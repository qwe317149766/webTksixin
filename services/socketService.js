const { Server } = require('socket.io');
const config = require('../config');
const { verifyToken } = require('./authService');
const TaskStore = require('../utils/taskStore');
const QuotaService = require('./quotaService');
const BatchRequester = require('../utils/BatchRequester');
const { sendText } = require('../tiktokWeb/TiktokApi');
const mysqlPool = require('../config/database');
  // 从 Redis 获取任务信息（如果 batchInfo 中没有完整信息）
const redis = require('../config/redis');
const BATCH_SIZE = config.task?.batchSize || 10;
const TASK_TOTAL_PREFIX = 'task:total';
const TASK_PROGRESS_PREFIX = 'task:progress';

function createRoomName(uid) {
  return `uid:${uid}`;
}

function getTaskTotalKey(taskId) {
  if (!taskId) throw new Error('taskId 不能为空');
  return `${TASK_TOTAL_PREFIX}:${taskId}`;
}

function getTaskProgressKey(taskId) {
  if (!taskId) throw new Error('taskId 不能为空');
  return `${TASK_PROGRESS_PREFIX}:${taskId}`;
}

async function getTaskTotals(taskId) {
  const taskInfoStr = await redis.get(`task:${taskId}`);
  if (taskInfoStr) {
    try {
      taskInfo = JSON.parse(taskInfoStr);
    } catch (e) {
      console.warn(`[Task] 解析任务信息失败 (taskId=${taskId}):`, e.message);
    }
  }
  const remainingStr = await redis.get(getTaskTotalKey(taskId));
  const remaining = Number(remainingStr || 0); 
  const progress = await redis.hgetall(getTaskProgressKey(taskId));
  const success = taskInfo.total - remaining;
  const fail = progress.fail || 0; //目前是0
  const completed = success + fail;
  const percent = Math.min(100, Math.round((success / taskInfo.total) * 100));
  return { total: taskInfo.total, success, fail, completed, remaining, percent };
}

async function incrementTaskProgress(taskId, field, amount = 1) {
  if (!taskId || !field) return 0;
  return redis.hincrby(getTaskProgressKey(taskId), field, amount);
}

async function emitTaskProgress(socketManager, uid, taskId) {
  try {
    const stats = await getTaskTotals(taskId);
    socketManager.emitToUid(uid, 'task:progress', {
      taskId,
      total: stats.total,
      success: stats.success,
      fail: stats.fail,
      completed: stats.completed,
      remaining: stats.remaining,
      progress: stats.percent,
    });
  } catch (error) {
    console.error(`[Task] 发送任务进度失败 (taskId=${taskId}):`, error.message);
  }
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
 * @param {string} taskId
 * @param {Function} onNeedMore
 * @param {Function} statusUpdater
 */
async function processBatchTasks(socketManager, tasks, taskId, onNeedMore, statusUpdater) {
  if (!tasks || tasks.length === 0) return;

  const tableName = 'uni_cookies_1'; // 默认表名，可以从配置或任务中获取
  let dbConnection = null;
  let taskInfo = null;

  try {
  
    const taskInfoStr = await redis.get(`task:${taskId}`);
    if (taskInfoStr) {
      try {
        taskInfo = JSON.parse(taskInfoStr);
      } catch (e) {
        console.warn(`[Task] 解析任务信息失败 (taskId=${taskId}):`, e.message);
      }
    }
  

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
    batchRequester.on('result', async (result) => {
        console.log('发送结果:', result);
        //判断各种状态 执行更新数据库 发送统计数据 扣减余额
        if (result.code === 0) {
          //更新redis中的待私信总数 -1 调用 quotaService 去减去余额
          let pendingResult = await QuotaService.decreaseTaskPendingCount({uid: result.uid, taskId: taskId, amount: 1});
          if (pendingResult.success) {
            console.log(`[Task] 用户 ${result.uid} 任务 ${taskId} 待私信总数 -1 成功`);
          } else {
            console.error(`[Task] 用户 ${result.uid} 任务 ${taskId} 待私信总数 -1 失败: ${pendingResult.message}`);
          }
          await incrementTaskProgress(taskId, 'success', 1);
          await emitTaskProgress(socketManager, result.uid, taskId);
          //发送任务统计到前端
          socketManager.emitToUid(result.uid, 'task:status', { status: 'completed', message: '任务已完成' });
        } else {
           console.error(`[Task] 用户 ${result.uid} 任务 ${taskId} 发送失败: ${result.message}`);
           //扣减失败停止任务
          //更改任务队列状态为停止
           await incrementTaskProgress(taskId, 'fail', 1);
           await emitTaskProgress(socketManager, result.uid, taskId);
           if (typeof statusUpdater === 'function') {
             await statusUpdater('stopped', '任务已完成');
           }
           socketManager.emitToUid(result.uid, 'task:status', { status: 'completed', message: '任务已完成' });
        }
    });

    batchRequester.on('done', () => {
      console.log('[BatchRequester] 所有任务完成');
      
    });

    batchRequester.on('needMore', (currentLength, neededLength) => {
      console.log(`[BatchRequester] 需要加载更多任务，当前队列长度: ${currentLength}，需要加载: ${neededLength}`);
      if (typeof onNeedMore === 'function') {
        onNeedMore(neededLength);
      }
    });

    batchRequester.on('error', (error) => {
      console.error('[BatchRequester] 任务执行错误:', error);
    });

    // 为每个任务分配一个 Cookie 并添加任务
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      // 优先使用 batchInfo，如果没有则使用 taskInfo
      const batchInfo = task.batchInfo || {};
      const finalTaskInfo = taskInfo || {};
      
      // 合并任务信息：batchInfo 优先，taskInfo 作为补充
      const content = batchInfo.content || finalTaskInfo.content || [];
      const msgType = batchInfo.msgType ?? finalTaskInfo.msgType ?? 0;
      const proxy = batchInfo.proxy || finalTaskInfo.proxy || '';
      const sendType = batchInfo.sendType ?? finalTaskInfo.sendType ?? 0;
      
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
      if (Array.isArray(content) && content.length > 0) {
        // 如果是数组，随机选择一个
        const randomIndex = Math.floor(Math.random() * content.length);
        textMsg = content[randomIndex] || '';
      } else if (typeof content === 'string') {
        // 如果是字符串，直接使用
        textMsg = content;
      }

      // 构建 sendText 参数 
      const requestData = {
        toUid: task.uid,
        textMsg: textMsg,
        cookieParams: cookiesText,
        proxy: proxy || null,
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
            taskId
          };
        } catch (error) {
          return {
            code: -10002,
            msg: error.message,
            data: { error: error.message },
            uid: task.uid,
            batchNo: task.batchNo,
            cookieId,
            taskId
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

function createTaskProcessor(socketManager, userId, taskId, statusChecker, statusUpdater) {
  let isProcessing = false;
  let shouldContinue = false;

  const triggerProcessing = async () => {
    if (!socketManager.hasConnections(userId)) {
      return;
    }

    // 检查任务状态，如果已停止则不继续处理
    if (statusChecker && !statusChecker()) {
      console.log(`[Task] 用户 ${userId} 任务 ${taskId} 已停止，不再处理`);
      return;
    }

    if (isProcessing) {
      shouldContinue = true;
      return;
    }

    isProcessing = true;
    shouldContinue = false;

    try {
      // 根据 taskId 过滤任务
      const tasks = await TaskStore.dequeueTask(userId, taskId, BATCH_SIZE);
      if (tasks && tasks.length > 0) {
        await processBatchTasks(socketManager, tasks, taskId, (neededLength) => {
          // 再次检查状态，如果已停止则不继续
          if (statusChecker && !statusChecker()) {
            console.log(`[Task] 用户 ${userId} 任务 ${taskId} 已停止，停止后续处理`);
            return;
          }
          // neededLength 表示需要加载的任务数量
          console.log(`[Task] 用户 ${userId} 任务 ${taskId} 需要加载 ${neededLength} 个任务`);
          shouldContinue = true;
        }, statusUpdater);
      } else {
        console.log(`[Task] 用户 ${userId} 任务 ${taskId} 队列为空，等待新的触发`);
        const hasPending = await TaskStore.hasPendingTasks(taskId);
        if (!hasPending && typeof statusUpdater === 'function') {
          await statusUpdater('idle', '任务队列已处理完成');
        }
      }
    } catch (error) {
      console.error(`任务轮询失败 (uid=${userId}, taskId=${taskId}):`, error);
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
      const taskId = socket.handshake.auth?.taskId || socket.handshake.query?.taskId;
      const user = await verifyToken(token);
      if (!user || !user.uid) {
        return next(new Error('AUTH_FAILED'));
      }
      if (!taskId) {
        return next(new Error('TASKID_REQUIRED'));
      }
      socket.data.user = user;
      socket.data.taskId = taskId;
      return next();
    } catch (error) {
      return next(error);
    }
  });

  const socketManager = new SocketManager(io);
  const userTaskProcessors = new Map();
  // 用户任务状态管理：uid -> { isRunning: boolean, triggerFn: function }
  const userTaskStatus = new Map();

  io.on('connection', async (socket) => {
    const { uid } = socket.data.user;
    const taskId = socket.data.taskId;
    socketManager.bind(uid, socket);
    console.log(`[Socket] 用户 ${uid} 已连接，taskId=${taskId}，socketId=${socket.id}`);

    socket.emit('connected', { uid, taskId });

    // 使用 taskId 作为 key，因为同一个用户可能有多个任务
    const taskKey = `${uid}:${taskId}`;
    
    const broadcastStatus = (status, message) => {
      const payload = { 
        isRunning: status === 'running',
        status,
        message:
          message ||
          (status === 'running'
            ? '任务处理中'
            : status === 'stopped'
              ? '任务已停止'
              : '任务已完成或待命'),
        taskId,
      };
      socketManager.emitToUid(uid, 'task:status', payload);
    };

    const existingStatus = await TaskStore.ensureTaskStatus(taskId, uid);

    // 初始化任务处理器和状态
    let taskStatus = userTaskStatus.get(taskKey);
    if (!taskStatus) {
      taskStatus = {
        status: existingStatus.status,
        isRunning: existingStatus.status === 'running',
        triggerFn: null,
      };
      userTaskStatus.set(taskKey, taskStatus);
    } else {
      taskStatus.status = existingStatus.status;
      taskStatus.isRunning = existingStatus.status === 'running';
    }

    const statusChecker = () => {
      const status = userTaskStatus.get(taskKey);
      return status ? status.status === 'running' : false;
    };

    const updateStatus = async (newStatus, message, extra = {}) => {
      await TaskStore.setTaskStatus(taskId, newStatus, { userId: uid, ...extra });
      const state = userTaskStatus.get(taskKey);
      if (state) {
        state.status = newStatus;
        state.isRunning = newStatus === 'running';
      } else {
        userTaskStatus.set(taskKey, {
          status: newStatus,
          isRunning: newStatus === 'running',
        });
      }
      broadcastStatus(newStatus, message);
    };

    const triggerTaskProcessing = createTaskProcessor(
      socketManager,
      uid,
      taskId,
      statusChecker,
      updateStatus
    );
    taskStatus.triggerFn = triggerTaskProcessing;
    userTaskProcessors.set(taskKey, triggerTaskProcessing);

    // 发送当前任务状态
    broadcastStatus(taskStatus.status, null);

    // Socket 连接成功并完成鉴权后，如果任务正在运行，立即触发任务处理
    if (taskStatus.isRunning) {
      taskStatus.triggerFn();
    }

    // 开始任务事件
    socket.on('task:start', async (data, callback) => {
      console.log(`[Socket] 用户 ${uid} 任务 ${taskId} 请求开始任务`);

      const latestStatus = await TaskStore.getTaskStatus(taskId);
      const currentStatus = latestStatus?.status || taskStatus.status;

      if (currentStatus === 'running') {
        const response = { success: false, message: '任务已在运行中' };
        broadcastStatus('running', '任务已在运行中');
        if (typeof callback === 'function') {
          callback(response);
        }
        return;
      }

      await updateStatus('running', '任务已开始');
      await emitTaskProgress(socketManager, uid, taskId);
      taskStatus.triggerFn();
      
      const response = { success: true, message: '任务已开始' };
      console.log(`[Socket] 用户 ${uid} 任务 ${taskId} 已开始`);
      
      if (typeof callback === 'function') {
        callback(response);
      }
    });

    // 停止任务事件
    socket.on('task:stop', async (data, callback) => {
      console.log(`[Socket] 用户 ${uid} 任务 ${taskId} 请求停止任务`);
      
      if (!taskStatus.isRunning) {
        const response = { success: false, message: '任务已停止' };
        broadcastStatus(taskStatus.status || 'stopped', '任务已停止');
        if (typeof callback === 'function') {
          callback(response);
        }
        return;
      }

      await updateStatus('stopped', '任务已停止', { stoppedBy: uid });
      
      const response = { success: true, message: '任务已停止' };
      console.log(`[Socket] 用户 ${uid} 任务 ${taskId} 已停止`);
      
      if (typeof callback === 'function') {
        callback(response);
      }
    });

    // 获取任务状态事件
    socket.on('task:getStatus', async (data, callback) => {
      const latestStatus = await TaskStore.getTaskStatus(taskId);
      const statusValue = latestStatus?.status || taskStatus.status || 'idle';
      const isRunning = statusValue === 'running';
      const response = {
        success: true,
        isRunning,
        taskId,
        status: statusValue,
        message:
          latestStatus?.message ||
          (statusValue === 'running'
            ? '任务处理中'
            : statusValue === 'stopped'
              ? '任务已停止'
              : '任务已完成或待命'),
      };
      broadcastStatus(statusValue, response.message);
      if (typeof callback === 'function') {
        callback(response);
      }
    });

    socket.on('disconnect', () => {
      socketManager.unbind(uid, socket.id);
      console.log(`[Socket] 用户 ${uid} 已断开，socketId=${socket.id}`);
      if (!socketManager.hasConnections(uid)) {
        userTaskProcessors.delete(taskKey);
        userTaskStatus.delete(taskKey);
      }
    });
  });

  // 返回 io 实例，供外部使用
  return io;
}

module.exports = {
  initSocketServer,
};

