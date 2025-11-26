const express = require('express');
const compression = require('compression');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('./config');

const mysqlPool = require('./config/database');
const redis = require('./config/redis');
const { sendText } = require('./tiktokWeb/TiktokApi');
const CookiesQueue = require('./utils/cookiesQueue');
const { updateCookieStatus, getNormalCookies } = require('./utils/cookieStatusUpdater');

const app = express();
const PORT = config.server.port;

// ==================== 中间件配置 ====================

// 安全头
app.use(helmet());

// CORS 配置
app.use(cors(config.cors));

// Gzip 压缩
app.use(compression());

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

  res.json(health);
});

// ==================== API 路由示例 ====================

// 示例：使用 MySQL 查询
app.get('/api/users', async (req, res) => {
  try {
    const [rows] = await mysqlPool.execute('SELECT * FROM users LIMIT 10');
    res.json({
      success: true,
      data: rows,
      count: rows.length
    });
  } catch (error) {
    console.error('MySQL 查询错误:', error);
    res.status(500).json({
      success: false,
      message: '数据库查询失败',
      error: error.message
    });
  }
});

// 示例：使用 Redis 缓存
app.get('/api/cache/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const value = await redis.get(key);
    
    if (value) {
      res.json({
        success: true,
        data: JSON.parse(value),
        fromCache: true
      });
    } else {
      res.json({
        success: true,
        data: null,
        fromCache: false,
        message: '缓存未命中'
      });
    }
  } catch (error) {
    console.error('Redis 查询错误:', error);
    res.status(500).json({
      success: false,
      message: '缓存查询失败',
      error: error.message
    });
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
    
    res.json({
      success: true,
      message: '缓存设置成功'
    });
  } catch (error) {
    console.error('Redis 设置错误:', error);
    res.status(500).json({
      success: false,
      message: '缓存设置失败',
      error: error.message
    });
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
      return res.json({
        success: true,
        data: JSON.parse(user),
        fromCache: true
      });
    }
    
    // Redis 未命中，查 MySQL
    const [rows] = await mysqlPool.execute(
      'SELECT * FROM users WHERE id = ?',
      [id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }
    
    // 写入 Redis 缓存（5 分钟过期）
    await redis.setex(cacheKey, 300, JSON.stringify(rows[0]));
    
    res.json({
      success: true,
      data: rows[0],
      fromCache: false
    });
  } catch (error) {
    console.error('查询用户错误:', error);
    res.status(500).json({
      success: false,
      message: '查询失败',
      error: error.message
    });
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
      return res.status(400).json({
        success: false,
        code: -1,
        message: '缺少必需参数: toUid (目标用户ID)'
      });
    }

    if (!textMsg || typeof textMsg !== 'string' || textMsg.trim().length === 0) {
      return res.status(400).json({
        success: false,
        code: -1,
        message: '缺少必需参数: textMsg (消息内容不能为空)'
      });
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
      return res.status(404).json({
        success: false,
        code: -1,
        message: `未找到状态为正常(status=1) 的 Cookie`
      });
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

    // 调用 TiktokApi 的 sendText 方法
    const result = await sendText(requestData);

    // 更新 used_count（使用次数+1）
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

    // 根据返回的 code 判断成功或失败
    const isSuccess = result.code === 0;

    // 返回结果
    res.status(isSuccess ? 200 : 400).json({
      success: isSuccess,
      code: result.code,
      message: result.msg,
      data: result.data,
      cookieId: cookieId
    });

  } catch (error) {
    console.error('发送 TikTok 消息错误:', error);
    res.status(500).json({
      success: false,
      code: -10002,
      message: '发送消息失败',
      error: error.message,
      data: {},
      ...(config.env === 'dev' && { stack: error.stack })
    });
  } finally {
    // 释放数据库连接
    if (dbConnection) {
      dbConnection.release();
    }
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

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('获取 Cookies 队列失败:', error);
    res.status(500).json({
      success: false,
      message: '获取队列失败',
      error: error.message
    });
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

    res.json({
      success: true,
      total
    });
  } catch (error) {
    console.error('获取队列总数失败:', error);
    res.status(500).json({
      success: false,
      message: '获取总数失败',
      error: error.message
    });
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
      res.json({
        success: true,
        data: cookie
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'Cookie 不存在'
      });
    }
  } catch (error) {
    console.error('获取 Cookie 失败:', error);
    res.status(500).json({
      success: false,
      message: '获取 Cookie 失败',
      error: error.message
    });
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
      res.json({
        success: true,
        data: status
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'Cookie 不存在'
      });
    }
  } catch (error) {
    console.error('获取 Cookie 状态失败:', error);
    res.status(500).json({
      success: false,
      message: '获取 Cookie 状态失败',
      error: error.message
    });
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

    res.json({
      success: true,
      message: 'Cookie 已从队列中移除'
    });
  } catch (error) {
    console.error('移除 Cookie 失败:', error);
    res.status(500).json({
      success: false,
      message: '移除 Cookie 失败',
      error: error.message
    });
  }
});

// ==================== 错误处理 ====================

// 404 处理
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: '路由不存在'
  });
});

// 全局错误处理
app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || '服务器内部错误',
    ...(config.env === 'dev' && { stack: err.stack })
  });
});

// ==================== 启动服务器 ====================

const server = app.listen(PORT, () => {
  console.log(`🚀 服务器运行在端口 ${PORT}`);
  console.log(`📊 环境: ${config.env}`);
  console.log(`🔗 健康检查: http://localhost:${PORT}/health`);
});

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

