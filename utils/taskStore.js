const redis = require('../config/redis');

const LUA_MARK_SUCCESS = `
local totalKey = KEYS[1]
local successKey = KEYS[2]
local remaining = tonumber(redis.call('GET', totalKey) or '0')
if remaining <= 0 then
  return {0, remaining}
end
remaining = remaining - 1
redis.call('SET', totalKey, remaining)
redis.call('INCR', successKey)
return {1, remaining}
`;

const LUA_MARK_FAIL = `
local totalKey = KEYS[1]
local failKey = KEYS[2]
local remaining = tonumber(redis.call('GET', totalKey) or '0')
if remaining <= 0 then
  return {0, remaining}
end
remaining = remaining - 1
redis.call('SET', totalKey, remaining)
redis.call('INCR', failKey)
return {1, remaining}
`;

/**
 * 基于 Redis Sorted Set 的任务队列
 */
class TaskStore {
  constructor() {
    this.queueKeyPrefix = 'tasks:zqueue';
    this.taskStatusPrefix = 'tasks:status';
    this.taskCountPrefix = 'task:total';
    this.taskPendingPrefix = 'task:pending';
    this.taskSuccessPrefix = 'task:success';
    this.taskFailPrefix = 'task:fail';
  }

  getQueueKey(userId, taskId) {
    if (userId === undefined || userId === null) {
      throw new Error('userId 不能为空');
    }
    const normalized = String(userId).trim();
    if (!normalized) {
      throw new Error('userId 不能为空字符串');
    }
    if (taskId === undefined || taskId === null) {
      throw new Error('taskId 不能为空');
    }
    const normalizedTaskId = String(taskId).trim();
    if (!normalizedTaskId) {
      throw new Error('taskId 不能为空字符串');
    }
    return `${this.queueKeyPrefix}:${normalized}:${normalizedTaskId}`;
  }

  getBatchUidKey(batchNo) {
    return `tasks:batch:${batchNo}:uids`;
  }

  getBatchInfoKey(batchNo) {
    return `tasks:batch:${batchNo}:info`;
  }

  async cleanupBatchInfo(batchNo) {
    if (!batchNo) return;
    await redis.del(this.getBatchInfoKey(batchNo));
    await redis.del(this.getBatchUidKey(batchNo));
  }

  getTaskStatusKey(taskId) {
    if (!taskId) {
      throw new Error('taskId 不能为空');
    }
    return `${this.taskStatusPrefix}:${taskId}`;
  }

  getTaskCountKey(taskId) {
    if (!taskId) {
      throw new Error('taskId 不能为空');
    }
    return `${this.taskCountPrefix}:${taskId}`;
  }
  getTaskPendingKey(taskId) {
    if (!taskId) {
      throw new Error('taskId 不能为空');
    }
    return `${this.taskPendingPrefix}:${taskId}`;
  }

  getTaskSuccessKey(taskId) {
    if (!taskId) {
      throw new Error('taskId 不能为空');
    }
    return `${this.taskSuccessPrefix}:${taskId}`;
  }

  getTaskFailKey(taskId) {
    if (!taskId) {
      throw new Error('taskId 不能为空');
    }
    return `${this.taskFailPrefix}:${taskId}`;
  }

  async initTaskCounters(taskId, total) {
    if (!taskId) throw new Error('taskId 不能为空');
    const normalizedTotal = Number(total) || 0;
    await redis
      .multi()
      .set(this.getTaskPendingKey(taskId), normalizedTotal)
      .set(this.getTaskCountKey(taskId), normalizedTotal)
      .set(this.getTaskSuccessKey(taskId), 0)
      .set(this.getTaskFailKey(taskId), 0)
      .exec();
  }

  async getTaskStatus(taskId) {
    if (!taskId) return null;
    const key = this.getTaskStatusKey(taskId);
    const data = await redis.hgetall(key);
    if (!data || Object.keys(data).length === 0) {
      return null;
    }
    return {
      status: data.status || 'idle',
      userId: data.userId || null,
      updatedAt: Number(data.updatedAt || 0),
      stoppedBy: data.stoppedBy || null,
      reason: data.reason || '',
    };
  }

  async setTaskStatus(taskId, status, extra = {}) {
    if (!taskId) return null;
    const key = this.getTaskStatusKey(taskId);
    const payload = {
      status,
      updatedAt: Date.now(),
      ...extra,
    };
    const flat = [];
    Object.entries(payload).forEach(([k, v]) => {
      flat.push(k, v === undefined || v === null ? '' : String(v));
    });
    await redis.hmset(key, ...flat);
    return this.getTaskStatus(taskId);
  }

  async ensureTaskStatus(taskId, userId) {
    const existing = await this.getTaskStatus(taskId);
    if (existing) {
      return existing;
    }
    return this.setTaskStatus(taskId, 'idle', { userId: userId || '' });
  }

  async getTaskCount(taskId) {
    if (!taskId) return 0;
    const key = this.getTaskCountKey(taskId);
    const val = await redis.get(key);
    return Number(val || 0);
  }

  async hasPendingTasks(taskId) {
    const count = await this.getTaskCount(taskId);
    console.log(`[TaskStore] 任务 ${taskId} 存在任务条数: ${count}`);
    return count > 0;
  }

  async markTaskSuccess(taskId) {
    if (!taskId) return { success: false, remaining: 0 };
    const result = await redis.eval(
      LUA_MARK_SUCCESS,
      2,
      this.getTaskCountKey(taskId),
      this.getTaskSuccessKey(taskId)
    );
    if (!Array.isArray(result) || result.length < 2) {
      return { success: false, remaining: 0 };
    }
    const status = Number(result[0]);
    const remaining = Number(result[1]);
    return { success: status === 1, remaining };
  }

  async markTaskFail(taskId) {
    if (!taskId) return { success: false, remaining: 0 };
    const result = await redis.eval(
      LUA_MARK_FAIL,
      2,
      this.getTaskCountKey(taskId),
      this.getTaskFailKey(taskId)
    );
    if (!Array.isArray(result) || result.length < 2) {
      return { success: false, remaining: 0 };
    }
    const status = Number(result[0]);
    const remaining = Number(result[1]);
    return { success: status === 1, remaining };
  }

  async getTaskStats(taskId) {
    if (!taskId) {
      return {
        total: 0,
        remaining: 0,
        success: 0,
        fail: 0,
      };
    }
    const [pending, remaining, success, fail] = await redis.mget(
      this.getTaskPendingKey(taskId),
      this.getTaskCountKey(taskId),
      this.getTaskSuccessKey(taskId),
      this.getTaskFailKey(taskId)
    );
    return {
      total: Number(pending || 0),
      remaining: Number(remaining || 0),
      success: Number(success || 0),
      fail: Number(fail || 0),
    };
  }

  async getBatchInfo(batchNo) {
    if (!batchNo) return null;
    const info = await redis.hgetall(this.getBatchInfoKey(batchNo));
    if (!info || Object.keys(info).length === 0) return null;
    
    // 解析 content，支持数组（JSON 格式）或字符串
    let content = info.content || '';
    try {
      // 尝试解析为 JSON（如果是数组）
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        content = parsed;
      }
    } catch (e) {
      // 如果不是 JSON，保持为字符串
      content = content || '';
    }
    
    return {
      content: content, // 可能是字符串或数组
      msgType: Number(info.msgType ?? 0),
      proxy: info.proxy || '',
      sendType: Number(info.sendType ?? 0),
      createdAt: Number(info.createdAt ?? Date.now()),
      updatedAt: Number(info.updatedAt ?? Date.now()),
    };
  }

  async ensureBatchInfo(batchNo, payload) {
    const infoKey = this.getBatchInfoKey(batchNo);
    const existingInfo = await redis.hgetall(infoKey);
    const now = Date.now();

    // 处理 content：如果是数组，序列化为 JSON；如果是字符串，直接使用
    let contentValue = payload.content ?? existingInfo.content ?? '';
    if (Array.isArray(contentValue)) {
      contentValue = JSON.stringify(contentValue);
    } else if (typeof contentValue === 'string') {
      // 保持为字符串
    } else {
      contentValue = '';
    }

    const info = {
      content: contentValue,
      msgType: payload.msgType ?? Number(existingInfo.msgType ?? 0),
      proxy: payload.proxy ?? existingInfo.proxy ?? '',
      sendType: payload.sendType ?? Number(existingInfo.sendType ?? 0),
      createdAt: Number(existingInfo.createdAt ?? now),
      updatedAt: now,
    };

    const flatArgs = Object.entries(info).flatMap(([field, value]) => [
      field,
      value === undefined || value === null ? '' : String(value),
    ]);

    if (flatArgs.length) {
      await redis.hmset(infoKey, ...flatArgs);
    }

    return info;
  }

  async addTask(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('任务 payload 必须是对象');
    }

    const taskIdRaw = payload.taskId;
    if (taskIdRaw === undefined || taskIdRaw === null) {
      throw new Error('任务必须包含 taskId');
    }

    const taskId = String(taskIdRaw).trim();
    if (!taskId) {
      throw new Error('taskId 不能为空字符串');
    }

    const userIdRaw = payload.userId;
    if (userIdRaw === undefined || userIdRaw === null) {
      throw new Error('任务必须包含 userId');
    }

    const userId = String(userIdRaw).trim();
    if (!userId) {
      throw new Error('userId 不能为空字符串');
    }

    const batchNoRaw = payload.batchNo;
    if (batchNoRaw === undefined || batchNoRaw === null) {
      throw new Error('任务必须包含 batchNo');
    }

    const batchNo = String(batchNoRaw).trim();
    if (!batchNo) {
      throw new Error('batchNo 不能为空字符串');
    }

    if (!Array.isArray(payload.uids) || payload.uids.length === 0) {
      throw new Error('任务必须包含至少一个 uid');
    }

    const normalizedUids = payload.uids
      .map(uid => (uid === undefined || uid === null ? '' : String(uid).trim()))
      .filter(Boolean);

    if (!normalizedUids.length) {
      throw new Error('任务必须包含至少一个有效的 uid');
    }

    const uniqueIncomingUids = Array.from(new Set(normalizedUids));

    const batchUidKey = this.getBatchUidKey(batchNo);
    const existingUids = await redis.smembers(batchUidKey);
    const existingSet = new Set(existingUids || []);

    const queueKey = this.getQueueKey(userId, taskId);
      console.log('queueKey', queueKey);
    // 如果有批次信息，保存到 Redis
    if (payload.batchInfo) {
      await this.ensureBatchInfo(batchNo, payload.batchInfo);
    }

    const newTasks = [];
    for (const uid of uniqueIncomingUids) {
      if (existingSet.has(uid)) {
        continue;
      }
      const entry = JSON.stringify({ batchNo, taskId, uid, userId });
      try {
        // 先检查任务是否真的存在于队列中
        const exists = await redis.zscore(queueKey, entry);
        if (exists !== null) {
          // 任务确实存在，输出详细信息并强制覆盖（删除后重新添加）
          console.log("exists:",exists)
          console.warn(`[TaskStore] 任务已存在于队列中 (taskId: ${taskId}, uid: ${uid}, batchNo: ${batchNo})`);
          // console.log(`[TaskStore] 队列中的任务 score: ${exists}, 将删除后重新添加`);
          // 删除已存在的任务，然后重新添加（确保使用最新的时间戳）
          // await redis.zrem(queueKey, entry);
          // console.log(`[TaskStore] 已删除旧任务，准备重新添加`);
        }else{
          console.log(`[TaskStore] 任务不存在，准备添加`);
        }
        
        // 添加任务
        const result = await redis.zadd(queueKey, Date.now(), entry);
        console.log("result:",result)
        if (result === 0) {
          // 如果返回 0，说明元素已存在（虽然我们检查过，但可能并发添加了）
          console.log(`[TaskStore] zadd 返回 0，任务可能已被并发添加 (taskId: ${taskId}, uid: ${uid})`);
          // 验证一下是否真的存在
          const verifyScore = await redis.zscore(queueKey, entry);
          if (verifyScore === null) {
            // 实际上不存在，可能是 Redis 的异常，尝试再次添加
            console.log(`[TaskStore] 验证发现任务不存在，尝试重新添加 (taskId: ${taskId}, uid: ${uid})`);
            const retryResult = await redis.zadd(queueKey, Date.now(), entry);
            if (retryResult === 1) {
              newTasks.push({ batchNo, uid, taskId, userId });
            } else {
              console.error(`[TaskStore] 重试添加仍然失败 (taskId: ${taskId}, uid: ${uid})`);
            }
          } else {
            // 确实存在，跳过
            console.log(`[TaskStore] 验证确认任务已存在，跳过 (taskId: ${taskId}, uid: ${uid})`);
          }
          continue;
        }
        if (result !== 1) {
          console.warn(`[TaskStore] zadd 返回异常值: ${result} (taskId: ${taskId}, uid: ${uid})`);
        }
        newTasks.push({ batchNo, uid, taskId, userId });
      } catch (error) {
        console.error(`[TaskStore] 添加任务到队列失败 (taskId: ${taskId}, uid: ${uid}):`, error.message);
        throw error; // 重新抛出错误，让调用方处理
      }
    }


    return {
      isNewBatch: existingSet.size === 0,
      newUids: newTasks.map(task => task.uid),
      batchNo,
      taskId,
      userId,
      addedCount: newTasks.length,
    };
  }

  /**
   * 获取所有任务（按 score，从旧到新）
   * @returns {Array}
   */
  async listTasks(userId, taskId) {
    if (!taskId) {
      throw new Error('taskId 不能为空');
    }
    const queueKey = this.getQueueKey(userId, taskId);
    const members = await redis.zrange(queueKey, 0, -1, 'WITHSCORES');
    if (!members.length) return [];

    const tasks = [];
    for (let i = 0; i < members.length; i += 2) {
      const raw = members[i];
      const score = Number(members[i + 1]);
      try {
        const parsed = JSON.parse(raw);
        tasks.push({ ...parsed, createdAt: score });
      } catch (error) {
        // ignore malformed entries
      }
    }

    const enriched = await Promise.all(
      tasks.map(async task => ({
        uid: task.uid,
        batchNo: task.batchNo,
        createdAt: task.createdAt,
        batchInfo: await this.getBatchInfo(task.batchNo),
      }))
    );

    return enriched;
  }

  /**
   * 根据批次号获取任务
   * @param {string} batchNo
   * @param {string} userId
   * @param {string} taskId
   * @returns {Array}
   */
  async listByBatch(batchNo, userId, taskId) {
    if (!batchNo || typeof batchNo !== 'string') {
      return [];
    }
    const normalized = batchNo.trim();
    if (!normalized) {
      return [];
    }
    if (!taskId) {
      throw new Error('taskId 不能为空');
    }
    const tasks = await this.listTasks(userId, taskId);
    return tasks.filter(task => task.batchNo === normalized);
  }

  /**
   * 批量出队任务（按照 score 最小的先出）
   * @param {number} batchSize - 批量大小，默认10
   * @returns {Array}
   */
  async dequeueTask(userId, taskId, batchSize = 10) {
    if (userId === undefined || userId === null) {
      return [];
    }
    if (!taskId) {
      throw new Error('taskId 不能为空');
    }

    const queueKey = this.getQueueKey(userId, taskId);
    if (batchSize <= 0) batchSize = 10;
    
    const members = await redis.zrange(queueKey, 0, batchSize - 1, 'WITHSCORES');
    console.log("members:",members.length)
    if (!members || members.length < 1) return [];

    const tasks = [];
    const rawTasks = [];
    const taskCountMap = new Map();
    
    // 解析任务（队列 key 已基于 taskId，所以所有任务都属于该 taskId）
    for (let i = 0; i < members.length; i += 2) {
      const rawTask = members[i];
      try {
        const task = JSON.parse(rawTask);
        rawTasks.push(rawTask);
        tasks.push({
          ...task,
          createdAt: Number(members[i + 1]),
        });
        const key = task.taskId;
        if (key) {
          taskCountMap.set(key, (taskCountMap.get(key) || 0) + 1);
        }
        // 如果已经获取到足够的任务，停止
        if (tasks.length >= batchSize) {
          break;
        }
      } catch (error) {
        // 忽略格式错误的任务
        console.log("error:",error)
      }
    }

    if (rawTasks.length === 0) return [];

    // 批量删除
    if (rawTasks.length === 1) {
      await redis.zrem(queueKey, rawTasks[0]);
    } else {
      await redis.zrem(queueKey, ...rawTasks);
    }

    // 批量从 Set 中移除 UID
    for (const task of tasks) {
      if (task.batchNo && task.uid) {
        const batchKey = this.getBatchUidKey(task.batchNo);
        await redis.srem(batchKey, task.uid);
        const remaining = await redis.scard(batchKey);
        if (remaining === 0) {
          await this.cleanupBatchInfo(task.batchNo);
        }
      }
    }

    // 根据 taskId 减少任务计数（按 taskId 进行计算）
   

    // 根据 taskId 获取订单信息（按 taskId 去重）
    const taskIds = Array.from(new Set(tasks.map(t => t.taskId).filter(Boolean)));
    const taskInfoMap = new Map();
    await Promise.all(
      taskIds.map(async taskId => {
        try {
          const taskStr = await redis.get(`task:${taskId}`);
          if (taskStr) {
            const taskData = JSON.parse(taskStr);
            // 提取批次信息（参考 /api/v1/tk-task/submit 接口）
            const batchInfo = {
              content: taskData.content || [], // content 可能是数组
              msgType: Number(taskData.msgType ?? 0),
              proxy: taskData.proxy || '',
              sendType: Number(taskData.sendType ?? 0),
              createdAt: taskData.createdAt || Date.now(),
              updatedAt: taskData.updatedAt || Date.now(),
            };
            taskInfoMap.set(taskId, batchInfo);
          }
        } catch (error) {
          console.error(`[TaskStore] 获取任务信息失败 (taskId: ${taskId}):`, error.message);
        }
      })
    );

    // 合并批次信息
    return tasks.map(task => ({
      ...task,
      batchInfo: taskInfoMap.get(task.taskId) || null,
    }));
  }

  /**
   * 查看队首任务
   * @returns {Object|null}
   */
  async peekTask(userId, taskId) {
    if (!taskId) {
      throw new Error('taskId 不能为空');
    }
    const queueKey = this.getQueueKey(userId, taskId);
    const members = await redis.zrange(queueKey, 0, 0, 'WITHSCORES');
    if (!members.length) return null;
    try {
      const task = JSON.parse(members[0]);
      const batchInfo = await this.getBatchInfo(task.batchNo);
      return {
        ...task,
        batchInfo,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * 获取队列长度
   * @returns {number}
   */
  async size(userId, taskId) {
    if (!taskId) {
      throw new Error('taskId 不能为空');
    }
    const queueKey = this.getQueueKey(userId, taskId);
    return redis.zcard(queueKey);
  }
}

module.exports = new TaskStore();

