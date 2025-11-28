const express = require('express');
const compression = require('compression');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('./config');

const mysqlPool = require('./config/database');
const authMysqlPool = mysqlPool.authPool;
const redis = require('./config/redis');
const { sendText } = require('./tiktokWeb/TiktokApi');
const CookiesQueue = require('./utils/cookiesQueue');
const { updateCookieStatus, getNormalCookies } = require('./utils/cookieStatusUpdater');
const TaskStore = require('./utils/taskStore');
const { initSocketServer } = require('./services/socketService');
const Response = require('./utils/response');
const { verifyToken } = require('./services/authService');
const QuotaService = require('./services/quotaService');
const GuidUtil = require('./utils/guid');

const app = express();

// 信任反向代理（只信任第一层代理，更安全）
// 如果 Nginx 在本地，设置为 1；如果知道代理 IP，可以指定 IP 地址数组
app.set('trust proxy', 1);
const PORT = config.server.port;

// ==================== 中间件配置 ====================

// 安全头配置（允许 Socket.IO CDN 和内联脚本）
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'", // 允许内联脚本（用于 demo）
        "https://cdn.socket.io" // 允许从 Socket.IO CDN 加载脚本
      ],
      scriptSrcAttr: [
        "'unsafe-inline'", // 允许内联事件处理器（如 onclick）
        "'unsafe-hashes'" // 允许使用 hash 的内联事件处理器
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'" // 允许内联样式
      ],
      connectSrc: [
        "'self'",
        "ws:", // WebSocket 连接
        "wss:", // 安全 WebSocket 连接
        "http://localhost:*", // 本地开发
        "http://127.0.0.1:*", // 本地开发
        "https://*" // 允许 HTTPS 连接（生产环境）
      ],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'", "https:", "data:"],
    },
  },
}));

// CORS 配置
app.use(cors(config.cors));

// Gzip 压缩
app.use(compression());

// 静态文件服务（用于提供 HTML demo 等）
app.use(express.static('public'));

// 解析 JSON 和 URL 编码
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 请求日志中间件
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
  });
  next();
});

/**
 * 将 uids 参数标准化为数组
 * 支持字符串（逗号/空格分隔）、数字、数组、以及 form-data 的 uids[]
 * @param {*} rawUids
 * @returns {string[]}
 */
function normalizeUids(rawUids) {
  let source = rawUids;
  if (source === undefined) {
    return [];
  }

  // 处理 form-data 中的 uids[]
  if (Array.isArray(source)) {
    return source
      .map(item => (item === null || item === undefined ? '' : item).toString().trim())
      .filter(Boolean);
  }

  // 处理数字
  if (typeof source === 'number') {
    return [source.toString()];
  }

  if (typeof source === 'string') {
    return source
      .split(/[,，\s]+/)
      .map(item => item.trim())
      .filter(Boolean);
  }

  // 处理对象（例如 { 'uids[]': '123,456' }）
  if (typeof source === 'object') {
    if (Array.isArray(source['uids[]'])) {
      return normalizeUids(source['uids[]']);
    }
    if (typeof source['uids[]'] === 'string') {
      return normalizeUids(source['uids[]']);
    }
  }

  return [];
}

/**
 * 根据 userId、batchNo、taskId 与 UID 列表，将任务写入队列
 * @param {string|number} userId
 * @param {string} taskId
 * @param {string} batchNo
 * @param {*} rawUids - 原始 UID 列表（字符串/数组等）
 * @param {Object} batchInfo - 批次信息（content, msgType, proxy, sendType）
 * @returns {Promise<{userId: string, taskId: string, batchNo: string, added: number, duplicated: number, total: number}>}
 */
async function enqueueTaskUids(userId, taskId, batchNo, rawUids, batchInfo = null) {
  if (userId === undefined || userId === null) {
    throw new Error('userId 不能为空');
  }
  const normalizedUserId = String(userId).trim();
  if (!normalizedUserId) {
    throw new Error('userId 不能为空字符串');
  }

  if (!taskId || typeof taskId !== 'string' || !taskId.trim()) {
    throw new Error('taskId 不能为空');
  }

  const normalizedTaskId = taskId.trim();
  const normalizedBatchNo = (batchNo !== undefined && batchNo !== null ? String(batchNo) : normalizedTaskId).trim();
  if (!normalizedBatchNo) {
    throw new Error('batchNo 不能为空');
  }

  const uidList = normalizeUids(rawUids);

  if (!uidList.length) {
    throw new Error('uid 列表不能为空');
  }

  const result = await TaskStore.addTask({
    batchNo: normalizedBatchNo,
    taskId: normalizedTaskId,
    userId: normalizedUserId,
    uids: uidList,
    // 如果有批次信息，传递给 addTask
    ...(batchInfo && { batchInfo }),
  });

  return {
    userId: normalizedUserId,
    taskId: normalizedTaskId,
    batchNo: result.batchNo,
    added: result.newUids.length,
    duplicated: uidList.length - result.newUids.length,
    total: uidList.length,
  };
}

// 限流配置
const limiter = rateLimit({
  ...config.rateLimit,
  message: '请求过于频繁，请稍后再试',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);

// ==================== 健康检查 ====================

app.get('/health', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {}
  };

  // 检查 MySQL
  try {
    const [rows] = await mysqlPool.execute('SELECT 1 as test');
    health.services.mysql = rows[0].test === 1 ? 'connected' : 'error';
  } catch (err) {
    health.services.mysql = 'error';
    health.status = 'degraded';
  }

  // 检查 Redis
  try {
    const result = await redis.ping();
    health.services.redis = result === 'PONG' ? 'connected' : 'error';
  } catch (err) {
    health.services.redis = 'error';
    health.status = 'degraded';
  }

  return Response.success(res, health, '健康检查成功', 0);
});

// ==================== API 路由示例 ====================

// 示例：使用 MySQL 查询
app.get('/api/users', async (req, res) => {
  try {
    const [rows] = await mysqlPool.execute('SELECT * FROM users LIMIT 10');
    return Response.success(res, { data: rows, count: rows.length }, '查询成功', 0);
  } catch (error) {
    console.error('MySQL 查询错误:', error);
    return Response.error(res, '数据库查询失败', -1, { error: error.message }, 500);
  }
});

// 示例：使用 Redis 缓存
app.get('/api/cache/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const value = await redis.get(key);
    
    if (value) {
      return Response.success(res, { data: JSON.parse(value), fromCache: true }, '查询成功', 0);
    } else {
      return Response.success(res, { data: null, fromCache: false }, '缓存未命中', 0);
    }
  } catch (error) {
    console.error('Redis 查询错误:', error);
    return Response.error(res, '缓存查询失败', -1, { error: error.message }, 500);
  }
});

// 示例：设置 Redis 缓存
app.post('/api/cache/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { value, ttl } = req.body; // ttl 单位：秒
    
    if (ttl) {
      await redis.setex(key, ttl, JSON.stringify(value));
    } else {
      await redis.set(key, JSON.stringify(value));
    }
    
    return Response.success(res, null, '缓存设置成功', 0);
  } catch (error) {
    console.error('Redis 设置错误:', error);
    return Response.error(res, '缓存设置失败', -1, { error: error.message }, 500);
  }
});

// 示例：MySQL + Redis 组合使用
app.get('/api/user/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const cacheKey = `user:${id}`;
    
    // 先查 Redis
    let user = await redis.get(cacheKey);
    
    if (user) {
      return Response.success(res, { data: JSON.parse(user), fromCache: true }, '查询成功', 0);
    }
    
    // Redis 未命中，查 MySQL
    const [rows] = await mysqlPool.execute(
      'SELECT * FROM users WHERE id = ?',
      [id]
    );
    
    if (rows.length === 0) {
      return Response.error(res, '用户不存在', -1, null, 404);
    }
    
    // 写入 Redis 缓存（5 分钟过期）
    await redis.setex(cacheKey, 300, JSON.stringify(rows[0]));
    
    return Response.success(res, { data: rows[0], fromCache: false }, '查询成功', 0);
  } catch (error) {
    console.error('查询用户错误:', error);
    return Response.error(res, '查询失败', -1, { error: error.message }, 500);
  }
});

// ==================== TikTok API 接口 ====================

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
 * 发送文本消息接口
 * POST /api/tiktok/send-text
 * 
 * 请求体参数:
 * {
 *   "toUid": "目标用户ID (必填)",
 *   "textMsg": "消息内容 (必填)",
 *   "tableName": "表名，如 'uni_cookies_1' (可选，默认 'uni_cookies_1')",
 *   "proxy": "http://proxy:port", // 可选，代理地址
 *   "createSequenceId": 10000, // 可选，不传则自动生成（10000-12000随机）
 *   "sendSequenceId": 10013 // 可选，不传则自动计算（createSequenceId + 1）
 * }
 */
app.post('/api/tiktok/send-text', async (req, res) => {
  let dbConnection = null;
  
  try {
    const { 
      toUid, 
      textMsg, 
      tableName = 'uni_cookies_1', // 默认表名
      proxy, 
      createSequenceId,
      sendSequenceId
    } = req.body;

    // 参数验证
    if (!toUid) {
      return Response.error(res, '缺少必需参数: toUid (目标用户ID)', -1, null, 400);
    }

    if (!textMsg || typeof textMsg !== 'string' || textMsg.trim().length === 0) {
      return Response.error(res, '缺少必需参数: textMsg (消息内容不能为空)', -1, null, 400);
    }

    // 从数据库获取 cookie（按 used_count 升序排序，使用次数少的优先）
    dbConnection = await mysqlPool.getConnection();
    
    const [records] = await dbConnection.execute(
      `SELECT id, cookies_text, ck_uid, used_count 
       FROM ${tableName} 
       WHERE status = 1 
       ORDER BY used_count ASC, update_time DESC 
       LIMIT 1`
    );

    if (records.length === 0) {
      await dbConnection.release();
      return Response.error(res, `未找到状态为正常(status=1) 的 Cookie`, -1, null, 404);
    }

    const cookieRecord = records[0];
    const cookieId = cookieRecord.id;
    const cookiesText = cookieRecord.cookies_text;
    const ckUid = cookieRecord.ck_uid || 0;
    const currentUsedCount = cookieRecord.used_count || 0;

    // 解析 cookie 获取 user_agent 和 device_id
    const cookieObj = parseCookieString(cookiesText);
    
    // 从 cookie 中获取 user_agent（优先级：cookie['User-Agent'] > cookie['user-agent']）
    const finalUserAgent = cookieObj['User-Agent'] || cookieObj['user-agent'] || null;
    
    // 从 cookie 中获取 device_id
    const finalDeviceId = cookieObj.device_id || null;
    
    // 计算 createSequenceId 和 sendSequenceId
    // createSequenceId: 如果不传，则在 10000-12000 之间随机
    const finalCreateSequenceId = createSequenceId || Math.floor(Math.random() * 2001) + 10000; // 10000-12000
    
    // sendSequenceId: 如果不传，则等于 createSequenceId + 1
    const finalSendSequenceId = sendSequenceId || (finalCreateSequenceId + 1);
    
    // 构建请求数据
    const requestData = {
      toUid,
      textMsg,
      cookieParams: cookiesText,
      proxy: proxy || null,
      user_agent: finalUserAgent,
      device_id: finalDeviceId,
      createSequenceId: finalCreateSequenceId,
      sendSequenceId: finalSendSequenceId,
    };

    // 调用web  TiktokApi 的 sendText 方法
    const result = await sendText(requestData);

    // 更新 used_count（使用次数+1)
    
    try {
      await dbConnection.execute(
        `UPDATE ${tableName} SET used_count = used_count + 1, update_time = UNIX_TIMESTAMP() WHERE id = ?`,
        [cookieId]
      );
    } catch (updateError) {
      console.error(`[API] 更新 Cookie 使用次数失败 (ID: ${cookieId}):`, updateError.message);
      // 使用次数更新失败不影响主流程
    }

    // 根据返回结果更新状态
    try {
      const updateResult = await updateCookieStatus({
        cookieId: cookieId,
        tableName: tableName,
        resultCode: result.code,
        cookiesText: cookiesText,
        ckUid: ckUid,
        connection: dbConnection
      });
      
      if (updateResult.updated) {
        console.log(`[API] Cookie ID ${cookieId} 状态已更新: ${updateResult.message}`);
      } else {
        console.log(`[API] Cookie ID ${cookieId} 状态未更新: ${updateResult.message}`);
      }
    } catch (updateError) {
      console.error(`[API] 更新 Cookie 状态失败 (ID: ${cookieId}):`, updateError.message);
      // 状态更新失败不影响接口返回
    }

    // 返回结果
    if (result.code === 0) {
      return Response.success(res, { ...result.data, cookieId }, result.msg || '发送成功', result.code);
    } else {
      return Response.error(res, result.msg || '发送失败', result.code, { ...result.data, cookieId }, 400);
    }

  } catch (error) {
    console.error('发送 TikTok 消息错误:', error);
    return Response.error(res, error.message || '发送消息失败', -10002, { ...(config.env === 'dev' && { stack: error.stack }) }, 500);
  } finally {
    // 释放数据库连接
    if (dbConnection) {
      dbConnection.release();
    }
  }
});

/**
 * 提交发送任务
 * POST /api/tasks/submit
 *
 * Headers:
 *   Authorization: Bearer <token> 或 X-Token: <token>
 *
 * Body:
 * {
 *   "uids": "123,456" | ["123","456"],
 *   "content": "消息内容",
 *   "msgType": 1,
 *   "proxy": "http://xxx:9000",
 *   "sendType": 0, // 0=web, 1=app
 *   "batchNo": "批次号",
 *   "total": 100 // 发送条数（必填）
 * }
 */
app.post('/api/v1/tk-task/submit', async (req, res) => {
  try {
    // 从请求头获取 token
    const authHeader = req.headers.authorization || req.headers['x-token'];
    let token = null;
    
    if (authHeader) {
      // 支持 Bearer <token> 格式
      if (authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      } else {
        token = authHeader;
      }
    }
    
    // 也可以从 body 中获取 token
    if (!token && req.body.token) {
      token = req.body.token;
    }

    if (!token) {
      return Response.error(res, '缺少 token，请在请求头 Authorization 或 X-Token 中提供', -1, null, 401);
    }

    // 验证 token 并获取用户信息
    const user = await verifyToken(token);
    if (!user || !user.uid) {
      return Response.error(res, 'token 无效或已过期', -1, null, 401);
    }

    const userId = user.uid;

    // 参数验证
    const { total, content, msgType, proxy, sendType } = req.body;
    let taskId = req.body.taskId;

    // 验证 total 参数（必填）
    if (total === undefined || total === null || Number.isNaN(Number(total))) {
      return Response.error(res, 'total 参数必填且必须是数字', -1, null, 400);
    }

    const normalizedTotal = Number(total);
    if (normalizedTotal <= 0 || !Number.isInteger(normalizedTotal)) {
      return Response.error(res, 'total 必须是大于 0 的整数', -1, null, 400);
    }

    // const rawUids = req.body.uids ?? req.body['uids[]'];
    // const uidList = normalizeUids(rawUids);

    // if (!uidList.length) {
    //   return Response.error(res, 'uids 参数不能为空，支持数组或以逗号/空格分隔的字符串', -1, null, 400);
    // }

    // content 支持字符串或数组
    let contentArray = [];
    if (Array.isArray(content)) {
      // 如果是数组，过滤空值并验证
      contentArray = content.filter(item => item && typeof item === 'string' && item.trim());
      if (contentArray.length === 0) {
        return Response.error(res, 'content 数组不能为空，至少需要一个有效的内容', -1, null, 400);
      }
    } else if (typeof content === 'string' && content.trim()) {
      // 如果是字符串，转换为数组
      contentArray = [content.trim()];
    } else {
      return Response.error(res, 'content 不能为空，支持字符串或字符串数组', -1, null, 400);
    }

    if (msgType === undefined || msgType === null || Number.isNaN(Number(msgType))) {
      return Response.error(res, 'msgType 必须是数字', -1, null, 400);
    }

    let normalizedSendType = 0;
    if (sendType !== undefined && sendType !== null && sendType !== '') {
      const parsed = Number(sendType);
      if (![0, 1].includes(parsed)) {
        return Response.error(res, 'sendType 仅支持 0(web) 或 1(app)', -1, null, 400);
      }
      normalizedSendType = parsed;
    }
    // 获取用户余额（先查 Redis，如果没有则查数据库）
    const currentQuota = await QuotaService.getQuota(userId);

    //获取每条需要消耗的积分
    const payConfig = await QuotaService.getPayConfigFromDB(userId);
    
    if (!payConfig) {
      return Response.error(res, '获取支付配置失败', -1, null, 500);
    }

    console.log("[payConfig]:",payConfig)
    //计算代理费用：总数 / 每单位代理数 * 每单位价格
    const proxyCost = (normalizedTotal / payConfig.unit_proxy) * payConfig.proxy_price;
    //计算发送费用：总数 / 每单位私信数 * 每单位价格
    const sendCost = (normalizedTotal / payConfig.unit_sixin) * payConfig.sixin_price;
    //统计总费用
    const totalCost = proxyCost + sendCost;

    console.log("[totalCost]:",totalCost)
    console.log("[proxyCost]:",proxyCost)
    console.log("[sendCost]:",sendCost)
    // 判断余额是否足够
    if (currentQuota < totalCost) {
      const insufficient = totalCost - currentQuota;
      return Response.error(res, `余额不足，当前余额: ${currentQuota}，需要: ${totalCost.toFixed(2)}`, -1, {
        currentQuota,
        required: totalCost,
        insufficient: insufficient
      }, 400);
    }
    console.log("[totalCost]:",totalCost)
    
    //创建taskID
    //先判断有没有传taskID 有传则更新 没有则新增
    taskId = GuidUtil.generate();

    // 扣减余额、冻结金额并生成账单
    const deductResult = await QuotaService.deductFreezeAndCreateBill({
      uid: userId,
      amount: totalCost,
      taskId: taskId,
      title: '私信任务消费',
      mark: `发送数量: ${normalizedTotal}, 代理费: ${proxyCost.toFixed(2)}, 发送费: ${sendCost.toFixed(2)}`,
      buyNum: normalizedTotal,
      payConfig: {
        total: normalizedTotal,
        proxyCost,
        sendCost,
        totalCost,
        config: payConfig,
      },
      billType: 'sixin',
      billCategory: 'frozen',
      billOrderId: GuidUtil.generate(),
      completedNum: 0,
    });

    if (!deductResult.success) {
      return Response.error(res, deductResult.message || '扣减余额失败', -1, null, 400);
    }

    const { beforeScore, afterScore, frozenScore, billId } = deductResult.data;
    
    //任务总数写入到redis中
    await redis.set(`task:total:${taskId}`, normalizedTotal);
     
    //将提交的信息缓存到redis 
    await redis.setex(`task:${taskId}`, 86400, JSON.stringify({
      userId,
      total: normalizedTotal,
      payConfig: payConfig,
      content: contentArray, // 保存为数组
      msgType,
      proxy,
      sendType,
      taskId,
      totalCost,
      proxyCost,
      sendCost,
      billId,
      status: 'frozen', // 已冻结
      message: '余额扣减成功，已冻结待结算'
    }));

    return Response.success(res, { 
      taskId,
      beforeScore,
      afterScore,
      frozenScore,
      totalCost,
      proxyCost,
      sendCost,
      billId,
      payConfig
    }, '任务提交成功，余额已扣减并冻结', 0);

  } catch (error) {
    console.error('提交任务失败:', error);
    return Response.error(res, error.message || '提交任务失败', -1, null, 500);
  }
});

/**
 * 将 UID 列表加入任务队列
 * Body: { taskId: string, uids: string[] | string }
 */
app.post('/api/v1/tk-task/enqueue', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || req.headers['x-token'];
    let token = null;

    if (authHeader) {
      if (authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      } else {
        token = authHeader;
      }
    }

    if (!token && req.body.token) {
      token = req.body.token;
    }

    if (!token) {
      return Response.error(res, '未登录', -1, null, 401);
    }

    const user = await verifyToken(token);
    if (!user || !user.uid) {
      return Response.error(res, 'token 无效或已过期', -1, null, 401);
    }

    const { taskId, batchNo, uid } = req.body;
    const rawUids = req.body.uids ?? req.body.uidList ?? req.body['uids[]'] ?? uid;

    if (!taskId) {
      return Response.error(res, 'taskId 不能为空', -1, null, 400);
    }

    if (!batchNo) {
      return Response.error(res, 'batchNo 不能为空', -1, null, 400);
    }
    //判断taskID是否存在
    const taskStr = await redis.get(`task:${taskId}`);
    if (!taskStr) {
      return Response.error(res, 'taskId 不存在', -1, null, 400);
    }
    
    let taskData;
    try {
      taskData = JSON.parse(taskStr);
    } catch (error) {
      return Response.error(res, '任务数据格式错误', -1, null, 400);
    }
    
    // 保存批次信息（包含 content 数组）
    const result = await enqueueTaskUids(user.uid, taskId, batchNo, rawUids, {
      content: taskData.content || [], // content 数组
      msgType: taskData.msgType,
      proxy: taskData.proxy,
      sendType: taskData.sendType,
    });

    return Response.success(res, {
      ...result,
      userId: user.uid,
    }, '任务添加成功', 0);
  } catch (error) {
    console.error('添加任务失败:', error);
    return Response.error(res, error.message || '添加任务失败', -1, null, 500);
  }
});

// ==================== Cookies 队列接口 ====================

/**
 * 分页获取正常 CK 列表（统一队列）
 * GET /api/cookies/queue?page=1&pageSize=10&priority=0
 * 
 * 查询参数:
 * - page: 页码（默认 1）
 * - pageSize: 每页数量（默认 10）
 * - priority: 优先级筛选（可选：0或1，不传则返回全部）
 */
app.get('/api/cookies/queue', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 10;
    const priority = req.query.priority !== undefined ? parseInt(req.query.priority) : null;

    // 获取分页数据
    const result = await CookiesQueue.getCookiesList(page, pageSize, priority);

    return Response.success(res, result, '查询成功', 0);
  } catch (error) {
    console.error('获取 Cookies 队列失败:', error);
    return Response.error(res, '获取队列失败', -1, { error: error.message }, 500);
  }
});

/**
 * 获取队列总数
 * GET /api/cookies/queue/count?priority=0
 * 
 * 查询参数:
 * - priority: 优先级筛选（可选：0或1，不传则返回全部）
 */
app.get('/api/cookies/queue/count', async (req, res) => {
  try {
    const priority = req.query.priority !== undefined ? parseInt(req.query.priority) : null;

    const total = await CookiesQueue.getQueueLength(priority);

    return Response.success(res, { total }, '查询成功', 0);
  } catch (error) {
    console.error('获取队列总数失败:', error);
    return Response.error(res, '获取总数失败', -1, { error: error.message }, 500);
  }
});

/**
 * 获取指定 ID 的 Cookie
 * GET /api/cookies/queue/:id
 */
app.get('/api/cookies/queue/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const cookie = await CookiesQueue.getCookieById(parseInt(id));

    if (cookie) {
      return Response.success(res, cookie, '查询成功', 0);
    } else {
      return Response.error(res, 'Cookie 不存在', -1, null, 404);
    }
  } catch (error) {
    console.error('获取 Cookie 失败:', error);
    return Response.error(res, '获取 Cookie 失败', -1, { error: error.message }, 500);
  }
});

/**
 * 获取指定 ID 的 Cookie 状态信息
 * GET /api/cookies/queue/:id/status
 */
app.get('/api/cookies/queue/:id/status', async (req, res) => {
  try {
    const { id } = req.params;

    const status = await CookiesQueue.getCookieStatus(parseInt(id));

    if (status) {
      return Response.success(res, status, '查询成功', 0);
    } else {
      return Response.error(res, 'Cookie 不存在', -1, null, 404);
    }
  } catch (error) {
    console.error('获取 Cookie 状态失败:', error);
    return Response.error(res, '获取 Cookie 状态失败', -1, { error: error.message }, 500);
  }
});

/**
 * 从队列中移除 Cookie
 * DELETE /api/cookies/queue/:id
 */
app.delete('/api/cookies/queue/:id', async (req, res) => {
  try {
    const { id } = req.params;

    await CookiesQueue.removeCookie(parseInt(id));

    return Response.success(res, null, 'Cookie 已从队列中移除', 0);
  } catch (error) {
    console.error('移除 Cookie 失败:', error);
    return Response.error(res, '移除 Cookie 失败', -1, { error: error.message }, 500);
  }
});

// ==================== 错误处理 ====================

// 404 处理
app.use((req, res) => {
  return Response.error(res, '路由不存在', -1, null, 404);
});

// 全局错误处理
app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  const errorData = config.env === 'dev' ? { stack: err.stack } : null;
  return Response.error(res, err.message || '服务器内部错误', -1, errorData, err.status || 500);
});

// ==================== 启动服务器 ====================

const server = app.listen(PORT, () => {
  console.log(`🚀 服务器运行在端口 ${PORT}`);
  console.log(`📊 环境: ${config.env}`);
  console.log(`🔗 健康检查: http://localhost:${PORT}/health`);
});

// 初始化 Socket.IO
initSocketServer(server);

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('收到 SIGTERM 信号，正在关闭服务器...');
  server.close(() => {
    console.log('服务器已关闭');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('收到 SIGINT 信号，正在关闭服务器...');
  server.close(() => {
    console.log('服务器已关闭');
    process.exit(0);
  });
});

// 未捕获的异常处理
process.on('uncaughtException', (err) => {
  console.error('未捕获的异常:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的 Promise 拒绝:', reason);
  process.exit(1);
});

module.exports = app;

