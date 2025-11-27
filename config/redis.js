const Redis = require('ioredis');
const config = require('./index');

/**
 * 创建 Redis 客户端
 * @param {Object} redisConfig - Redis 配置
 * @param {string} name - 客户端名称（用于日志）
 * @returns {Redis}
 */
function createRedisClient(redisConfig, name = 'Redis') {
  // 强制使用 IPv4，避免 IPv6 连接问题
  const finalConfig = {
    ...redisConfig,
    family: 4, // 强制使用 IPv4
    // 如果 host 是 localhost，转换为 127.0.0.1
    host: redisConfig.host === 'localhost' ? '127.0.0.1' : redisConfig.host,
  };

  // 如果密码为空字符串或未设置，则不设置 password 属性
  if (!finalConfig.password || finalConfig.password === '') {
    delete finalConfig.password;
  }

  const client = new Redis(finalConfig);

  // 连接事件监听
  client.on('connect', () => {
    console.log(`✅ ${name} 连接成功 (${finalConfig.host}:${finalConfig.port})`);
  });

  client.on('ready', () => {
    console.log(`✅ ${name} 就绪`);
  });

  client.on('error', (err) => {
    console.error(`❌ ${name} 连接错误:`, err.message);
    if (err.code === 'ECONNREFUSED') {
      console.error(`💡 提示: 请确保 ${name} 服务已启动`);
      console.error(`   尝试连接: ${finalConfig.host}:${finalConfig.port}`);
    }
  });

  client.on('close', () => {
    console.log(`⚠️ ${name} 连接关闭`);
  });

  client.on('reconnecting', (delay) => {
    console.log(`🔄 ${name} 正在重连，延迟: ${delay}ms`);
  });

  return client;
}

// 本地 Redis（用于任务队列、配额、缓存等）
const redis = createRedisClient(config.redis, 'Local Redis');

// 鉴权 Redis（远程服务器，用于 token 验证等）
const authRedis = createRedisClient(config.authRedis, 'Auth Redis');

// 优雅关闭
process.on('SIGINT', async () => {
  console.log('正在关闭 Redis 连接...');
  await Promise.all([redis.quit(), authRedis.quit()]);
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('正在关闭 Redis 连接...');
  await Promise.all([redis.quit(), authRedis.quit()]);
  process.exit(0);
});

// 默认导出本地 Redis，同时导出 authRedis
module.exports = redis;
module.exports.authRedis = authRedis;
