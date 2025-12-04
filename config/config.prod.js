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
    host: '62.164.220.35',
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
    batchSize: 200, // 批量处理任务数量
    concurrency: 200, // 并发数
    lowThreshold: 400, // 低阈值
    cookieRatio: {
      multiplier: 1, // cookies 总数倍数（相对于 tasks.length）
      priority1Ratio: 8/10, // priority_code=1 的比例
      priority0Ratio: 2/10, // priority_code=0 的比例
    },
    needMoreThrottleMs: 100,
    orderTimeoutMs: 5 * 60 * 1000,
    sender: {
      channel: 'app',
    }
  },
  proxy: {
    socks5: 'socks5h://accountId-5086-tunnelId-12988-area-us:a123456@proxyus.starryproxy.com:10000',
  },
  curl: {
    modifyProxyUsername: false,
    maxRequestsPerConnection: 20,
    healthCheckIntervalMs: 60000,
    queueBackoffBaseMs: 20,
    queueBackoffMaxMs: 2000,
    queueMaxConcurrentAttempts: 100,
    connectionPool: {
      initialSize: 100,
      maxSize: 1000,
      prewarmBatchSize: 20,
      maxFailures: 3,
      idleTimeoutMs: 300000,
      refreshIntervalMs: 600000,
      maxRequestsPerConnection: 1000,
      maxConcurrentPerConnection: 1,
    },
  },
}
