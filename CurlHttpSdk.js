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
const Log = console;

const CONNECTION_POOL_CONFIG = {
    INITIAL_SIZE: 50,						//初始化50个连接	
    MAX_FAILURES_PER_CONNECTION: 100,		//每个IP最多使用100次	
    CONNECTION_IDLE_TIMEOUT: 300000 		//每个IP只能使用5分钟
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
                if (conn) conn.failureCount += 1;
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
        if (!this.connectionPool.some(c => c.originalProxyUrl === baseProxyUrl)) {
            const pool = Array.from({ length: CONNECTION_POOL_CONFIG.INITIAL_SIZE },
			() => this.createConnection(baseProxyUrl)
            );
            this.connectionPool.push(...pool);
            Log.info(`[CurlHttpSdk] 初始化代理池 (${baseProxyUrl})，初始大小: ${pool.length}`);
        }
    }

    startHealthCheck() {
        this.healthCheckInterval = setInterval(() => {
            const now = Date.now();
            this.connectionPool = this.connectionPool.filter(c => {
                const healthy = c.failureCount < CONNECTION_POOL_CONFIG.MAX_FAILURES_PER_CONNECTION &&
                    (c.activeRequests > 0 || now - c.lastUsedAt <= CONNECTION_POOL_CONFIG.CONNECTION_IDLE_TIMEOUT);
                if (!healthy) Log.info(`[CurlHttpSdk] 移除不健康连接 ${c.id}`);
                return healthy;
            });
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
