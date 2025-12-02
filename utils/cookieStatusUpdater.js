const mysqlPool = require('../config/database');
const redis = require('../config/redis');
const config = require('../config');

/**
 * Cookie 状态更新工具类
 * 封装了从 checkCookies.js 提取的状态更新逻辑
 */

// 状态码映射
const STATUS_MAP = {
  0: '待检测',
  1: '已检测',
  3: '已封禁',
  4: '维护社区',
  5: '发送太快',
  7: '已退出'
};

// 错误码到状态码的映射（根据 TiktokApi.sendText 的返回码）
const ERROR_CODE_TO_STATUS = {
  0: 1,        // 发送成功 -> 已检测
  '-10001': 7, // 账户可能已退出 -> 已退出
  10002: 5,    // 发送太快 -> 发送太快
  10004: 3,    // 发送端限制私信 -> 已封禁
  '-10000': 4  // 维护社区 -> 维护社区
};

// 需要跳过不更新状态的错误码
const SKIP_UPDATE_CODES = ['-1', '-10002', '10001'];

// Redis 存储键名
const REDIS_HASH_KEY = 'cookies:data:all';

/**
 * 解析 cookie 字符串为对象
 */
function parseCookieString(cookieStr) {
  if (typeof cookieStr !== 'string') {
    return cookieStr;
  }

  // 尝试解析为 JSON 格式
  try {
    const trimmed = cookieStr.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || 
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed;
      }
    }
  } catch (error) {
    // JSON 解析失败，继续按 cookie 字符串格式解析
  }

  // 按 cookie 字符串格式解析
  const cookieObj = {};
  cookieStr.split(';').forEach(part => {
    const [key, ...val] = part.trim().split('=');
    if (key && val.length > 0) {
      cookieObj[key] = val.join('=');
    }
  });
  
  return cookieObj;
}

/**
 * 更新 Cookie 状态
 * @param {Object} options - 配置选项
 * @param {number} options.cookieId - Cookie ID
 * @param {string} options.tableName - 表名（如 'uni_cookies' 或 'uni_cookies_1'）
 * @param {number} options.resultCode - TiktokApi.sendText 返回的 code
 * @param {string} options.cookiesText - Cookie 文本
 * @param {number} options.ckUid - CK UID（可选）
 * @param {Object} options.connection - 数据库连接（可选，不提供则创建新连接）
 * @returns {Promise<Object>} 返回 { updated: boolean, newStatus: number|null, message: string }
 */
async function updateCookieStatus({
  cookieId,
  tableName,
  resultCode,
  cookiesText,
  ckUid = 0,
  connection = null
}) {
  const shouldCreateConnection = !connection;
  let dbConnection = connection;

  try {
    // 如果没有提供连接，创建新连接
    if (shouldCreateConnection) {
      dbConnection = await mysqlPool.getConnection();
    }

    // 检查是否需要跳过更新
    const codeStr = String(resultCode);
    if (SKIP_UPDATE_CODES.includes(codeStr)) {
      return {
        updated: false,
        newStatus: null,
        message: `跳过更新（错误码: ${resultCode}）`
      };
    }

    // 根据返回码获取新状态
    const newStatus = ERROR_CODE_TO_STATUS[resultCode];
    
    if (newStatus === null || newStatus === undefined) {
      return {
        updated: false,
        newStatus: null,
        message: `未知返回码: ${resultCode}，跳过更新`
      };
    }

    // 更新数据库状态
    await dbConnection.execute(
      `UPDATE ${tableName} SET status = ?, update_time = UNIX_TIMESTAMP() WHERE id = ?`,
      [newStatus, cookieId]
    );

    // 如果状态是 1（已检测/正常），根据配置决定是否存入 Redis
    const saveToRedis = config.cookies && config.cookies.saveToRedis !== false;
    
    if (newStatus === 1 && saveToRedis) {
      try {
        // 解析 cookies 获取 store-country-code
        const cookieObj = parseCookieString(cookiesText);
        const storeCountryCode = cookieObj['store-country-code'] || cookieObj.store_country_code || '';
        
        // 计算优先级：store-country-code 为 'us' 则优先级为 0，否则为 1
        const priority = (storeCountryCode.toLowerCase() === 'us') ? 0 : 1;

        const cookieData = {
          id: cookieId,
          table_name: tableName,
          ck_uid: ckUid || 0,
          cookies_text: cookiesText,
          status: newStatus,
          cookie_status: 1,
          priority: priority,
          store_country_code: storeCountryCode,
          update_time: Math.floor(Date.now() / 1000)
        };

        // 存入 Redis Hash
        await redis.hset(REDIS_HASH_KEY, cookieId.toString(), JSON.stringify(cookieData));
      } catch (redisError) {
        console.error(`Redis 存储失败 (ID: ${cookieId}):`, redisError.message);
        // Redis 存储失败不影响主流程
      }
    }

    return {
      updated: true,
      newStatus: newStatus,
      message: `状态已更新为: ${STATUS_MAP[newStatus]} (${newStatus})`
    };

  } catch (error) {
    console.error(`更新 Cookie 状态失败 (ID: ${cookieId}):`, error.message);
    throw error;
  } finally {
    // 如果创建了新连接，需要关闭
    if (shouldCreateConnection && dbConnection) {
      dbConnection.release();
    }
  }
}

/**
 * 从数据库获取 status=1 的 Cookie
 * @param {string} tableName - 表名
 * @param {number} limit - 获取数量（默认1）
 * @param {Object} connection - 数据库连接（可选）
 * @returns {Promise<Array>} Cookie 记录数组
 */
async function getNormalCookies(tableName, limit = 1, connection = null) {
  const shouldCreateConnection = !connection;
  let dbConnection = connection;

  try {
    if (shouldCreateConnection) {
      dbConnection = await mysqlPool.getConnection();
    }

    const [records] = await dbConnection.execute(
      `SELECT id, cookies_text, ck_uid, store_country_code, priority_code 
       FROM ${tableName} 
       WHERE status = 1 
       ORDER BY priority_code ASC, update_time DESC 
       LIMIT ?`,
      [limit]
    );

    return records;
  } catch (error) {
    console.error('获取正常 Cookie 失败:', error.message);
    throw error;
  } finally {
    if (shouldCreateConnection && dbConnection) {
      dbConnection.release();
    }
  }
}

module.exports = {
  updateCookieStatus,
  getNormalCookies,
  STATUS_MAP,
  ERROR_CODE_TO_STATUS,
  SKIP_UPDATE_CODES
};

