// config/config.default.js
module.exports = {
  server: {
    port: 3000,
    workers: require('os').cpus().length,
    hotReload: true, // 是否启用热更新（开发环境默认启用）
    hotReloadDebounce: 1000, // 热更新防抖延迟（毫秒）
  },
  cookies: {
    saveToRedis: false, // 是否将正常CK存入Redis队列
  },
  mysql: {
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: '',
    database: 'tiktok_db',
    connectionLimit: 20,
    queueLimit: 0,
    waitForConnections: true,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    connectTimeout: 10000,
    charset: 'utf8mb4',
    timezone: '+00:00',
    multipleStatements: false
  },
  redis: {
    host: 'localhost',
    port: 6379,
    password: 'a123456',
    db: 0,
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => {
      return Math.min(times * 1000, 20000);
    },
    enableReadyCheck: true,
    enableOfflineQueue: true,
    lazyConnect: false,
    connectTimeout: 10000,
    commandTimeout: 5000,
    keepAlive: 30000
  },
  cors: {
    origin: '*',
    credentials: true
  },
  rateLimit: {
    windowMs: 1 * 60 * 1000,
    max: 100,
  }
};
