const redis = require('../config/redis');
// 使用远程 MySQL（authPool）读取账户余额
const { authPool: authMysqlPool } = require('../config/database');

const QUOTA_KEY = 'user:score';
const QUOTA_CONFIG_KEY = 'pay:config';
const QUOTA_TABLE = 'uni_system_admin'; // 用户表名，可根据实际情况修改
const QUOTA_COLUMN = 'score_num'; // 余额字段名，可根据实际情况修改

/**
 * 从 Redis 获取余额
 */
async function getQuotaFromRedis(uid) {
  const value = await redis.hget(QUOTA_KEY, uid);
  return value !== null ? Number(value) : null;
}

/**
 * 从数据库获取余额
 */
async function getQuotaFromDB(uid) {
  try {
    // 使用远程 MySQL 读取账户余额
    const [rows] = await authMysqlPool.execute(
      `SELECT  * FROM ${QUOTA_TABLE} WHERE id = ?  LIMIT 1`,
      [uid]
    );
    console.log('rows:', rows);
    if (rows.length > 0) {
      return Number(rows[0][QUOTA_COLUMN] || 0);
    }
    return 0;
  } catch (error) {
    console.error(`[Quota] 从数据库获取余额失败 (UID: ${uid}):`, error.message);
    return 0;
  }
}

/**
 * 从数据库获取余额
 */
async function getPayConfigFromDB(uid) {
  try {
    //先从redis中获取
    const redisConfig = await redis.hget(QUOTA_CONFIG_KEY, uid);
    if(redisConfig) {
      try {
        const config = JSON.parse(redisConfig);
        // 确保所有值都是 Number 类型
        return {
          proxy_price: Number(config.proxy_price) || 100,
          unit_proxy: Number(config.unit_proxy) || 10000,
          unit_sixin: Number(config.unit_sixin) || 1,
          sixin_price: Number(config.sixin_price) || 1,
          unit_score: Number(config.unit_score) || 1,
          score_price: Number(config.score_price) || 0.03,
        };
      } catch (parseError) {
        console.error(`[Quota] 解析 Redis 配置失败 (UID: ${uid}):`, parseError.message);
        // 继续从数据库获取
      }
    }
    // 使用远程 MySQL 读取账户配置
    const [rows] = await authMysqlPool.execute(
      `SELECT  * FROM uni_system_admin WHERE id = ?  LIMIT 1`,
      [uid]
    );
    console.log('rows:', rows);
    if(!rows.length) return null
    // 将可能为 BigInt 的值转换为 Number
    let {proxy_price,unit_proxy,unit_sixin,sixin_price,unit_score,score_price} = rows[0]
    proxy_price = Number(proxy_price) || 0;
    unit_proxy = Number(unit_proxy) || 0;
    unit_sixin = Number(unit_sixin) || 0;
    sixin_price = Number(sixin_price) || 0;
    unit_score = Number(unit_score) || 0;
    score_price = Number(score_price) || 0;
    
    //到system表中去查询
    //如果有一个没有值就从uni_sysyem_config表中去获取
    if(proxy_price <= 0 || unit_proxy <= 0 || unit_sixin <= 0 || sixin_price <= 0 || unit_score <= 0 || score_price <= 0) {
      // 使用远程 MySQL 读取系统配置
      const [systemRows] = await authMysqlPool.execute(
        `SELECT  * FROM uni_system_config WHERE config_tab_id = 31  LIMIT 1`,
      );
       // 将 二维数组转成一维 然后 menu_name 是key value是value
       const systemConfig = systemRows.reduce((acc, curr) => {
        // 将可能为 BigInt 的值转换为 Number
        const value = curr.value;
        acc[curr.menu_name] = typeof value === 'bigint' ? Number(value) : (Number(value) || value);
        return acc;
      }, {});
      proxy_price = Number(systemConfig.proxy_price) || 100     //消耗100积分 
      unit_proxy = Number(systemConfig.unit_proxy) || 10000   //每一万代理
      unit_sixin = Number(systemConfig.unit_sixin) || 1       //每条私信
      sixin_price = Number(systemConfig.sixin_price) || 1    //等于积分
      unit_score = Number(systemConfig.unit_score) || 1      //每积分
      score_price = Number(systemConfig.score_price) || 0.03 //等于3分钱
    } 
    //将值写入redis 然后从redis中获取
    await redis.hset(QUOTA_CONFIG_KEY, uid, JSON.stringify({
      proxy_price,
      unit_proxy,
      unit_sixin,
      sixin_price,
      unit_score,
      score_price,
    }));
    return {
      proxy_price,
      unit_proxy,
      unit_sixin,
      sixin_price,
      unit_score,
      score_price,
    };
  } catch (error) {
    console.error(`[Quota] 从数据库获取余额失败 (UID: ${uid}):`, error.message);
    return null;
  }
}

async function everyQuota(uid) {
  const quota = await getQuotaFromDB(uid);
  
  return Math.ceil(quota / 100);
}
/**
 * 获取余额（先查 Redis，如果没有则查数据库）
 */
async function getQuota(uid) {
  // 先查 Redis
  const redisQuota = await getQuotaFromRedis(uid);
  if (redisQuota !== null) {
    return redisQuota;
  }
  
  // Redis 没有，查数据库
  const dbQuota = await getQuotaFromDB(uid);
  
  // 将数据库余额同步到 Redis
  if (dbQuota > 0) {
    await redis.hset(QUOTA_KEY, uid, dbQuota);
  }
  
  return dbQuota;
}

async function ensureQuotaRecord(uid) {
  const exists = await redis.hexists(QUOTA_KEY, uid);
  if (!exists) {
    await redis.hset(QUOTA_KEY, uid, 0);
  }
}

/**
 * 原子性扣减余额（使用 Lua 脚本保证原子性）
 * @param {string} uid - 用户ID
 * @param {number} amount - 扣减金额
 * @returns {Promise<{success: boolean, quota: number, message?: string}>}
 */
async function deductQuotaAtomic(uid, amount = 1) {
  if (!uid || amount <= 0) {
    return {
      success: false,
      quota: 0,
      message: '参数错误',
    };
  }

  // Lua 脚本：原子性扣减余额
  // 1. 获取当前余额
  // 2. 检查余额是否足够
  // 3. 如果足够，扣减并返回新余额
  // 4. 如果不足，返回当前余额和错误信息
  const luaScript = `
    local key = KEYS[1]
    local field = ARGV[1]
    local amount = tonumber(ARGV[2])
    
    -- 获取当前余额
    local current = redis.call('HGET', key, field)
    if current == false then
      -- 如果 Redis 中没有，尝试从数据库加载（这里先返回0，由上层处理）
      return {0, 0, 'not_found'}
    end
    
    current = tonumber(current) or 0
    
    -- 检查余额是否足够
    if current < amount then
      return {0, current, 'insufficient'}
    end
    
    -- 扣减余额
    local newQuota = redis.call('HINCRBY', key, field, -amount)
    return {1, newQuota, 'success'}
  `;

  try {
    const result = await redis.eval(
      luaScript,
      1, // KEYS 数量
      QUOTA_KEY, // KEYS[1]
      uid, // ARGV[1]
      amount.toString() // ARGV[2]
    );

    const [success, quota, status] = result;

    if (status === 'not_found') {
      // Redis 中没有余额，尝试从数据库加载
      const dbQuota = await getQuotaFromDB(uid);
      if (dbQuota > 0) {
        // 同步到 Redis
        await redis.hset(QUOTA_KEY, uid, dbQuota);
        
        // 再次尝试扣减
        if (dbQuota >= amount) {
          const finalQuota = await redis.hincrby(QUOTA_KEY, uid, -amount);
          return {
            success: true,
            quota: finalQuota,
          };
        } else {
          return {
            success: false,
            quota: dbQuota,
            message: '余额不足',
          };
        }
      } else {
        return {
          success: false,
          quota: 0,
          message: '余额不存在',
        };
      }
    }

    if (success === 1) {
      return {
        success: true,
        quota: Number(quota),
      };
    } else {
      return {
        success: false,
        quota: Number(quota),
        message: status === 'insufficient' ? '余额不足' : '扣减失败',
      };
    }
  } catch (error) {
    console.error(`[Quota] 原子性扣减失败 (UID: ${uid}, Amount: ${amount}):`, error.message);
    return {
      success: false,
      quota: 0,
      message: `扣减失败: ${error.message}`,
    };
  }
}



async function addQuota(uid, amount = 1) {
  const quota = await redis.hincrby(QUOTA_KEY, uid, amount);
  return quota;
}

module.exports = {
  getQuota,
  ensureQuotaRecord,
  deductQuotaAtomic, // 原子性扣减（推荐使用）
  addQuota,
  getPayConfigFromDB
};

