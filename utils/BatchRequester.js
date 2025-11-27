const { EventEmitter } = require('events');

class BatchRequester extends EventEmitter {
    constructor({ sdk, concurrency = 100, lowThreshold = 50 }) {
        super();
        this.sdk = sdk;                     // 复用你的 CurlHttpSdk
        this.concurrency = concurrency;     // 最大并发
        this.lowThreshold = lowThreshold;   // 队列不足阈值提醒补充
        this.queue = [];                    // 待请求队列
        this.active = 0;                    // 正在运行数量
        this.running = false;
    }

    /**
     * 添加任务
     * 支持两种模式：
     * 1. 旧模式（向后兼容）：addTask(url, headers, body, proxyID)
     * 2. 新模式（执行任意函数）：addTask(fn, ...args) 或 addTask({ fn, args })
     */
    addTask(...args) {
        // 判断是否是函数模式
        if (args.length > 0 && typeof args[0] === 'function') {
            // 新模式：addTask(fn, ...args)
            const fn = args[0];
            const fnArgs = args.slice(1);
            this.queue.push({ type: 'function', fn, args: fnArgs });
        } else if (args.length === 1 && typeof args[0] === 'object' && typeof args[0].fn === 'function') {
            // 新模式：addTask({ fn, args })
            const { fn, args: fnArgs = [] } = args[0];
            this.queue.push({ type: 'function', fn, args: fnArgs });
        } else {
            // 旧模式：addTask(url, headers, body, proxyID)
            const [url, headers = {}, body = null, proxyID = null] = args;
            this.queue.push({ type: 'request', url, headers, body, proxyID });
        }

        // 队列不足时提醒补充新任务
        if (this.queue.length < this.lowThreshold) {
            this.emit("needMore", this.queue.length);
        }

        this._runNext();
    }

    start() {
        this.running = true;
        for (let i = 0; i < this.concurrency; i++) {
            this._runNext();
        }
    }

    stop() {
        this.running = false;
    }

    _runNext() {
        if (!this.running) return;
        if (this.active >= this.concurrency) return;
        const task = this.queue.shift();
        if (!task) {
            // 队列空 & 没有 active 请求 => 全部完成
            if (this.active === 0) this.emit("done");
            return;
        }

        this.active++;

        let p;
        
        if (task.type === 'function') {
            // 执行任意函数
            const { fn, args = [] } = task;
            try {
                p = Promise.resolve(fn(...args));
            } catch (error) {
                p = Promise.reject(error);
            }
        } else {
            // 旧模式：使用 SDK 请求
            const { url, headers, body, proxyID } = task;
            p = this.sdk.request(body ? "POST" : "GET", url, headers, body, proxyID);
        }

        p.then(result => {
            if (task.type === 'function') {
                // 函数执行结果
                this.emit("result", {
                    type: 'function',
                    success: result && (result.code === 0 || result.code === undefined),
                    data: result,
                });
            } else {
                // SDK 请求结果
                this.emit("result", {
                    type: 'request',
                    url: task.url,
                    success: result.ok,
                    status: result.status,
                    data: result.body,
                });
            }
        }).catch(err => {
            this.emit("result", {
                type: task.type || 'request',
                success: false,
                error: err.message,
                data: err,
            });
        }).finally(() => {
            this.active--;
            this._runNext(); // 启动下一个进入并发
        });
    }
}
module.exports = BatchRequester;
