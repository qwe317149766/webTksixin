const { Server } = require('socket.io');
const config = require('../config');
const { verifyToken } = require('./authService');
const TaskStore = require('../utils/taskStore');
const QuotaService = require('./quotaService');
const BatchRequester = require('../utils/BatchRequester');
const { sendText } = require('../tiktokWeb/TiktokApi');
const mysqlPool = require('../config/database');

const BATCH_SIZE = config.task?.batchSize || 10;

function createRoomName(uid) {
  return `uid:${uid}`;
}

class SocketManager {
  constructor(io) {
    this.io = io;
    this.uidSockets = new Map(); // uid -> Set(socketId)
  }

  bind(uid, socket) {
    const room = createRoomName(uid);
    socket.join(room);
    const set = this.uidSockets.get(uid) || new Set();
    set.add(socket.id);
    this.uidSockets.set(uid, set);
  }

  unbind(uid, socketId) {
    const set = this.uidSockets.get(uid);
    if (!set) return;
    set.delete(socketId);
    if (!set.size) {
      this.uidSockets.delete(uid);
    }
  }

  emitToUid(uid, event, payload) {
    const room = createRoomName(uid);
    const roomInfo = this.io.sockets.adapter.rooms.get(room);
    if (!roomInfo || roomInfo.size === 0) {
      return false;
    }
    this.io.to(room).emit(event, payload);
    return true;
  }

  hasConnections(uid) {
    const set = this.uidSockets.get(uid);
    return !!(set && set.size > 0);
  }
}

/**
 * 解析 Cookie 字符串
 */
function parseCookieString(cookieStr) {
  if (!cookieStr || typeof cookieStr !== 'string') {
    return {};
  }
  
  const cookieObj = {};
  if (cookieStr.startsWith('{') && cookieStr.endsWith('}')) {
    try {
      return JSON.parse(cookieStr);
    } catch (e) {
      // 如果不是有效 JSON，继续按字符串解析
    }
  }
  
  cookieStr.split(';').forEach(part => {
    const [key, ...val] = part.trim().split('=');
    if (key && val.length > 0) {
      cookieObj[key] = val.join('=');
    }
  });
  
  return cookieObj;
}

 async  function getAlivableCookies(dbConnection, tableName,totalNum) {
    // 获取配置的分配比例
    const cookieRatio = config.task?.cookieRatio || {
      multiplier: 1.5,
      priority1Ratio: 2/3,
      priority0Ratio: 1/3,
    };

    // 计算需要获取的 cookies 数量
    const totalCookiesNeeded = Math.ceil(totalNum * cookieRatio.multiplier);
    const priority1Count = Math.ceil(totalCookiesNeeded * cookieRatio.priority1Ratio);
    const priority0Count = Math.ceil(totalCookiesNeeded * cookieRatio.priority0Ratio);

    console.log(`[Task] 需要获取 ${totalCookiesNeeded} 个 cookies (priority_code=1: ${priority1Count}, priority_code=0: ${priority0Count})`);

    // 从数据库获取 priority_code=1 的 cookies
    const [priority1Cookies] = await dbConnection.execute(
      `SELECT id, cookies_text, ck_uid, used_count 
       FROM ${tableName} 
       WHERE status = 1 AND priority_code = 1
       ORDER BY used_count ASC, update_time DESC 
       LIMIT ?`,
      [priority1Count]
    );

    // 从数据库获取 priority_code=0 的 cookies
    const [priority0Cookies] = await dbConnection.execute(
      `SELECT id, cookies_text, ck_uid, used_count 
       FROM ${tableName} 
       WHERE status = 1 AND priority_code = 0
       ORDER BY used_count ASC, update_time DESC 
       LIMIT ?`,
      [priority0Count]
    );

    // 合并所有 cookies（优先使用 priority_code=1 的）
    return [...priority1Cookies, ...priority0Cookies];
 }

/**
 * 批量处理任务，使用 BatchRequester 执行 sendText
 * @param {SocketManager} socketManager
 * @param {Array} tasks
 */
async function processBatchTasks(socketManager, tasks, onNeedMore) {
  if (!tasks || tasks.length === 0) return;

  const tableName = 'uni_cookies_1'; // 默认表名，可以从配置或任务中获取
  let dbConnection = null;

  try {
    // 获取数据库连接
    dbConnection = await mysqlPool.getConnection();

    // 获取配置的分配比例
    const cookieRatio = config.task?.cookieRatio || {
      multiplier: 1.5,
      priority1Ratio: 2/3,
      priority0Ratio: 1/3,
    };

    // 计算需要获取的 cookies 数量
    const totalCookiesNeeded = Math.ceil(tasks.length * cookieRatio.multiplier);
    const priority1Count = Math.ceil(totalCookiesNeeded * cookieRatio.priority1Ratio);
    const priority0Count = Math.ceil(totalCookiesNeeded * cookieRatio.priority0Ratio);

    console.log(`[Task] 需要获取 ${totalCookiesNeeded} 个 cookies (priority_code=1: ${priority1Count}, priority_code=0: ${priority0Count})`);

    const allCookies = await getAlivableCookies(dbConnection, tableName, tasks.length);

    if (allCookies.length === 0) {
      console.warn(`[Task] 未找到可用 Cookie，跳过本次批量处理`);
      return;
    }

    console.log(`[Task] 实际获取到 ${allCookies.length} 个 cookies `);

    // 创建 BatchRequester 实例
    const batchRequester = new BatchRequester({
      sdk: null, // 函数模式下不需要 SDK
      concurrency: config.task?.concurrency || 10,
      lowThreshold: config.task?.lowThreshold || 50,
    });

    // 监听结果
    batchRequester.on('result', (result) => {
        console.log('发送结果:', result);
        //判断各种状态 执行更新数据库 发送统计数据 扣减余额
    });

    batchRequester.on('done', () => {
      console.log('[BatchRequester] 所有任务完成');
      
    });

    batchRequester.on('needMore', (length) => {
      console.log(`[BatchRequester] 需要加载更多任务，当前队列长度: ${length}`);
      if (typeof onNeedMore === 'function') {
        onNeedMore();
      }
    });

    batchRequester.on('error', (error) => {
      console.error('[BatchRequester] 任务执行错误:', error);
    });

    // 为每个任务分配一个 Cookie 并添加任务
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const batchInfo = task.batchInfo || {};
      
      // 从已获取的 cookies 中分配（循环使用）
      const cookieIndex = i % allCookies.length;
      const cookieRecord = allCookies[cookieIndex];
      
      if (!cookieRecord) {
        console.warn(`[Task] 任务 ${task.uid} 未找到可用 Cookie，跳过`);
        continue;
      }

      const cookiesText = cookieRecord.cookies_text;
      const cookieId = cookieRecord.id;
      
      // 解析 Cookie 获取 user_agent 和 device_id
      const cookieObj = parseCookieString(cookiesText);
      const userAgent = cookieObj['User-Agent'] || cookieObj['user-agent'] || null;
      const deviceId = cookieObj.device_id || null;

      // 计算序列 ID
      const createSequenceId = Math.floor(Math.random() * 2001) + 10000; // 10000-12000
      const sendSequenceId = createSequenceId + 1;

      // 从 content 数组中随机选择消息内容
      let textMsg = '';
      if (Array.isArray(batchInfo.content) && batchInfo.content.length > 0) {
        // 如果是数组，随机选择一个
        const randomIndex = Math.floor(Math.random() * batchInfo.content.length);
        textMsg = batchInfo.content[randomIndex] || '';
      } else if (typeof batchInfo.content === 'string') {
        // 如果是字符串，直接使用
        textMsg = batchInfo.content;
      }

      // 构建 sendText 参数
      const requestData = {
        toUid: task.uid,
        textMsg: textMsg,
        cookieParams: cookiesText,
        proxy: batchInfo.proxy || null,
        user_agent: userAgent,
        device_id: deviceId,
        createSequenceId,
        sendSequenceId,
      };

      // 使用函数模式添加任务
      batchRequester.addTask(async () => {
        try {
          // 执行 sendText
          const result = await sendText(requestData);
          
          // 更新 Cookie 使用次数
          try {
            await dbConnection.execute(
              `UPDATE ${tableName} SET used_count = used_count + 1, update_time = UNIX_TIMESTAMP() WHERE id = ?`,
              [cookieId]
            );
          } catch (updateError) {
            console.error(`[Task] 更新 Cookie 使用次数失败 (ID: ${cookieId}):`, updateError.message);
          }
          // 返回结果，包含任务信息
          return {
            ...result,
            uid: task.uid,
            batchNo: task.batchNo,
            cookieId,
          };
        } catch (error) {
          return {
            code: -10002,
            msg: error.message,
            data: { error: error.message },
            uid: task.uid,
            batchNo: task.batchNo,
            cookieId,
          };
        }
      });
    }

    // 启动批量处理
    batchRequester.start();

  } catch (error) {
    console.error('[Task] 批量处理任务失败:', error);
  } finally {
    if (dbConnection) {
      dbConnection.release();
    }
  }
}

function createTaskProcessor(socketManager, userId, statusChecker) {
  let isProcessing = false;
  let shouldContinue = false;

  const triggerProcessing = async () => {
    if (!socketManager.hasConnections(userId)) {
      return;
    }

    // 检查任务状态，如果已停止则不继续处理
    if (statusChecker && !statusChecker()) {
      console.log(`[Task] 用户 ${userId} 任务已停止，不再处理`);
      return;
    }

    if (isProcessing) {
      shouldContinue = true;
      return;
    }

    isProcessing = true;
    shouldContinue = false;

    try {
      const tasks = await TaskStore.dequeueTask(userId, BATCH_SIZE);
      if (tasks && tasks.length > 0) {
        await processBatchTasks(socketManager, tasks, () => {
          // 再次检查状态，如果已停止则不继续
          if (statusChecker && !statusChecker()) {
            console.log(`[Task] 用户 ${userId} 任务已停止，停止后续处理`);
            return;
          }
          shouldContinue = true;
        });
      } else {
        console.log(`[Task] 用户 ${userId} 队列为空，等待新的触发`);
      }
    } catch (error) {
      console.error(`任务轮询失败 (uid=${userId}):`, error);
    } finally {
      isProcessing = false;
      if (shouldContinue && (!statusChecker || statusChecker())) {
        shouldContinue = false;
        setImmediate(triggerProcessing);
      }
    }
  };

  return triggerProcessing;
}

function initSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: config.cors || { origin: '*', methods: ['GET', 'POST'] },
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      const user = await verifyToken(token);
      if (!user || !user.uid) {
        return next(new Error('AUTH_FAILED'));
      }
      socket.data.user = user;
      return next();
    } catch (error) {
      return next(error);
    }
  });

  const socketManager = new SocketManager(io);
  const userTaskProcessors = new Map();
  // 用户任务状态管理：uid -> { isRunning: boolean, triggerFn: function }
  const userTaskStatus = new Map();

  io.on('connection', (socket) => {
    const { uid } = socket.data.user;
    socketManager.bind(uid, socket);
    console.log(`[Socket] 用户 ${uid} 已连接，socketId=${socket.id}`);

    socket.emit('connected', { uid });

    // 初始化任务处理器和状态
    let taskStatus = userTaskStatus.get(uid);
    if (!taskStatus) {
      // 创建状态检查函数
      const statusChecker = () => {
        const status = userTaskStatus.get(uid);
        return status ? status.isRunning : false;
      };
      
      const triggerTaskProcessing = createTaskProcessor(socketManager, uid, statusChecker);
      taskStatus = {
        isRunning: true, // 默认自动开始
        triggerFn: triggerTaskProcessing,
      };
      userTaskStatus.set(uid, taskStatus);
      userTaskProcessors.set(uid, triggerTaskProcessing);
    }

    // 发送当前任务状态
    socket.emit('task:status', { 
      isRunning: taskStatus.isRunning,
      message: taskStatus.isRunning ? '任务处理中' : '任务已停止'
    });

    // Socket 连接成功并完成鉴权后，如果任务正在运行，立即触发任务处理
    if (taskStatus.isRunning) {
      taskStatus.triggerFn();
    }

    // 开始任务事件
    socket.on('task:start', (data, callback) => {
      console.log(`[Socket] 用户 ${uid} 请求开始任务`);
      
      if (taskStatus.isRunning) {
        const response = { success: false, message: '任务已在运行中' };
        socket.emit('task:status', { isRunning: true, message: '任务已在运行中' });
        if (typeof callback === 'function') {
          callback(response);
        }
        return;
      }

      taskStatus.isRunning = true;
      taskStatus.triggerFn();
      
      const response = { success: true, message: '任务已开始' };
      socket.emit('task:status', { isRunning: true, message: '任务已开始' });
      console.log(`[Socket] 用户 ${uid} 任务已开始`);
      
      if (typeof callback === 'function') {
        callback(response);
      }
    });

    // 停止任务事件
    socket.on('task:stop', (data, callback) => {
      console.log(`[Socket] 用户 ${uid} 请求停止任务`);
      
      if (!taskStatus.isRunning) {
        const response = { success: false, message: '任务已停止' };
        socket.emit('task:status', { isRunning: false, message: '任务已停止' });
        if (typeof callback === 'function') {
          callback(response);
        }
        return;
      }

      taskStatus.isRunning = false;
      
      const response = { success: true, message: '任务已停止' };
      socket.emit('task:status', { isRunning: false, message: '任务已停止' });
      console.log(`[Socket] 用户 ${uid} 任务已停止`);
      
      if (typeof callback === 'function') {
        callback(response);
      }
    });

    // 获取任务状态事件
    socket.on('task:getStatus', (data, callback) => {
      const response = {
        success: true,
        isRunning: taskStatus.isRunning,
        message: taskStatus.isRunning ? '任务处理中' : '任务已停止'
      };
      socket.emit('task:status', { 
        isRunning: taskStatus.isRunning, 
        message: response.message 
      });
      if (typeof callback === 'function') {
        callback(response);
      }
    });

    socket.on('disconnect', () => {
      socketManager.unbind(uid, socket.id);
      console.log(`[Socket] 用户 ${uid} 已断开，socketId=${socket.id}`);
      if (!socketManager.hasConnections(uid)) {
        userTaskProcessors.delete(uid);
        userTaskStatus.delete(uid);
      }
    });
  });

  // 返回 io 实例，供外部使用
  return io;
}

module.exports = {
  initSocketServer,
};

