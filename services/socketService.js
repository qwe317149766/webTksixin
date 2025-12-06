const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { verifyToken } = require('./authService');
const TaskStore = require('../utils/taskStore');
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
const defaultCookieTable = 'uni_cookies_0';
const COOKIE_DAILY_LIMIT = config.task?.cookieDailyLimit || 40;
const COOKIE_BATCH_ACCOUNT_SIZE = config.task?.cookieBatchAccountSize || 100;

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
const NEED_MORE_DEMAND_MULTIPLIER =
  (config.task && typeof config.task.needMoreDemandMultiplier === 'number'
    ? config.task.needMoreDemandMultiplier
    : 1.2);

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

// 待发送人与 Cookie 的全局映射关系：每个 uid（接收者）在整个系统中只能被分配一次 cookie
const uidCookieMap = new Map(); // key: `${uid}` -> { cookieId, cookies_text, cookieRecord, taskId }

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

async function handleSendResult(result, socketManager) {
  let dbConnection = null;
  const payload =
    (result && typeof result.data === 'object' && result.data !== null)
      ? result.data
      : result || {};
  const task = payload.task || result.task || {};
  const cookieId = payload.cookieId || result.cookieId;
  const taskIdFromResult = task.taskId;

  if (!taskIdFromResult) {
    console.warn('[Task] 结果中缺少 taskId，跳过处理');
    return;
  }

  if (stoppedTasks.has(taskIdFromResult)) {
    console.log(`[Task] 任务 ${taskIdFromResult} 已停止，忽略结果 code=${payload.code}`);
    return;
  }

  console.log('cookieId:', cookieId, 'code:', payload.code);
  console.log('[data]:', payload);

  const tableName =
    payload.cookieTable ||
    result.cookieTable ||
    task.cookieTable ||
    defaultCookieTable;
  const ownerId = task.userId;
  const resultCode =
    payload.code !== undefined && payload.code !== null
      ? Number(payload.code)
      : result.code;
  const receiverUid = result.uid || payload.uid || task.uid;
  const messageData = payload.data || result.data || {};
  let cookieShouldStop = false;

  try {
    dbConnection = await mysqlPool.getConnection();
    if (resultCode === 0) {
      taskRetryCounts.delete(getRetryKey(task.taskId, task.uid));
      const markResult = await TaskStore.markTaskSuccess(taskIdFromResult);
      if (!markResult.success) {
        console.log(`[Task] 任务 ${taskIdFromResult} 剩余数量已为 0，标记为完成`);
        await stopTaskQueue(ownerId, taskIdFromResult, 'completed');
        return {
          code: resultCode,
          isSuccess: true,
          cookieShouldStop: false,
        };
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
            `[Task] 更新 Cookie 使用次数失败 (ID: ${cookieId}):`,
            updateError.message
          );
        }
      } else {
        console.warn('[Task] 发送成功但缺少 cookieId，跳过使用次数更新');
      }

      logSuccessUidAsync(ownerId, taskIdFromResult, task.uid || result.uid);
      await emitTaskProgress(socketManager, ownerId, taskIdFromResult);
      markTaskLastSuccessAt(taskIdFromResult);
      if (markResult.remaining <= 0) {
        await stopTaskQueue(ownerId, taskIdFromResult, 'completed');
      }

      const countKey = getTaskRequesterKey(ownerId, taskIdFromResult);
      const counts =
        taskExecutionCounts.get(countKey) || { total: 0, success: 0, fail: 0 };
      counts.total++;
      counts.success++;
      taskExecutionCounts.set(countKey, counts);
      console.log(
        `[Task] 任务执行次数统计 - 任务 ${taskIdFromResult} (用户 ${ownerId}): 总计=${counts.total}, 成功=${counts.success}, 失败=${counts.fail}`
      );

      if (receiverUid) {
        const uidKey = String(receiverUid);
        if (uidCookieMap.has(uidKey)) {
          const cookieMapping = uidCookieMap.get(uidKey);
          uidCookieMap.delete(uidKey);
          console.log(
            `[Task] 任务成功，清理接收者 ${receiverUid} 的 Cookie 映射 (Cookie ID: ${cookieMapping.cookieId})，使用完毕`
          );
          if (cookieMapping.cookieId) {
            cookieError10001Counts.delete(cookieMapping.cookieId);
          }
        }
      }
    } else {
      let shouldRequeue = false;
      let tongJs = true;
      let recordFail = true;
      console.log('[data.code]:', resultCode);

      if (resultCode !== -10001 && cookieId) {
        cookieError10001Counts.delete(cookieId);
      }

      if (resultCode === 10001 && receiverUid) {
        logSuccessUidAsync(ownerId, taskIdFromResult, receiverUid);
      }

      if (resultCode === -10001) {
        cookieShouldStop = true;
        if (cookieId) {
          const currentCount = (cookieError10001Counts.get(cookieId) || 0) + 1;
          cookieError10001Counts.set(cookieId, currentCount);

          console.log(
            `[Task] 用户 ${task.uid} 任务 ${taskIdFromResult} 错误码 -10001 (Cookie ID: ${cookieId})，连续错误次数: ${currentCount}`
          );

          if (currentCount >= 3) {
            console.log(
              `[Task] Cookie ID ${cookieId} 连续 ${currentCount} 次返回 -10001，将账号状态改为已退出`
            );
            await dbConnection.execute(
              `UPDATE ${tableName} SET status = 3 WHERE id = ?`,
              [cookieId]
            );
            cookieError10001Counts.delete(cookieId);
            shouldRequeue = true;
          } else {
            shouldRequeue = true;
          }
        } else {
          shouldRequeue = true;
        }
      } else if (resultCode === -10000) {
        cookieShouldStop = true;
        console.log(
          `[Task] 用户 ${task.uid} 任务 ${taskIdFromResult} 维护社区: ${JSON.stringify(
            messageData
          )}`
        );
        await dbConnection.execute(
          `UPDATE ${tableName} SET status = 5 WHERE id = ?`,
          [cookieId]
        );
        shouldRequeue = true;
      } else if (resultCode === -1) {
        cookieShouldStop = true;
        console.log(
          `[Task] 用户 ${task.uid} 任务 ${taskIdFromResult} 退出状态: ${JSON.stringify(
            messageData
          )}`
        );
        await dbConnection.execute(
          `UPDATE ${tableName} SET status = 3 WHERE id = ?`,
          [cookieId]
        );
        shouldRequeue = true;
      } else if (resultCode === 10004) {
        cookieShouldStop = true;
        console.log(
          `[Task] 用户 ${task.uid} 任务 ${taskIdFromResult} 发送端被限制: ${JSON.stringify(
            messageData
          )}`
        );
        await dbConnection.execute(
          `UPDATE ${tableName} SET status = 2 WHERE id = ?`,
          [cookieId]
        );
        shouldRequeue = true;
      } else if (resultCode === 10002) {
        cookieShouldStop = true;
        console.log(
          `[Task] 用户 ${task.uid} 任务 ${taskIdFromResult} 发送太快: ${JSON.stringify(
            messageData
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
      } else if (resultCode === -10002) {
        console.log(
          `[Task] 用户 ${task.uid} 任务 ${taskIdFromResult} 网络异常: ${JSON.stringify(
            messageData
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
        cookieShouldStop = true;
        console.error(
          `[Task] 用户 ${task.uid} 任务 ${taskIdFromResult} 发送失败: ${JSON.stringify(
            messageData
          )}`
        );
        shouldRequeue = true;
      }

      if (receiverUid) {
        const uidKey = String(receiverUid);
        if (uidCookieMap.has(uidKey)) {
          const cookieMapping = uidCookieMap.get(uidKey);
          uidCookieMap.delete(uidKey);
          console.log(
            `[Task] 任务失败，清理接收者 ${receiverUid} 的 Cookie 映射 (Cookie ID: ${cookieMapping.cookieId})，允许重新分配`
          );
        }
      }

      const retryKey = getRetryKey(task.taskId, task.uid);
      if (shouldRequeue) {
        const attempts = (taskRetryCounts.get(retryKey) || 0) + 1;
        if (attempts > MAX_TASK_RETRY) {
          console.warn(
            `[Task] 任务 ${task.taskId} -> ${task.uid} 超过最大重试次数 ${MAX_TASK_RETRY}，不再重试`
          );
          taskRetryCounts.delete(retryKey);
          shouldRequeue = false;
          recordFail = true;
        } else {
          taskRetryCounts.set(retryKey, attempts);
          console.log(
            `[Task] 任务 ${task.taskId} -> ${task.uid} 第 ${attempts} 次重试，重新入队`
          );
          const queueKey = TaskStore.getQueueKey(ownerId, task.taskId);
          await redis.zadd(queueKey, Date.now(), JSON.stringify(task));
          recordFail = false;
        }
      } else {
        taskRetryCounts.delete(retryKey);
      }

      console.log('recordFail:', recordFail);
      console.log('tongJs:', tongJs);
      if (recordFail && tongJs) {
        const failResult = await TaskStore.markTaskFail(task.taskId);
        console.log('failResult:', failResult);
        if (!failResult.success) {
          console.log(`[Task] 任务 ${task.taskId} 剩余数量已为 0，标记为完成`);
          await stopTaskQueue(ownerId, task.taskId, 'completed');
        } else {
          await emitTaskProgress(socketManager, ownerId, taskIdFromResult);
          if (failResult.remaining <= 0) {
            await stopTaskQueue(ownerId, task.taskId, 'completed');
          }
        }
      }

      const countKey = getTaskRequesterKey(ownerId, taskIdFromResult);
      const counts =
        taskExecutionCounts.get(countKey) || { total: 0, success: 0, fail: 0 };
      counts.total++;
      counts.fail++;
      taskExecutionCounts.set(countKey, counts);
      console.log(
        `[Task] 任务执行次数统计 - 任务 ${taskIdFromResult} (用户 ${ownerId}): 总计=${counts.total}, 成功=${counts.success}, 失败=${counts.fail}`
      );
    }
  } catch (err) {
    console.error('[Task] 结果处理失败:', err);
  } finally {
    if (dbConnection) {
      dbConnection.release();
    }
    if (task && task.userId && task.taskId) {
      const preferredPriority =
        payload.priorityCode !== undefined
          ? Number(payload.priorityCode)
          : task.priorityCode !== undefined
            ? Number(task.priorityCode)
            : undefined;
      const normalizedPreferred =
        preferredPriority !== undefined && !Number.isNaN(preferredPriority)
          ? preferredPriority
          : undefined;
      if (normalizedPreferred !== undefined) {
        console.log('[拉取特定账号]', normalizedPreferred);
      }
      triggerTaskProcessing(task.userId, task.taskId, 1, {
        preferredPriority: normalizedPreferred,
      });
    }
  }

  return {
    code: resultCode,
    isSuccess: resultCode === 0,
    cookieShouldStop,
  };
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
        `SELECT id, cookies_text, ck_uid, used_count, day_count, priority_code,ck_type 
         FROM ${tableName}
         WHERE ${whereClause} AND priority_code = ?
         ORDER BY day_count ASC
         LIMIT ?`,
        [desiredCode, desiredCount]
      );
      let combined = priorityCookies || [];
      if (combined.length < desiredCount) {
        const fallbackCode = desiredCode === 1 ? 0 : 1;
        const fallbackNeeded = desiredCount - combined.length;
        if (fallbackNeeded > 0) {
          const [fallbackCookies] = await dbConnection.execute(
            `SELECT id, cookies_text, ck_uid, used_count, day_count, priority_code,ck_type
             FROM ${tableName}
             WHERE ${whereClause} AND priority_code = ?
             ORDER BY day_count ASC
             LIMIT ?`,
            [fallbackCode, fallbackNeeded]
          );
          combined = combined.concat(fallbackCookies || []);
        }
        if (combined.length < desiredCount) {
          const deficit = desiredCount - combined.length;
          const [others] = await dbConnection.execute(
            `SELECT id, cookies_text, ck_uid, used_count, day_count, priority_code,ck_type
             FROM ${tableName}
             WHERE ${whereClause} AND priority_code NOT IN (0,1)
             ORDER BY day_count ASC
             LIMIT ?`,
            [deficit]
          );
          combined = combined.concat(others || []);
        }
      }
      return combined;
    }

    const priority1Count = Math.ceil(totalCookiesNeeded * cookieRatio.priority1Ratio);
    const priority0Count = Math.ceil(totalCookiesNeeded * cookieRatio.priority0Ratio);

    console.log(`[Task] 需要获取 ${totalCookiesNeeded} 个 cookies (priority_code=1: ${priority1Count}, priority_code=0: ${priority0Count})`);

    // 从数据库获取 priority_code=1 的 cookies
    const [priority1Cookies] = await dbConnection.execute(
      `SELECT id, cookies_text, ck_uid, used_count, day_count, priority_code,ck_type 
       FROM ${tableName} 
     WHERE ${whereClause} AND priority_code = 1
       ORDER BY day_count ASC
       LIMIT ?`,
    [...whereParams, priority1Count]
    );

    // 从数据库获取 priority_code=0 的 cookies
    let remainingForPriority0 = Math.max(0, totalCookiesNeeded - priority1Cookies.length);
    const [priority0Cookies] = await dbConnection.execute(
      `SELECT id, cookies_text, ck_uid, used_count, day_count, priority_code,ck_type
       FROM ${tableName} 
       WHERE ${whereClause} AND priority_code = 0
       ORDER BY day_count ASC
       LIMIT ?`,
      [...whereParams, priority0Count + remainingForPriority0]
    );

    const combined = [...priority1Cookies, ...priority0Cookies];
    if (combined.length < totalCookiesNeeded) {
      const deficit = totalCookiesNeeded - combined.length;
      const [fallbackCookies] = await dbConnection.execute(
        `SELECT id, cookies_text, ck_uid, used_count, day_count, priority_code,ck_type 
         FROM ${tableName} 
         WHERE ${whereClause} AND priority_code NOT IN (0, 1)
         ORDER BY day_count ASC
         LIMIT ?`,
        [...whereParams, deficit]
      );
      combined.push(...fallbackCookies);
    }

    return combined;
 }

/**
 * 批量处理任务，统一封装私信发送
 * @param {SocketManager} socketManager
 * @param {Array} tasks
 * @param {string} taskId
 * @param {Function} onNeedMore
 * @param {Function} statusUpdater
 */
async function processBatchTasks(socketManager, tasks, taskId, statusUpdater, options = {}) {
  if (!tasks || tasks.length === 0) return;

  let tableName = 'uni_cookies_0'; // 默认表名，可以从配置或任务中获取
  let dbConnection = null;
  let taskInfo = null;

  stoppedTasks.delete(taskId);

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

    dbConnection = await mysqlPool.getConnection();

    const preferredPriority =
      options && Object.prototype.hasOwnProperty.call(options, 'preferredPriority')
        ? options.preferredPriority
        : undefined;
    const normalizedPreferred =
      preferredPriority !== undefined && preferredPriority !== null
        ? Number(preferredPriority)
        : null;
    const usePreferred =
      normalizedPreferred !== null && !Number.isNaN(normalizedPreferred);

    const cookieTargetCount = Math.max(
      1,
      Math.min(COOKIE_BATCH_ACCOUNT_SIZE, Math.max(tasks.length, 1))
    );

    async function loadCookies(desiredTable, desiredCount) {
      if (!usePreferred) {
        return await getAlivableCookies(dbConnection, desiredTable, desiredCount);
      }
      const targeted = await getAlivableCookies(dbConnection, desiredTable, desiredCount, {
        priorityCode: normalizedPreferred,
        priorityCount: desiredCount,
      });
      const fetched = targeted || [];
      if (fetched.length >= desiredCount) {
        return fetched;
      }
      const remaining = desiredCount - fetched.length;
      const others = await getAlivableCookies(dbConnection, desiredTable, remaining);
      return fetched.concat(others || []);
    }

    let allCookies;
    try {
      allCookies = await loadCookies(tableName, cookieTargetCount);
    } catch (error) {
      if (error.code === 'ER_NO_SUCH_TABLE' && tableName !== 'uni_cookies_0') {
        console.warn(`[Task] Cookie 表 ${tableName} 不存在，降级到 uni_cookies_0`);
        tableName = 'uni_cookies_0';
        allCookies = await loadCookies(tableName, cookieTargetCount);
      } else {
        throw error;
      }
    }

    if ((!allCookies || allCookies.length === 0) && tableName !== 'uni_cookies_0') {
      console.warn(`[Task] 表 ${tableName} 没有可用 Cookie，继续使用默认表`);
      tableName = 'uni_cookies_0';
      allCookies = await loadCookies(tableName, cookieTargetCount);
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

    const pendingTasks = [...alreadyAssignedTasks, ...duplicateTasks];
    if (pendingTasks.length) {
      await requeueTasks(pendingTasks);
    }

    if (!filteredTasks.length) {
      return;
    }

    const taskQueue = filteredTasks.slice();
    const skippedTasks = [];

    async function dispatchTaskWithCookie(task, cookieRecord) {
      const batchInfo = task.batchInfo || {};
      const finalTaskInfo = taskInfo || {};
      const content = batchInfo.content || finalTaskInfo.content || [];
      const proxy = batchInfo.proxy || finalTaskInfo.proxy || '';

      const sendType = cookieRecord.ck_type || 'app';
      const uidKey = String(task.uid);
      const cookiesText = cookieRecord.cookies_text;
      const cookieId = cookieRecord.id;
      const priorityCode = Number(cookieRecord.priority_code) || 0;
      task.cookieTable = tableName;
      task.priorityCode = priorityCode;

      uidCookieMap.set(uidKey, {
        cookieId,
        cookies_text: cookiesText,
        cookieRecord,
        taskId,
      });

      console.log(
        `[Task] 接收者 ${task.uid} 分配新 Cookie (ID: ${cookieId})，任务: ${taskId}`
      );

      const cookieObj = parseCookieString(cookiesText);
      const userAgent = cookieObj['User-Agent'] || cookieObj['user-agent'] || null;
      const deviceId = cookieObj.device_id || null;

      const createSequenceId = Math.floor(Math.random() * 2001) + 10000;
      const sendSequenceId = createSequenceId + 1;

      let textMsg = '';
      if (Array.isArray(content) && content.length > 0) {
        const randomIndex = Math.floor(Math.random() * content.length);
        textMsg = content[randomIndex] || '';
      } else if (typeof content === 'string') {
        textMsg = content;
      }

      const requestData = {
        toUid: task.uid,
        textMsg,
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

      try {
        const result = await MessageSender.sendPrivateMessage(senderOptions);
        return await handleSendResult(
          {
            ...result,
            uid: task.uid,
            batchNo: task.batchNo,
            cookieId,
            taskId,
            task,
            priorityCode,
            cookieTable: tableName,
          },
          socketManager
        );
      } catch (error) {
        return await handleSendResult(
          {
            code: -10002,
            msg: error.message,
            data: { error: error.message },
            uid: task.uid,
            batchNo: task.batchNo,
            cookieId,
            taskId,
            task,
            priorityCode,
            cookieTable: tableName,
          },
          socketManager
        );
      }
    }

    async function runCookieWorker(cookieRecord, initialQuota) {
      let remainingQuota = initialQuota;
      while (remainingQuota > 0) {
        const nextTask = taskQueue.shift();
        if (!nextTask) {
          break;
        }
        const uidKey = String(nextTask.uid || '');
        if (!uidKey) {
          skippedTasks.push(nextTask);
          continue;
        }
        if (uidCookieMap.has(uidKey)) {
          skippedTasks.push(nextTask);
          continue;
        }

        const outcome = await dispatchTaskWithCookie(nextTask, cookieRecord);
        if (!outcome) {
          remainingQuota = Math.max(0, remainingQuota - 1);
          continue;
        }
        if (outcome.cookieShouldStop) {
          break;
        }
        if (outcome.isSuccess) {
          remainingQuota = Math.max(0, remainingQuota - 1);
        }
      }
    }

    const cookieWorkers = [];
    for (const cookie of allCookies) {
      if (!taskQueue.length) {
        break;
      }
      const usedToday = Number(cookie.day_count || 0);
      const availableQuota = Math.max(0, COOKIE_DAILY_LIMIT - usedToday);
      if (availableQuota <= 0) {
        continue;
      }
      cookieWorkers.push(runCookieWorker(cookie, availableQuota));
    }

    if (!cookieWorkers.length) {
      console.warn(`[Task] 本批次没有可用 Cookie (taskId=${taskId})`);
      if (taskQueue.length) {
        await requeueTasks(taskQueue);
      }
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

    await Promise.all(cookieWorkers);

    if (taskQueue.length) {
      await requeueTasks(taskQueue);
    }
    if (skippedTasks.length) {
      await requeueTasks(skippedTasks);
    }
  } catch (error) {
    console.error('[Task] 批量处理任务失败:', error);
  } finally {
    if (dbConnection) {
      dbConnection.release();
    }
  }
}

function createTaskProcessor(socketManager, userId, taskId, statusChecker, statusUpdater, needMoreNotifier = null) {
  let isProcessing = false;
  let stopRequested = false;
  let nextPreferredPriority = null;

  const applyPreferredPriorityOption = (options = {}) => {
    if (Object.prototype.hasOwnProperty.call(options, 'preferredPriority')) {
      const incoming = options.preferredPriority;
      if (incoming === null || incoming === undefined) {
        nextPreferredPriority = null;
      } else {
        const normalized = Number(incoming);
        nextPreferredPriority = Number.isNaN(normalized) ? null : normalized;
      }
    }
  };

  const runLoop = async () => {
    while (!stopRequested) {
      if (!socketManager.hasConnections(userId)) {
        break;
      }
      if (statusChecker && !statusChecker()) {
        console.log(`[Task] 用户 ${userId} 任务 ${taskId} 已停止，不再处理`);
        break;
      }

      const taskStats = await TaskStore.getTaskStats(taskId);
      const remainingTasks = Math.max(0, Number(taskStats?.remaining || 0));
      if (remainingTasks <= 0) {
        if (typeof statusUpdater === 'function') {
          await statusUpdater('idle', '任务队列已处理完成', { isEnd: true });
        }
        break;
      }

      const maxBatch = Math.min(
        BATCH_SIZE,
        (config.task?.concurrency || 10) * 3,
        remainingTasks
      );
      const batchSize = Math.max(1, maxBatch);
      const tasks = await TaskStore.dequeueTask(userId, taskId, batchSize);

      if (!tasks || tasks.length === 0) {
        console.log(`[Task] 用户 ${userId} 任务 ${taskId} 队列为空，等待新的触发`);
        const hasPending = await TaskStore.hasPendingTasks(taskId);
        if (!hasPending) {
          if (typeof statusUpdater === 'function') {
            await statusUpdater('idle', '任务队列已处理完成', { isEnd: true });
          }
          break;
        }
        if (typeof needMoreNotifier === 'function') {
          const demand = config.task?.concurrency || BATCH_SIZE;
          await needMoreNotifier(demand, {
            totalTasks: Number(taskStats?.total || 0),
            remainingTasks,
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }

      const preferredPriority = nextPreferredPriority;
      nextPreferredPriority = null;
      await processBatchTasks(socketManager, tasks, taskId, statusUpdater, {
        preferredPriority,
      });
    }
  };

  const triggerProcessing = async (_demand = 1, options = {}) => {
    applyPreferredPriorityOption(options);

    if (!socketManager.hasConnections(userId)) {
      return false;
    }

    if (statusChecker && !statusChecker()) {
      return false;
    }

    if (isProcessing) {
      return true;
    }

    stopRequested = false;
    isProcessing = true;
    runLoop()
      .catch((error) => {
        console.error(`任务轮询失败 (uid=${userId}, taskId=${taskId}):`, error);
      })
      .finally(() => {
        isProcessing = false;
      });

    return true;
  };

  triggerProcessing.stop = () => {
    stopRequested = true;
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
      if (newStatus === 'running') {
        stoppedTasks.delete(taskId);
      }
      broadcastStatus(newStatus, message);
    };

    const emitNeedMoreEvent = async (needAmount, meta = {}) => {
      let normalizedNeed = Math.floor(Number(needAmount) || 0);
      if (!Number.isFinite(normalizedNeed) || normalizedNeed <= 0) {
        return;
      }

      let totalTasks = Number(meta.totalTasks);
      if (!Number.isFinite(totalTasks) || totalTasks <= 0) {
        try {
          const stats = await TaskStore.getTaskStats(taskId);
          totalTasks = Number(stats?.total || stats?.remaining || 0);
        } catch (error) {
          console.warn(
            `[Task] needMore 获取任务总数失败 (uid=${uid}, taskId=${taskId}):`,
            error.message
          );
        }
      }

      if (Number.isFinite(totalTasks) && totalTasks > 0) {
        const limit = Math.max(1, Math.floor(totalTasks * NEED_MORE_DEMAND_MULTIPLIER));
        if (normalizedNeed > limit) {
          console.log(
            `[Task] needMore 请求 ${normalizedNeed} 超过阈值 ${limit}，自动收敛 (uid=${uid}, taskId=${taskId})`
          );
          normalizedNeed = limit;
        }
      }

      if (normalizedNeed <= 0) {
        return;
      }

      const throttleKey = `${uid}:${taskId}`;
      const now = Date.now();
      const lastEmit = needMoreThrottleMap.get(throttleKey) || 0;
      if (now - lastEmit >= NEED_MORE_INTERVAL) {
        const emitted = socketManager.emitToUid(uid, 'task:needMore', {
          taskId,
          need: normalizedNeed,
        });
        needMoreThrottleMap.set(throttleKey, now);
        if (!emitted) {
          console.log(`[Task] 用户 ${uid} 当前无 socket 连接，needMore 事件仅记录`);
        }
      } else {
        console.log(
          `[Task] needMore 触发过于频繁，10秒内仅允许一次 (uid=${uid}, taskId=${taskId})`
        );
      }
    };

    const triggerTaskProcessing = createTaskProcessor(
      socketManager,
      uid,
      taskId,
      statusChecker,
      updateStatus,
      emitNeedMoreEvent
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
    const triggerFn = globalTaskProcessors.get(taskKey);
    if (triggerFn && typeof triggerFn.stop === 'function') {
      triggerFn.stop();
      console.log(`[Task] 任务处理循环已请求停止 (uid=${userId}, taskId=${taskId})`);
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
  if (userId) {
    const countKey = getTaskRequesterKey(userId, taskId);
    taskExecutionCounts.delete(countKey);
  }

  return { stopped: true, stats: cachedStats };
}

module.exports = {
  initSocketServer,
  triggerTaskProcessing,
  stopTaskQueue,
};

