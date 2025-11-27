const mysql = require('mysql2/promise');
const config = require('./index');

// 本地 MySQL 连接池（用于 cookies 等）
const pool = mysql.createPool(config.mysql);

// 远程 MySQL 连接池（用于账户余额等）
const authPool = mysql.createPool(config.authMysql);

// 测试本地连接
pool.getConnection()
  .then(connection => {
    console.log('✅ Local MySQL 连接池创建成功 (localhost)');
    connection.release();
  })
  .catch(err => {
    console.error('❌ Local MySQL 连接池创建失败:', err.message);
  });

// 测试远程连接
authPool.getConnection()
  .then(connection => {
    console.log('✅ Auth MySQL 连接池创建成功 (217.77.12.171)');
    connection.release();
  })
  .catch(err => {
    console.error('❌ Auth MySQL 连接池创建失败:', err.message);
  });

// 优雅关闭
process.on('SIGINT', async () => {
  console.log('正在关闭 MySQL 连接池...');
  await Promise.all([pool.end(), authPool.end()]);
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('正在关闭 MySQL 连接池...');
  await Promise.all([pool.end(), authPool.end()]);
  process.exit(0);
});

// 默认导出本地连接池，同时导出 authPool
module.exports = pool;
module.exports.authPool = authPool;
