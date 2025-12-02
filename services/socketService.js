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

// 针对用户 + 任务的 BatchRequester 单例
const taskRequesters = new Map(); // key: `${userId}:${taskId}` -> BatchRequester

// 待发送人与 Cookie 的全局映射关系：每个 uid（接收者）在整个系统中只能被分配一次 cookie
const uidCookieMap = new Map(); // key: `${uid}` -> { cookieId, cookies_text, cookieRecord, taskId }

// 跟踪每个 BatchRequester 的 done 事件是否已被处理，防止重复触发
const batchRequesterDoneFlags = new Map(); // key: `${userId}:${taskId}` -> boolean

// 跟踪每个任务的执行次数
const taskExecutionCounts = new Map(); // key: `${userId}:${taskId}` -> { total: number, success: number, fail: number }

// 跟踪每个 cookieId 的连续 -10001 错误次数
const cookieError10001Counts = new Map(); // key: `${cookieId}` -> number

// 全局任务处理器映射，用于外部触发任务处理
const globalTaskProcessors = new Map(); // key: `${userId}:${taskId}` -> triggerFn

function getTaskRequesterKey(userId, taskId) {
  return `${userId}:${taskId}`;
}

async function getOrCreateBatchRequester(socketManager, userId, taskId, onNeedMore, statusUpdater) {
  const key = getTaskRequesterKey(userId, taskId);
  let batchRequester = taskRequesters.get(key);
  
  // 检查任务状态
  const taskStatus = await TaskStore.getTaskStatus(taskId);
  const currentStatus = taskStatus?.status || 'idle';
  
  if (batchRequester) {
    // BatchRequester 已存在，检查状态是否需要重新启动或停止
    if (currentStatus === 'idle' && batchRequester.running) {
      // 任务状态为 idle，但 BatchRequester 正在运行，需要停止
      console.log(`[BatchRequester] 任务 ${taskId} 状态为 idle，停止 BatchRequester`);
      batchRequester.stop();
    } else if (currentStatus === 'stopped' && batchRequester.running) {
      // 任务状态为 stopped，但 BatchRequester 正在运行，需要停止
      console.log(`[BatchRequester] 任务 ${taskId} 状态为 stopped，停止 BatchRequester`);
      batchRequester.stop();
    } else if (currentStatus === 'stopped' && !batchRequester.running) {
      // 任务状态为 stopped，但 BatchRequester 已停止，需要重新启动任务
      console.log(`[BatchRequester] 任务 ${taskId} 状态为 stopped，重新启动 BatchRequester`);
      // 重置 done 标志，因为这是新的任务批次
      batchRequesterDoneFlags.delete(key);
      batchRequester.start();
    } else if (currentStatus === 'running' && !batchRequester.running) {
      // 任务状态为 running，但 BatchRequester 已停止，需要重新启动
      console.log(`[BatchRequester] 任务 ${taskId} 状态为 running，重新启动 BatchRequester`);
      // 重置 done 标志，因为这是新的任务批次
      batchRequesterDoneFlags.delete(key);
      batchRequester.start();
    }
    return batchRequester;
  }

  // 如果 BatchRequester 不存在，但任务状态为 idle，不应该创建新的
  if (currentStatus === 'idle') {
    console.log(`[BatchRequester] 任务 ${taskId} 状态为 idle，不创建新的 BatchRequester`);
    return null;
  }

  // 清理旧的 done 标志（如果有），确保新的 BatchRequester 可以正常触发 done 事件
  batchRequesterDoneFlags.delete(key);

  batchRequester = new BatchRequester({
    sdk: null, // 函数模式下不需要 SDK
    concurrency: config.task?.concurrency || 10,
    lowThreshold: config.task?.lowThreshold || 50,
  });

  // 统一结果处理：更新配额、进度、Cookie 状态等
  batchRequester.on('result', async (result) => {
    const tableName = 'uni_cookies_1';
    let dbConnection = null;
    let {task} = result.data;
    const taskIdFromResult = task.taskId;
    console.log('taskIdFromResult:',taskIdFromResult)
    try {
      dbConnection = await mysqlPool.getConnection();
      if (result.code === 0) {
        // 成功：待私信总数 -1，更新使用次数，进度 +1
        let pendingResult = await QuotaService.decreaseTaskPendingCount({
          uid: result.uid,
          taskId: taskIdFromResult,
          amount: 1,
        });
        console.log('执行扣减!')
        console.log('taskIdFromResult:',pendingResult)
        //如果条数扣减失败直接停止队列任务，发送到前端 任务已完成,停止队列任务
        if (!pendingResult.success) {
          console.log('任务已完成')
          batchRequester.stop();
          //更新队列的运行状态
          await statusUpdater('idle', '任务队列已处理完成');
          return;
        }
        console.log(
          `[Task] 用户 ${task.uid} 任务 ${taskIdFromResult} 待私信总数 -1 成功`
        );
        try {
          await dbConnection.execute(
            `UPDATE ${tableName} SET used_count = used_count + 1, update_time = UNIX_TIMESTAMP() WHERE id = ?`,
            [result.cookieId]
          );
        } catch (updateError) {
          console.error(
            `[Task] 更新 Cookie 使用次数失败 (ID: ${result.cookieId}):`,
            updateError.message
          );
        }

        await incrementTaskProgress(taskIdFromResult, 'success', 1);
        await emitTaskProgress(socketManager, result.uid, taskIdFromResult);
        
        // 更新任务执行次数统计（成功）
        const countKey = getTaskRequesterKey(userId, taskIdFromResult);
        const counts = taskExecutionCounts.get(countKey) || { total: 0, success: 0, fail: 0 };
        counts.total++;
        counts.success++;
        taskExecutionCounts.set(countKey, counts);
        console.log(`[Task] 任务执行次数统计 - 任务 ${taskIdFromResult} (用户 ${userId}): 总计=${counts.total}, 成功=${counts.success}, 失败=${counts.fail}`);
        
        // 任务成功，从 uidCookieMap 中删除映射（使用完毕，允许在其他任务中使用）
        const receiverUid = result.uid;
        if (receiverUid) {
          const uidKey = String(receiverUid);
          if (uidCookieMap.has(uidKey)) {
            const cookieMapping = uidCookieMap.get(uidKey);
            uidCookieMap.delete(uidKey);
            console.log(`[Task] 任务成功，清理接收者 ${receiverUid} 的 Cookie 映射 (Cookie ID: ${cookieMapping.cookieId})，使用完毕`);
            // 任务成功，重置该 cookieId 的连续错误计数
            if (cookieMapping.cookieId) {
              cookieError10001Counts.delete(cookieMapping.cookieId);
            }
          }
        }
      } else {
        const data = result.data || {};
        const taskIdFromResult = task.taskId;
        const cookieId = data.cookieId || result.cookieId;
        console.log('cookieId:',cookieId,data.code)
        // 不同错误码更新 Cookie 状态
        let needRetry = false;
        let tongJs = true
        console.log("[data.code]:",data.code)
        
        // 如果不是 -10001 错误，重置该 cookieId 的连续错误计数
        if (data.code !== -10001 && cookieId) {
          cookieError10001Counts.delete(cookieId);
        }
        
        if (data.code === -10001) {
          // 处理 -10001 错误，跟踪连续错误次数
          if (cookieId) {
            const currentCount = (cookieError10001Counts.get(cookieId) || 0) + 1;
            cookieError10001Counts.set(cookieId, currentCount);
            
            console.log(
              `[Task] 用户 ${task.uid} 任务 ${taskIdFromResult} 错误码 -10001 (Cookie ID: ${cookieId})，连续错误次数: ${currentCount}`
            );
            
            // 如果连续超过3次，将账号状态改为已退出
            if (currentCount >= 3) {
              console.log(
                `[Task] Cookie ID ${cookieId} 连续 ${currentCount} 次返回 -10001，将账号状态改为已退出`
              );
              await dbConnection.execute(
                `UPDATE ${tableName} SET status = 3 WHERE id = ?`,
                [cookieId]
              );
              // 清除计数器
              cookieError10001Counts.delete(cookieId);
              needRetry = true;
            } else {
              // 未达到3次，继续重试
              needRetry = true;
            }
          } else {
            // 没有 cookieId，直接重试
            needRetry = true;
          }
        } else if (data.code === -10000) {
          console.log(
            `[Task] 用户 ${task.uid} 任务 ${taskIdFromResult} 维护社区: ${JSON.stringify(
              data.data
            )}`
          );
          await dbConnection.execute(
            `UPDATE ${tableName} SET status = 5 WHERE id = ?`,
            [cookieId]
          );
          needRetry = true;
        } else if (data.code === -1) {
          console.log(
            `[Task] 用户 ${task.uid} 任务 ${taskIdFromResult} 退出状态: ${JSON.stringify(
              data.data
            )}`
          );
          await dbConnection.execute(
            `UPDATE ${tableName} SET status = 3 WHERE id = ?`,
            [cookieId]
          );
          needRetry = true;
        } else if (data.code === 10004) {
          console.log(
            `[Task] 用户 ${task.uid} 任务 ${taskIdFromResult} 发送端被限制: ${JSON.stringify(
              data.data
            )}`
          );
          await dbConnection.execute(
            `UPDATE ${tableName} SET status = 2 WHERE id = ?`,
            [cookieId]
          );
          needRetry = true;
        } else if (data.code === 10002) {
          console.log(
            `[Task] 用户 ${task.uid} 任务 ${taskIdFromResult} 发送太快: ${JSON.stringify(
              data.data
            )}`
          );
          await dbConnection.execute(
            `UPDATE ${tableName} SET status = 6 WHERE id = ?`,
            [cookieId]
          );
          needRetry = true;
        } else if (data.code === -10002) {
          console.log(
            `[Task] 用户 ${task.uid} 任务 ${taskIdFromResult} 网络异常: ${JSON.stringify(
              data.data
            )}`
          );
          tongJs = false
          needRetry = true;
        } else {
          console.error(
            `[Task] 用户 ${task.uid} 任务 ${taskIdFromResult} 发送失败: ${JSON.stringify(
              data.data
            )}`
          );
          needRetry = true;
        }
        // 任务失败，从 uidCookieMap 中删除映射，允许重新分配
        const receiverUid = result.uid || task.uid;
        if (receiverUid) {
          const uidKey = String(receiverUid);
          if (uidCookieMap.has(uidKey)) {
            const cookieMapping = uidCookieMap.get(uidKey);
            uidCookieMap.delete(uidKey);
            console.log(`[Task] 任务失败，清理接收者 ${receiverUid} 的 Cookie 映射 (Cookie ID: ${cookieMapping.cookieId})，允许重新分配`);
          }
        }
        
        if (needRetry) {
          console.log('重新添加队列',task)
          const queueKey = TaskStore.getQueueKey(task.userId, task.taskId)
          console.log('queueKey:',queueKey)
          const retryResult = await redis.zadd(queueKey, Date.now(), JSON.stringify(task));
          console.log("retryResult:",retryResult)
        }
        if (tongJs) {
          await incrementTaskProgress(task.taskId, 'fail', 1);
          await emitTaskProgress(socketManager, task.userId, taskIdFromResult);
        }
        
        // 更新任务执行次数统计（失败）
        const countKey = getTaskRequesterKey(task.userId, taskIdFromResult);
        const counts = taskExecutionCounts.get(countKey) || { total: 0, success: 0, fail: 0 };
        counts.total++;
        counts.fail++;
        taskExecutionCounts.set(countKey, counts);
        console.log(`[Task] 任务执行次数统计 - 任务 ${taskIdFromResult} (用户 ${task.userId}): 总计=${counts.total}, 成功=${counts.success}, 失败=${counts.fail}`);
      }
    } catch (err) {
      console.error('[BatchRequester] 结果处理失败:', err);
    } finally {
      if (dbConnection) {
        dbConnection.release();
      }
    }
  });

  batchRequester.on('needMore', (currentLength, neededLength) => {
    console.log(
      `[BatchRequester] 需要加载更多任务，当前队列长度: ${currentLength}，需要加载: ${neededLength}`
    );
    if (typeof onNeedMore === 'function') {
      onNeedMore(neededLength);
    }
  });

  batchRequester.on('done', async () => {
    // 检查是否已经处理过 done 事件，防止重复触发
    if (batchRequesterDoneFlags.get(key)) {
      console.log(`[BatchRequester] 任务 ${taskId} 的 done 事件已处理过，跳过重复处理`);
      return;
    }
    
    // 标记为已处理
    batchRequesterDoneFlags.set(key, true);
    
    console.log('[BatchRequester] 所有任务完成');
    
    // 打印最终的任务执行次数统计
    const finalCounts = taskExecutionCounts.get(key);
    if (finalCounts) {
      console.log(`[Task] 任务执行次数最终统计 - 任务 ${taskId} (用户 ${userId}): 总计=${finalCounts.total}, 成功=${finalCounts.success}, 失败=${finalCounts.fail}, 成功率=${finalCounts.total > 0 ? ((finalCounts.success / finalCounts.total) * 100).toFixed(2) : 0}%`);
    } else {
      console.log(`[Task] 任务执行次数最终统计 - 任务 ${taskId} (用户 ${userId}): 无执行记录`);
    }
    
    try {
      const hasPending = await TaskStore.hasPendingTasks(taskId);
      if (!hasPending && typeof statusUpdater === 'function') {
        await statusUpdater('idle', '任务队列已处理完成');
        // 注意：不清理 uidCookieMap，因为每个 uid 在整个系统中只能被分配一次
        // 如果清理了，其他任务可能会再次分配这个 uid，导致重复发送
        // 如果需要清理，应该在任务完全完成且确认不再需要时手动清理
      }
    } catch (error) {
      console.error('[BatchRequester] done 检查任务状态失败:', error);
    } finally {
      console.log('key:',key)
      taskRequesters.delete(key);
      batchRequesterDoneFlags.delete(key);
      // 清理执行次数统计（可选，如果需要保留历史记录可以不删除）
      // taskExecutionCounts.delete(key);
    }
  });

  batchRequester.on('error', (error) => {
    console.error('[BatchRequester] 任务执行错误:', error);
  });

  batchRequester.start();
  taskRequesters.set(key, batchRequester);
  return batchRequester;
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

    const allCookies = await getAlivableCookies(dbConnection, tableName, tasks.length);

    if (allCookies.length === 0) {
      console.warn(`[Task] 未找到可用 Cookie，休息10秒后重新处理`);
      
      // 等待10秒
      await new Promise(resolve => setTimeout(resolve, 10000));
      
      // 将任务重新放回队列
      const userId = tasks[0]?.userId;
      if (userId) {
        for (const task of tasks) {
          if (!task.taskId) {
            console.warn(`[Task] 任务缺少 taskId，跳过:`, task);
            continue;
          }
          const queueKey = TaskStore.getQueueKey(task.userId, task.taskId);
          const entry = JSON.stringify({
            batchNo: task.batchNo,
            taskId: task.taskId,
            uid: task.uid,
            userId: task.userId
          });
          await redis.zadd(queueKey, Date.now(), entry);
        }
        console.log(`[Task] 已将 ${tasks.length} 个任务重新放回队列，等待重新处理`);
        // 触发 onNeedMore 回调，让上层重新获取任务
        if (typeof onNeedMore === 'function') {
          onNeedMore(tasks.length);
        }
      }
      return;
    }

    console.log(`[Task] 实际获取到 ${allCookies.length} 个 cookies `);

    // 为当前用户 + 任务获取（或创建）单例 BatchRequester
    const userId = tasks[0]?.userId;
    const batchRequester = await getOrCreateBatchRequester(
      socketManager,
      userId,
      taskId,
      onNeedMore,
      statusUpdater
    );

    // 如果 BatchRequester 为 null（状态为 idle），跳过本次批量处理
    if (!batchRequester) {
      console.log(`[Task] 任务 ${taskId} 状态为 idle，跳过批量处理`);
      return;
    }

    // 为每个任务分配一个 Cookie 并添加任务
    // 记录已使用的 cookie ID，避免重复分配
    const usedCookieIds = new Set();
    
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
      
      // 检查该 uid（接收者）是否已经在全局范围内分配过 cookie
      const uidKey = String(task.uid);
      let cookieMapping = uidCookieMap.get(uidKey);
      
      if (cookieMapping) {
        // 该 uid 已经被分配过 cookie，不能重复分配，跳过此任务
        console.log(`[Task] 接收者 ${task.uid} 已被分配过 Cookie (ID: ${cookieMapping.cookieId}, 任务: ${cookieMapping.taskId})，跳过，不能重复发送`);
        continue;
      }
      
      // 未分配过，从可用 cookies 中选择一个（优先选择未使用的）
      let selectedCookie = null;
      
      // 先尝试选择未使用的 cookie
      for (let j = 0; j < allCookies.length; j++) {
        const cookie = allCookies[j];
        if (!usedCookieIds.has(cookie.id)) {
          selectedCookie = cookie;
          break;
        }
      }
      
      // 如果所有 cookie 都被使用过，则按顺序选择
      if (!selectedCookie && allCookies.length > 0) {
        selectedCookie = allCookies[i % allCookies.length];
      }
      
      if (!selectedCookie) {
        console.warn(`[Task] 任务 ${taskId} 的接收者 ${task.uid} 未找到可用 Cookie，跳过`);
        continue;
      }
      
      const cookieRecord = selectedCookie;
      const cookiesText = cookieRecord.cookies_text;
      const cookieId = cookieRecord.id;
      
      // 记录全局映射关系：uid -> cookie（每个 uid 只能被分配一次）
      uidCookieMap.set(uidKey, {
        cookieId,
        cookies_text: cookiesText,
        cookieRecord,
        taskId  // 记录是哪个任务分配的
      });
      usedCookieIds.add(cookieId);
      
      console.log(`[Task] 接收者 ${task.uid} 分配新 Cookie (ID: ${cookieId})，任务: ${taskId}`);
      
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

      // 使用函数模式添加任务，仅负责调用 sendText 并返回结果
      batchRequester.addTask(async () => {
        try {
          const result = await sendText(requestData);
          // 返回结果，包含任务信息
          return {
            ...result,
            uid: task.uid,
            batchNo: task.batchNo,
            cookieId,
            taskId,
            task
          };
        } catch (error) {
          return {
            code: -10002,
            msg: error.message,
            data: { error: error.message },
            uid: task.uid,
            batchNo: task.batchNo,
            cookieId,
            taskId,
            task
          };
        }
      });
    }

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
          const emitted = socketManager.emitToUid(userId, 'task:needMore', {
            taskId,
            need: neededLength,
          });
          if (!emitted) {
            console.log(`[Task] 用户 ${userId} 当前无 socket 连接，needMore 事件仅记录`);
          }
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
    // 同时存储到全局 Map，供外部触发使用
    globalTaskProcessors.set(taskKey, triggerTaskProcessing);

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

      // if (currentStatus === 'running') {
      //   const response = { success: false, message: '任务已在运行中' };
      //   broadcastStatus('running', '任务已在运行中');
      //   console.log('任务已在运行中....');
      //   if (typeof callback === 'function') {
      //     callback(response);
      //   }
      //   return;
      // }

      const hasPending = await TaskStore.hasPendingTasks(taskId);
      console.log(`[Socket] 用户 ${uid} 任务 ${taskId} 是否有待处理队列: ${hasPending}`);
      if (!hasPending) {
        const response = { success: false, message: '任务已完成，当前无待处理队列' };
        const statusLabel = currentStatus || 'idle';
        broadcastStatus(statusLabel, '任务队列已处理完成');
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
      let statusValue = latestStatus?.status || taskStatus.status || 'idle';
      let message =
        latestStatus?.message ||
        (statusValue === 'running'
          ? '任务处理中'
          : statusValue === 'stopped'
            ? '任务已停止'
            : '任务已完成或待命');

      // 如果状态仍为 running 但队列已无任务，主动更新为 idle
      if (statusValue === 'running') {
        const hasPending = await TaskStore.hasPendingTasks(taskId);
        if (!hasPending) {
          await updateStatus('idle', '任务队列已处理完成');
          statusValue = 'idle';
          message = '任务队列已处理完成';
        }
      }

      const isRunning = statusValue === 'running';
      const response = {
        success: true,
        isRunning,
        taskId,
        status: statusValue,
        message,
      };
      broadcastStatus(statusValue, message);
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
        globalTaskProcessors.delete(taskKey);
      }
    });
  });

  // 返回 io 实例，供外部使用
  return io;
}

/**
 * 触发任务处理（供外部调用，如 enqueue 接口）
 * @param {string} userId - 用户 ID
 * @param {string} taskId - 任务 ID
 * @returns {boolean} - 是否成功触发
 */
function triggerTaskProcessing(userId, taskId) {
  const taskKey = `${userId}:${taskId}`;
  const triggerFn = globalTaskProcessors.get(taskKey);
  
  if (triggerFn) {
    console.log(`[Task] 外部触发任务处理: 用户 ${userId}, 任务 ${taskId}`);
    triggerFn();
    return true;
  } else {
    console.log(`[Task] 未找到任务处理器: 用户 ${userId}, 任务 ${taskId}`);
    return false;
  }
}

module.exports = {
  initSocketServer,
  triggerTaskProcessing,
};

