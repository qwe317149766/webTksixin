const Redis = require('ioredis');
const config = require('./index');

// Redis 连接配置
// 强制使用 IPv4，避免 IPv6 连接问题
const redisConfig = {
  ...config.redis,
  family: 4, // 强制使用 IPv4
  // 如果 host 是 localhost，转换为 127.0.0.1
  host: config.redis.host === 'localhost' ? '127.0.0.1' : config.redis.host,
};

// 如果密码为空字符串或未设置，则不设置 password 属性
if (!redisConfig.password || redisConfig.password === '') {
  delete redisConfig.password;
}

const redis = new Redis(redisConfig);

// 连接事件监听
redis.on('connect', () => {
  console.log('✅ Redis 连接成功');
});

redis.on('ready', () => {
  console.log('✅ Redis 就绪');
});

redis.on('error', (err) => {
  console.error('❌ Redis 连接错误:', err.message);
  if (err.code === 'ECONNREFUSED') {
    console.error('💡 提示: 请确保 Redis 服务已启动');
    console.error(`   尝试连接: ${redisConfig.host}:${redisConfig.port}`);
    console.error('   Windows: 检查 Redis 服务是否运行');
    console.error('   启动命令: redis-server 或通过服务管理器启动');
  }
});

redis.on('close', () => {
  console.log('⚠️ Redis 连接关闭');
});

redis.on('reconnecting', (delay) => {
  console.log(`🔄 Redis 正在重连，延迟: ${delay}ms`);
});

// 优雅关闭
process.on('SIGINT', async () => {
  console.log('正在关闭 Redis 连接...');
  await redis.quit();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('正在关闭 Redis 连接...');
  await redis.quit();
  process.exit(0);
});

module.exports = redis;

