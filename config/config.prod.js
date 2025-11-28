// config/config.prod.js
module.exports = {
  server: {
    port: 3000,
    workers: require('os').cpus().length,
  },
  // 远程 MySQL（用于账户余额等）
  authMysql: {
    host: '217.77.12.171',
    port: 3306,
    user: 'ins_fb',
    password: 'G4fMJZCkjHLLZDNs',
    database: 'ins_fb',
    connectionLimit: 100,
    queueLimit: 0,
    waitForConnections: true,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    connectTimeout: 35000,
    charset: 'utf8mb4',
    timezone: '+00:00',
    multipleStatements: false
  },
  // 本地 MySQL（用于 cookies 等）
  mysql: {
    host: 'localhost',
    port: 3306,
    user: 'uni_fb',
    password: 'G4fMJZCkjHLLZDNs',
    database: 'uni_fb',
    connectionLimit: 1000,
    queueLimit: 0,
    waitForConnections: true,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    connectTimeout: 35000,
    charset: 'utf8mb4',
    timezone: '+00:00',
    multipleStatements: false
  },
  // 鉴权 Redis（远程服务器，用于 token 验证等）
  authRedis: {
    host: '217.77.12.171',
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
  // 本地 Redis（用于任务队列、配额等）
  redis: {
    host: '127.0.0.1',
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
    max: 100000,
  },
  task: {
    batchSize: 1, // 批量处理任务数量
    concurrency: 1, // 并发数
    lowThreshold: 2, // 低阈值
    cookieRatio: {
      multiplier: 1.5, // cookies 总数倍数（相对于 tasks.length）
      priority1Ratio: 2/3, // priority_code=1 的比例
      priority0Ratio: 1/3, // priority_code=0 的比例
    },
  },
}
