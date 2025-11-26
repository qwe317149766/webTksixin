const cluster = require('cluster');
const config = require('./config');
const HotReloadManager = require('./utils/hotReload');

const numWorkers = config.server.workers;

if (cluster.isMaster) {
  console.log(`主进程 ${process.pid} 正在运行`);
  console.log(`启动 ${numWorkers} 个工作进程...`);

  // 创建工作进程
  for (let i = 0; i < numWorkers; i++) {
    cluster.fork();
  }

  // 初始化热更新管理器
  const hotReload = new HotReloadManager(cluster, {
    enabled: config.server.hotReload !== false, // 默认启用，可通过配置禁用
    debounceDelay: config.server.hotReloadDebounce || 1000,
  });

  // 启动热更新（仅在非生产环境或明确启用时）
  if (config.env === 'dev' || config.server.hotReload === true) {
    hotReload.start();
  }

  // 监听工作进程退出
  cluster.on('exit', (worker, code, signal) => {
    console.log(`工作进程 ${worker.process.pid} 已退出 (代码: ${code}, 信号: ${signal})`);
    
    // 如果不是在重启过程中，自动重启工作进程
    if (!hotReload.isRestarting) {
      console.log('正在启动新的工作进程...');
      cluster.fork();
    }
  });

  // 监听工作进程在线
  cluster.on('online', (worker) => {
    console.log(`工作进程 ${worker.process.pid} 已上线`);
  });

  // 监听工作进程断开连接
  cluster.on('disconnect', (worker) => {
    console.log(`工作进程 ${worker.process.pid} 已断开连接`);
  });

  // 优雅关闭所有工作进程
  process.on('SIGTERM', () => {
    console.log('主进程收到 SIGTERM，正在关闭所有工作进程...');
    hotReload.stop();
    for (const id in cluster.workers) {
      cluster.workers[id].kill();
    }
  });

  process.on('SIGINT', () => {
    console.log('主进程收到 SIGINT，正在关闭所有工作进程...');
    hotReload.stop();
    for (const id in cluster.workers) {
      cluster.workers[id].kill();
    }
  });

} else {
  // 工作进程启动服务器
  require('./server.js');
  console.log(`工作进程 ${process.pid} 已启动`);
}

