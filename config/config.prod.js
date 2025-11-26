// config/config.prod.js
module.exports = {
  mysql: {
    host: 'your_prod_mysql_host',
    password: 'your_prod_mysql_password',
    database: 'tiktok_db_prod',
    connectionLimit: 100,
  },
  redis: {
    host: 'your_prod_redis_host',
    password: 'your_prod_redis_password',
  },
  server: {
    port: 80,
  },
  cors: {
    origin: 'https://your-production-domain.com',
  },
  rateLimit: {
    max: 1000, // 为生产环境设置更高的请求限制
  }
};
