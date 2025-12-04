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
  task: {
    batchSize: 10, // 批量处理任务数量
    concurrency: 10, // 并发数
    lowThreshold: 50, // 低阈值
    needMoreThrottleMs: 10000, // needMore 最小间隔
    orderTimeoutMs: 5 * 60 * 1000, // 订单超时时间（毫秒）
    cookieRatio: {
      multiplier: 1.5, // cookies 总数倍数（相对于 tasks.length）
      priority1Ratio: 2/3, // priority_code=1 的比例
      priority0Ratio: 1/3, // priority_code=0 的比例
    },
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
  },
  proxy: {
    socks5: '',
  },
  curl: {
    keepAlive: {
      enabled: true,
      idleSeconds: 60,
      intervalSeconds: 30,
    },
    maxConcurrency: 200,
    requestTimeoutSeconds:90,
    connectionPool: {
      initialSize: 20,
      prewarmBatchSize: 5,
      maxFailures: 3,
      idleTimeoutMs: 300000,
      refreshIntervalMs: 600000,
    },
  },
};
