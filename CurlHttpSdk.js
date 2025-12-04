'use strict'

let Curl, CurlFeature, Easy, Multi;
const os = require('os');
const platform = os.platform();
let libcurlPath = './bin/mac/node_libcurl.node';
if (platform === 'linux') libcurlPath = './bin/linux/node_libcurl.node';
else if (platform === 'win32') libcurlPath = './bin/win/node_libcurl.node';

try {
    const localLibcurl = require(libcurlPath);
    Curl = localLibcurl.Curl;
    CurlFeature = localLibcurl.CurlFeature;
    Easy = localLibcurl.Easy;
    Multi = localLibcurl.Multi;
} catch (err) {
    throw new Error(err);
}

const EventEmitter = require('events');
const config = require('./config');
const Log = console;
const KEEP_ALIVE_CONFIG = config.curl?.keepAlive || {};
const MAX_CONCURRENCY =
    (config.curl && typeof config.curl.maxConcurrency === 'number'
        ? config.curl.maxConcurrency
        : 100);
const DEFAULT_TIMEOUT_SECONDS =
    (config.curl && typeof config.curl.requestTimeoutSeconds === 'number'
        ? config.curl.requestTimeoutSeconds
        : 35);


const CONNECTION_POOL_CONFIG = {
    INITIAL_SIZE: config.curl?.connectionPool?.initialSize ?? 20,
    PREWARM_BATCH_SIZE: config.curl?.connectionPool?.prewarmBatchSize ?? 5,
    MAX_FAILURES_PER_CONNECTION: config.curl?.connectionPool?.maxFailures ?? 3,
    CONNECTION_IDLE_TIMEOUT: config.curl?.connectionPool?.idleTimeoutMs ?? 300000,
    REFRESH_INTERVAL: config.curl?.connectionPool?.refreshIntervalMs ?? 600000,
};

class CurlHttpSdk extends EventEmitter {
    constructor(options = {}) {
        super();
        this.multi = new Multi();
        this.handles = [];
        this.handlesData = [];
        this.handlesHeaders = [];
        this.callbacks = new Map();
        this.proxyPool = options.proxyPool || [];
        this.defaultProxy = options.proxy || null;
        this.connectionPool = [];
        this.nextConnectionId = 0;
        this.modifyProxyUsername = true;
        this.maxConcurrency =
            typeof options.maxConcurrency === 'number'
                ? options.maxConcurrency
                : MAX_CONCURRENCY;
        this.activeRequestsTotal = 0;
        this.pendingQueue = [];
        this.baseProxies = [];

        // 初始化连接池
        if (this.proxyPool.length) {
            this.proxyPool.forEach(proxy => this.initializeConnectionPool(proxy));
        } else if (this.defaultProxy) {
            this.initializeConnectionPool(this.defaultProxy);
        }

        this.startHealthCheck();

        // Multi 回调
        this.multi.onMessage((error, handle, errorCode) => {
            const key = this.handles.indexOf(handle);
            const callback = this.callbacks.get(handle);
            const dataBuffers = this.handlesData[key] || [];
            const responseBody = Buffer.concat(dataBuffers);

            const responseCode = handle.getInfo('RESPONSE_CODE').data || 0;

            // 增加使用次数
            const conn = handle._connection;
            if (conn) {
                conn.activeRequests = Math.max(0, conn.activeRequests - 1);
                conn.totalRequests += 1;
                conn.lastUsedAt = Date.now();
            }

            if (error) {
                if (conn) {
                    const isHandshakeError =
                        typeof error.message === 'string' &&
                        error.message.toLowerCase().includes('handshake');
                    this._handleConnectionFailure(conn, isHandshakeError);
                }
                callback.reject(new Error(`Request failed: ${error.message}, code: ${errorCode}`));
            } else {
				const key = this.handles.indexOf(handle);
				const dataBuffers = this.handlesData[key] || [];
				const responseBody = Buffer.concat(dataBuffers);

				const rawHeaders = this.handlesHeaders[key] || [];
				const headers = {};
				for (const line of rawHeaders) {
					const idx = line.indexOf(':');
					if (idx > 0) {
						const name = line.slice(0, idx).trim();
						const value = line.slice(idx + 1).trim();
						headers[name.toLowerCase()] = value;
					}
				}
                if (conn) {
                    conn.failureCount = 0;
                    conn.isHealthy = true;
                }
                callback.resolve({
                    ok: responseCode >= 200 && responseCode < 300,
                    status: responseCode,
					body: responseBody,
					headers,
                    text: async () => responseBody.toString('utf-8'),
                    json: async () => JSON.parse(responseBody.toString('utf-8'))
                });
            }

            // 清理
            this.multi.removeHandle(handle);
            handle.close();
            if (key >= 0) {
                this.handles.splice(key, 1);
                this.handlesData.splice(key, 1);
                this.handlesHeaders.splice(key, 1);
            } else {
                this.handlesData.pop();
                this.handlesHeaders.pop();
            }
            this.callbacks.delete(handle);
            this._finalizeQueuedRequest();
        });
    }

    // =================== 连接池管理 ===================
	createConnection(baseProxyUrl) {
        const id = this.nextConnectionId++;
        let modifiedProxyUrl = baseProxyUrl;

        const match = baseProxyUrl.match(/^(socks5h?:\/\/|http:\/\/|https:\/\/)([^:]+)(:.*)/i);
		if (this.modifyProxyUsername && match && match[1].startsWith('socks')) {
            const [, protocol, username, rest] = match;
            const randomId = Math.floor(Math.random() * 100000);
            modifiedProxyUrl = `${protocol}${username}-conn${id}-${randomId}${rest}`;
        }

        Log.info(`[CurlHttpSdk] 创建连接 ${id}，代理: ${modifiedProxyUrl}`);

		return {
			id,
			originalProxyUrl: baseProxyUrl,
			proxyUrl: modifiedProxyUrl,
            activeRequests: 0,
            totalRequests: 0,
            failureCount: 0,
			lastUsedAt: Date.now(),
			createdAt: Date.now(),
			isHealthy: true,
            proxyID: null
        };
	}

	initializeConnectionPool(baseProxyUrl) {
        if (!baseProxyUrl) {
            return;
        }
        if (!this.baseProxies.includes(baseProxyUrl)) {
            this.baseProxies.push(baseProxyUrl);
        }
        const existing = this.connectionPool.filter(c => c.originalProxyUrl === baseProxyUrl);
        if (existing.length >= CONNECTION_POOL_CONFIG.INITIAL_SIZE) {
            return;
        }
        const missing = CONNECTION_POOL_CONFIG.INITIAL_SIZE - existing.length;
        const pool = Array.from({ length: missing }, () => this.createConnection(baseProxyUrl));
        this.connectionPool.push(...pool);
        Log.info(`[CurlHttpSdk] 初始化代理池 (${baseProxyUrl})，补充连接: ${pool.length}`);
    }

    startHealthCheck() {
        this.healthCheckInterval = setInterval(() => {
            this.refreshConnectionPool();
        }, 60000);
    }

    pickConnection(proxyID) {
        // 1. 已绑定 proxyID 的连接
		if(!this.connectionPool?.length){
			return null
		}
		if(!proxyID){
			const candidates = this.connectionPool.filter(c => c.isHealthy)
			if (!candidates.length) {
				const newConn = this.createConnection(this.defaultProxy)
				this.connectionPool.push(newConn)
				return newConn
			}
			return candidates.reduce((best, c) => c.activeRequests < best.activeRequests ? c : best)
		}
        let conn = this.connectionPool.find(c => c.proxyID === proxyID && c.isHealthy);
        if (conn) return conn;

        // 2. 未绑定 proxyID 的健康连接
        conn = this.connectionPool.find(c => !c.proxyID && c.isHealthy);
        if (conn) {
            conn.proxyID = proxyID;
            return conn;
        }

        // 3. 创建新连接
        const newConn = this.createConnection(this.defaultProxy);
        newConn.proxyID = proxyID;
        this.connectionPool.push(newConn);
        return newConn;
    }

    refreshConnectionPool() {
        const now = Date.now();
        const before = this.connectionPool.length;
        this.connectionPool = this.connectionPool.filter((conn) => {
            const stale = now - conn.createdAt >= CONNECTION_POOL_CONFIG.REFRESH_INTERVAL;
            const idleTooLong = now - conn.lastUsedAt > CONNECTION_POOL_CONFIG.CONNECTION_IDLE_TIMEOUT;
            const failedTooMuch =
                conn.failureCount >= CONNECTION_POOL_CONFIG.MAX_FAILURES_PER_CONNECTION || !conn.isHealthy;
            const removable = (stale && conn.activeRequests === 0) ||
                (idleTooLong && conn.activeRequests === 0) ||
                failedTooMuch;
            if (removable) {
                Log.info(`[CurlHttpSdk] 回收连接 ${conn.id} (${conn.originalProxyUrl})`);
            }
            return !removable;
        });
        const removed = before - this.connectionPool.length;
        if (removed > 0) {
            Log.info(`[CurlHttpSdk] 已清理 ${removed} 个连接`);
        }

        this.baseProxies.forEach((proxy) => this.ensureMinimumConnections(proxy));
    }

    ensureMinimumConnections(proxyUrl) {
        if (!proxyUrl) {
            return;
        }
        const healthyConnections = this.connectionPool.filter(
            (conn) => conn.originalProxyUrl === proxyUrl && conn.isHealthy
        ).length;
        if (healthyConnections >= CONNECTION_POOL_CONFIG.INITIAL_SIZE) {
            return;
        }
        const missing = CONNECTION_POOL_CONFIG.INITIAL_SIZE - healthyConnections;
        const batch = Math.min(CONNECTION_POOL_CONFIG.PREWARM_BATCH_SIZE, missing);
        for (let i = 0; i < batch; i += 1) {
            const conn = this.createConnection(proxyUrl);
            this.connectionPool.push(conn);
        }
        Log.info(`[CurlHttpSdk] 预热代理 ${proxyUrl}，新增 ${batch} 个连接`);
    }

    _handleConnectionFailure(connection, forceUnhealthy = false) {
        if (!connection) {
            return;
        }
        connection.failureCount += 1;
        if (forceUnhealthy || connection.failureCount >= CONNECTION_POOL_CONFIG.MAX_FAILURES_PER_CONNECTION) {
            connection.isHealthy = false;
            Log.warn(`[CurlHttpSdk] 标记连接 ${connection.id} (${connection.originalProxyUrl}) 为不可用`);
        }
    }

    // =================== 请求处理 ===================
    _parseProxy(proxyUrl) {
        if (!proxyUrl) return null;
        const lower = proxyUrl.toLowerCase();
        if (lower.startsWith('http://') || lower.startsWith('https://')) return Curl.PROXYTYPE_HTTP;
        if (lower.startsWith('socks4://')) return Curl.PROXYTYPE_SOCKS4;
        if (lower.startsWith('socks4a://')) return Curl.PROXYTYPE_SOCKS4A;
        if (lower.startsWith('socks5://')) return Curl.PROXYTYPE_SOCKS5;
        if (lower.startsWith('socks5h://')) return Curl.PROXYTYPE_SOCKS5_HOSTNAME;
        return Curl.PROXYTYPE_HTTP;
    }

    _createEasy(method, url, headers = {}, body = null, proxy, connection) {
        const handle = new Easy();
        handle._connection = connection; // 绑定连接对象
        handle.setOpt('URL', url);
        handle.setOpt('CUSTOMREQUEST', method.toUpperCase());
        handle.setOpt('FOLLOWLOCATION', true);
        handle.setOpt('SSL_VERIFYPEER', false);
        handle.setOpt('SSL_VERIFYHOST', false);
        handle.setOpt('TIMEOUT', DEFAULT_TIMEOUT_SECONDS);

        if (KEEP_ALIVE_CONFIG.enabled !== false) {
            try {
                handle.setOpt('TCP_KEEPALIVE', 1);
                if (KEEP_ALIVE_CONFIG.idleSeconds) {
                    handle.setOpt('TCP_KEEPIDLE', Number(KEEP_ALIVE_CONFIG.idleSeconds));
                }
                if (KEEP_ALIVE_CONFIG.intervalSeconds) {
                    handle.setOpt('TCP_KEEPINTVL', Number(KEEP_ALIVE_CONFIG.intervalSeconds));
                }
            } catch (keepAliveError) {
                Log.warn('[CurlHttpSdk] 设置 TCP KeepAlive 失败:', keepAliveError.message);
            }
        }

        if (proxy) {
            handle.setOpt('PROXY', proxy);
            handle.setOpt('PROXYTYPE', this._parseProxy(proxy));
        }

        if (headers && Object.keys(headers).length) {
            handle.setOpt('HTTPHEADER', Object.entries(headers).map(([k, v]) => `${k}: ${v}`));
        }

			if (body != null) {
				if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
                const buf = Buffer.from(body);
                let pos = 0;
                // handle.enable(CurlFeature.NoDataParsing);
                handle.setOpt('POST', true);
                handle.setOpt('READFUNCTION', (buffer, size, nmemb) => {
                    const toRead = size * nmemb;
                    if (pos >= buf.length) return 0;
                    const written = buf.copy(buffer, 0, pos, Math.min(pos + toRead, buf.length));
                    pos += written;
                    return written;
                });
				} else if (typeof body === 'object') {
                handle.setOpt('POSTFIELDS', JSON.stringify(body));
				} else {
                handle.setOpt('POSTFIELDS', body);
            }
        }

        this.handlesData.push([]);
		this.handlesHeaders.push([]);

        handle.setOpt('WRITEFUNCTION', (data, n, nmemb) => {
            const idx = this.handles.indexOf(handle);
            if (idx >= 0) this.handlesData[idx].push(data);
            else this.handlesData[this.handlesData.length - 1].push(data);
            return n * nmemb;
        });
		handle.setOpt('HEADERFUNCTION', (data, size, nmemb) => {
			const headerString = data.toString('utf8');
			const idx = this.handles.indexOf(handle);
			if (idx >= 0) this.handlesHeaders[idx].push(headerString);
			else this.handlesHeaders[this.handlesHeaders.length - 1].push(headerString);
			return size * nmemb;
		});

        return handle;
    }

    request(method, url, headers = {}, body = null, proxyID = null) {
        return new Promise((resolve, reject) => {
            const executeRequest = () => {
                const connection = this.pickConnection(proxyID);
                if (connection) {
                    connection.activeRequests += 1;
                }

                const handle = this._createEasy(
                    method,
                    url,
                    headers,
                    body,
                    connection?.proxyUrl || null,
                    connection
                );

                const cleanupOnFailure = () => {
                    const idx = this.handles.indexOf(handle);
                    if (idx >= 0) {
                        this.handles.splice(idx, 1);
                        this.handlesData.splice(idx, 1);
                        this.handlesHeaders.splice(idx, 1);
                    } else {
                        this.handlesData.pop();
                        this.handlesHeaders.pop();
                    }
                    this.callbacks.delete(handle);
                    if (connection) {
                        connection.activeRequests = Math.max(0, connection.activeRequests - 1);
                    }
                    this._finalizeQueuedRequest();
                };

                this.handles.push(handle);
                this.callbacks.set(handle, { resolve, reject });

                setImmediate(() => {
                    try {
                        this.multi.addHandle(handle);
                    } catch (error) {
                        cleanupOnFailure();
                        reject(
                            new Error(
                                `Failed to add handle to multi: ${error.message || 'unknown error'}`
                            )
                        );
                    }
                });
            };

            if (this.activeRequestsTotal >= this.maxConcurrency) {
                this.pendingQueue.push(executeRequest);
            } else {
                this.activeRequestsTotal += 1;
                executeRequest();
            }
        });
    }

    get(url, headers = {}, proxyID = null) {
        return this.request('GET', url, headers, null, proxyID);
    }

    post(url, body, headers = {}, proxyID = null) {
        return this.request('POST', url, headers, body, proxyID);
    }

    close() {
        if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
        this.multi.close();
        this.handles.forEach(h => h.close());
        this.handles = [];
        this.handlesData = [];
        this.callbacks.clear();
    }

    _finalizeQueuedRequest() {
        if (this.activeRequestsTotal > 0) {
            this.activeRequestsTotal -= 1;
        }
        if (this.pendingQueue.length > 0) {
            const nextTask = this.pendingQueue.shift();
            if (typeof nextTask === 'function') {
                this.activeRequestsTotal += 1;
                setImmediate(nextTask);
            }
        }
    }
}
// 单文件运行并进行测试

if (require.main === module) {
    // 简单的测试
    (async ()=>{
		try{
			const sdk = new CurlHttpSdk({
				proxy: 'socks5h://accountId-5086-tunnelId-12988-area-us:a123456@proxyas.starryproxy.com:10000',
			});
			// 测试 GET 请求
			const res1= await sdk.get('https://httpbin.org/get',null,1)
			const res2 = await sdk.get('https://httpbin.org/get',null,1)
			console.log('GET 请求成功:', await res1.text(), await res2.text())
		}catch(e){
			console.log('GET 请求失败:', e)
		}
	})()
}
let sharedInstance = null;

function getCurlHttpSdkInstance(options = {}) {
	if (sharedInstance) {
		return sharedInstance;
	}
	sharedInstance = new CurlHttpSdk(options);
	return sharedInstance;
}

module.exports = { CurlHttpSdk, getCurlHttpSdkInstance };
