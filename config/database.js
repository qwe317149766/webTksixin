const mysql = require('mysql2/promise');
const config = require('./index');

// MySQL 连接池配置
const pool = mysql.createPool(config.mysql);

// 测试连接
pool.getConnection()
  .then(connection => {
    console.log('✅ MySQL 连接池创建成功');
    connection.release();
  })
  .catch(err => {
    console.error('❌ MySQL 连接池创建失败:', err.message);
  });

// 优雅关闭
process.on('SIGINT', async () => {
  console.log('正在关闭 MySQL 连接池...');
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('正在关闭 MySQL 连接池...');
  await pool.end();
  process.exit(0);
});

module.exports = pool;

