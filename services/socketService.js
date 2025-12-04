const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { verifyToken } = require('./authService');
const TaskStore = require('../utils/taskStore');
const BatchRequester = require('../utils/BatchRequester');
const MessageSender = require('./messageSender');
const mysqlPool = require('../config/database');
const QuotaService = require('./quotaService');
  // 从 Redis 获取任务信息（如果 batchInfo 中没有完整信息）
const redis = require('../config/redis');
const { updateTaskCache } = require('./taskCacheService');
const BATCH_SIZE = config.task?.batchSize || 10;
const MAX_TASK_RETRY = config.task?.maxRetries || 1;
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

function markTaskLastSuccessAt(taskId) {
  if (!taskId) {
    return;
  }
  updateTaskCache(taskId, (payload = {}) => {
    const now = Date.now();
    payload.lastSuccessAt = now;
    payload.lastSuccessAtISO = new Date(now).toISOString();
    if (!payload.firstSuccessAt) {
      payload.firstSuccessAt = now;
    }
    return payload;
  });
}

const successUidDir = path.resolve(__dirname, '../public/success-uids');
let successDirReady = false;

async function ensureSuccessDir() {
  if (successDirReady) {
    return;
  }
  await fs.promises.mkdir(successUidDir, { recursive: true });
  successDirReady = true;
}

async function recordSuccessUidFile(userId, taskId, receiverUid) {
  if (!userId || !taskId || !receiverUid) {
    return;
  }
  try {
    await ensureSuccessDir();
    const fileName = `${userId}-${taskId}.txt`;
    const filePath = path.join(successUidDir, fileName);
    await fs.promises.appendFile(filePath, `${receiverUid}\n`, 'utf8');
  } catch (error) {
    console.error(`[Task] 写入成功 UID 文件失败 (userId=${userId}, taskId=${taskId}, uid=${receiverUid}):`, error.message);
  }
}

function logSuccessUidAsync(userId, taskId, receiverUid) {
  if (!userId || !taskId || !receiverUid) {
    return;
  }
  recordSuccessUidFile(userId, taskId, receiverUid).catch((err) => {
    console.error('[Task] 异步写入成功 UID 文件失败:', err.message);
  });
}

const needMoreThrottleMap = new Map(); // key -> timestamp
const NEED_MORE_INTERVAL =
  (config.task && typeof config.task.needMoreThrottleMs === 'number'
    ? config.task.needMoreThrottleMs
    : 10000);

async function getTaskTotals(taskId) {
  const stats = await TaskStore.getTaskStats(taskId);
  const total = stats.total;
  const remaining = stats.remaining;
  const success = stats.success;
  const fail = stats.fail;
  const completed = success + fail;
  const percent = total > 0 ? Math.min(100, Math.round((success / total) * 100)) : 0;
  return { total, success, fail, completed, remaining, percent };
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

async function finalizeTaskBill(taskId, { force = false } = {}) {
  if (!taskId) {
    return;
  }
  try {
    const stats = await TaskStore.getTaskStats(taskId);
    if (force || stats.remaining <= 0) {
      await QuotaService.completeBillByTask(taskId, stats.success || 0);
      console.log(
        `[Task] 已更新账单状态 (taskId=${taskId}) -> status=1, complate_num=${stats.success || 0}, force=${force}`
      );
    }
  } catch (error) {
    console.error(`[Task] 更新账单状态失败 (taskId=${taskId}):`, error.message);
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
const taskRetryCounts = new Map(); // key: `${taskId}:${uid}` -> retryCount

// 跟踪每个 cookieId 的连续 -10001 错误次数
const cookieError10001Counts = new Map(); // key: `${cookieId}` -> number

// 全局任务处理器映射，用于外部触发任务处理
const globalTaskProcessors = new Map(); // key: `${userId}:${taskId}` -> triggerFn
const stoppedTasks = new Set(); // 记录已停止/完成的任务
let sharedSocketManager = null;

function getTaskRequesterKey(userId, taskId) {
  return `${userId}:${taskId}`;
}

function getRetryKey(taskId, uid) {
  return `${taskId}:${uid}`;
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
  stoppedTasks.delete(taskId);

  batchRequester = new BatchRequester({
    sdk: null, // 函数模式下不需要 SDK
    concurrency: config.task?.concurrency || 10,
    lowThreshold: config.task?.lowThreshold || 50,
  });

  // 统一结果处理：更新配额、进度、Cookie 状态等
  const defaultCookieTable = 'uni_cookies_0';

  batchRequester.on('result', async (result) => {
    let dbConnection = null;
    const data = result.data || {};
    const task = data.task || result.task || {};
    const cookieId = data.cookieId || result.cookieId;
    console.log('cookieId:',cookieId,"code:",data.code)
    const taskIdFromResult = task.taskId;
    console.log("[data]:",data)
    const tableName =
      data.cookieTable ||
      task.cookieTable ||
      defaultCookieTable;
    console.log('taskIdFromResult:',taskIdFromResult)
    
    try {
      dbConnection = await mysqlPool.getConnection();
      if (data.code === 0) {
        taskRetryCounts.delete(getRetryKey(task.taskId, task.uid));
        const markResult = await TaskStore.markTaskSuccess(taskIdFromResult);
        if (!markResult.success) {
          console.log(`[Task] 任务 ${taskIdFromResult} 剩余数量已为 0，标记为完成`);
          await stopTaskQueue(task.userId, taskIdFromResult, 'completed');
          return;
        }
        console.log(
          `[Task] 用户 ${task.uid} 任务 ${taskIdFromResult} 待私信总数 -1 成功`
        );
        if (cookieId) {
          try {
            await dbConnection.execute(
              `UPDATE ${tableName} SET used_count = used_count + 1, day_count = day_count + 1, update_time = UNIX_TIMESTAMP() WHERE id = ?`,
              [cookieId]
            );
          } catch (updateError) {
            console.error(
              `[Task] 更新 Cookie 使用次数失败 (ID: ${result.cookieId}):`,
              updateError.message
            );
          }
        } else {
          console.warn('[Task] 发送成功但缺少 cookieId，跳过使用次数更新');
        }

        logSuccessUidAsync(task.userId, taskIdFromResult, task.uid || result.uid);
        await emitTaskProgress(socketManager, task.userId, taskIdFromResult);
        markTaskLastSuccessAt(taskIdFromResult);
        if (markResult.remaining <= 0) {
          await stopTaskQueue(task.userId, taskIdFromResult, 'completed');
        }
        
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
       
        // 不同错误码更新 Cookie 状态
        let shouldRequeue = false;
        let tongJs = true
        let recordFail = true;
        const receiverUid = result.uid || task.uid;
        console.log("[data.code]:",data.code)
        
        // 如果不是 -10001 错误，重置该 cookieId 的连续错误计数
        if (data.code !== -10001 && cookieId) {
          cookieError10001Counts.delete(cookieId);
        }
        
        if (data.code === 10001 && receiverUid) {
          logSuccessUidAsync(task.userId, taskIdFromResult, receiverUid);
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
              shouldRequeue = true;
            } else {
              // 未达到3次，继续重试
              shouldRequeue = true;
            }
          } else {
            // 没有 cookieId，直接重试
            shouldRequeue = true;
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
          shouldRequeue = true;
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
          shouldRequeue = true;
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
          shouldRequeue = true;
        } else if (data.code === 10002) {
          console.log(
            `[Task] 用户 ${task.uid} 任务 ${taskIdFromResult} 发送太快: ${JSON.stringify(
              data.data
            )}`
          );
          if (cookieId) {
            await dbConnection.execute(
              `UPDATE ${tableName} SET status = 6 WHERE id = ?`,
              [cookieId]
            );
          }
          shouldRequeue = true;
          recordFail = false;
        } else if (data.code === -10002) {
          console.log(
            `[Task] 用户 ${task.uid} 任务 ${taskIdFromResult} 网络异常: ${JSON.stringify(
              data.data
            )}`
          );
          const netKey = getRetryKey(task.taskId, `${task.uid}:net`);
          const netAttempts = (taskRetryCounts.get(netKey) || 0) + 1;
          if (netAttempts >= 5) {
            console.warn(
              `[Task] 用户 ${task.uid} 任务 ${taskIdFromResult} 网络异常已达 ${netAttempts} 次，标记为失败`
            );
            taskRetryCounts.delete(netKey);
            tongJs = true;
            shouldRequeue = false;
          } else {
            taskRetryCounts.set(netKey, netAttempts);
            tongJs = false;
            shouldRequeue = true;
          }
        } else {
          console.error(
            `[Task] 用户 ${task.uid} 任务 ${taskIdFromResult} 发送失败: ${JSON.stringify(
              data.data
            )}`
          );
          shouldRequeue = true;
        }
        // 任务失败，从 uidCookieMap 中删除映射，允许重新分配
        if (receiverUid) {
          const uidKey = String(receiverUid);
          if (uidCookieMap.has(uidKey)) {
            const cookieMapping = uidCookieMap.get(uidKey);
            uidCookieMap.delete(uidKey);
            console.log(`[Task] 任务失败，清理接收者 ${receiverUid} 的 Cookie 映射 (Cookie ID: ${cookieMapping.cookieId})，允许重新分配`);
          }
        }
        
        const retryKey = getRetryKey(task.taskId, task.uid);
        if (shouldRequeue) {
          const attempts = (taskRetryCounts.get(retryKey) || 0) + 1;
          if (attempts > MAX_TASK_RETRY) {
            console.warn(`[Task] 任务 ${task.taskId} -> ${task.uid} 超过最大重试次数 ${MAX_TASK_RETRY}，不再重试`);
            taskRetryCounts.delete(retryKey);
            shouldRequeue = false;
            recordFail = true
          } else {
            taskRetryCounts.set(retryKey, attempts);
            console.log(`[Task] 任务 ${task.taskId} -> ${task.uid} 第 ${attempts} 次重试，重新入队`);
            const queueKey = TaskStore.getQueueKey(task.userId, task.taskId);
            await redis.zadd(queueKey, Date.now(), JSON.stringify(task));
            recordFail = false;
          }
        } else {
          taskRetryCounts.delete(retryKey);
        }
        console.log('recordFail:',recordFail)
        console.log('tongJs:',tongJs)
          if (recordFail && tongJs) {
            const failResult = await TaskStore.markTaskFail(task.taskId);
            console.log('failResult:',failResult)
            if (!failResult.success) {
              console.log(`[Task] 任务 ${task.taskId} 剩余数量已为 0，标记为完成`);
              await stopTaskQueue(task.userId, task.taskId, 'completed');
            } else {
              await emitTaskProgress(socketManager, task.userId, taskIdFromResult);
              if (failResult.remaining <= 0) {
                await stopTaskQueue(task.userId, task.taskId, 'completed');
              }
            }
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
      if (task && task.userId && task.taskId) {
        const preferredPriority =
          data.priorityCode !== undefined
            ? Number(data.priorityCode)
            : task.priorityCode !== undefined
              ? Number(task.priorityCode)
              : undefined;
        const normalizedPreferred =
          preferredPriority !== undefined && !Number.isNaN(preferredPriority)
            ? preferredPriority
            : undefined;
        console.log('[拉取特定账号]',normalizedPreferred)    
        triggerTaskProcessing(task.userId, task.taskId, 1, {
          preferredPriority: normalizedPreferred,
        });
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
    if (Number.isFinite(neededLength) && neededLength > 0) {
      triggerTaskProcessing(userId, taskId, Math.floor(neededLength));
    }
  });

  batchRequester.on('done', async () => {
    // 检查是否已经处理过 done 事件，防止重复触发
    if (batchRequesterDoneFlags.get(key)) {
      console.log(`[BatchRequester] 任务 ${taskId} 的 done 事件已处理过，跳过重复处理`);
      const pending = await TaskStore.hasPendingTasks(taskId);
      if (pending && socketManager.hasConnections(userId)) {
        console.log(`[BatchRequester] 任务 ${taskId} 仍有待处理队列，尝试重启`);
        triggerTaskProcessing(userId, taskId, BATCH_SIZE);
      }
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
      if (hasPending) {
        console.log(`[BatchRequester] 任务 ${taskId} 在 done 时仍有剩余，尝试重启队列`);
        triggerTaskProcessing(userId, taskId, BATCH_SIZE);
      } else if (typeof statusUpdater === 'function') {
        await statusUpdater('idle', '任务队列已处理完成', { isEnd: true });
        await stopTaskQueue(userId, taskId, 'completed');
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

function getUserCookieTableName(uid) {
  const numericUid = Number(uid);
  if (!Number.isFinite(numericUid) || numericUid <= 0) {
    return 'uni_cookies_0';
  }
  return `uni_cookies_${numericUid}`;
}

async  function getAlivableCookies(dbConnection, tableName,totalNum, options = {}) {
    // 获取配置的分配比例
    const cookieRatio = config.task?.cookieRatio || {
      multiplier: 1.5,
      priority1Ratio: 2/3,
      priority0Ratio: 1/3,
    };

  const whereParts = ['status = 1', 'day_count < 40'];
  const whereParams = [];

  const whereClause = whereParts.join(' AND ');

    // 计算需要获取的 cookies 数量
    const totalCookiesNeeded = Math.ceil(totalNum * cookieRatio.multiplier);
    const priorityCodeFilter = options.priorityCode;
    const priorityCount =
      options.priorityCount && Number.isFinite(options.priorityCount)
        ? Math.max(1, Math.floor(options.priorityCount))
        : null;

    if (
      priorityCodeFilter !== undefined &&
      priorityCodeFilter !== null &&
      !Number.isNaN(Number(priorityCodeFilter))
    ) {
      const desiredCode = Number(priorityCodeFilter);
      const desiredCount = priorityCount || totalNum || 1;
      console.log(
        `[Task] 定向获取 priority_code=${desiredCode} 的 cookies，数量 ${desiredCount}`
      );
      const [priorityCookies] = await dbConnection.execute(
        `SELECT id, cookies_text, ck_uid, used_count, day_count, priority_code 
         FROM ${tableName}
         WHERE ${whereClause} AND priority_code = ?
         ORDER BY day_count ASC
         LIMIT ?`,
        [desiredCode, desiredCount]
      );
      return priorityCookies;
    }

    const priority1Count = Math.ceil(totalCookiesNeeded * cookieRatio.priority1Ratio);
    const priority0Count = Math.ceil(totalCookiesNeeded * cookieRatio.priority0Ratio);

    console.log(`[Task] 需要获取 ${totalCookiesNeeded} 个 cookies (priority_code=1: ${priority1Count}, priority_code=0: ${priority0Count})`);

    // 从数据库获取 priority_code=1 的 cookies
    const [priority1Cookies] = await dbConnection.execute(
      `SELECT id, cookies_text, ck_uid, used_count, day_count, priority_code 
       FROM ${tableName} 
     WHERE ${whereClause} AND priority_code = 1
       ORDER BY day_count ASC
       LIMIT ?`,
    [...whereParams, priority1Count]
    );

    // 从数据库获取 priority_code=0 的 cookies
    const [priority0Cookies] = await dbConnection.execute(
      `SELECT id, cookies_text, ck_uid, used_count, day_count, priority_code 
       FROM ${tableName} 
     WHERE ${whereClause} AND priority_code = 0
       ORDER BY day_count ASC
       LIMIT ?`,
    [...whereParams, priority0Count]
    );

    // 合并所有 cookies（优先使用 priority_code=1 的）
    return [...priority1Cookies, ...priority0Cookies];
 }

/**
 * 批量处理任务，统一封装私信发送
 * @param {SocketManager} socketManager
 * @param {Array} tasks
 * @param {string} taskId
 * @param {Function} onNeedMore
 * @param {Function} statusUpdater
 */
async function processBatchTasks(socketManager, tasks, taskId, onNeedMore, statusUpdater, options = {}) {
  if (!tasks || tasks.length === 0) return;

  let tableName = 'uni_cookies_0'; // 默认表名，可以从配置或任务中获取
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
  

    const userId = tasks[0]?.userId;
    if (taskInfo?.cookieTable) {
      tableName = taskInfo.cookieTable;
    } else {
      tableName = getUserCookieTableName(userId);
    }

    // 获取数据库连接
    dbConnection = await mysqlPool.getConnection();

    const preferredPriority =
      options && options.hasOwnProperty('preferredPriority')
        ? options.preferredPriority
        : undefined;
    const normalizedPreferred =
      preferredPriority !== undefined && preferredPriority !== null
        ? Number(preferredPriority)
        : null;
    const usePreferred =
      normalizedPreferred !== null && !Number.isNaN(normalizedPreferred);

    async function loadCookies(desiredTable) {
      if (!usePreferred) {
        return await getAlivableCookies(dbConnection, desiredTable, tasks.length);
      }
      const targeted = await getAlivableCookies(dbConnection, desiredTable, 1, {
        priorityCode: normalizedPreferred,
        priorityCount: 1,
      });
      const remaining = Math.max(0, tasks.length - targeted.length);
      if (remaining <= 0) {
        return targeted;
      }
      const others = await getAlivableCookies(dbConnection, desiredTable, remaining);
      return [...targeted, ...others];
    }

    let allCookies;
    try {
      allCookies = await loadCookies(tableName);
    } catch (error) {
      if (error.code === 'ER_NO_SUCH_TABLE' && tableName !== 'uni_cookies_0') {
        console.warn(`[Task] Cookie 表 ${tableName} 不存在，降级到 uni_cookies_0`);
        tableName = 'uni_cookies_0';
        allCookies = await loadCookies(tableName);
      } else {
        throw error;
      }
    }

    if ((!allCookies || allCookies.length === 0) && tableName !== 'uni_cookies_0') {
      console.warn(`[Task] 表 ${tableName} 没有可用 Cookie，继续使用默认表`);
      tableName = 'uni_cookies_0';
      allCookies = await loadCookies(tableName); 
    }

    async function requeueTasks(taskList = []) {
      if (!taskList.length) {
        return;
      }
      for (const item of taskList) {
        if (!item || !item.taskId || !item.userId) {
          continue;
        }
        const queueKey = TaskStore.getQueueKey(item.userId, item.taskId);
        const entry = JSON.stringify({
          batchNo: item.batchNo,
          taskId: item.taskId,
          uid: item.uid,
          userId: item.userId,
        });
        await redis.zadd(queueKey, Date.now(), entry);
      }
      console.log(`[Task] 已将 ${taskList.length} 个任务重新放回队列 (taskId=${taskId})`);
    }

    if (!allCookies || allCookies.length === 0) {
      console.warn(`[Task] 未找到可用 Cookie，任务 ${taskId} 将停止 (用户 ${userId})`);
      await requeueTasks(tasks);
      if (typeof statusUpdater === 'function') {
        await statusUpdater('stopped', '暂无可用账号，任务已停止', {
          reason: 'no_available_cookies',
        });
      }
      if (userId) {
        await stopTaskQueue(userId, taskId, 'no_available_cookies');
      }
      return;
    }

    console.log(`[Task] 实际获取到 ${allCookies.length} 个 cookies `);

    // 为当前用户 + 任务获取（或创建）单例 BatchRequester
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

    const seenUidSet = new Set();
    const uniqueTasks = [];
    const duplicateTasks = [];

    for (const task of tasks) {
      const uidKey = String(task.uid || '');
      if (!uidKey) {
        continue;
      }
      if (seenUidSet.has(uidKey)) {
        duplicateTasks.push(task);
        continue;
      }
      seenUidSet.add(uidKey);
      uniqueTasks.push(task);
    }

    const filteredTasks = [];
    const alreadyAssignedTasks = [];

    for (const task of uniqueTasks) {
      const uidKey = String(task.uid || '');
      if (!uidKey) {
        continue;
      }
      if (uidCookieMap.has(uidKey)) {
        alreadyAssignedTasks.push(task);
        continue;
      }
      filteredTasks.push(task);
    }

    const assignmentCount = Math.min(filteredTasks.length, allCookies.length);
    if (assignmentCount === 0) {
      await requeueTasks([
        ...filteredTasks,
        ...alreadyAssignedTasks,
        ...duplicateTasks,
      ]);
      return;
    }

    const assignments = Array.from({ length: assignmentCount }, (_, idx) => ({
      task: filteredTasks[idx],
      cookie: allCookies[idx],
    }));

    const pendingTasks = [
      ...filteredTasks.slice(assignmentCount),
      ...alreadyAssignedTasks,
      ...duplicateTasks,
    ];

    if (pendingTasks.length) {
      await requeueTasks(pendingTasks);
    }

    assignments.forEach(({ task, cookie }) => {
      // 优先使用 batchInfo，如果没有则使用 taskInfo
      const batchInfo = task.batchInfo || {};
      const finalTaskInfo = taskInfo || {};
      
      // 合并任务信息：batchInfo 优先，taskInfo 作为补充
      const content = batchInfo.content || finalTaskInfo.content || [];
      const msgType = batchInfo.msgType ?? finalTaskInfo.msgType ?? 0;
      const proxy = batchInfo.proxy || finalTaskInfo.proxy || '';
      
      const resolvedChannel = MessageSender.resolveChannel(
        batchInfo.sendType ??
          finalTaskInfo.sendType ??
          config.task?.sender?.channel
      );
      const sendType = resolvedChannel === 'app' ? 1 : 0;
      
      // 检查该 uid（接收者）是否已经在全局范围内分配过 cookie
      const uidKey = String(task.uid);
      const cookieRecord = cookie;
      const cookiesText = cookieRecord.cookies_text;
      const cookieId = cookieRecord.id;
      const priorityCode = Number(cookieRecord.priority_code) || 0;
      task.cookieTable = tableName;
      task.priorityCode = priorityCode;
      
      // 记录全局映射关系：uid -> cookie（每个 uid 只能被分配一次）
      uidCookieMap.set(uidKey, {
        cookieId,
        cookies_text: cookiesText,
        cookieRecord,
        taskId  // 记录是哪个任务分配的
      });
      
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

      const senderOptions = {
        sendType,
        receiverId: task.uid,
        textMsg,
        messageData: textMsg,
        cookieObject: cookieObj,
        cookiesText,
        proxy: proxy || null,
        requestData,
      };
      console.log("senderOptions:",senderOptions)
      // 使用函数模式添加任务，封装发送实现
      batchRequester.addTask(async () => {
        try {
          const result = await MessageSender.sendPrivateMessage(senderOptions);
          return {
            ...result,
            uid: task.uid,
            batchNo: task.batchNo,
            cookieId,
            taskId,
            task,
            priorityCode
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
            task,
            priorityCode
          };
        }
      });
    });

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
  let pendingDemand = 0;
  let nextPreferredPriority = null;

  const triggerProcessing = async (demand = 1, options = {}) => {
    if (
      options &&
      Object.prototype.hasOwnProperty.call(options, 'preferredPriority')
    ) {
      const incoming = options.preferredPriority;
      if (incoming === null || incoming === undefined) {
        nextPreferredPriority = null;
      } else {
        const normalized = Number(incoming);
        nextPreferredPriority = Number.isNaN(normalized) ? null : normalized;
      }
    }

    const normalizedDemand = Number.isFinite(demand) && demand > 0 ? Math.floor(demand) : 0;
    if (normalizedDemand > 0) {
      pendingDemand += normalizedDemand;
    } else if (pendingDemand === 0) {
      pendingDemand = 1;
    }

    if (!socketManager.hasConnections(userId)) {
      return false;
    }

    if (statusChecker && !statusChecker()) {
      return false;
    }

    if (isProcessing) {
      return true;
    }

    isProcessing = true;
    try {
      while (pendingDemand > 0) {
        if (!socketManager.hasConnections(userId)) {
          break;
        }
        if (statusChecker && !statusChecker()) {
          console.log(`[Task] 用户 ${userId} 任务 ${taskId} 已停止，不再处理`);
          break;
        }

        const batchSize = Math.min(BATCH_SIZE, pendingDemand);
        const tasks = await TaskStore.dequeueTask(userId, taskId, batchSize);

        if (!tasks || tasks.length === 0) {
          console.log(`[Task] 用户 ${userId} 任务 ${taskId} 队列为空，等待新的触发`);
          const hasPending = await TaskStore.hasPendingTasks(taskId);
          if (!hasPending && typeof statusUpdater === 'function') {
            await statusUpdater('idle', '任务队列已处理完成', { isEnd: true });
          }
          break;
        }

        pendingDemand = Math.max(0, pendingDemand - tasks.length);

        await processBatchTasks(
          socketManager,
          tasks,
          taskId,
          (neededLength) => {
            if (statusChecker && !statusChecker()) {
              return;
            }
            const need = Number.isFinite(neededLength) && neededLength > 0
              ? Math.floor(neededLength)
              : 0;
            if (need > 0) {
              pendingDemand += need;
              const throttleKey = `${userId}:${taskId}`;
              const now = Date.now();
              const lastEmit = needMoreThrottleMap.get(throttleKey) || 0;
              if (now - lastEmit >= NEED_MORE_INTERVAL) {
                const emitted = socketManager.emitToUid(userId, 'task:needMore', {
                  taskId,
                  need,
                });
                needMoreThrottleMap.set(throttleKey, now);
                if (!emitted) {
                  console.log(`[Task] 用户 ${userId} 当前无 socket 连接，needMore 事件仅记录`);
                }
              } else {
                console.log(`[Task] needMore 触发过于频繁，10秒内仅允许一次 (uid=${userId}, taskId=${taskId})`);
              }
            }
          },
          statusUpdater,
          { preferredPriority: nextPreferredPriority }
        );
        nextPreferredPriority = null;
      }
    } catch (error) {
      console.error(`任务轮询失败 (uid=${userId}, taskId=${taskId}):`, error);
    } finally {
      isProcessing = false;
      pendingDemand = Math.max(0, pendingDemand);
    }

    return true;
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
  sharedSocketManager = socketManager;
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
    
    const broadcastStatus = (status, message, extraPayload = {}) => {
      const isEnd = status === 'idle';
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
        is_end: isEnd,
        ...extraPayload,
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
        broadcastStatus(statusLabel, '任务队列已处理完成', { isEnd: true });
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
        broadcastStatus(taskStatus.status || 'stopped', '任务已停止', { isEnd: true });
        if (typeof callback === 'function') {
          callback(response);
        }
        return;
      }

      await stopTaskQueue(uid, taskId, 'manual_stop');
      
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
          await updateStatus('idle', '任务队列已处理完成', { isEnd: true });
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

    socket.on('disconnect', async () => {
      socketManager.unbind(uid, socket.id);
      console.log(`[Socket] 用户 ${uid} 已断开，socketId=${socket.id}`);
      if (!socketManager.hasConnections(uid)) {
        userTaskProcessors.delete(taskKey);
        userTaskStatus.delete(taskKey);
        globalTaskProcessors.delete(taskKey);
        // await stopTaskQueue(uid, taskId, 'socket_disconnected');
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
function triggerTaskProcessing(userId, taskId, demand = 1, options = {}) {
  const taskKey = `${userId}:${taskId}`;
  if (stoppedTasks.has(taskId)) {
    console.log(`[Task] 任务 ${taskId} 已停止或完成，忽略触发请求`);
    return false;
  }
  const triggerFn = globalTaskProcessors.get(taskKey);
  
  if (triggerFn) {
    console.log(`[Task] 外部触发任务处理: 用户 ${userId}, 任务 ${taskId}, 数量 ${demand}`);
    triggerFn(demand, options).catch(error => {
      console.error(`[Task] 触发任务处理失败 (taskId=${taskId}):`, error);
    });
    return true;
  } else {
    console.log(`[Task] 未找到任务处理器: 用户 ${userId}, 任务 ${taskId}`);
    return false;
  }
}

async function stopTaskQueue(userId, taskId, reason = 'manual', options = {}) {
  if (!taskId) {
    return { stopped: false, message: 'taskId 不能为空' };
  }

  const {
    markPendingSettlement = false,
    cleanupQueue = false,
    cleanupTaskStats = false,
    customStatus = null,
  } = options || {};

  let cachedStats = null;
  if (markPendingSettlement || cleanupQueue || cleanupTaskStats) {
    try {
      cachedStats = await TaskStore.getTaskStats(taskId);
    } catch (error) {
      console.error(`[Task] 获取任务统计失败 (taskId=${taskId}):`, error.message);
    }
  }

  const targetStatus =
    customStatus ||
    (markPendingSettlement
      ? 'pending_settlement'
      : reason === 'completed'
        ? 'completed'
        : 'stopped');

  try {
    await TaskStore.setTaskStatus(taskId, targetStatus, {
      userId: userId || '',
      reason: reason || 'manual',
    });
  } catch (error) {
    console.error(`[Task] 设置任务状态失败 (taskId=${taskId}):`, error.message);
  }

  if (userId) {
    const taskKey = getTaskRequesterKey(userId, taskId);
    const requester = taskRequesters.get(taskKey);
    if (requester) {
      requester.stop();
      console.log(`[Task] BatchRequester 已停止 (uid=${userId}, taskId=${taskId})`);
    }
  }

  if (markPendingSettlement) {
    const successCount = cachedStats?.success || 0;
    await QuotaService.completeBillByTask(taskId, successCount);
  } else {
    await finalizeTaskBill(taskId, { force: true });
  }

  if (cleanupQueue && userId) {
    await TaskStore.clearTaskQueue(userId, taskId);
  }

  if (cleanupTaskStats) {
    await TaskStore.clearTaskStats(taskId);
  }

  if (sharedSocketManager && userId) {
    sharedSocketManager.emitToUid(userId, 'task:status', {
      isRunning: false,
      status: targetStatus,
      message:
        targetStatus === 'pending_settlement'
          ? '任务待结算'
          : targetStatus === 'completed'
            ? '任务已完成'
            : '任务已停止',
      taskId,
      is_end: true,
      reason,
    });
  }

  stoppedTasks.add(taskId);

  return { stopped: true, stats: cachedStats };
}

module.exports = {
  initSocketServer,
  triggerTaskProcessing,
  stopTaskQueue,
};

