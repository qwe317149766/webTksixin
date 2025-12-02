const zlib = require('zlib');
const crypto = require('crypto');
let redisClient = null;
try {
  redisClient = require('../../../config/redis');
} catch (error) {
  console.warn('[TikTokService] Redis 客户端初始化失败，仅使用内存缓存:', error.message);
}
const { CurlHttpSdk } = require('../../../CurlHttpSdk');
const { makeArgus } = require('../utils/encryption/argus');
const { makeGorgon } = require('../utils/encryption/gorgon');
const { makeLadon } = require('../utils/encryption/ladon');
const { md5, sm3Hash } = require('../utils/encryption/common');
const Settings = require('../config/settings');
const {
  createArgusProtobuf,
  createConversationProtobuf,
  createPrivateMessageProtobuf,
  parseCreateConversationResponse,
  parsePrivateMessageResponse,
  createSeedEncryptProtobuf,
  createSeedRequestProtobuf,
  parseSeedResponse,
  parseSeedDecrypt,
  createTokenEncryptProtobuf,
  createTokenRequestProtobuf,
  parseTokenResponse,
  parseTokenDecrypt
} = require('../utils/protobuf/protobuf-helper');
const { mssdkEncrypt, mssdkDecrypt } = require('../utils/encryption/mssdk');
const { makeHex26_1, makeHex26_2 } = require('../utils/encryption/hex26');
const { buildGuard } = require('../utils/encryption/device_ticket_data');
const REDIS_SEED_KEY_PREFIX = 'tiktokApp:seed:';
const REDIS_TOKEN_KEY_PREFIX = 'tiktokApp:token:';
const REDIS_CACHE_TTL = (Settings.CACHE_TTL || 24 * 60 * 60);
/**
 * 简单的内存缓存实现
 * 缓存 seed 和 token，基于 cookieData 的 hash 作为 key
 */
class SeedTokenCache {
  constructor() {
    this.cache = new Map();
    this.cacheExpiry = 24 * 60 * 60 * 1000; // 24小时（毫秒）
  }

  /**
   * 生成缓存键（基于 cookieData 的 device_id 和 uid）
   */
  _getCacheKey(cookieData, prefix) {
    try {
      const cookies = typeof cookieData === 'string' 
        ? JSON.parse(cookieData) 
        : cookieData;
      const deviceId = cookies.device_id || '';
      const uid = cookies.uid || cookies.user_id || '';
      const key = `${prefix}:${deviceId}:${uid}`;
      return crypto.createHash('md5').update(key).digest('hex');
    } catch (e) {
      console.error('Error generating cache key:', e);
      return null;
    }
  }

  /**
   * 获取缓存的 seed
   */
  getSeed(cookieData) {
    const key = this._getCacheKey(cookieData, 'seed');
    if (!key) return null;

    const cached = this.cache.get(key);
    if (!cached) return null;

    // 检查是否过期
    if (Date.now() - cached.timestamp > this.cacheExpiry) {
      this.cache.delete(key);
      return null;
    }

    return [cached.seed, cached.seedType];
  }

  /**
   * 设置缓存的 seed
   */
  setSeed(cookieData, seed, seedType) {
    const key = this._getCacheKey(cookieData, 'seed');
    if (!key) return;

    this.cache.set(key, {
      seed,
      seedType,
      timestamp: Date.now()
    });
  }

  /**
   * 获取缓存的 token
   */
  getToken(cookieData) {
    const key = this._getCacheKey(cookieData, 'token');
    if (!key) return null;

    const cached = this.cache.get(key);
    if (!cached) return null;

    // 检查是否过期
    if (Date.now() - cached.timestamp > this.cacheExpiry) {
      this.cache.delete(key);
      return null;
    }

    return cached.token;
  }

  /**
   * 设置缓存的 token
   */
  setToken(cookieData, token) {
    const key = this._getCacheKey(cookieData, 'token');
    if (!key) return;

    this.cache.set(key, {
      token,
      timestamp: Date.now()
    });
  }

  /**
   * 清除缓存
   */
  clear() {
    this.cache.clear();
  }
}

// 创建全局缓存实例
const seedTokenCache = new SeedTokenCache();

class TikTokService {
  /**
   * 生成请求头
   */
  static async makeHeaders(deviceId, createTime, signCount, reportCount, settingCount, 
                     appLaunchTime, secDeviceToken, phoneInfo, seed, seedEncodeType,
                     seedEncodeHex, algorithmData1, hex32, queryString, postData,
                     appVersion = "40.6.3", sdkVersionStr = "v05.02.00-ov-android",
                     sdkVersion = 0x5020020, callType = 738, appVersionConstant = 0xC60A000) {
    
    // 计算 x-ss-stub
    // postData 可能是 Buffer 或 hex 字符串
    let postDataBuffer;
    if (Buffer.isBuffer(postData)) {
      postDataBuffer = postData;
    } else if (typeof postData === 'string') {
      // 如果是字符串，假设是 hex 格式
      postDataBuffer = Buffer.from(postData || "0000000000000000", 'hex');
    } else {
      postDataBuffer = Buffer.from("0000000000000000", 'hex');
    }
    const xSsStub = md5(postDataBuffer).toUpperCase();
    
    // 计算 bodyhash
    const p13 = sm3Hash(xSsStub);
    const bodyhash = p13.substring(0, 12);
    
    // 计算 queryHash
    const p14 = sm3Hash(queryString);
    const queryHash = p14.substring(0, 12);
    
    // 计算 pskHash 和 pskCalHash
    const pskHash = "c955dcf9aab6502223da8ed220bc4d56"; // 固定值
    // pskCalHash = sm3(query_string.encode("utf8").hex() + x_ss_stub + "30")
    // Python: bytes.fromhex(query_string.encode("utf8").hex()+x_ss_stub+"30")
    // 这意味着：query_string 转为 UTF-8 bytes，再转为 hex，然后加上 x_ss_stub（小写）和 "30"
    const queryStringHex = Buffer.from(queryString, 'utf8').toString('hex');
    const pskCalHashInputHex = queryStringHex + xSsStub.toLowerCase() + '30';
    // sm3Hash 需要接收字符串或 Buffer，这里传入 hex 字符串
    const pskCalHash = sm3Hash(pskCalHashInputHex);
    
    // 如果 seedEncodeType 不为空，计算 seedEncodeHex 和 algorithmData1
    let finalSeedEncodeHex = "";
    let finalAlgorithmData1 = "";
    let finalHex32 = "";
    
    if (seedEncodeType && seedEncodeType !== '' && seedEncodeType !== 0) {
      // 计算 seedEncodeHex
      finalSeedEncodeHex = makeHex26_1(seedEncodeType, queryString, xSsStub);
      
      // 计算 algorithmData1 (需要完整的 p14 和 p13，不只是前12个字符)
      finalAlgorithmData1 = makeHex26_2(p14, p13);
      
      // 设置 hex32（固定值）
      finalHex32 = "62f8a4323c5efd1a90f3b66b002c905e7f0ee2ea6dd8df20847d2390";
    }
    
    // 生成 Argus protobuf
    const xArgusProtobufHex = await createArgusProtobuf(
      deviceId,
      appVersion,
      sdkVersionStr,
      sdkVersion,
      createTime,
      bodyhash,
      queryHash,
      signCount,
      reportCount,
      settingCount,
      appLaunchTime,
      secDeviceToken || '',
      pskHash,
      pskCalHash,
      callType,
      phoneInfo,
      appVersionConstant,
      seed || '', // 确保 seed 不为 null
      seedEncodeType || 0,
      finalSeedEncodeHex,
      finalAlgorithmData1,
      finalHex32
    );
    
    // 生成签名
    const xKhronos = createTime;
    const xArgus = makeArgus(xArgusProtobufHex, queryHash); // 传入实际的 protobuf hex 字符串
    const xLadon = makeLadon(String(xKhronos));
    const xGorgon = makeGorgon(String(xKhronos), queryString, "4a0016a8476c0080", xSsStub);
    
    return {
      'X-SS-STUB': xSsStub,
      'X-Khronos': xKhronos,
      'X-Argus': xArgus,
      'X-Ladon': xLadon,
      'X-Gorgon': xGorgon,
    };
  }
  
  /**
   * 解析 cookie_data（可能是 JSON 字符串或对象）
   */
  static parseCookieData(cookieData) {
    if (typeof cookieData === 'string') {
      try {
        return JSON.parse(cookieData);
      } catch (e) {
        // 如果不是 JSON，可能是 base64 编码的 JSON
        try {
          const decoded = Buffer.from(cookieData, 'base64').toString('utf8');
          return JSON.parse(decoded);
        } catch (e2) {
          throw new Error('Invalid cookie_data format');
        }
      }
    }
    return cookieData;
  }

  /**
   * 从 multi_sids 中提取 uid
   * multi_sids 格式通常是: "uid%3Asessionid" 或 "uid:sessionid"
   * 其中 %3A 是 URL 编码的冒号
   * 例如: "7369216251397030917%3A077cfb992c7db24ef52d4fd11a856938"
   * 或者: "7560648920885118007:a1787f5786d0d68bba95c02478ad08a7"
   * @param {string} multiSids - multi_sids 字符串
   * @returns {string|null} 提取到的 uid，如果无法提取则返回 null
   */
  static extractUidFromMultiSids(multiSids) {
    if (!multiSids || typeof multiSids !== 'string') {
      return null;
    }

    try {
      // 先尝试 URL 解码（处理 %3A 的情况）
      let decoded = multiSids;
      if (multiSids.includes('%3A')) {
        decoded = decodeURIComponent(multiSids);
      }
      
      // 提取第一个数字（uid），格式通常是 "uid:sessionid" 或 "uid%3Asessionid"
      // 使用正则表达式匹配开头的数字
      const match = decoded.match(/^(\d+)[:：]/);
      if (match && match[1]) {
        return match[1];
      }
      
      // 如果上面没匹配到，尝试解析为 JSON（某些情况下可能是 JSON 格式）
      const parsed = JSON.parse(decoded);
      
      // 如果是对象，遍历查找 uid
      if (typeof parsed === 'object' && parsed !== null) {
        // 如果是数组
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && item.uid) {
              return String(item.uid);
            }
          }
        } else {
          // 如果是对象，遍历所有键值对
          for (const key in parsed) {
            const value = parsed[key];
            if (value && typeof value === 'object') {
              if (value.uid) {
                return String(value.uid);
              }
            }
          }
        }
      }
    } catch (e) {
      // 如果解析失败，尝试直接提取数字
      // 例如：如果 multi_sids 就是纯数字字符串
      const numberMatch = multiSids.match(/^(\d+)$/);
      if (numberMatch && numberMatch[1]) {
        return numberMatch[1];
      }
      
      console.warn('Failed to extract uid from multi_sids:', e.message);
    }

    return null;
  }

  /**
   * 生成随机 device_id（19位数字字符串）
   * @returns {string} 随机生成的 device_id
   */
  static generateRandomDeviceId() {
    // TikTok device_id 通常是 19 位数字
    const min = BigInt('1000000000000000000'); // 19位最小数
    const max = BigInt('9999999999999999999'); // 19位最大数
    const range = max - min;
    const random = BigInt(Math.floor(Math.random() * Number(range)));
    return String(min + random);
  }

  /**
   * 生成随机 install_id（19位数字字符串）
   * @returns {string} 随机生成的 install_id
   */
  static generateRandomInstallId() {
    // TikTok install_id 通常是 19 位数字
    return this.generateRandomDeviceId();
  }

  /**
   * 构建查询字符串
   */
  static buildQueryString(params) {
    return Object.keys(params)
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
      .join('&');
  }

  /**
   * 基于关键字段生成 Redis 哈希
   */
  static buildRedisAccountHash(cookies = {}) {
    try {
      const deviceId = cookies.device_id || '';
      const uid = cookies.uid || cookies.user_id || '';
      const sessionId = cookies.sessionid || cookies.session_id || cookies.sid_tt || '';
      const raw = `${deviceId}:${uid}:${sessionId}`;
      if (!raw.replace(/:/g, '')) {
        return null;
      }
      return crypto.createHash('md5').update(raw).digest('hex');
    } catch (error) {
      console.warn('Failed to build Redis account hash:', error.message);
      return null;
    }
  }

  static getSeedRedisKey(cookies = {}) {
    const hash = this.buildRedisAccountHash(cookies);
    return hash ? `${REDIS_SEED_KEY_PREFIX}${hash}` : null;
  }

  static getTokenRedisKey(cookies = {}) {
    const hash = this.buildRedisAccountHash(cookies);
    return hash ? `${REDIS_TOKEN_KEY_PREFIX}${hash}` : null;
  }

  /**
   * 根据 cookies 决定使用的 API 域名
   */
  static getApiBaseUrlFromCookies(cookies = {}) {
    const region =
      (cookies['store-country-code'] ||
        cookies['store_country_code'] ||
        cookies['x-tt-store-region'] ||
        cookies['x_tt_store_region'] ||
        '').toString().toLowerCase();

    const isUsRegion = region === 'us';
    console.log("isUsRegion:",isUsRegion)
    const baseUrl = isUsRegion
      ? Settings.TIKTOK_API_BASE_URL
      : Settings.TIKTOK_API_GLOBAL_BASE_URL;

    let host;
    try {
      host = new URL(baseUrl).host;
    } catch {
      host = baseUrl.replace(/^https?:\/\//i, '').split('/')[0];
    }

    return { baseUrl, host };
  }

  /**
   * 创建 HTTP 客户端（支持代理）
   */
  static getHttpClient(proxyUrl) {
    if (!this._curlClients) {
      this._curlClients = new Map();
    }

    const key = proxyUrl || 'default';
    if (!this._curlClients.has(key)) {
      const sdk = new CurlHttpSdk({
        proxy: proxyUrl || null,
        timeout: Settings.REQUEST_TIMEOUT * 1000,
      });

      const client = {
        sdk,
        async post(url, data, options = {}) {
          const headers = options.headers || {};
          let finalUrl = url;

          if (options.params && Object.keys(options.params).length > 0) {
            const queryString = TikTokService.buildQueryString(options.params);
            finalUrl = `${finalUrl}${finalUrl.includes('?') ? '&' : '?'}${queryString}`;
          }

          const response = await sdk.post(finalUrl, data, headers);
          const responseHeaders = response.headers || {};
          let bodyBuffer = Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body || '');
          const encoding = (responseHeaders['content-encoding'] || '').toLowerCase();

          try {
            if (encoding.includes('gzip')) {
              bodyBuffer = zlib.gunzipSync(bodyBuffer);
            } else if (encoding.includes('deflate')) {
              bodyBuffer = zlib.inflateSync(bodyBuffer);
            }
          } catch (decompressError) {
            console.warn('Failed to decompress response body:', decompressError.message);
          }

          return {
            status: response.status,
            headers: responseHeaders,
            data: bodyBuffer,
          };
        },
      };

      this._curlClients.set(key, client);
    }

    return this._curlClients.get(key);
  }

  /**
   * 创建私信关系（会话）
   * @param {string} receiverId - 接收者用户ID
   * @param {string} cookieData - Cookie数据（JSON 字符串或对象）
   * @param {string} deviceId - 设备ID
   * @param {string} createTime - 创建时间戳
   * @param {string} queryString - 查询字符串
   * @param {string} proxyUrl - 代理URL（可选）
   * @returns {Promise<Object>} 包含 conversationId 的结果
   */
  static async createConversation(receiverId, cookieData, deviceId, createTime, queryString, proxyUrl = null,
    cachedSeed = null, cachedSeedType = null, cachedToken = null) {
    try {
      // 1. 解析 cookie_data
      const cookies = this.parseCookieData(cookieData);
      console.log("cookies:",cookies)
      // 2. 提取必要的 cookie 字段
      // 2.1 提取 uid：优先从 cookies.uid，如果没有则从 multi_sids 中提取
      let senderId = cookies.uid || cookies.user_id;
      if (!senderId && cookies.multi_sids) {
        senderId = this.extractUidFromMultiSids(cookies.multi_sids);
        if (senderId) {
          console.log('Extracted uid from multi_sids:', senderId);
        }
      }
      
      // 2.2 提取 install_id：如果没有则随机生成
      let iid = cookies.install_id;
      if (!iid) {
        iid = this.generateRandomInstallId();
        console.log('Generated random install_id:', iid);
      }
      
      // 2.3 提取 device_id：优先使用传入的 deviceId，然后从 cookies，最后随机生成
      let actualDeviceId = deviceId || cookies.device_id;
      if (!actualDeviceId) {
        actualDeviceId = this.generateRandomDeviceId();
        console.log('Generated random device_id:', actualDeviceId);
      }
      
      const actualCreateTime = createTime || Math.floor(Date.now() / 1000);
      
      // 3. 验证必需字段
      if (!senderId) {
        throw new Error('Missing required field: uid (not found in cookies.uid or multi_sids)');
      }
      
      if (!iid) {
        throw new Error('Failed to generate install_id');
      }
      
      if (!actualDeviceId) {
        throw new Error('Failed to generate device_id');
      }

      // 3. 构建 URL 和查询参数
      const timee = Date.now() / 1000;
      const utime = Math.floor(timee * 1000);
      const stime = Math.floor(timee);
      const randomOffset = Math.floor(Math.random() * 20) + 1;
      
      const params = {
        'device_platform': 'android',
        'os': 'android',
        'ssmix': 'a',
        '_rticket': String(utime + randomOffset),
        'channel': 'googleplay',
        'aid': '1233',
        'app_name': 'musical_ly',
        'version_code': '400603',
        'version_name': '40.6.3',
        'manifest_version_code': '2024006030',
        'update_version_code': '2024006030',
        'ab_version': '40.6.3',
        'resolution': '1080*2209',
        'dpi': '420',
        'device_type': 'Pixel 6',
        'device_brand': 'google',
        'language': 'en',
        'os_api': '35',
        'os_version': '15',
        'ac': 'wifi',
        'is_pad': '0',
        "carrier_region": "TW",
        'app_type': 'normal',
        'sys_region': 'US',
        'last_install_time': '1758618230',
        'timezone_name': 'America/New_York',
        'residence': 'US',
        'app_language': 'en',
        'ac2': 'wifi',
        'uoo': '0',
        'op_region': 'TW',
        'timezone_offset': '-18000',
        'build_number': '40.6.3',
        'host_abi': 'arm64-v8a',
        'locale': 'en',
        "op_region": "TW",
        'ts': String(stime - randomOffset),
        'iid': String(iid),
        'device_id': String(actualDeviceId)
      };
      
      const finalQueryString = queryString || this.buildQueryString(params);
      
      // 4. 获取 seed 和 token（优先从缓存获取）
      let seed = cachedSeed || null;
      let seedType = cachedSeedType || null;
      let token = cachedToken || null;

      if (seed && seedType) {
        seedTokenCache.setSeed(cookieData, seed, seedType);
      }
      if (token) {
        seedTokenCache.setToken(cookieData, token);
      }
      
      // 尝试从缓存获取
      const memorySeed = seedTokenCache.getSeed(cookieData);
      if (memorySeed) {
        [seed, seedType] = memorySeed;
        console.log('Using cached seed');
      } else {
        // 从接口获取 seed
        try {
          [seed, seedType] = await this.getSeed(cookieData, actualDeviceId, iid, proxyUrl);
          if (seed && seedType) {
            seedTokenCache.setSeed(cookieData, seed, seedType);
            console.log('Fetched seed from API and cached');
          }
        } catch (error) {
          console.warn('Failed to get seed, continuing without it:', error.message);
        }
      }
      
      // 尝试从缓存获取 token
      const memoryToken = seedTokenCache.getToken(cookieData);
      if (memoryToken) {
        token = memoryToken;
        console.log('Using cached token');
      } else {
        // 从接口获取 token
        try {
          token = await this.getToken(cookieData, actualDeviceId, iid, proxyUrl);
          if (token) {
            console.log("token:",token)
            seedTokenCache.setToken(cookieData, token);
            console.log('Fetched token from API and cached');
          }
        } catch (error) {
          console.warn('Failed to get token, continuing without it:', error.message);
        }
      }
      
      // 5. 生成 protobuf
      const postDataBuffer = await createConversationProtobuf(actualDeviceId, senderId, receiverId, iid);
      // 为了计算签名，需要 hex 字符串
      const postDataHex = postDataBuffer.toString('hex');
      
      // 6. 生成请求头（使用 hex 字符串计算签名，传入 seed 和 token）
      const signCount = Math.floor(Math.random() * 20) + 20; // 20-40
      const headers = await this.makeHeaders(
        actualDeviceId,
        String(stime),
        signCount,
        2,
        4,
        stime - 6,
        token || '', // secDeviceToken
        'Pixel 6',
        seed || '', // seed
        seedType || 0, // seedEncodeType
        '', // seedEncodeHex (会在 makeHeaders 中计算)
        '', // algorithmData1 (会在 makeHeaders 中计算)
        '', // hex32 (会在 makeHeaders 中计算)
        finalQueryString,
        postDataHex
      );
      
      // 6. 构建完整的请求头
      const { baseUrl: conversationBaseUrl, host: conversationHost } = this.getApiBaseUrlFromCookies(cookies);
      console.log("conversationHost:",conversationHost)
      console.log("conversationBaseUrl:",conversationBaseUrl)
      const requestHeaders = {
        ...headers,
        'rpc-persist-pyxis-policy-v-tnc': '1',
        'rpc-persist-pyxis-policy-state-law-is-ca': '1',
        'Locale': 'en',
        'x-tt-pba-enable': '1',
        'X-Biz-Id': '1180',
        'x-bd-kmsv': '0',
        'x-tt-dm-status': 'login=1;ct=1;rt=8',
        'X-SS-REQ-TICKET': String(utime),
        'x-bd-client-key': '#7XhgXG1xPDHCI3vftue5QnEDqKXYPbJp6uwMo9cxiO9OcRvy+Qp3rOun1iYALEujE/vC2OAuGh0vj5qS',
        'tt-ticket-guard-public-key': 'BEMMWabeDuYzmk4XiGq8gHmjLqTqMuaU7i9sg6grfIFaMlh6hmM5UcFGI59UIHK6SEtjyw5iQEn5odvJ4qUTd0M=',
        'sdk-version': '2',
        'tt-ticket-guard-iteration-version': '0',
        'tt-ticket-guard-client-data': 'eyJyZXFfY29udGVudCI6InRpY2tldCxwYXRoLHRpbWVzdGFtcCIsInJlcV9zaWduIjoiTUVVQ0lRQ1J3MzR0T05mekpJOEdVdnllNFdVSkF5N2NlbUExejdNcEpHTXVNWlhtUXdJZ1pmY2VBQlo2YmVBMXJzcFVONWxTaDV2S2xDbmFkeDBHa3o3R2Rqa1lncWtcdTAwM2QiLCJ0aW1lc3RhbXAiOjE3NjAwMjQzNjEsInRzX3NpZ24iOiJ0cy4xLjQwMjNlMTBjNTVmZWUwNWU1MTAyZjU2YzYwYmZmM2FkMWNiM2Q5ZWFhNWVhODc3ZDUyOWQ3ZjAxYjBkODlkOTE3YTUwZThhNDE3ZGYwNjlkZjlhNTU1YmQxNmM2NmVmOGIzNjM5YTU2YjY0MmQ3ZDhmOWM4ODFmNDJiOTMyOWVjIn0=',
        'X-Tt-Token': cookies['X-Tt-Token'] || cookies['x_tt_token'] || '',
        'tt-ticket-guard-version': '3',
        'passport-sdk-version': '-1',
        "rpc-persist-pns-region-1": "TW|1668284",
        "rpc-persist-pns-region-2": "TW|1668284",
        "rpc-persist-pns-region-3": "TW|1668284",
        'x-vc-bdturing-sdk-version': '2.3.13.i18n',
        'oec-vc-sdk-version': '3.0.12.i18n',
        'x-tt-request-tag': 'n=0;nr=111;bg=0',
        'x-tt-store-region': cookies['store-country-code'] || cookies['store_country_code'] || 'kr',
        'x-tt-store-region-src': cookies['store-country-code-src'] || cookies['store_country_code_src'] || 'uid',
        'User-Agent': cookies['User-Agent'] || cookies['user_agent'] || 'okhttp/3.12.13.20',
        'Content-Type': 'application/x-protobuf',
        'Accept': 'application/x-protobuf', // 明确请求 protobuf 格式响应
        'Host': conversationHost,
        'Cookie': this.buildCookieString(cookies)
      };
      console.log('requestHeaders:',requestHeaders)
      const url = `${conversationBaseUrl}/v2/conversation/create?`+finalQueryString;
      console.log('url:',url)
      const client = this.getHttpClient(proxyUrl);
      
      const response = await client.post(url, postDataBuffer, {
        headers: requestHeaders,
        // params: params,
        responseType: 'arraybuffer'
      });
      
      // 8. 解析响应
      const responseBuffer = Buffer.isBuffer(response.data) ? response.data : Buffer.from(response.data);
      const responseHex = responseBuffer.toString('hex');
      
      // 检查响应 Content-Type
      const responseHeaders = response.headers || {};
      const contentType = responseHeaders['content-type'] || '';
      console.log('Response Content-Type:', contentType);
      
      // 检查是否是 JSON 响应（以 { 开头或 Content-Type 包含 json）
      const isJsonResponse = (responseBuffer.length > 0 && responseBuffer[0] === 0x7b) || 
                            contentType.includes('application/json') ||
                            contentType.includes('text/json');
      
      if (isJsonResponse) {
        try {
          const jsonResponse = JSON.parse(responseBuffer.toString('utf-8'));
          console.log('Received JSON response (expected protobuf):', jsonResponse);
          
          // 如果 status_code 不是成功，抛出错误
          if (jsonResponse.status_code && jsonResponse.status_code !== 0) {
            throw new Error(`API returned error: ${jsonResponse.status_code} - ${jsonResponse.error_desc || 'Unknown error'}`);
          }
          
          // JSON 响应中没有 conversation_id，需要从 body 中解析（如果 body 是 protobuf）
          if (jsonResponse.body) {
            // body 可能是 base64 编码的 protobuf
            let bodyBuffer;
            if (typeof jsonResponse.body === 'string') {
              try {
                bodyBuffer = Buffer.from(jsonResponse.body, 'base64');
              } catch {
                bodyBuffer = Buffer.from(jsonResponse.body, 'hex');
              }
            } else {
              bodyBuffer = Buffer.from(jsonResponse.body);
            }
            
            const conversationId = await parseCreateConversationResponse(bodyBuffer);
            if (conversationId) {
              return { conversationId: String(conversationId) };
            }
          }
          
          // 如果收到 JSON 但期望 protobuf，记录警告
          console.warn('Server returned JSON instead of protobuf. This may indicate a configuration issue.');
          throw new Error('Failed to parse conversation_id from JSON response (expected protobuf)');
        } catch (jsonError) {
          if (jsonError.message.includes('API returned error') || jsonError.message.includes('expected protobuf')) {
            throw jsonError;
          }
          console.warn('Failed to parse as JSON, trying protobuf:', jsonError.message);
        }
      }
      
      // 尝试解析为 protobuf
      console.log('Parsing response as protobuf, hex length:', responseHex.length);
      try {
        const createResonse = await parseCreateConversationResponse(responseBuffer);
        console.log("createResonse:",createResonse.body.create_conversation_v2_body)
        const conversationId  = createResonse.body.create_conversation_v2_body.conversation.conversation_short_id
        const chatId = createResonse.body.create_conversation_v2_body.conversation.conversation_id
        if (!conversationId) {
          // 如果解析失败，输出调试信息
          console.error('Failed to parse conversation_id from protobuf response');
          console.error('Response hex (first 200 chars):', responseHex.substring(0, 200));
          console.error('Response length:', responseHex.length, 'bytes');
          console.error('Full response hex:', responseHex);
          throw new Error('Failed to parse conversation_id from response. The response may be an error response or have an unexpected format.');
        }
        
        return { conversationId: String(conversationId),chatId };
      } catch (parseError) {
        // 如果错误信息已经包含 API 错误信息，直接抛出
        if (parseError.message.includes('API returned error response')) {
          throw parseError;
        }
        // 否则包装错误
        console.error('Error parsing conversation response:', parseError.message);
        console.error('Response hex:', responseHex);
        throw new Error(`Failed to parse conversation_id: ${parseError.message}`);
      }
      
    } catch (error) {
      console.error('Error in createConversation:', error);
      throw error;
    }
  }

  /**
   * 构建 Cookie 字符串
   */
  static buildCookieString(cookies) {
    const cookieParts = [
      `store-idc=${cookies['store-idc'] || ''}`,
      `store-country-code=${cookies['store-country-code'] || ''}`,
      `install_id=${cookies.install_id || ''}`,
      `ttreq=${cookies.ttreq || ''}`,
      `passport_csrf_token=${cookies.passport_csrf_token || ''}`,
      `passport_csrf_token_default=${cookies.passport_csrf_token_default || ''}`,
      `store-country-code-src=${cookies['store-country-code-src'] || 'uid'}`,
      `multi_sids=${cookies.multi_sids || ''}`,
      `cmpl_token=${cookies.cmpl_token || ''}`,
      `d_ticket=${cookies.d_ticket || ''}`,
      `sid_guard=${cookies.sid_guard || ''}`,
      `uid_tt=${cookies.uid_tt || ''}`,
      `uid_tt_ss=${cookies.uid_tt_ss || ''}`,
      `sid_tt=${cookies.sid_tt  || ''}`,
      `sessionid=${cookies.sessionid || cookies.sessionid_ss || ''}`,
      `sessionid_ss=${cookies.sessionid_ss || cookies.sessionid || ''}`,
      `tt_session_tlb_tag=${cookies['tt_session_tlb_tag'] || 'sttt%7C5%7CDQp2JeFvbsRVd066xKPLJP________-5NWxRwFjRS8rZNh5mBfI6XbTiVUUkftEYH0ToFGFa3-c%3D'}`,
      `tt-target-idc=${cookies['tt-target-idc'] || ''}`,
      `tt_ticket_guard_has_set_public_key=1`, 
      `store-country-sign=${cookies['store-country-sign']  || ''}`,
      `msToken=${cookies.msToken || cookies.ms_token || ''}`,
      `odin_tt=${cookies.odin_tt || cookies.odin_tt || ''}`
    ];
    
    return cookieParts.join('; ');
  }
  
  /**
   * 发送私信
   * @param {string} receiverId - 接收者用户ID
   * @param {string} conversationId - 会话ID（通过 createConversation 获取）
   * @param {string|Object} messageData - 消息内容
   * @param {string} cookieData - Cookie数据
   * @param {string} deviceId - 设备ID
   * @param {string} createTime - 创建时间戳
   * @param {string} queryString - 查询字符串
   * @param {string} proxyUrl - 代理URL（可选）
   * @returns {Promise<Object>} 发送结果
   */
  static async sendMessage(receiverId, conversationId, messageData, cookieData, 
                           deviceId, createTime, queryString, proxyUrl = null,
                           seed = null, seedType = null, token = null) {
    try {
      // 1. 解析 cookie_data
      const cookies = this.parseCookieData(cookieData);
      
      // 2. 提取必要的 cookie 字段
      const senderId = cookies.uid || cookies.user_id;
      const iid = cookies.install_id;
      const actualDeviceId = deviceId || cookies.device_id;
      const actualCreateTime = createTime || Math.floor(Date.now() / 1000);
      
      if (!senderId || !iid || !actualDeviceId) {
        throw new Error('Missing required cookie fields: uid, install_id, device_id');
      }

      // 3. 构建 URL 和查询参数
      const timee = Date.now() / 1000;
      const utime = Math.floor(timee * 1000);
      const stime = Math.floor(timee);
      const randomOffset = Math.floor(Math.random() * 20) + 1;
      
      const params = {
        'device_platform': 'android',
        'os': 'android',
        'ssmix': 'a',
        '_rticket': String(utime + randomOffset),
        'channel': 'googleplay',
        'aid': '1233',
        'app_name': 'musical_ly',
        'version_code': '400603',
        'version_name': '40.6.3',
        'manifest_version_code': '2024006030',
        'update_version_code': '2024006030',
        'ab_version': '40.6.3',
        'resolution': '1080*2400',
        'dpi': '420',
        'device_type': 'Pixel 6',
        'device_brand': 'google',
        'language': 'en',
        'os_api': '35',
        'os_version': '15',
        'ac': 'wifi',
        'is_pad': '0',
        'current_region': 'TW',
        'app_type': 'normal',
        'sys_region': 'US',
        'last_install_time': '1758618230',
        'timezone_name': 'America/New_York',
        'residence': 'TW',
        'app_language': 'en',
        'ac2': 'wifi',
        'uoo': '0',
        'op_region': 'TW',
        'timezone_offset': '-18000',
        'build_number': '40.6.3',
        'host_abi': 'arm64-v8a',
        'locale': 'en',
        'region': 'US',
        'ts': String(stime - randomOffset),
        'iid': String(iid),
        'device_id': String(actualDeviceId)
      };
      console.log('params:',params)
      const finalQueryString = queryString || this.buildQueryString(params);
      console.log('finalQueryString:',finalQueryString)
      // 4. 获取 seed 和 token（优先从缓存获取，如果没有则使用传入的参数）
      let finalSeed = seed;
      let finalSeedType = seedType;
      let finalToken = token;

      if (finalSeed && finalSeedType) {
        seedTokenCache.setSeed(cookieData, finalSeed, finalSeedType);
      }
      if (finalToken) {
        seedTokenCache.setToken(cookieData, finalToken);
      }
      // 如果参数中没有提供，尝试从缓存获取
      if (!finalSeed) {
        const memorySeed = seedTokenCache.getSeed(cookieData);
        if (memorySeed) {
          [finalSeed, finalSeedType] = memorySeed;
          console.log('Using cached seed in sendMessage');
        }
      }
      
      if (!finalToken) {
        const memoryToken = seedTokenCache.getToken(cookieData);
        if (memoryToken) {
          finalToken = memoryToken;
          console.log('Using cached token in sendMessage');
        }
      }
      
      // 如果缓存中也没有，尝试从接口获取（这种情况应该很少，因为应该在 createConversation 时已经获取了）
      if (!finalSeed || !finalToken) {
        try {
          if (!finalSeed) {
            const [seedResult, seedTypeResult] = await this.getSeed(cookieData, actualDeviceId, iid, proxyUrl);
            finalSeed = seedResult;
            finalSeedType = seedTypeResult;
            if (finalSeed && finalSeedType) {
              seedTokenCache.setSeed(cookieData, finalSeed, finalSeedType);
            }
          }
          if (!finalToken) {
            finalToken = await this.getToken(cookieData, actualDeviceId, iid, proxyUrl);
            if (finalToken) {
              seedTokenCache.setToken(cookieData, finalToken);
            }
          }
        } catch (error) {
          console.warn('Failed to get seed/token, continuing without them:', error.message);
        }
      }
      const isCardMessage = typeof messageData === 'object' && messageData.isCard === true;
      const messageText = typeof messageData === 'string'
        ? messageData
        : (messageData && (messageData.text || messageData.message)) || '';
      const postDataHexOverride = (messageData && typeof messageData === 'object' && messageData.postDataHex)
        ? String(messageData.postDataHex).trim()
        : null;

      return await this.sendMessageStandalone(
        receiverId,
        conversationId,
        isCardMessage,
        messageText,
        finalSeedType || 0,
        finalSeed || '',
        finalToken || '',
        cookieData,
        proxyUrl,
        { postDataHex: postDataHexOverride }
      );
      
    } catch (error) {
      console.error('Error in sendMessage:', error);
      throw error;
    }
  }

  /**
   * 直接构造 headers 并发送消息（与 test_send_message_standalone.js 保持一致）
   */
  static async sendMessageStandalone(
    receiverId,
    conversationId,
    isCard,
    messageData,
    seedEncodeType,
    seed,
    token,
    cookieData,
    proxyUrl = null,
    options = {}
  ) {
    try {
      const cookies = this.parseCookieData(cookieData);
      const senderId = cookies.uid || cookies.user_id;
      const iid = cookies.install_id;
      const deviceId = cookies.device_id;

      if (!senderId || !iid || !deviceId) {
        throw new Error('Missing required cookie fields: uid, install_id, device_id');
      }

      const ua = cookies['User-Agent'] || cookies.user_agent || 'okhttp/3.12.13.20';
      const timee = Date.now() / 1000;
      const utime = Math.floor(timee * 1000);
      const stime = Math.floor(timee);
      const randomOffset = Math.floor(Math.random() * 20) + 1;

      const params = {
        'device_platform': 'android',
        'os': 'android',
        'ssmix': 'a',
        '_rticket': String(utime + randomOffset),
        'channel': 'googleplay',
        'aid': '1233',
        'app_name': 'musical_ly',
        'version_code': '400603',
        'version_name': '40.6.3',
        'manifest_version_code': '2024006030',
        'update_version_code': '2024006030',
        'ab_version': '40.6.3',
        'resolution': '1080*2400',
        'dpi': '420',
        'device_type': 'Pixel 6',
        'device_brand': 'google',
        'language': 'en',
        'os_api': '35',
        'os_version': '15',
        'ac': 'wifi',
        'is_pad': '0',
        'current_region': 'US',
        'app_type': 'normal',
        'sys_region': 'US',
        'last_install_time': '1758618230',
        'timezone_name': 'America/New_York',
        'residence': 'US',
        'app_language': 'en',
        'ac2': 'wifi',
        'uoo': '0',
        'op_region': 'US',
        'timezone_offset': '-18000',
        'build_number': '40.6.3',
        'host_abi': 'arm64-v8a',
        'locale': 'en',
        'region': 'US',
        'ts': String(stime - randomOffset),
        'iid': String(iid),
        'device_id': String(deviceId)
      };

      const queryString = this.buildQueryString(params);
  

      const isCardFlag = typeof isCard === 'boolean'
        ? isCard
        : (typeof messageData === 'object' && messageData && messageData.isCard === true);

      const postDataHexOverride = options.postDataHex || null;
      let postDataBuffer;
      let postDataHex;

      if (postDataHexOverride) {
        if (!/^[0-9a-fA-F]+$/.test(postDataHexOverride) || postDataHexOverride.length % 2 !== 0) {
          throw new Error('Invalid postDataHex: must be even-length hex string');
        }
        postDataHex = postDataHexOverride;
        postDataBuffer = Buffer.from(postDataHex, 'hex');
      } else {
        const messageText = typeof messageData === 'string'
          ? messageData
          : (messageData && (messageData.text || messageData.message)) || '';

        postDataBuffer = await createPrivateMessageProtobuf(
          utime,
          deviceId,
          iid,
          senderId,
          receiverId,
          conversationId,
          messageText,
          !!isCardFlag
        );
        postDataHex = postDataBuffer.toString('hex');
      }

      const headersFromMake = await this.makeHeaders(
        deviceId,
        stime,
        1000,
        2,
        8,
        stime - 6,
        token || '',
        'Pixel 6',
        seed || '',
        seedEncodeType || 0,
        '',
        '',
        '',
        queryString,
        postDataHex
      );
      const { baseUrl: messageBaseUrl, host: messageHost } = this.getApiBaseUrlFromCookies(cookies);
      const url = `${messageBaseUrl}/v1/message/send?${queryString}`;
      console.log('url:', url);
      let requestHeaders = {
        ...headersFromMake,
        'rpc-persist-pyxis-policy-v-tnc': '1',
        'rpc-persist-pyxis-policy-state-law-is-ca': '1',
        'Accept-Encoding': 'gzip',
        'Locale': 'en',
        'x-tt-pba-enable': '1',
        'X-Biz-Id': '1180',
        'x-bd-kmsv': '0',
        'x-tt-dm-status': 'login=1;ct=1;rt=8',
        'X-SS-REQ-TICKET': String(utime),
        'x-bd-client-key': '#7XhgXG1xPDHCI3vftue5QnEDqKXYPbJp6uwMo9cxiO9OcRvy+Qp3rOun1iYALEujE/vC2OAuGh0vj5qS',
        'tt-ticket-guard-public-key': 'BEMMWabeDuYzmk4XiGq8gHmjLqTqMuaU7i9sg6grfIFaMlh6hmM5UcFGI59UIHK6SEtjyw5iQEn5odvJ4qUTd0M=',
        'sdk-version': '2',
        'tt-ticket-guard-iteration-version': '0',
        'tt-ticket-guard-client-data': 'eyJyZXFfY29udGVudCI6InRpY2tldCxwYXRoLHRpbWVzdGFtcCIsInJlcV9zaWduIjoiTUVRQ0lCV1NldkhBbHhXbEI0WTNxRFU2QkMxOXRBRG0vZWxBOFl6eUVKUEpiT3FzQWlCRG01Q0ZPU0NqRHlWMlhqclcwUlJBTHFVMGpkNzVQUVFIRWRBSks5UXE0UVx1MDAzZFx1MDAzZCIsInRpbWVzdGFtcCI6MTc1ODgxOTU3MSwidHNfc2lnbiI6InRzLjEuNDZhNjk5MzZiZDJkNmEyMmJiYWUxMzJiMzAyNTQzYzA5OTY5NWQ4MGQ4MDNiYTM0OTI5MWEyNDFjODQ3NTllNzdhNTBlOGE0MTdkZjA2OWRmOWE1NTViZDE2YzY2ZWY4YjM2MzlhNTZiNjQyZDdkOGY5Yzg4MWY0MmI5MzI5ZWMifQ==',
        'X-Tt-Token': cookies['X-Tt-Token'] || cookies['x_tt_token'] || '',
        'tt-ticket-guard-version': '3',
        'passport-sdk-version': '-1',
        'rpc-persist-pns-region-1': 'US|6252001|5332921',
        'rpc-persist-pns-region-2': 'US|6252001|5332921',
        'rpc-persist-pns-region-3': 'US|6252001|5332921',
        'x-vc-bdturing-sdk-version': '2.3.13.i18n',
        'oec-vc-sdk-version': '3.0.12.i18n',
        'x-tt-request-tag': 'n=0;nr=111;bg=0',
        'x-tt-store-region': cookies['store-country-code'] || 'us',
        'x-tt-store-region-src': cookies['store-country-code-src'] || 'uid',
        'User-Agent': ua,
        'Content-Type': 'application/x-protobuf',
        'Host': messageHost,
        'Cookie': this.buildCookieString(cookies),
        'Accept': 'application/x-protobuf'
      };
      //调用 build_guard 函数
      let buildGuard1 = {}
      if(cookies['ts_sign_ree']){
         buildGuard1 = await buildGuard({
          cookie: cookies,
          path: '/message/send',
          privHex:cookies['priv_hex'],
          isTicket:true
        });
      }
      requestHeaders = Object.assign(requestHeaders, buildGuard1);
      const client = this.getHttpClient(proxyUrl);
      const response = await client.post(url, postDataBuffer, {
        headers: requestHeaders,
        responseType: 'arraybuffer'
      });

      const buffer = Buffer.isBuffer(response.data) ? response.data : Buffer.from(response.data);
      let decoded = null;
      let jsonFallback = null;

      try {
        decoded = await parsePrivateMessageResponse(buffer);
      } catch (error) {
        try {
          jsonFallback = JSON.parse(buffer.toString('utf-8'));
        } catch {
          jsonFallback = null;
        }
      }

      return decoded?.body?.send_message_body;
    } catch (error) {
      console.error('Error in sendMessageStandalone:', error);
      throw error;
    }
  }

  /**
   * 获取 Seed
   * @param {string} cookieData - Cookie数据
   * @param {string} deviceId - 设备ID
   * @param {string} proxyUrl - 代理URL（可选）
   * @returns {Promise<Array>} [seed, seedType]
   */
  static async getSeed(cookieData, deviceId, installId = null, proxyUrl = null) {
    try {
      // 1. 解析 cookie_data
      const cookies = this.parseCookieData(cookieData);
      const redisSeedKey = redisClient ? this.getSeedRedisKey(cookies) : null;
      if (redisClient && redisSeedKey) {
        try {
          const cachedValue = await redisClient.get(redisSeedKey);
          if (cachedValue) {
            const parsed = JSON.parse(cachedValue);
            if (parsed && parsed.seed !== undefined && parsed.seedType !== undefined) {
              return [parsed.seed, parsed.seedType];
            }
          }
        } catch (error) {
          console.warn('[TikTokService] 读取 Redis seed 缓存失败:', error.message);
        }
      }
      // 2. 提取必要的字段
      // 优先使用传入的 installId，然后从 cookies 中获取
      const iid = installId || cookies.install_id;
      // 优先使用传入的 deviceId，然后从 cookies 中获取
      const actualDeviceId = deviceId || cookies.device_id;
      
      if (!iid || !actualDeviceId) {
        throw new Error('Missing required fields: install_id, device_id');
      }

      // 3. 构建 URL 和查询参数
      const timee = Date.now() / 1000;
      const utime = Math.floor(timee * 1000);
      const stime = Math.floor(timee);
      
      const queryString = `lc_id=2142840551&platform=android&device_platform=android&sdk_ver=v05.02.00-alpha.9-ov-android&sdk_ver_code=84017184&app_ver=40.6.3&version_code=2024006030&aid=1233&sdkid&subaid&iid=${iid}&did=${actualDeviceId}&bd_did&client_type=inhouse&region_type=ov&mode=2`;
      const url = `${Settings.TIKTOK_SDK_BASE_URL}/ms/get_seed?${queryString}`;
      
      // 4. 生成 session 和加密数据
      const { randomUUID } = require('crypto');
      let session = null;
      let tem = null;
      let biaozhi = false;
      
      for (let i = 0; i < 1000000; i++) {
        session = randomUUID().replace(/-/g, '');
        tem = await createSeedEncryptProtobuf(session, actualDeviceId);
        // zlib 压缩并检查长度
        const zlibBytes = Buffer.from(tem, 'hex');
        const zlibRes = zlib.deflateSync(zlibBytes, { level: 1 }).toString('hex');
        
        if (zlibRes.length === 154) {
          biaozhi = true;
          break;
        }
      }
      console.log('biaozhi:', biaozhi);
      if (!biaozhi) {
        throw new Error('Failed to generate session: cannot find zlib result with length 154');
      }
      
      // 5. MSSDK 加密
      const seedEncrypt = mssdkEncrypt(tem, false);
      
      // 6. 生成请求数据
      const postData = await createSeedRequestProtobuf(seedEncrypt, utime);
      const postDataHex = postData;
      
      // 7. 生成请求头
      const headers = await this.makeHeaders(
        actualDeviceId,
        String(stime),
        52,
        2,
        4,
        stime - 6,
        '',
        'Pixel 6',
        '',
        '',
        '',
        '',
        '',
        queryString,
        postDataHex
      );
      
      // 8. 构建完整的请求头
      const copyCookies = { ...cookies };
      copyCookies['store-country-code']  = 'us';
      const requestHeaders = {
        ...headers,
        'rpc-persist-pyxis-policy-v-tnc': '1',
        'rpc-persist-pyxis-policy-state-law-is-ca': '1',
        'Accept-Encoding': 'gzip',
        'x-tt-request-tag': 'n=0;nr=111;bg=0;t=0',
        'rpc-persist-pns-region-3': 'US|6252001|5332921',
        'rpc-persist-pns-region-2': 'US|6252001|5332921',
        'rpc-persist-pns-region-1': 'US|6252001|5332921',
        // "rpc-persist-pns-region-1": "TW|1668284",
        // "rpc-persist-pns-region-2": "TW|1668284",
        // "rpc-persist-pns-region-3": "TW|1668284",
        'x-tt-pba-enable': '1',
        'Accept': '*/*',
        'x-bd-kmsv': '0',
        'X-SS-REQ-TICKET': String(utime),
        'x-bd-client-key': '#7XhgXG1xPDHCI3vftue5QnEDqKXYPbJp6uwMo9cxiO9OcRvy+Qp3rOun1iYALEujE/vC2OAuGh0vj5qS',
        'x-vc-bdturing-sdk-version': '2.3.13.i18n',
        'oec-vc-sdk-version': '3.0.12.i18n',
        'sdk-version': '2',
        'x-tt-dm-status': 'login=1;ct=1;rt=8',
        'X-Tt-Token': cookies['X-Tt-Token'] || cookies['x_tt_token'] || '',
        'passport-sdk-version': '-1',
        'x-tt-store-region': 'us',      //从ck中获取
        'x-tt-store-region-src': 'uid',  //从ck中获取
        'User-Agent': cookies['User-Agent'] || cookies['user_agent'] || 'okhttp/3.12.13.20',
        'Content-Type': 'application/octet-stream',
        'Host': 'mssdk16-normal-useast5.tiktokv.us',
        'Cookie': this.buildCookieString(copyCookies)
      };
      
      // 9. 发送请求
      console.log('requestHeaders:',requestHeaders)
      console.log("url:",url)
      const client = this.getHttpClient(proxyUrl);
      const response = await client.post(url, Buffer.from(postDataHex, 'hex'), {
        headers: requestHeaders,
        responseType: 'arraybuffer'
      });
      
      // 10. 解析响应
      const responseBufferSeed = Buffer.isBuffer(response.data) ? response.data : Buffer.from(response.data);
      const responseHex = responseBufferSeed.toString('hex');
      const resPb = await parseSeedResponse(responseHex);
      
      // protobufjs 可能使用驼峰命名或下划线命名，需要兼容处理
      const seedDecryptBuffer = resPb.seedDecrypt || resPb.seed_decrypt;
      
      if (!seedDecryptBuffer || !Buffer.isBuffer(seedDecryptBuffer)) {
        console.warn('seed_decrypt field is missing or invalid in response');
        return ['', ''];
      }
      
      const seedDecryptHex = seedDecryptBuffer.toString('hex');
      
      if (!seedDecryptHex || seedDecryptHex === '') {
        return ['', ''];
      }
      
      // 11. 解密 seed_decrypt
      const seedDecryptRes = mssdkDecrypt(seedDecryptHex, false, false);
      
      // 12. 解析解密后的 seed
      const afterDecryptSeed = await parseSeedDecrypt(seedDecryptRes);
      const seed = afterDecryptSeed.seed;
      // Python: seed_type = int(aftre_decrypt_seed.extra_info.algorithm.encode("utf-8").hex(), 16) // 2
      const extraInfo = afterDecryptSeed.extraInfo || afterDecryptSeed.extra_info;
      if (!extraInfo || !extraInfo.algorithm) {
        console.warn('extra_info.algorithm is missing in decrypted seed');
        return [seed || '', ''];
      }
      
      const algorithmHex = Buffer.from(extraInfo.algorithm, 'utf8').toString('hex');
      const seedType = Math.floor(parseInt(algorithmHex, 16) / 2);
      console.log("seed:",seed)
      console.log("seedType:",seedType)
      if (redisClient && redisSeedKey) {
        try {
          await redisClient.set(
            redisSeedKey,
            JSON.stringify({ seed: seed || '', seedType }),
            'EX',
            REDIS_CACHE_TTL
          );
        } catch (error) {
          console.warn('[TikTokService] 写入 Redis seed 缓存失败:', error.message);
        }
      }
      return [seed || '', seedType];
      
    } catch (error) {
      console.error('Error in getSeed:', error);
      throw error;
    }
  }

  /**
   * 获取 Token
   * @param {string} cookieData - Cookie数据
   * @param {string} deviceId - 设备ID
   * @param {string} proxyUrl - 代理URL（可选）
   * @returns {Promise<string>} token
   */
  static async getToken(cookieData, deviceId, installId = null, proxyUrl = null) {
    try {
      // 1. 解析 cookie_data
      const cookies = this.parseCookieData(cookieData);
      const redisTokenKey = redisClient ? this.getTokenRedisKey(cookies) : null;
      if (redisClient && redisTokenKey) {
        try {
          const cachedToken = await redisClient.get(redisTokenKey);
          if (cachedToken) {
            return cachedToken;
          }
        } catch (error) {
          console.warn('[TikTokService] 读取 Redis token 缓存失败:', error.message);
        }
      }
      
      // 2. 提取必要的字段
      // 优先使用传入的 installId，然后从 cookies 中获取
      const iid = installId || cookies.install_id;
      // 优先使用传入的 deviceId，然后从 cookies 中获取
      const actualDeviceId = deviceId || cookies.device_id;
      
      if (!iid || !actualDeviceId) {
        throw new Error('Missing required fields: install_id, device_id');
      }

      // 3. 构建 URL 和查询参数
      const timee = Date.now() / 1000;
      const utime = Math.floor(timee * 1000);
      const stime = Math.floor(timee);
      
      const queryString = `lc_id=2142840551&platform=android&device_platform=android&sdk_ver=v05.02.00-alpha.9-ov-android&sdk_ver_code=84017184&app_ver=40.6.3&version_code=2024006030&aid=1233&sdkid&subaid&iid=${iid}&did=${actualDeviceId}&bd_did&client_type=inhouse&region_type=ov&mode=2`;
      const url = `${Settings.TIKTOK_SDK_BASE_URL}/sdi/get_token?${queryString}`;
      
      // 4. 生成 TokenEncrypt
      // const tem = await createTokenEncryptProtobuf(stime, actualDeviceId);
      
      // 5. MSSDK 加密
      // const tokenEncrypt = mssdkEncrypt(tem, false);
      
      // 6. 生成请求数据
      // const postData = await createTokenRequestProtobuf(tokenEncrypt, utime);
      // const postDataHex = postData;
      
      // 使用写死的 post_data（与 Python token_test.py 保持一致）
      const postDataHex = "08c49080820410021802229005c5fdf8642b9b585bab135b7dc61e0ef85c8e4d48446e8d6aa8c1b44baa4be24ca15b347fb46f91309d5feaad7bd1ed554cd0d3b4e613ea6b7691f13eb4a0e03e8918f60977fa37f128e299f6c52db9fd7ba7013b6f7864999ea155d3c3b191a2e135d8a850957b6051e7302cb5afe7fb30fa751f346eba586ef7cb9ed3b21d1458a033cd00c8ea28cc6c8c2901ecce73bbf2e8c1126d50b4af20d7e2c4074bfe564a8422b7ada5e049b2c7fc8f7476ab18cd2801b09907eaaba60d9c1e3dfe409126ddf0e23af4fadf99e0ef9e27623fe6575e6286bc4c505e59278d5bbe0cfb1e583e884e46ea45e63dd90033d699119cb77a874e288ef1093f7a73aeb75da0711c1c3b4d1c8b988db6780fe9bf7128063bfe24d139b8508732eceba7a5847df935e579cf99655c3c8572d6380b3e4e68bbc1594c00e1bb61407c3b0720e0da6e78b7269bfcf556a2f8960de17d923d8e7667fa04b8666ca1209bd73f07418fe3eb51cc52e121e66f86e43997d04dba0572c141db055982f378f6e0cad3ec7eb57229cf3c43ef7163fe75ff5ddfa188c02f1ab42458705e3ae812bd01d6b264edef31545d4a780a3c08a4960cd5dbae3170cfdbdc0a8aaec9682719a1987f4ef53505195250e5468ee2eae62e80e616d3719bc987f25d993bfc98b409fa777c82d5002ebd3ac5f0ef2441d0c5910b5d51d0d3962b7723243213801773b1536d0acbaf4be4b0f32f9857475f065732f8361c2908b02c544f61195e39b47fb44b7b73f0beb68bb4428752c5001de40428ff8491ff9f9d6f7b13d491c18d6aaebd43917dd6ecc6d7051048d33c497f93c3d7e75b9fadb9af93a4934f5728c9e058f51debcf5dbe472d21303a204c63dec2a66ababd66a3ba8dffe21dfc32cfcbac51e14c499878b1b18c96a15baac45a2828e6899a93bb66";
      
      // 7. 生成请求头
      const headers = await this.makeHeaders(
        actualDeviceId,
        String(stime),
        52,
        2,
        4,
        stime - 6,
        '',
        'Pixel 6',
        '',
        '',
        '',
        '',
        '',
        queryString,
        postDataHex
      );
      const copyCookies = { ...cookies };
      copyCookies['store-country-code']  = 'us';
      // 8. 构建完整的请求头
      const requestHeaders = {
        ...headers,
        'rpc-persist-pyxis-policy-v-tnc': '1',
        'rpc-persist-pyxis-policy-state-law-is-ca': '1',
        'Accept-Encoding': 'gzip',
        'rpc-persist-pns-region-3': 'US|6252001|5332921',
        'x-tt-request-tag': 'n=0;nr=111;bg=0;t=0',
        'rpc-persist-pns-region-2': 'US|6252001|5332921',
        'rpc-persist-pns-region-1': 'US|6252001|5332921',
        'x-tt-pba-enable': '1',
        'Accept': '*/*',
        'x-bd-kmsv': '0',
        'X-SS-REQ-TICKET': String(utime),
        'x-bd-client-key': '#7XhgXG1xPDHCI3vftue5QnEDqKXYPbJp6uwMo9cxiO9OcRvy+Qp3rOun1iYALEujE/vC2OAuGh0vj5qS',
        'x-vc-bdturing-sdk-version': '2.3.13.i18n',
        'oec-vc-sdk-version': '3.0.12.i18n',
        'sdk-version': '2',
        'x-tt-dm-status': 'login=1;ct=1;rt=8',
        'X-Tt-Token': cookies['X-Tt-Token'] || cookies['x_tt_token'] || '',
        'passport-sdk-version': '-1',
        'x-tt-store-region': 'us',
        'x-tt-store-region-src': 'uid',
        'User-Agent': cookies['User-Agent'] || cookies['user_agent'] || 'okhttp/3.12.13.20',
        'Content-Type': 'application/octet-stream',
        'Host': 'mssdk16-normal-useast5.tiktokv.us',
        'Cookie': this.buildCookieString(copyCookies)
      };
      
      // 9. 发送请求
      const client = this.getHttpClient(proxyUrl);
      const response = await client.post(url, Buffer.from(postDataHex, 'hex'), {
        headers: requestHeaders,
        responseType: 'arraybuffer'
      });
      
      // 10. 解析响应
      const responseBufferToken = Buffer.isBuffer(response.data) ? response.data : Buffer.from(response.data);
      const responseHex = responseBufferToken.toString('hex');
      console.log("responseHex:",responseHex)
      const resPb = await parseTokenResponse(responseHex);
      console.log("resPb:",resPb)
      // protobufjs 可能使用驼峰命名或下划线命名，需要兼容处理
      // Python: tokenDecrypt = res_pb.token_decrypt.hex()
      // 即使 token_decrypt 为空，Python 也会返回空字符串，不会抛出异常
      const tokenDecryptBuffer = resPb.tokenDecrypt || resPb.token_decrypt;
      
      // 参考 Python: if tokenDecrypt != "": ... else: return ""
      // protobufjs 在字段不存在时可能返回空数组 [] 或空 Buffer
      if (tokenDecryptBuffer !== undefined && tokenDecryptBuffer !== null) {
        // 如果 tokenDecryptBuffer 是数组，转换为 Buffer
        let tokenDecryptHex = '';
        if (Array.isArray(tokenDecryptBuffer)) {
          tokenDecryptHex = Buffer.from(tokenDecryptBuffer).toString('hex');
        } else if (Buffer.isBuffer(tokenDecryptBuffer)) {
          tokenDecryptHex = tokenDecryptBuffer.toString('hex');
        } else {
          // 其他类型，尝试转换
          console.warn('token_decrypt field is invalid type:', typeof tokenDecryptBuffer);
          return '';
        }
        
        // Python: if tokenDecrypt != "": ... else: return ""
        if (!tokenDecryptHex || tokenDecryptHex === '') {
          return '';
        }
        
        // 继续处理非空的 tokenDecryptHex
        // 11. 尝试直接解析 protobuf（如果已经是解密后的格式）
        // 如果直接解析失败，则先解密再解析
        let tokenDecryptRes = tokenDecryptHex;
        let afterDecryptToken;
        
        try {
          // 尝试直接解析为 TokenDecrypt protobuf
          afterDecryptToken = await parseTokenDecrypt(tokenDecryptHex);
          
          if (afterDecryptToken && afterDecryptToken.token) {
            return afterDecryptToken.token;
          }
        } catch (directParseError) {
          // 直接解析失败，说明需要先解密
          // 12. 解密 token_decrypt
          tokenDecryptRes = mssdkDecrypt(tokenDecryptHex, false, false);
          
          // 13. 解析解密后的 token
          afterDecryptToken = await parseTokenDecrypt(tokenDecryptRes);
        }
        
        const token = afterDecryptToken.token || '';
        if (redisClient && redisTokenKey && token) {
          try {
            await redisClient.set(redisTokenKey, token, 'EX', REDIS_CACHE_TTL);
          } catch (error) {
            console.warn('[TikTokService] 写入 Redis token 缓存失败:', error.message);
          }
        }
        return token;
      }
      
      // tokenDecryptBuffer 不存在
      console.warn('token_decrypt field is missing or invalid in response');
      // 如果响应标记为空，输出更多调试信息
      if (resPb._isEmpty) {
        console.warn('TokenResponse is empty, no token_decrypt available');
      }
      return '';
      
      // 11. 解密 token_decrypt
      const tokenDecryptRes = mssdkDecrypt(tokenDecryptHex, false, false);
      
      // 12. 解析解密后的 token
      const afterDecryptToken = await parseTokenDecrypt(tokenDecryptRes);
      const token = afterDecryptToken.token || '';
      if (redisClient && redisTokenKey && token) {
        try {
          await redisClient.set(redisTokenKey, token, 'EX', REDIS_CACHE_TTL);
        } catch (error) {
          console.warn('[TikTokService] 写入 Redis token 缓存失败:', error.message);
        }
      }
      return token;
      
    } catch (error) {
      console.error('Error in getToken:', error);
      throw error;
    }
  }

  /**
   * 仅供控制层读取的内存缓存
   */
  static async getCachedSeedFromMemory(cookieData, deviceId = null, installId = null, proxyUrl = null) {
    const cached = seedTokenCache.getSeed(cookieData);
    if (cached) {
      return cached;
    }

    try {
      const cookies = this.parseCookieData(cookieData);
      const iid = installId || cookies.install_id || this.generateRandomInstallId();
      const actualDeviceId = deviceId || cookies.device_id || this.generateRandomDeviceId();

      const [seed, seedType] = await this.getSeed(cookieData, actualDeviceId, iid, proxyUrl);
      if (seed && seedType) {
        seedTokenCache.setSeed(cookieData, seed, seedType);
        return [seed, seedType];
      }
    } catch (error) {
      console.warn('Failed to refresh seed cache:', error.message);
    }

    return null;
  }

  static async getCachedTokenFromMemory(cookieData, deviceId = null, installId = null, proxyUrl = null) {
    const cached = seedTokenCache.getToken(cookieData);
    if (cached) {
      return cached;
    }

    try {
      const cookies = this.parseCookieData(cookieData);
      const iid = installId || cookies.install_id || this.generateRandomInstallId();
      const actualDeviceId = deviceId || cookies.device_id || this.generateRandomDeviceId();

      const token = await this.getToken(cookieData, actualDeviceId, iid, proxyUrl);
      if (token) {
        seedTokenCache.setToken(cookieData, token);
        return token;
      }
    } catch (error) {
      console.warn('Failed to refresh token cache:', error.message);
    }

    return null;
  }
}

module.exports = TikTokService;

