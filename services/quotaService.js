// Redis 客户端（本地用于任务统计，authRedis 用于余额）
const redis = require('../config/redis');
const { authRedis } = redis;
// 使用远程 MySQL（authPool）读取账户余额
const { authPool: authMysqlPool } = require('../config/database');
const GuidUtil = require('../utils/guid');

const QUOTA_KEY = 'user:score';
const QUOTA_CONFIG_KEY = 'pay:config';
const QUOTA_TABLE = 'uni_system_admin'; // 用户表名，可根据实际情况修改
const QUOTA_COLUMN = 'score_num'; // 余额字段名，可根据实际情况修改

function buildBillOrderId(prefix = 'bill') {
  return `${prefix}_${GuidUtil.generate()}`;
}

async function insertBillRecord(connection, {
  billType = 'sixin',
  billCategory = 'adjust',
  billTitle = '',
  billMark = '',
  taskId = '',
  amount = 0,
  pm = 1,
  uid,
  beforeScore = 0,
  afterScore = 0,
  buyNum = 0,
  payConfig = {},
  status = 1,
}) {
  if (!uid) {
    throw new Error('insertBillRecord 需要 uid');
  }

  const now = Math.floor(Date.now() / 1000);
  const payload =
    typeof payConfig === 'string' ? payConfig : JSON.stringify(payConfig || {});
  await connection.execute(
    `INSERT INTO uni_user_bill (
        bill_type,
        bill_mark,
        bill_title,
        bill_category,
        taskId,
        num,
        pm,
        uid,
        before_num,
        after_num,
        bill_order_id,
        buy_num,
        pay_config,
        complate_num,
        status,
        create_time,
        update_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      billType,
      billMark,
      billTitle,
      billCategory,
      taskId || '',
      amount,
      pm,
      uid,
      beforeScore,
      afterScore,
      buildBillOrderId(taskId || 'bill'),
      buyNum,
      payload,
      0,
      status,
      now,
      now,
    ]
  );
}

/**
 * 从 Redis 获取余额
 */
async function getQuotaFromRedis(uid) {
  // 使用鉴权 Redis 获取余额
  const value = await authRedis.hget(QUOTA_KEY, uid);
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
    //先从鉴权 Redis 中获取
    const redisConfig = await authRedis.hget(QUOTA_CONFIG_KEY, uid);
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
      proxy_price = Number(systemConfig.proxy_price) || 0     //消耗100积分 
      unit_proxy = Number(systemConfig.unit_proxy) || 10000     //每一万代理
      unit_sixin = Number(systemConfig.unit_sixin) || 10000         //每条私信
      sixin_price = Number(systemConfig.sixin_price) || 10000    //等于积分
      unit_score = Number(systemConfig.unit_score) || 1      //每积分
      score_price = Number(systemConfig.score_price) || 0.03 //等于3分钱
    } 
    //将值写入鉴权 Redis
    await authRedis.hset(QUOTA_CONFIG_KEY, uid, JSON.stringify({
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
  // const redisQuota = await getQuotaFromRedis(uid);
  // if (redisQuota !== null) {
  //   return redisQuota;
  // }
  
  // Redis 没有，查数据库
  const dbQuota = await getQuotaFromDB(uid);
  
  // // 将数据库余额同步到鉴权 Redis
  // if (dbQuota > 0) {
  //   await authRedis.hset(QUOTA_KEY, uid, dbQuota);
  // }
  
  return dbQuota;
}

async function ensureQuotaRecord(uid) {
  // 使用鉴权 Redis
  const exists = await authRedis.hexists(QUOTA_KEY, uid);
  if (!exists) {
    await authRedis.hset(QUOTA_KEY, uid, 0);
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

  let connection;
  try {
    connection = await authMysqlPool.getConnection();
    await connection.beginTransaction();

    const [rows] = await connection.execute(
      `SELECT ${QUOTA_COLUMN} FROM ${QUOTA_TABLE} WHERE id = ? FOR UPDATE`,
      [uid]
    );

    if (!rows.length) {
      await connection.rollback();
      return { success: false, quota: 0, message: '用户不存在' };
    }

    const currentScore = Number(rows[0][QUOTA_COLUMN] || 0);
    if (currentScore < amount) {
      await connection.rollback();
      return { success: false, quota: currentScore, message: '余额不足' };
    }

    const [updateResult] = await connection.execute(
      `UPDATE ${QUOTA_TABLE}
          SET ${QUOTA_COLUMN} = ${QUOTA_COLUMN} - ?, 
              update_time = UNIX_TIMESTAMP()
        WHERE id = ? AND ${QUOTA_COLUMN} - ? >= 0`,
      [amount, uid, amount]
    );
    if (updateResult.affectedRows === 0) {
      await connection.rollback();
      return { success: false, quota: currentScore, message: '余额不足或并发冲突' };
    }

    const newScore = currentScore - amount;
    await connection.commit();
    await authRedis.hset(QUOTA_KEY, uid, newScore);

    return { success: true, quota: newScore };
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    console.error(`[Quota] 余额扣减失败 (UID: ${uid}, Amount: ${amount}):`, error.message);
    return {
      success: false,
      quota: 0,
      message: `扣减失败: ${error.message}`,
    };
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

async function addQuota(uid, amount = 1) {
  // 使用鉴权 Redis 增加余额
  const quota = await authRedis.hincrby(QUOTA_KEY, uid, amount);
  return quota;
}

/**
 * 扣减余额、冻结金额并生成账单（单事务完成）
 * @param {Object} params
 * @param {string|number} params.uid - 用户ID
 * @param {number} params.amount - 扣减金额
 * @param {string} params.taskId - 任务ID
 * @param {string} params.title - 账单标题
 * @param {string} params.mark - 备注
 * @returns {Promise<{success: boolean, data?: Object, message?: string}>}
 */
async function deductFreezeAndCreateBill(params) {
  const {
    uid,
    amount,
    taskId,
    title = '任务消费',
    mark = '',
    buyNum = 0,
    payConfig = {},
    billType = 'sixin',
    billCategory = 'frozen',
    billOrderId = '',
    completedNum = 0,
  } = params;

  if (!uid || amount <= 0) {
    return { success: false, message: '参数错误' };
  }

  let connection;
  try {
    // 获取连接并开启事务
    connection = await authMysqlPool.getConnection();
    await connection.beginTransaction();

    // 1. 查询当前余额（FOR UPDATE 行级锁）
    const [rows] = await connection.execute(
      `SELECT ${QUOTA_COLUMN}, frozen_score_num FROM ${QUOTA_TABLE} WHERE id = ? FOR UPDATE`,
      [uid]
    );

    if (rows.length === 0) {
      await connection.rollback();
      return { success: false, message: '用户不存在' };
    }

    const currentScore = Number(rows[0][QUOTA_COLUMN] || 0);
    const currentFrozen = Number(rows[0].frozen_score_num || 0);

    if (currentScore < amount) {
      await connection.rollback();
      return { success: false, message: '余额不足', beforeScore: currentScore };
    }

    // 2. 扣减余额，增加冻结金额（条件更新）
    const [updateResult] = await connection.execute(
      `UPDATE ${QUOTA_TABLE} 
        SET ${QUOTA_COLUMN} = ${QUOTA_COLUMN} - ?, 
            frozen_score_num = frozen_score_num + ?, 
            update_time = UNIX_TIMESTAMP() 
        WHERE id = ? AND ${QUOTA_COLUMN} - ? >= 0`,
      [amount, amount, uid, amount]
    );

    if (updateResult.affectedRows === 0) {
      await connection.rollback();
      return { success: false, message: '余额不足或并发冲突', beforeScore: currentScore };
    }

    const newScore = currentScore - amount;
    const newFrozen = currentFrozen + amount;

    // 3. 创建账单（和扣减在同一事务内）
    const now = Math.floor(Date.now() / 1000);
    const [billResult] = await connection.execute(
      `INSERT INTO uni_user_bill (
          bill_type,
          bill_mark,
          bill_title,
          bill_category,
          taskId,
          num,
          pm,
          uid,
          before_num,
          after_num,
          bill_order_id,
          buy_num,
          pay_config,
          complate_num,
          settle_amount,
          status,
          create_time,
          update_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        billType,
        mark,
        title,
        billCategory,
        taskId || '',
        amount,
        0, // pm=0 支出
        uid,
        currentScore,
        newScore,
        billOrderId || taskId || '',
        buyNum,
        typeof payConfig === 'string' ? payConfig : JSON.stringify(payConfig || {}),
        completedNum,
        0,
        0, // 0=待结算
        now,
        now,
      ]
    );

    await connection.commit();

    // 同步更新鉴权 Redis 中的余额（异步，不影响事务）
    await authRedis.hset(QUOTA_KEY, uid, newScore);

    return {
      success: true,
      data: {
        beforeScore: currentScore,
        afterScore: newScore,
        frozenScore: newFrozen,
        deductAmount: amount,
        billId: billResult.insertId,
      },
    };
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    console.error(`[Quota] 扣减并创建账单失败 (UID: ${uid}, Amount: ${amount}):`, error.message);
    return { success: false, message: `扣减失败: ${error.message}` };
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

async function completeBillByTask(taskId, completedNum = 0) {
  if (!taskId) {
    return;
  }

  try {
    await authMysqlPool.execute(
      `UPDATE uni_user_bill
         SET status = 1,
             complate_num = ?
       WHERE taskId = ?
         AND bill_type = 'sixin'
         AND bill_category = 'frozen'`,
      [completedNum, taskId]
    );
  } catch (error) {
    console.error(`[Quota] 更新账单完成状态失败 (taskId=${taskId}):`, error.message);
  }
}

async function getBillByTask(uid, taskId) {
  if (!uid || !taskId) {
    return null;
  }

  const [rows] = await authMysqlPool.execute(
    `SELECT id,
            uid,
            taskId,
            bill_type,
            bill_category,
            num,
            pm,
            bill_mark,
            bill_title,
            buy_num,
            pay_config,
            complate_num,
            settle_amount,
            status,
            create_time,
            update_time
       FROM uni_user_bill
      WHERE uid = ?
        AND taskId = ?
        AND bill_type = 'sixin'
        AND bill_category = 'frozen'
      LIMIT 1`,
    [uid, taskId]
  );

  return rows[0] || null;
}

function parsePayConfigData(raw) {
  if (!raw) {
    return null;
  }

  if (typeof raw === 'object') {
    return raw;
  }

  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.warn('[Quota] 解析 pay_config 失败:', error.message);
      return null;
    }
  }

  return null;
}

async function updateBillPayConfig(billId, config = {}) {
  if (!billId) return;
  const payload =
    typeof config === 'string' ? config : JSON.stringify(config || {});
  await authMysqlPool.execute(
    `UPDATE uni_user_bill
        SET pay_config = ?, update_time = UNIX_TIMESTAMP()
      WHERE id = ?`,
    [payload, billId]
  );
}

async function updateBillSettleAmount(billId, amount = 0) {
  if (!billId) return;
  await authMysqlPool.execute(
    `UPDATE uni_user_bill
        SET settle_amount = ?, update_time = UNIX_TIMESTAMP()
      WHERE id = ?`,
    [Number(amount) || 0, billId]
  );
}

async function updateBillSettlement(billId, { payConfig, settleAmount, status } = {}) {
  if (!billId) return;
  const updates = [];
  const params = [];

  if (payConfig !== undefined) {
    const payload =
      typeof payConfig === 'string' ? payConfig : JSON.stringify(payConfig || {});
    updates.push('pay_config = ?');
    params.push(payload);
  }

  if (settleAmount !== undefined) {
    updates.push('settle_amount = ?');
    params.push(Number(settleAmount) || 0);
  }

  if (status !== undefined && status !== null) {
    updates.push('status = ?');
    params.push(status);
  }

  if (!updates.length) {
    return;
  }

  const setClause = `${updates.join(', ')}, update_time = UNIX_TIMESTAMP()`;
  await authMysqlPool.execute(
    `UPDATE uni_user_bill
        SET ${setClause}
      WHERE id = ?`,
    [...params, billId]
  );
}

async function updateBillStatus(billId, status = 1) {
  if (!billId) return;
  await authMysqlPool.execute(
    `UPDATE uni_user_bill
        SET status = ?, update_time = UNIX_TIMESTAMP()
      WHERE id = ?`,
    [status, billId]
  );
}

async function releaseFrozenAndRefund({ uid, taskId, settlementCost = 0 }) {
  if (!uid) {
    throw new Error('uid 不能为空');
  }

  let connection;
  try {
    connection = await authMysqlPool.getConnection();
    await connection.beginTransaction();

    const [rows] = await connection.execute(
      `SELECT ${QUOTA_COLUMN}, frozen_score_num FROM ${QUOTA_TABLE} WHERE id = ? FOR UPDATE`,
      [uid]
    );

    if (!rows.length) {
      throw new Error('用户不存在');
    }

    const currentScore = Number(rows[0][QUOTA_COLUMN] || 0);
    const currentFrozen = Number(rows[0].frozen_score_num || 0);
    const normalizedSettlement = Math.max(0, Number(settlementCost) || 0);
    const usedFrozen = Math.min(currentFrozen, normalizedSettlement);
    const refundAmount = Math.max(0, currentFrozen - normalizedSettlement);
    const [updateResult] = await connection.execute(
      `UPDATE ${QUOTA_TABLE}
         SET ${QUOTA_COLUMN} = ${QUOTA_COLUMN} + ?,
             frozen_score_num = GREATEST(frozen_score_num - ?, 0),
             update_time = UNIX_TIMESTAMP()
       WHERE id = ?`,
      [refundAmount, currentFrozen, uid]
    );
    if (updateResult.affectedRows === 0) {
      throw new Error('更新余额失败');
    }

    const newScore = currentScore + refundAmount;
    if (refundAmount > 0) {
      await insertBillRecord(connection, {
        billType: 'sixin',
        billCategory: 'refund',
        billTitle: '私信失败退回',
        billMark: `任务 ${taskId || ''} 未使用退回`,
        taskId,
        amount: refundAmount,
        pm: 1,
        uid,
        beforeScore: currentScore,
        afterScore: newScore,
      });
    }

    if (currentFrozen > 0) {
      await insertBillRecord(connection, {
        billType: 'score',
        billCategory: 'unfreeze',
        billTitle: '积分解冻',
        billMark: `任务 ${taskId || ''} 结算完成，解冻冻结积分`,
        taskId,
        amount: currentFrozen,
        pm: 0,
        uid,
        beforeScore: newScore,
        afterScore: newScore,
      });
    }

    await connection.commit();
    await authRedis.hset(QUOTA_KEY, uid, newScore);

    return {
      currentFrozen,
      usedFrozen,
      refundAmount,
      newScore,
    };
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    throw error;
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

async function settleTaskBilling({ uid, billId, taskId, settlementCost, payConfig, status = 2 }) {
  if (!uid || !billId || settlementCost === undefined) {
    throw new Error('settleTaskBilling 参数错误');
  }

  let connection;
  try {
    connection = await authMysqlPool.getConnection();
    await connection.beginTransaction();

    const [rows] = await connection.execute(
      `SELECT ${QUOTA_COLUMN}, frozen_score_num FROM ${QUOTA_TABLE} WHERE id = ? FOR UPDATE`,
      [uid]
    );

    if (!rows.length) {
      throw new Error('用户不存在');
    }

    const currentScore = Number(rows[0][QUOTA_COLUMN] || 0);
    const currentFrozen = Number(rows[0].frozen_score_num || 0);
    const normalizedSettlement = Math.max(0, Number(settlementCost) || 0);
    const usedFrozen = Math.min(currentFrozen, normalizedSettlement);
    const refundAmount = Math.max(0, currentFrozen - normalizedSettlement);

    const [updateResult] = await connection.execute(
      `UPDATE ${QUOTA_TABLE}
         SET ${QUOTA_COLUMN} = ${QUOTA_COLUMN} + ?,
             frozen_score_num = GREATEST(frozen_score_num - ?, 0),
             update_time = UNIX_TIMESTAMP()
       WHERE id = ?`,
      [refundAmount, currentFrozen, uid]
    );

    if (updateResult.affectedRows === 0) {
      throw new Error('更新余额失败');
    }

    const newScore = currentScore + refundAmount;

    const updates = [];
    const params = [];

    if (payConfig !== undefined) {
      const payload =
        typeof payConfig === 'string' ? payConfig : JSON.stringify(payConfig || {});
      updates.push('pay_config = ?');
      params.push(payload);
    }

    updates.push('settle_amount = ?');
    params.push(normalizedSettlement);

    if (status !== undefined && status !== null) {
      updates.push('status = ?');
      params.push(status);
    }

    const setClause = `${updates.join(', ')}, update_time = UNIX_TIMESTAMP()`;
    await connection.execute(
      `UPDATE uni_user_bill
          SET ${setClause}
        WHERE id = ?`,
      [...params, billId]
    );

    await connection.commit();
    await authRedis.hset(QUOTA_KEY, uid, newScore);

    return {
      currentFrozen,
      usedFrozen,
      refundAmount,
      newScore,
    };
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    throw error;
  } finally {
    if (connection) {
      connection.release();
    }
  }
}
async function getUserBills({ uid, page = 1, pageSize = 10, status, taskId }) {
  if (!uid) {
    throw new Error('uid 不能为空');
  }
  const normalizedPage = Math.max(1, parseInt(page, 10) || 1);
  const normalizedPageSize = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 10));
  const offset = (normalizedPage - 1) * normalizedPageSize;

  const whereParts = ['uid = ?', 'bill_type = ?', 'bill_category = ?'];
  const params = [uid, 'sixin', 'frozen'];

  if (status !== undefined && status !== null && status !== '') {
    whereParts.push('status = ?');
    params.push(status);
  }

  if (taskId) {
    whereParts.push('taskId = ?');
    params.push(taskId);
  }

  const whereClause = whereParts.join(' AND ');

  const [rows] = await authMysqlPool.execute(
    `SELECT id, bill_type, bill_mark, bill_title, bill_category, taskId, num, pm, uid, before_num, after_num, bill_order_id, buy_num, pay_config, complate_num AS completed_num, settle_amount, status, create_time, update_time
     FROM uni_user_bill
     WHERE ${whereClause}
     ORDER BY id DESC
     LIMIT ?, ?`,
    [...params, offset, normalizedPageSize]
  );

  const [countRows] = await authMysqlPool.execute(
    `SELECT COUNT(*) AS total FROM uni_user_bill WHERE ${whereClause}`,
    params
  );

  return {
    list: rows,
    total: Number(countRows[0]?.total || 0),
    page: normalizedPage,
    pageSize: normalizedPageSize,
  };
}
module.exports = {
  getQuota,
  ensureQuotaRecord,
  deductQuotaAtomic, // 原子性扣减（推荐使用）
  addQuota,
  getPayConfigFromDB,
  deductFreezeAndCreateBill, // 扣减、冻结并生成账单（组合操作）
  getUserBills,
  completeBillByTask,
  getBillByTask,
  parsePayConfigData,
  updateBillPayConfig,
  updateBillSettleAmount,
  updateBillSettlement,
  settleTaskBilling,
  releaseFrozenAndRefund,
  updateBillStatus,
};

