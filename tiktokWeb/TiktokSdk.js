const signBogus = require('./encryption/xbogus')
const signGnarly = require('./encryption/xgnarly')
const { signWithKeysInfo ,getDefaultBase64} = require('./encryption/signWithKeysInfo')
const { URL } = require('url')
const fs = require('fs')
const path = require('path')
const {
	encryptSendTextMessage,
	decodeResponse,
	encrpytCreateConversationV2,
} = require('./protobufTool')
const { getCurlHttpSdkInstance } = require('../CurlHttpSdk')
const { getTimestampByTimezone,buildHeadersByLang} = require('./util/helper')
let Log
try {
	Log = require('ee-core/log')
} catch (error) {
	Log = {
		info: (...args) => console.log('[INFO]', ...args),
		warn: (...args) => console.warn('[WARN]', ...args),
		error: (...args) => console.error('[ERROR]', ...args),
	}
}

/**
 * 获取指定时区的当前时间戳（秒）
 *
 * 注意：Unix 时间戳本质上是 UTC 时间。此函数获取指定时区的当前本地时间，
 * 然后将其转换为对应的 UTC 时间戳。
 *
 * @param {string} timezone - 时区，例如：
 *   - 'America/New_York'（东部时间 EST/EDT，UTC-5/UTC-4）
 *   - 'America/Chicago'（中部时间 CST/CDT，UTC-6/UTC-5）
 *   - 'America/Denver'（山地时间 MST/MDT，UTC-7/UTC-6）
 *   - 'America/Los_Angeles'（太平洋时间 PST/PDT，UTC-8/UTC-7）
 * @returns {number} Unix 时间戳（秒）
 */
function getTimestampInTimezone(timezone = 'America/New_York') {
	const now = new Date()

	// 获取指定时区的日期时间组件
	const formatter = new Intl.DateTimeFormat('en-US', {
		timeZone: timezone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false,
	})

	const parts = formatter.formatToParts(now)
	const year = parseInt(parts.find(p => p.type === 'year').value)
	const month = parseInt(parts.find(p => p.type === 'month').value) - 1
	const day = parseInt(parts.find(p => p.type === 'day').value)
	const hour = parseInt(parts.find(p => p.type === 'hour').value)
	const minute = parseInt(parts.find(p => p.type === 'minute').value)
	const second = parseInt(parts.find(p => p.type === 'second').value)

	// 将指定时区的时间转换为 UTC 时间戳
	// 使用 Date.UTC 创建 UTC 时间，然后计算时区偏移
	const utcTime = Date.UTC(year, month, day, hour, minute, second)

	// 计算时区偏移：当前 UTC 时间与指定时区时间的差值
	const offset = now.getTime() - utcTime

	// 返回调整后的时间戳（秒）
	return Math.floor((now.getTime() + offset) / 1000)
}

/**
 * 获取美国东部时间的时间戳（秒）
 * 使用东部时间（America/New_York，EST/EDT）
 *
 * 注意：大多数 API 使用 UTC 时间戳是标准做法。
 * 如果需要 UTC 时间戳，请使用: Math.floor(Date.now() / 1000)
 *
 * @returns {number} Unix 时间戳（秒）
 */
function getUSTimestamp() {
	// 获取美国东部时间的当前时间戳
	// 注意：这仍然返回 UTC 时间戳，但基于美国东部时间的当前时间计算
	return getTimestampInTimezone('America/New_York')
}
/**
 * HTTP 请求封装类 - 单例模式
 */
class HttpClient {
	constructor() {
		if (HttpClient._instance) {
			return HttpClient._instance
		}

		this.baseUrl = 'https://im-api.tiktok.com'
		this.proxy = null
		// 时区缓存：key 为代理地址（或 'default'），value 为时区字符串
		this.timezoneCache = {}
		this.geoLiteReaderPromise = null
		this.geoLiteDbPath = null

		this.defaultHeaders = {
			accept: 'application/x-protobuf',
			'accept-language': 'en-IE,en;q=0.7',
			'cache-control': 'no-cache',
			'content-type': 'application/x-protobuf',
			pragma: 'no-cache',
			priority: 'u=1, i',
			'sec-ch-ua':`"Not A(Brand";v="8", "Chromium";v="132", "Google Chrome";v="132"`,
			'sec-ch-ua-mobile': '?0',
			'sec-ch-ua-platform': '"Windows"',
			'sec-fetch-dest': 'empty',
			'sec-fetch-mode': 'cors',
			'sec-fetch-site': 'same-site',
			Referer: 'https://www.tiktok.com/messages?lang=en',
			Origin: 'https://www.tiktok.com',
			'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
		}

		// 初始化CurlHttpSdk
		this.curlHttpSdk = null // 延迟初始化，根据代理配置创建

		HttpClient._instance = this
	}

	/**
	 * 获取单例实例
	 * @returns {HttpClient} 单例实例
	 */
	static getInstance() {
		if (!HttpClient._instance) {
			HttpClient._instance = new HttpClient()
		}
		return HttpClient._instance
	}

	/**
	 * 重置单例实例（主要用于测试）
	 */
	static resetInstance() {
		HttpClient._instance = null
	}

	/**
	 * 获取或创建 CurlHttpSdk 实例
	 * @param {string} proxy - 代理配置
	 * @returns {CurlHttpSdk} CurlHttpSdk 实例
	 */
	getCurlHttpSdk(proxy = null) {
		if (!this.curlHttpSdk) {
			const initOptions = proxy ? { proxy } : {}
			this.proxy = proxy || null
			this.curlHttpSdk = getCurlHttpSdkInstance(initOptions)
			console.log(
				`[HttpClient] 复用全局 CurlHttpSdk 实例，代理: ${this.proxy || '默认'}`
			)
		} else if (proxy && this.proxy !== proxy) {
			console.warn(
				`[HttpClient] 全局 CurlHttpSdk 已初始化，当前代理固定为 ${this.proxy || '默认'}，无法切换为 ${proxy}`
			)
		}
		return this.curlHttpSdk
	}

	/**
	 * 尝试解析 GeoLite2 数据库路径
	 * @returns {string|null} 数据库路径
	 */
	resolveGeoLiteDbPath() {
		const candidates = []
		if (process.env.GEOLITE2_DB_PATH) {
			candidates.push(process.env.GEOLITE2_DB_PATH)
		}

		const projectRoot = path.resolve(__dirname, '../../../')
		candidates.push(path.join(projectRoot, 'run', 'GeoLite2-City.mmdb'))
		candidates.push(path.join(projectRoot, 'GeoLite2-City.mmdb'))

		const cwd = process.cwd()
		candidates.push(path.join(cwd, 'run', 'GeoLite2-City.mmdb'))
		candidates.push(path.join(cwd, 'GeoLite2-City.mmdb'))

		if (process.resourcesPath) {
			candidates.push(
				path.join(process.resourcesPath, 'run', 'GeoLite2-City.mmdb')
			)
			candidates.push(path.join(process.resourcesPath, 'GeoLite2-City.mmdb'))
		}

		for (const filePath of candidates) {
			if (filePath && fs.existsSync(filePath)) {
				return filePath
			}
		}

		return null
	}



	/**
	 * 使用 GeoLite2 数据库解析 IP 对应的时区
	 * @param {string} ip - 公网 IP
	 * @returns {Promise<string|null>} 时区字符串
	 */
	async lookupTimezoneFromGeoLite(ip) {
		if (!ip) {
			return null
		}

		try {
			
			const geoInfo = global.GeoIp.getGeoDataSync(ip)
			return (
				(geoInfo &&
					geoInfo.location &&
					(geoInfo.location.time_zone || geoInfo.location.timeZone)) ||
				null
			)
		} catch (error) {
			Log.warn(`[HttpClient] GeoLite2 解析 IP(${ip}) 时区失败: ${error.message}`)
			return null
		}
	}

	/**
	 * 根据代理获取当前公网 IP
	 * @param {CurlHttpSdk} sdk
	 * @returns {Promise<string>}
	 */
	async fetchCurrentIp(sdk) {
		const response = await sdk.get('https://api.ip.sb/ip', {
			'User-Agent': this.defaultHeaders['user-agent'],
		})

		let ip = response.body
		if (Buffer.isBuffer(ip)) {
			ip = ip.toString('utf8')
		}

		if (typeof ip === 'string') {
			return ip.trim()
		}

		if (ip && typeof ip === 'object' && ip.ip) {
			return String(ip.ip).trim()
		}

		throw new Error('无法解析当前公网 IP')
	}

	/**
	 * 通过 IP 地理位置 API 获取当前代理 IP 的时区，并返回该时区的当前时间戳
	 * @param {CurlHttpSdk} curlSdk - CurlHttpSdk 实例（如果提供则直接使用，否则根据 proxy 创建）
	 * @param {string} proxy - 代理配置（仅在 curlSdk 未提供时使用）
	 * @returns {Promise<number>} Unix 时间戳（秒）
	 */
	async getTimestampByIp(curlSdk = null, proxy = null) {
		const cacheKey = proxy || 'default'
		let timezone = this.timezoneCache[cacheKey]

		// 如果缓存中没有时区，先获取时区
		if (!timezone) {
			try {
				// 如果提供了 curlSdk，直接使用；否则创建新的
				const sdk = curlSdk || this.getCurlHttpSdk(proxy)

				// 使用 ip.sb API 获取 IP 地理位置信息
				const response = await sdk.get('https://api.ip.sb/geoip', {
					'User-Agent': this.defaultHeaders['user-agent'],
				})

				// 解析响应体（可能是 Buffer 或字符串）
				let geoInfo
				if (Buffer.isBuffer(response.body)) {
					geoInfo = JSON.parse(response.body.toString('utf8'))
				} else if (typeof response.body === 'string') {
					geoInfo = JSON.parse(response.body)
				} else {
					geoInfo = response.body
				}

				timezone = geoInfo.timezone || 'America/New_York'

				// 缓存时区信息
				this.timezoneCache[cacheKey] = timezone

				Log.info(
					`[HttpClient] 获取到 IP 时区: ${timezone} (代理: ${proxy || '无'})`
				)
			} catch (error) {
				Log.warn(
					`[HttpClient] 获取 IP 时区失败，使用默认时区: ${error.message}`
				)
				// 失败时使用默认时区并缓存
				timezone = 'America/New_York'
				this.timezoneCache[cacheKey] = timezone
			}
		}

		// 获取指定时区的当前时间并转换为时间戳
		// Unix 时间戳本质上是 UTC 时间，表示同一时刻
		// 这里直接返回当前 UTC 时间戳即可
		const timestamp = Math.floor(Date.now() / 1000)

		Log.info(`[HttpClient] 使用时区 ${timezone}，当前 UTC 时间戳: ${timestamp}`)

		return timestamp
	}



	/**
	 * 根据时区获取对应的 region 和 locale
	 * @param {string} timezone - 时区字符串，例如 'Asia/Tokyo', 'America/New_York'
	 * @returns {Object} { region, locale, appLanguage }
	 */
	getRegionAndLocaleByTimezone(timezone) {
		// 时区到 region 和 locale 的映射
		const timezoneMap = {
			// 亚洲
			'Asia/Tokyo': { region: 'JP', locale: 'ja-JP', appLanguage: 'ja' },
			'Asia/Seoul': { region: 'KR', locale: 'ko-KR', appLanguage: 'ko' },
			'Asia/Taipei': { region: 'TW', locale: 'zh-TW', appLanguage: 'zh-Hant' },
			'Asia/Singapore': { region: 'SG', locale: 'en-SG', appLanguage: 'en' },
			'Asia/Bangkok': { region: 'TH', locale: 'th-TH', appLanguage: 'th' },
			'Asia/Jakarta': { region: 'ID', locale: 'id-ID', appLanguage: 'id' },
			'Asia/Manila': { region: 'PH', locale: 'en-PH', appLanguage: 'en' },
			'Asia/Kolkata': { region: 'IN', locale: 'en-IN', appLanguage: 'en' },
			// 美洲
			'America/New_York': { region: 'US', locale: 'en-US', appLanguage: 'en' },
			'America/Los_Angeles': {
				region: 'US',
				locale: 'en-US',
				appLanguage: 'en',
			},
			'America/Chicago': { region: 'US', locale: 'en-US', appLanguage: 'en' },
			'America/Denver': { region: 'US', locale: 'en-US', appLanguage: 'en' },
			'America/Toronto': { region: 'CA', locale: 'en-CA', appLanguage: 'en' },
			'America/Mexico_City': {
				region: 'MX',
				locale: 'es-MX',
				appLanguage: 'es',
			},
			'America/Sao_Paulo': { region: 'BR', locale: 'pt-BR', appLanguage: 'pt' },
			// 欧洲
			'Europe/London': { region: 'GB', locale: 'en-GB', appLanguage: 'en' },
			'Europe/Paris': { region: 'FR', locale: 'fr-FR', appLanguage: 'fr' },
			'Europe/Berlin': { region: 'DE', locale: 'de-DE', appLanguage: 'de' },
			'Europe/Rome': { region: 'IT', locale: 'it-IT', appLanguage: 'it' },
			'Europe/Madrid': { region: 'ES', locale: 'es-ES', appLanguage: 'es' },
			'Europe/Moscow': { region: 'RU', locale: 'ru-RU', appLanguage: 'ru' },
			// 大洋洲
			'Australia/Sydney': { region: 'AU', locale: 'en-AU', appLanguage: 'en' },
			'Pacific/Auckland': { region: 'NZ', locale: 'en-NZ', appLanguage: 'en' },
		}

		// 查找匹配的时区
		const match = timezoneMap[timezone]
		if (match) {
			return match
		}

		// 如果没有精确匹配，根据时区前缀推断
		if (timezone.startsWith('Asia/')) {
			// 默认亚洲地区使用新加坡
			return { region: 'SG', locale: 'en-SG', appLanguage: 'en' }
		} else if (timezone.startsWith('America/')) {
			// 默认美洲地区使用美国
			return { region: 'US', locale: 'en-US', appLanguage: 'en' }
		} else if (timezone.startsWith('Europe/')) {
			// 默认欧洲地区使用英国
			return { region: 'GB', locale: 'en-GB', appLanguage: 'en' }
		}

		// 默认值
		return { region: 'US', locale: 'en-US', appLanguage: 'en' }
	}

	/**
	 * 调用 account/info 接口（在发送消息前调用）
	 * @param {Object} cookies - Cookie 对象
	 * @param {Object} options - 选项对象
	 * @param {CurlHttpSdk} curlSdk - CurlHttpSdk 实例
	 * @param {string} userAgent - User-Agent
	 * @param {number} timestamp - 时间戳
	 * @returns {Promise<Object>} 更新后的 cookies 对象
	 */
	async callBeginUserRegistration(
		cookies,
		options,
		curlSdk,
		userAgent,
		timestamp
	) {
		try {
			// 从 cookies 或 options 中获取必要参数
			const deviceId = cookies.device_id || cookies.did || '7543896640060655111'
			const msToken = cookies.msToken || ''
			const odinId = cookies.odin_tt || cookies.odinId || ''
			const browserVersion = userAgent.replace('Mozilla/', '')

			// 获取时区（如果缓存中没有，使用传入的 curlSdk 获取）
			const cacheKey = options.proxy || 'default'
			let tzName = this.timezoneCache[cacheKey]

			if (!tzName) {
				// 如果缓存中没有时区，使用传入的 curlSdk 获取
				try {
					const response = await curlSdk.get('https://api.ip.sb/geoip', {
						'User-Agent': this.defaultHeaders['user-agent'],
					})

					let geoInfo
					if (Buffer.isBuffer(response.body)) {
						geoInfo = JSON.parse(response.body.toString('utf8'))
					} else if (typeof response.body === 'string') {
						geoInfo = JSON.parse(response.body)
					} else {
						geoInfo = response.body
					}

					tzName = geoInfo.timezone || 'Asia/Shanghai'
					// this.timezoneCache[cacheKey] = tzName
					Log.info(
						`[HttpClient] 在 callBeginUserRegistration 中获取到 IP 时区: ${tzName}`
					)
				} catch (error) {
					Log.warn(`[HttpClient] 获取 IP 时区失败: ${error.message}`)
					tzName = 'Asia/Shanghai'
				}
			}

			// 根据时区获取对应的 region 和 locale
			const { region, locale, appLanguage } =
				this.getRegionAndLocaleByTimezone(tzName)

			// 如果 options 中提供了 region 或 locale，优先使用（但时区必须匹配）
			const finalRegion = options.region || region
			const finalLocale = options.locale || locale
			const finalAppLanguage = options.app_language || appLanguage

			// 构建查询参数（所有参数都在 URL 中）
			const queryParams = {
				WebIdLastTime: 0,
				aid: 1459,
				app_language: finalAppLanguage,
				app_name: 'tiktok_web',
				browser_language: options.browser_language || finalLocale,
				browser_name: 'Mozilla',
				browser_online: true,
				browser_platform: 'Win32',
				browser_version: browserVersion,
				channel: 'tiktok_web',
				cookie_enabled: true,
				data_collection_enabled: true,
				device_id: deviceId,
				device_platform: 'web_pc',
				focus_state: true,
				from_page: 'fyp',
				history_len: 4,
				is_fullscreen: false,
				is_page_visible: true,
				locale: finalLocale,
				odinId: odinId,
				os: 'windows',
				priority_region: finalRegion,
				referer: '',
				region: finalRegion,
				screen_height: 1080,
				screen_width: 1920,
				tz_name: tzName,
				user_is_login: true,
				webcast_language: finalLocale,
				msToken: msToken,
			}

			// 构建查询字符串（不包含 X-Bogus 和 X-Gnarly）
			const queryString = this.buildQueryString(queryParams)

			// 生成 X-Bogus 和 X-Gnarly 签名（GET 请求，body 为空）
			const emptyBody = ''
			const xBogus = signBogus(queryString, emptyBody, userAgent, timestamp)
			const xGnarly = signGnarly(queryString, emptyBody, userAgent, 0, '5.1.1')

			// 构建完整 URL（包含查询参数和签名）
			const url = `https://www.tiktok.com/passport/web/account/info/?${queryString}&X-Bogus=${xBogus}&X-Gnarly=${xGnarly}`

			// 创建 cookies 副本，并删除与 store-country 相关的 cookies，让服务器根据 IP 重新判断
			const cleanedCookies = { ...cookies }
			// delete cleanedCookies['store-country-code']
			// delete cleanedCookies['store-country-code-src']
			// delete cleanedCookies['store-country-sign']
			// delete cleanedCookies['store-idc']
			// delete cleanedCookies['tt-target-idc']
			delete cleanedCookies['region']
			delete cleanedCookies['lang']
			Log.info('清理后的 cookies:', Object.keys(cleanedCookies).length, '个')

			// 构建请求头
			const headers = {
				// ...this.defaultHeaders,
				cookie: this.buildCookieString(cleanedCookies),
				referer: 'https://www.tiktok.com/',
				'referrer-policy': 'strict-origin-when-cross-origin',
			}
			// 发送 GET 请求
			const response = await curlSdk.get(url, headers)

			// 打印响应体内容
			let responseBody = response.body
			if (Buffer.isBuffer(responseBody)) {
				responseBody = responseBody.toString('utf8')
			}
			Log.info(`[HttpClient] account/info 响应状态: ${response.status}`)
			Log.info(`[HttpClient] account/info 响应体:`, responseBody)

			// 处理 Cookie 更新（如果有）
			// 使用清理后的 cookies 作为基础，这样服务器返回的新 cookies 会覆盖旧的
			const updatedCookies = { ...cleanedCookies }

			// response.headers 的结构是 { '0': { 'Set-Cookie': [...] } }
			// 需要先获取 '0' 键对应的对象，然后获取 Set-Cookie
			let setCookieHeaders = null

			// 尝试不同的方式获取 Set-Cookie
			console.log('response:',response)
			if (response.headers && typeof response.headers === 'object') {
				// 方式1: response.headers['0']['Set-Cookie'] 或 response.headers['0']['set-cookie']
				const headerObj = response.headers['0'] || response.headers[0]
				if (headerObj) {
					setCookieHeaders = headerObj['Set-Cookie'] || headerObj['set-cookie']
				}
				// 方式2: 直接查找 Set-Cookie 或 set-cookie（如果不在 '0' 键下）
				if (!setCookieHeaders) {
					setCookieHeaders =
						response.headers['Set-Cookie'] || response.headers['set-cookie']
				}
			}

			Log.info(
				'setCookieHeaderssetCookieHeaderssetCookieHeaders:',
				setCookieHeaders
			)
			if (setCookieHeaders) {
				// 确保是数组格式
				const cookieArray = Array.isArray(setCookieHeaders)
					? setCookieHeaders
					: [setCookieHeaders]

				// 解析所有 Set-Cookie 头
				for (const setCookieHeader of cookieArray) {
					const newCookies = this.parseSetCookie(setCookieHeader)
					Object.assign(updatedCookies, newCookies)
				}
				// 找出新增或更新的 cookies
				const changedCookies = Object.keys(updatedCookies).filter(
					key => !cookies[key] || cookies[key] !== updatedCookies[key]
				)
			}

			// 返回更新后的 cookies（包含响应头 Set-Cookie 中的新 cookies）
			return updatedCookies
		} catch (error) {
			// 如果调用失败，记录警告但不中断主流程，返回原始 cookies
			Log.warn(`[HttpClient] 调用 account/info 失败: ${error.message}`)
			return cookies
		}
	}

	/**
	 * 发送 POST 请求
	 * @param {string} endpoint - API 端点
	 * @param {Object} params - 查询参数
	 * @param {Buffer} body - 请求体
	 * @param {Object} cookies - Cookie 对象
	 * @param {Function} onCookieUpdate - Cookie 更新回调
	 * @returns {Promise<Object>} 响应数据
	 */
	async post(
		endpoint,
		params,
		body,
		cookies = {},
		onCookieUpdate = null,
		options = {}
	) {
		try {
			// 构建查询字符串
			const queryString = this.buildQueryString(params)

			// 生成加密签名
			const userAgent =
				this.defaultHeaders['user-agent'] ||
				this.defaultHeaders['User-Agent'] ||
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36'
			const encodeData = Buffer.from(body).toString('latin1')

			// 获取或创建 CurlHttpSdk 实例
			const curlSdk = this.getCurlHttpSdk(options.proxy)

			let tzName = cookies['tz_name'] || 'America/New_York'
			const timestamp = getTimestampByTimezone(tzName)
			const xBogus = signBogus(queryString, encodeData, userAgent, timestamp)

			const xGnarly = signGnarly(queryString, encodeData, userAgent, 0, '5.1.1')
			// 构建完整 URL
			const signData = `ticket=${cookies['sessionid']}&path=${endpoint}&timestamp=${timestamp}`
			// 
			this.baseUrl = cookies['imApi'] ? decodeURIComponent(cookies['imApi'])  : this.baseUrl
			Log.info("baseUrl:",this.baseUrl)
			const url = `${this.baseUrl}${endpoint}?${queryString}&X-Bogus=${xBogus}&X-Gnarly=${xGnarly}`
	
			let tiketHeader = {

			}
			if(!cookies['ts_sign_ree']){
			  const base64Key =	await getDefaultBase64()
			  tiketHeader = {
				"tt-ticket-guard-iteration-version": "0",
				"tt-ticket-guard-public-key":base64Key,
				"tt-ticket-guard-version": "2",
				"tt-ticket-guard-web-version": "1"
			  }

			}else{
				let ticketGuardData = await signWithKeysInfo(signData, {
					ticket: cookies['sessionid'],
					tsSign: cookies['ts_sign_ree'],
					timestamp,
				})
				tiketHeader = {
					'tt-ticket-guard-iteration-version': 0,
					'tt-ticket-guard-version': 2,
					'tt-ticket-guard-web-version': 1,
					'tt-ticket-guard-client-data': ticketGuardData['client-data'],
					'tt-ticket-guard-public-key': ticketGuardData['public-key']
				}
			}
			

			// 构建请求头
			const headers = {
				...this.defaultHeaders,
				cookie: this.buildCookieString(cookies),
				'content-length': body.length,
				...tiketHeader
				
			}

			// 在发送 POST 请求前，先调用 begin_user_registration 接口
			// // 获取更新后的 cookies（包含响应头 Set-Cookie 中的新 cookies）
			// const updatedCookies = await this.callBeginUserRegistration(
			// 	cookies,
			// 	options,
			// 	curlSdk,
			// 	userAgent,
			// 	timestamp
			// )
			// Log.info('updatedCookiesupdatedCookiesupdatedCookies:', updatedCookies)

			// // 使用更新后的 cookies（包含响应头 Set-Cookie）更新请求头
			// headers.cookie = this.buildCookieString(updatedCookies)

			// // 如果提供了回调函数，通知调用者 cookies 已更新
			// if (onCookieUpdate) {
			// 	// 找出新增或更新的 cookies
			// 	const newCookies = {}
			// 	Object.keys(updatedCookies).forEach(key => {
			// 		if (!cookies[key] || cookies[key] !== updatedCookies[key]) {
			// 			newCookies[key] = updatedCookies[key]
			// 		}
			// 	})
			// 	if (Object.keys(newCookies).length > 0) {
			// 		onCookieUpdate(newCookies)
			// 	}
			// }

			// 使用CurlHttpSdk发送请求
			const response = await curlSdk.post(url, body, headers,cookies['sessionid'])
			// 处理 Cookie 更新
			if (onCookieUpdate && response.headers['set-cookie']) {
				const newCookies = this.parseSetCookie(response.headers['set-cookie'])
				onCookieUpdate(newCookies)
			}

			Log.info(
				`[HttpClient] 响应状态: ${response.status} ${response.statusText}`
			)
			Log.info(`[HttpClient] 响应体长度: ${response.body.length} 字节`)

			// CurlHttpSdk 返回的 body 是字符串，需要转换为 Uint8Array
			return new Uint8Array(Buffer.from(response.body, 'binary'))
		} catch (error) {
			Log.error('❌ HTTP 请求失败:', error.message)
			throw error
		}
	}

	/**
	 * 构建查询字符串
	 * @param {Object} params - 参数对象
	 * @returns {string} 查询字符串
	 */
	buildQueryString(params) {
		return Object.keys(params)
			.map(
				key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`
			)
			.join('&')
	}

	/**
	 * 构建 Cookie 字符串
	 * @param {Object} cookies - Cookie 对象
	 * @returns {string} Cookie 字符串
	 */
	buildCookieString(cookies) {
		return Object.keys(cookies)
			.map(key => `${key}=${cookies[key]}`)
			.join('; ')
	}

	/**
	 * 解析 Set-Cookie 头（单个 Set-Cookie 字符串）
	 * @param {string} setCookieHeader - Set-Cookie 头字符串，例如: "cookie_name=value; Path=/; Domain=.tiktok.com; HttpOnly"
	 * @returns {Object} Cookie 对象，例如: { cookie_name: "value" }
	 */
	parseSetCookie(setCookieHeader) {
		const cookies = {}
		if (!setCookieHeader) return cookies

		// 如果传入的是对象（数组），取第一个元素
		if (
			typeof setCookieHeader === 'object' &&
			!Array.isArray(setCookieHeader)
		) {
			setCookieHeader = setCookieHeader[0]
		}

		// Set-Cookie 头的格式: "name=value; Path=/; Domain=.example.com; HttpOnly"
		// 我们只需要提取 name=value 部分
		// 用分号分割，取第一部分（name=value）
		const parts = setCookieHeader.split(';')
		console.log('parts:',parts)
		if (parts.length > 0) {
			const nameValue = parts[0].trim()
			const equalIndex = nameValue.indexOf('=')
			if (equalIndex > 0) {
				const name = nameValue.substring(0, equalIndex).trim()
				const value = nameValue.substring(equalIndex + 1).trim()
				if (name && value) {
					cookies[name] = value
				}
			}
		}
		return cookies
	}
}

/**
 * TikTok SDK 主类
 */
class TiktokSdk {
	constructor() {
		if (TiktokSdk._instance) {
			return TiktokSdk._instance
		}

		// 初始化空配置，所有参数在方法调用时传递
		this.cookies = {}
		this.headers = {}
		this.proxy = null
		this.userAgent =
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36'
		this.httpClient = HttpClient.getInstance()

		// 默认请求参数
		this.defaultParams = {
			msToken:
				'IolmGDO5xskGIyJ0hZP4GZcWHujYwihvuHbAg2IJMtIBdI_aC4Kfq_VFmcOJLzrUhS_2Pm4jFQCkzNFT93a-VxvrRPsncMIH1t81irh8sqGu9VDd5MqHxRj2mKDVOZt-lf_6-E5nsRJQaaCpLfHp_3FkRNQ=',
		}

		TiktokSdk._instance = this
	}

	/**
	 * 获取单例实例
	 * @returns {TiktokSdk} 单例实例
	 */
	static getInstance() {
		if (!TiktokSdk._instance) {
			TiktokSdk._instance = new TiktokSdk()
		}
		return TiktokSdk._instance
	}

	/**
	 * 重置单例实例（主要用于测试）
	 */
	static resetInstance() {
		TiktokSdk._instance = null
	}

	/**
	 * 更新 Cookies（已废弃，现在通过 _currentRequest 管理）
	 * @param {Object} newCookies - 新的 Cookie 对象
	 * @deprecated 使用 _currentRequest.cookies 替代
	 */
	updateCookies(newCookies) {
		// 不再直接修改单例的 cookies，而是通过 _currentRequest 管理
		if (this._currentRequest) {
			this._currentRequest.cookies = {
				...this._currentRequest.cookies,
				...newCookies,
			}
			console.log('🍪 Cookies 已更新到当前请求:', Object.keys(newCookies))
		} else {
			console.warn('⚠️ 没有当前请求上下文，无法更新 cookies')
		}
	}

	/**
	 * 更新 Headers
	 * @param {Object} newHeaders - 新的 Headers 对象
	 */
	updateHeaders(newHeaders) {
		this.headers = { ...this.headers, ...newHeaders }
		this.userAgent =
			newHeaders.user_agent || newHeaders['user-agent'] || this.userAgent

		// 更新 HttpClient 的 headers
		this.httpClient = HttpClient.getInstance()
		// 更新默认 headers
		this.httpClient.defaultHeaders = {
			...this.httpClient.defaultHeaders,
			'user-agent': this.userAgent,
			...newHeaders,
		}
	}

	/**
	 * 发送文本消息
	 * @param {string} chatId - 聊天室 ID
	 * @param {string} shortId - 短 ID
	 * @param {string} text - 消息文本
	 * @param {Object} options - 额外选项
	 * @returns {Promise<Object>} 响应数据
	 */
	async sendTextMessage(chatId, shortId, text, options = {}) {
		try {
			console.log(`📤 发送消息: "${text}" 到聊天室 ${chatId}`)

			// 从请求上下文中获取配置
			const requestContext =
				options.requestContext || this._currentRequest || {}
			const requestHeaders = requestContext.headers || {}
			const requestCookies = requestContext.cookies || {}
			const requestProxy = requestContext.proxy || options.proxy

			// 合并 headers
			const mergedHeaders = { ...requestHeaders, ...(options.headers || {}) }

			// 编码 protobuf 数据
			const protobufData = encryptSendTextMessage(
				mergedHeaders,
				text,
				chatId,
				shortId,
				options.sequenceId || 10013
			)
			const queryParams = Object.assign({
				aid: '1988',
				version_code: '1.0.0',
				app_name: 'tiktok_web',
				device_platform: 'web_pc',
				msToken: requestContext.cookies.msToken,
			})
			// 发送请求
			const responseData = await this.httpClient.post(
				'/v1/message/send',
				queryParams,
				protobufData,
				requestCookies,
				newCookies => {
					// 更新请求上下文的 cookies
					if (requestContext) {
						requestContext.cookies = {
							...requestContext.cookies,
							...newCookies,
						}
					}
				},
				{ proxy: requestProxy }
			)

			// 解码响应
			const result = decodeResponse(responseData)

			console.log(
				'📊 响应状态:',
				result.status_code === 0 ? '成功' : '失败',
				result.status_code
			)

			if (result.body && result.body.send_message_body) {
				console.log(
					'📝 服务器消息ID:',
					result.body.send_message_body.server_message_id
				)
			}

			return result
		} catch (error) {
			console.error('❌ 发送消息失败:', error.message)
			throw error
		}
	}

	/**
	 * 创建对话
	 * @param {string} uid - 用户 ID
	 * @param {string} toUid - 目标用户 ID
	 * @param {Object} options - 额外选项
	 * @returns {Promise<Object>} 响应数据
	 */
	async createConversation(uid, toUid, options = {}) {
		try {
			console.log(`👥 创建对话: ${uid} <-> ${toUid}`)

			// 从请求上下文中获取配置
			const requestContext =
				options.requestContext || this._currentRequest || {}
			const requestHeaders = requestContext.headers || {}
			const requestCookies = requestContext.cookies || {}
			const requestProxy = requestContext.proxy || options.proxy

			// 合并 headers
			const mergedHeaders = { ...requestHeaders, ...(options.headers || {}) }

			// 编码 protobuf 数据
			const protobufData = encrpytCreateConversationV2(
				mergedHeaders,
				uid,
				toUid,
				options.sequenceId || Math.floor(Math.random() * 500) + 10000
			)
			// 发送请求
			const responseData = await this.httpClient.post(
				'/v2/conversation/create',
				{
					msToken: requestContext.cookies.msToken,
				},
				protobufData,
				requestCookies,
				newCookies => {
					// 更新请求上下文的 cookies
					if (requestContext) {
						requestContext.cookies = {
							...requestContext.cookies,
							...newCookies,
						}
					}
				},
				{ proxy: requestProxy }
			)
			// 解码响应
			const result = decodeResponse(responseData)
			console.log('📊 状态码:', result.status_code)
			return result
		} catch (error) {
			console.error('❌ 创建对话失败:', error.message)
			throw error
		}
	}

	/**
	 * 获取当前 Cookies
	 * @returns {Object} Cookie 对象
	 */
	getCookies() {
		// 从当前请求中获取 cookies，如果没有则返回空对象
		if (this._currentRequest && this._currentRequest.cookies) {
			return { ...this._currentRequest.cookies }
		}
		return {}
	}

	/**
	 * 设置 Cookies（已废弃，现在通过 _currentRequest 管理）
	 * @param {Object} cookies - Cookie 对象
	 * @deprecated 使用 _currentRequest.cookies 替代
	 */
	setCookies(cookies) {
		// 不再直接修改单例的 cookies，而是通过 _currentRequest 管理
		if (this._currentRequest) {
			this._currentRequest.cookies = { ...cookies }
			console.log('🍪 Cookies 已设置到当前请求:', Object.keys(cookies))
		} else {
			console.warn('⚠️ 没有当前请求上下文，无法设置 cookies')
		}
	}

	/**
	 * 设置代理（已废弃，现在通过 _currentRequest 管理）
	 * @param {string} proxy - 代理地址，格式: http://host:port 或 https://host:port
	 * @deprecated 使用 _currentRequest.proxy 替代
	 */
	setProxy(proxy) {
		// 不再直接修改单例的 proxy，而是通过 _currentRequest 管理
		if (this._currentRequest) {
			this._currentRequest.proxy = proxy
			console.log(`🔗 代理已更新到当前请求: ${proxy}`)
		} else {
			console.warn('⚠️ 没有当前请求上下文，无法设置代理')
		}
	}

	/**
	 * 获取当前代理配置
	 * @returns {string|null} 代理地址
	 */
	getProxy() {
		// 从当前请求中获取代理，如果没有则返回 null
		if (this._currentRequest && this._currentRequest.proxy) {
			return this._currentRequest.proxy
		}
		return null
	}

}

module.exports = { TiktokSdk, HttpClient }
