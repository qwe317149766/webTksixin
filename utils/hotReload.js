const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');

/**
 * 热更新管理器
 */
class HotReloadManager {
  constructor(cluster, options = {}) {
    this.cluster = cluster;
    this.options = {
      // 监听的文件扩展名
      extensions: options.extensions || ['.js'],
      // 忽略的文件/目录
      ignored: options.ignored || [
        /node_modules/,
        /\.git/,
        /\.log$/,
        /\.tmp$/,
        /\.cache/,
        /config\/config\.(dev|prod)\.js$/, // 忽略配置文件，避免频繁重启
      ],
      // 延迟重启时间（毫秒），避免频繁重启
      debounceDelay: options.debounceDelay || 1000,
      // 是否启用热更新
      enabled: options.enabled !== false,
    };
    
    this.watcher = null;
    this.restartTimer = null;
    this.isRestarting = false;
    this.restartQueue = [];
  }

  /**
   * 启动文件监听
   */
  start() {
    if (!this.options.enabled) {
      console.log('⚠️  热更新功能已禁用');
      return;
    }

    const projectRoot = path.resolve(__dirname, '..');
    
    // 构建监听路径
    const watchPaths = [
      path.join(projectRoot, 'server.js'),
      path.join(projectRoot, 'cluster.js'),
      path.join(projectRoot, 'config'),
      path.join(projectRoot, 'tiktokWeb'),
      path.join(projectRoot, 'utils'),
    ].filter(p => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    });

    console.log('🔥 启动热更新监听...');
    console.log('📁 监听目录:', watchPaths);

    // 创建文件监听器
    this.watcher = chokidar.watch(watchPaths, {
      ignored: this.options.ignored,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });

    // 监听文件变化
    this.watcher.on('change', (filePath) => {
      this.handleFileChange(filePath);
    });

    this.watcher.on('add', (filePath) => {
      if (this.isWatchableFile(filePath)) {
        console.log(`📄 检测到新文件: ${filePath}`);
      }
    });

    this.watcher.on('error', (error) => {
      console.error('❌ 文件监听错误:', error);
    });

    console.log('✅ 热更新监听已启动');
  }

  /**
   * 检查文件是否可监听
   */
  isWatchableFile(filePath) {
    const ext = path.extname(filePath);
    return this.options.extensions.includes(ext);
  }

  /**
   * 处理文件变化
   */
  handleFileChange(filePath) {
    if (!this.isWatchableFile(filePath)) {
      return;
    }

    console.log(`🔄 检测到文件变化: ${filePath}`);

    // 清除之前的重启定时器
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
    }

    // 防抖处理：延迟重启，避免频繁重启
    this.restartTimer = setTimeout(() => {
      this.restartWorkers();
    }, this.options.debounceDelay);
  }

  /**
   * 重启工作进程（滚动重启）
   */
  async restartWorkers() {
    if (this.isRestarting) {
      console.log('⏳ 重启正在进行中，跳过此次重启');
      return;
    }

    this.isRestarting = true;
    console.log('🔄 开始滚动重启工作进程...');

    const workers = Object.values(this.cluster.workers || {});
    
    if (workers.length === 0) {
      console.log('⚠️  没有工作进程需要重启');
      this.isRestarting = false;
      return;
    }

    // 逐个重启工作进程，确保至少有一个进程在处理请求
    for (let i = 0; i < workers.length; i++) {
      const worker = workers[i];
      
      try {
        console.log(`🔄 正在重启工作进程 ${worker.process.pid} (${i + 1}/${workers.length})`);
        
        // 创建新的工作进程
        const newWorker = this.cluster.fork();
        
        // 等待新进程就绪
        await new Promise((resolve) => {
          newWorker.once('online', () => {
            console.log(`✅ 新工作进程 ${newWorker.process.pid} 已就绪`);
            resolve();
          });
        });

        // 等待一小段时间，确保新进程完全启动
        await new Promise(resolve => setTimeout(resolve, 500));

        // 优雅关闭旧进程
        await this.gracefulShutdown(worker);

        console.log(`✅ 工作进程 ${worker.process.pid} 已替换为 ${newWorker.process.pid}`);
        
        // 在重启下一个进程前稍作等待
        if (i < workers.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`❌ 重启工作进程 ${worker.process.pid} 失败:`, error);
      }
    }

    console.log('✅ 所有工作进程已重启完成');
    this.isRestarting = false;
  }

  /**
   * 优雅关闭工作进程
   */
  async gracefulShutdown(worker) {
    return new Promise((resolve) => {
      // 发送关闭信号
      worker.disconnect();

      // 设置超时，如果进程在指定时间内没有退出，强制杀死
      const timeout = setTimeout(() => {
        if (!worker.isDead()) {
          console.log(`⚠️  工作进程 ${worker.process.pid} 未在超时时间内退出，强制终止`);
          worker.kill('SIGKILL');
        }
        resolve();
      }, 10000); // 10秒超时

      // 监听进程退出
      worker.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  /**
   * 停止文件监听
   */
  stop() {
    if (this.watcher) {
      console.log('🛑 停止热更新监听...');
      this.watcher.close();
      this.watcher = null;
    }

    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }
}

module.exports = HotReloadManager;

