const redis = require('../config/redis');

const TASK_CACHE_KEY_PREFIX = 'task:';
const DEFAULT_TASK_CACHE_TTL = 86400; // 1 天

function getTaskCacheKey(taskId) {
  return `${TASK_CACHE_KEY_PREFIX}${taskId}`;
}

async function getTaskCache(taskId) {
  if (!taskId) {
    return null;
  }
  try {
    const cacheStr = await redis.get(getTaskCacheKey(taskId));
    if (!cacheStr) {
      return null;
    }
    return JSON.parse(cacheStr);
  } catch (error) {
    console.error(`[TaskCache] 读取任务缓存失败 (taskId=${taskId}):`, error.message);
    return null;
  }
}

async function updateTaskCache(taskId, mutator) {
  if (!taskId || typeof mutator !== 'function') {
    return null;
  }

  const key = getTaskCacheKey(taskId);
  let cacheStr;
  try {
    cacheStr = await redis.get(key);
  } catch (error) {
    console.error(`[TaskCache] 获取任务缓存失败 (taskId=${taskId}):`, error.message);
    return null;
  }

  if (!cacheStr) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(cacheStr);
  } catch (error) {
    console.error(`[TaskCache] 任务缓存 JSON 解析失败 (taskId=${taskId}):`, error.message);
    return null;
  }

  const result = await Promise.resolve(mutator(payload)) || payload;

  let ttl = await redis.ttl(key);
  if (ttl <= 0) {
    ttl = DEFAULT_TASK_CACHE_TTL;
  }

  try {
    await redis.set(key, JSON.stringify(payload));
    await redis.expire(key, ttl);
  } catch (error) {
    console.error(`[TaskCache] 更新任务缓存失败 (taskId=${taskId}):`, error.message);
  }

  return result;
}

module.exports = {
  getTaskCache,
  updateTaskCache,
  DEFAULT_TASK_CACHE_TTL,
};

