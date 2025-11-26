const { TiktokSdk } = require('./TiktokSdk')
//导入buildHeadersByLang
const { buildHeadersByLang } = require('./util/helper')
function generateWindowsChromeUA() {
	const major = 130 + Math.floor(Math.random() * 11) // Chrome 版本 120~130
	const build = `${major}.0.${Math.floor(Math.random() * 5000)}.${Math.floor(Math.random() * 200)}`

	return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${build} Safari/537.36`
}
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

async function sendText(requestData) {
	let {
		cookieParams,
		toUid,
		createSequenceId,
		sendSequenceId,
		textMsg,
		proxy,
		user_agent,
		device_id,
	} = requestData
	Log.info('[MockTikTokApi] 发送消息:', requestData)

	console.log('=== TikTok SDK  ===\n')
	//解析cookies
	let cookie = {}
	if (typeof cookieParams === 'string') {
		//判断是否是json
		if(cookieParams.startsWith('{') && cookieParams.endsWith('}')){
			cookie = JSON.parse(cookieParams)
		}else{	
				cookieParams.split(';').forEach(part => {
					let [key, ...val] = part.trim().split('=')
					if (key && val.length > 0) {
						cookie[key] = val.join('=')
					}
				})
		}
	} else {
		cookie = cookieParams
	}
	console.log('cookieParams:',cookie,typeof cookie,cookie['store-country-code'])
	// process.exit()
	// 从 multi_sids 中提取 uid
	let multiSids = cookie['multi_sids']
	console.log('multi_sids:', multiSids)
	let uid = null
	if (multiSids) {
		const match = String(multiSids).match(/^(\d+)/)
		if (match) {
			uid = match[1]
			cookie.uid = uid
		}
	}
	cookie.msToken = cookie.msToken || ''
	//如果
	cookie['user-agent'] = decodeURIComponent(
		user_agent || cookie['User-Agent']
	)
	//
	Log.info(`cookie['user-agent'] `,cookie['user-agent'] )
	let requestCookies = cookie
	uid = cookie.uid
	//decice_id 如果没有则随机
	// device_id如果没有则随机
	if (!device_id && !cookie.device_id) {
		// 生成一个19位的数字字符串作为device_id 最新6开头，最大7开头
		let random = Math.floor(Math.random() * 10)
		if (random < 6) {
			device_id =
				'6' +
				String(
					Math.floor(Math.random() * 9_000_000_000_000_000_000) +
						1_000_000_000_000_000_000
				)
		} else {
			device_id =
				'7' +
				String(
					Math.floor(Math.random() * 9_000_000_000_000_000_000) +
						1_000_000_000_000_000_000
				)
		}
	}
	console.log('device_id:', device_id)
	cookie.device_id = device_id

	const userAgent = cookie['user-agent'] || generateWindowsChromeUA()
	const verifyFp = cookie['verifyFp'] || ''
	delete requestCookies['phone']
	delete requestCookies['twofa']
	delete requestCookies['uid']
	// delete requestCookies['ts_sign_ree']
	delete requestCookies['password']
	delete requestCookies['username']
	delete requestCookies['X-Tt-Token']
	delete requestCookies['User-Agent']
	delete requestCookies['user-agent']

	const sdk = new TiktokSdk()
	//先获取tzname
	let {'store-country-code': storeCountryCode} = cookie
	Log.info("storeCountryCode:",storeCountryCode)
	let builldInfo = buildHeadersByLang(storeCountryCode)
	//获取时区
	// const tzName = await sdk.getTimezoneName(proxy);
	requestCookies['tz_name'] = builldInfo.tz_name; //挂载到ck上
	Log.info('获取到的时区名称:', requestCookies['tz_name']);
	try {
		console.log('cookie.uid:', uid)
		let requestContext = {
			cookies: requestCookies,
			headers: {
				screen_width: '1920',
				screen_height: '1080',
				browser_language: builldInfo.locale,
				priority_region: 'US',
				region: 'US',
				verifyFp: verifyFp,
				user_agent: userAgent,
				browser_name: 'Mozilla',
				browser_version: userAgent.replace('Mozilla/', ''),
				history_len: '10',
				device_id: cookie.device_id,
				'Web-Sdk-Ms-Token': cookie.msToken,
				locale: builldInfo.locale,
				tz_name: builldInfo.tz_name,
				webcast_language: builldInfo.locale,
				app_language: builldInfo.locale,
			},
			proxy: proxy, // 直接传递代理配置
		}
		const conversationResult = await sdk.createConversation(
			uid, // uid
			toUid, // toUid
			{
				requestContext,
				sequenceId: createSequenceId,
			}
		)
		//获取返回值然后发送消息
		if (
			conversationResult &&
			(!conversationResult.body ||
				!conversationResult.body.create_conversation_v2_body ||
				!conversationResult.body.create_conversation_v2_body.conversation)
		) {
			return {
				code: -10001,
				msg: '账户可能已退出!',
				data: conversationResult,
			}
		}
		let { conversation_id, conversation_short_id } =
			conversationResult.body.create_conversation_v2_body.conversation
		
		let result = await sdk.sendTextMessage(
			conversation_id,
			conversation_short_id,
			textMsg,
			{
				sequenceId: sendSequenceId,
				requestContext,
			}
		)
		//判断成功
		if (
			!result.body ||
			!result.body.send_message_body ||
			!result.body.send_message_body
		) {
			return {
				code: -1,
				msg: '账户可能已退出',
				data: result,
			}
		}
		if (result.body.send_message_body.status === 0) {
			//发送成功
			return {
				code: 0,
				msg: '发送消息成功',
				data: result.body.send_message_body,
			}
		}
		let { check_message } = result.body.send_message_body
		check_message = JSON.parse(check_message)
		const status_code = check_message['status_code']
		const status_message = check_message['status_message']
		const notice_code = check_message['notice_code']
		console.log('check_message:', check_message)
		//重复发送的情况
		if (status_code == 7193) {
			return {
				code: 10001,
				msg: '重复发送', //需要更改料子的状态
				data: result,
			}
		}
		if (
			status_code == 7290 ||
			status_code == 7202 ||
			status_code == 7278 ||
			status_code == 7409
		) {
			return {
				code: 10001,
				msg: '接收者被限制',
				data: result,
			}
		}
		if (status_code == 7201) {
			return {
				code: 10004,
				msg: '发送端限制私信',
				data: result,
			}
		}
		if (status_code == 7180) {
			return {
				code: 10002,
				msg: '您发送太快了',
				data: result,
			}
		}
		if (status_code == 7195 || status_code == 7179 || status_code == 7289) {
			//
			return {
				code: -10000,
				msg: '维护社区',
				data: result,
			}
		}
		//维护社群的情况

		return {
			code: -1,
			msg: '发送消息失败',
			data: check_message,
		}
	} catch (error) {
		return {
			code: -10002,
			msg: error.message,
			data: {},
		}
	}
}

// 如果直接运行此文件，执行示例
if (require.main === module) {
	sendText()
}

module.exports = { sendText }
