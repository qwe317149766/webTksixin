/**
 *
 * 功能: 使用密钥信息对数据进行签名
 */

const nodeCrypto = require('crypto')
const crypto = nodeCrypto.webcrypto || globalThis.crypto

if (!crypto || !crypto.subtle) {
	throw new Error(
		'Web Crypto API not available. Please use Node.js 15+ or enable webcrypto.'
	)
}

/**
 * Base64 编码
 * @param {string} str - 要编码的字符串
 * @returns {string} Base64 编码的字符串
 */
function base64Encode(str) {
	return Buffer.from(str, 'utf8').toString('base64')
}

/**
 * 二进制数据转 Base64
 * @param {Uint8Array|ArrayBuffer} data - 二进制数据
 * @returns {string} Base64 编码的字符串
 */
function binaryToBase64(data) {
	const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
	return Buffer.from(bytes).toString('base64')
}

/**
 * Base64 转二进制数据
 * @param {string} base64 - Base64 编码的字符串
 * @returns {Uint8Array} 二进制数据
 */
function base64ToBinary(base64) {
	return new Uint8Array(Buffer.from(base64, 'base64'))
}

/**
 * PEM 格式字符串转 ArrayBuffer
 * @param {string} pem - PEM 格式的密钥字符串
 * @returns {ArrayBuffer} 密钥的二进制数据
 */
function pemToArrayBuffer(pem) {
	// 移除 PEM 头部和尾部，以及换行符
	const base64 = pem
		.replace(/-----BEGIN (PRIVATE|PUBLIC) KEY-----/g, '')
		.replace(/-----END (PRIVATE|PUBLIC) KEY-----/g, '')
		.replace(/\s/g, '')

	// Base64 解码
	const bytes = base64ToBinary(base64)
	return bytes.buffer
}

/**
 * ArrayBuffer 转 Base64 字符串（用于 PEM 格式）
 * 参考源码：arrayBufferToBase64 使用 btoa(String.fromCharCode(...))
 * @param {ArrayBuffer} buffer - 密钥的二进制数据
 * @returns {string} Base64 字符串
 */
function arrayBufferToBase64(buffer) {
	const bytes = new Uint8Array(buffer)
	// 在 Node.js 中使用 Buffer，结果与 btoa 一致
	return binaryToBase64(bytes)
}

/**
 * ArrayBuffer 转 PEM 格式
 * 参考源码：arrayBufferToPem 直接拼接，不进行 64 字符换行
 * @param {ArrayBuffer} buffer - 密钥的二进制数据
 * @param {string} type - 密钥类型 ("PRIVATE KEY" | "PUBLIC KEY")
 * @returns {string} PEM 格式的密钥字符串
 */
function arrayBufferToPem(buffer, type) {
	const base64 = arrayBufferToBase64(buffer)
	// 参考源码：直接拼接，不进行 64 字符换行
	return `-----BEGIN ${type}-----\n${base64}\n-----END ${type}-----`
}

/**
 * Buffer 转 Hex 字符串
 * @param {Uint8Array|ArrayBuffer} buffer - 二进制数据
 * @returns {string} Hex 字符串
 */
function bufferToHex(buffer) {
	const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
	return Array.from(bytes)
		.map(b => b.toString(16).padStart(2, '0'))
		.join('')
}

/**
 * Hex 字符串转 Uint8Array
 * @param {string} hex - Hex 字符串
 * @returns {Uint8Array} 二进制数据
 */
function hexToBuffer(hex) {
	const bytes = new Uint8Array(hex.length / 2)
	for (let i = 0; i < hex.length; i += 2) {
		bytes[i / 2] = parseInt(hex.substr(i, 2), 16)
	}
	return bytes
}

/**
 * DER 格式签名转 hex (Web Crypto API 返回的是 DER 格式)
 * @param {ArrayBuffer} derSignature - DER 格式的签名
 * @returns {string} Hex 字符串
 */
function derSignatureToHex(derSignature) {
	const bytes = new Uint8Array(derSignature)
	return bufferToHex(bytes)
}

/**
 * 从 PEM 格式导入私钥
 * @param {string} privateKeyPem - PEM 格式的私钥
 * @returns {Promise<CryptoKey>} CryptoKey 对象
 */
async function importPrivateKeyFromPem(privateKeyPem) {
	try {
		const keyData = pemToArrayBuffer(privateKeyPem)

		const privateKey = await crypto.subtle.importKey(
			'pkcs8', // 格式
			keyData, // 密钥数据
			{
				name: 'ECDSA',
				namedCurve: 'P-256', // SECP256R1
			},
			true, // extractable
			['sign'] // usages
		)

		return privateKey
	} catch (error) {
		console.error('[error] Failed to import private key:', error)
		throw error
	}
}

/**
 * 从 PEM 格式导入公钥
 * @param {string} publicKeyPem - PEM 格式的公钥
 * @returns {Promise<CryptoKey>} CryptoKey 对象
 */
async function importPublicKeyFromPem(publicKeyPem) {
	try {
		const keyData = pemToArrayBuffer(publicKeyPem)

		const publicKey = await crypto.subtle.importKey(
			'spki', // 格式
			keyData, // 密钥数据
			{
				name: 'ECDSA',
				namedCurve: 'P-256', // SECP256R1
			},
			true, // extractable
			['verify'] // usages
		)

		return publicKey
	} catch (error) {
		console.error('[error] Failed to import public key:', error)
		throw error
	}
}

/**
 * 导出私钥为 PEM 格式
 * @param {CryptoKey} privateKey - 私钥 CryptoKey 对象
 * @returns {Promise<string>} PEM 格式的私钥字符串
 */
async function exportPrivateKey(privateKey) {
	try {
		const keyData = await crypto.subtle.exportKey('pkcs8', privateKey)
		return arrayBufferToPem(keyData, 'PRIVATE KEY')
	} catch (error) {
		console.error('[error] Failed to export private key:', error)
		throw error
	}
}

/**
 * Base64 编码函数（参考源码：ib 函数）
 * 手动实现 Base64 编码，与源码保持一致
 * @param {Uint8Array} e - 要编码的字节数组
 * @returns {string} Base64 编码的字符串
 */
function base64EncodeBytes(e) {
	const base64Chars =
		'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
	const result = []

	for (let r = 0; r < e.length; r += 3) {
		const b1 = e[r] || 0
		const b2 = e[r + 1] || 0
		const b3 = e[r + 2] || 0
		const n = (b1 << 16) | (b2 << 8) | b3

		for (let i = 0; i < 4; i++) {
			if (8 * r + 6 * i <= 8 * e.length) {
				result.push(base64Chars.charAt((n >>> (6 * (3 - i))) & 63))
			} else {
				result.push('=')
			}
		}
	}

	return result.join('')
}

/**
 * 导出公钥为 PEM 格式
 * 参考源码：exportPublicKey 还会提取 publicRawKeyBase64
 * @param {CryptoKey} publicKey - 公钥 CryptoKey 对象
 * @returns {Promise<Object>} 包含 publicKeyPem 和 publicRawKeyBase64 的对象
 */
async function exportPublicKey(publicKey) {
	try {
		const keyData = await crypto.subtle.exportKey('spki', publicKey)

		// 提取最后 65 字节（未压缩公钥点：0x04 + X(32) + Y(32)）
		// 参考源码：r = new Uint8Array(t).slice(-65)
		const keyBytes = new Uint8Array(keyData)
		const rawPublicKey = keyBytes.slice(-65) // 最后 65 字节

		// 生成 publicRawKeyBase64
		// 参考源码：n = i_(this.bufferToHex(r)), publicRawKeyBase64 = ib(n)
		// 源码逻辑：hex -> Uint8Array -> base64
		// 但直接 base64 编码应该等价，为了与源码一致，我们按照源码的方式实现
		const hexString = bufferToHex(rawPublicKey)
		const hexBytes = hexToBuffer(hexString) // 相当于 i_(hexString)
		const publicRawKeyBase64 = base64EncodeBytes(hexBytes) // 相当于 ib(hexBytes)

		// 生成 PEM 格式的公钥
		const publicKeyPem = arrayBufferToPem(keyData, 'PUBLIC KEY')

		return {
			publicKeyPem,
			publicRawKeyBase64,
		}
	} catch (error) {
		console.error('[error] Failed to export public key:', error)
		throw error
	}
}

/**
 * 生成 ECDSA 密钥对
 * @returns {Promise<Object>} 包含 privateKey 和 publicKey 的对象
 */
async function generateKeyPair() {
	try {
		const keyPair = await crypto.subtle.generateKey(
			{
				name: 'ECDSA',
				namedCurve: 'P-256', // SECP256R1
			},
			true, // extractable
			['sign', 'verify'] // usages
		)

		return {
			privateKey: keyPair.privateKey,
			publicKey: keyPair.publicKey,
		}
	} catch (error) {
		console.error('[error] Failed to generate key pair:', error)
		throw error
	}
}

/**
 * 生成密钥对并导出为 PEM 格式
 * @returns {Promise<Object>} 包含 privateKeyPem、publicKeyPem 和 publicRawKeyBase64 的对象
 */
async function generateKeys() {
	try {
		const keyPair = await generateKeyPair()
		const privateKeyPem = await exportPrivateKey(keyPair.privateKey)
		const publicKeyInfo = await exportPublicKey(keyPair.publicKey)

		return {
			privateKeyPem,
			publicKeyPem: publicKeyInfo.publicKeyPem,
			publicRawKeyBase64: publicKeyInfo.publicRawKeyBase64,
			privateKey: keyPair.privateKey,
			publicKey: keyPair.publicKey,
		}
	} catch (error) {
		console.error('[error] Failed to generate keys:', error)
		throw error
	}
}

/**
 * 使用私钥对数据进行签名
 * @param {CryptoKey} privateKey - 私钥 CryptoKey 对象
 * @param {string} data - 要签名的数据
 * @returns {Promise<string>} Hex 格式的签名 (DER 格式的 hex)
 */
async function signDataWithKey(privateKey, data) {
	try {
		// 将字符串转换为 ArrayBuffer
		const encoder = new TextEncoder()
		const dataBuffer = encoder.encode(data)

		// 使用 ECDSA 和 SHA-256 进行签名
		const signature = await crypto.subtle.sign(
			{
				name: 'ECDSA',
				hash: { name: 'SHA-256' },
			},
			privateKey,
			dataBuffer
		)

		// Web Crypto API 返回的是 DER 格式的签名，转换为 hex
		return derSignatureToHex(signature)
	} catch (error) {
		console.error('[error] Failed to sign data:', error)
		throw error
	}
}

// 默认的 keysInfo（将在模块加载时自动生成密钥对）
// ticket 和 ts_sign 需要从外部传入，不自动生成
// 如果需要更新，可以使用 setKeysInfo 函数
let defaultKeysInfo = {
	crypt: {
		ec_privateKey: '',
		ec_publicKey: '',
	},
	sign: {
		ticket: '',
		ts_sign: '',
	},
}

// 初始化 keysInfo（只生成密钥对，不生成 ticket 和 ts_sign）
let keysInitialized = false

/**
 * 初始化 keysInfo（只生成密钥对）
 * ticket 和 ts_sign 需要从外部传入
 * @returns {Promise<void>}
 */
async function initializeKeysInfo() {
	if (keysInitialized) {
		return
	}

	try {
		console.log('[log] Generating key pair...')
		const keys = await generateKeys()

		defaultKeysInfo = {
			crypt: {
				ec_privateKey: keys.privateKeyPem,
				ec_publicKey: keys.publicKeyPem,
				publicRawKeyBase64: keys.publicRawKeyBase64, // 保存公钥的原始 Base64 编码
			},
			sign: {
				ticket: '', // 需要从外部传入
				ts_sign: '', // 需要从外部传入
			},
		}

		keysInitialized = true
		console.log('[log] Key pair generated successfully')
	} catch (error) {
		console.error('[error] Failed to initialize keysInfo:', error)
		throw error
	}
}

/**
 * 从签名字符串中提取字段名（用于 req_content）
 * @param {string} signData - 签名字符串，格式如 "ticket=xxx&path=xxx&timestamp=xxx"
 * @returns {string} 字段名列表，格式如 "ticket,path,timestamp"
 */
function extractReqContent(signData) {
	if (!signData) return ''
	const params = signData.split('&')
	return params.map(param => param.split('=')[0]).join(',')
}

/**
 * 使用密钥信息对数据进行签名
 * @param {string} signData - 要签名的数据（必需）
 * @param {Object} options - 必需参数
 * @param {string} options.ticket - 票据（必需）
 * @param {string} options.tsSign - 时间戳签名（必需）
 * @param {string} [options.reqContent='ticket,path,timestamp'] - 请求内容（默认值为 "ticket,path,timestamp"）
 * @param {number} [options.timestamp] - 时间戳（如果不提供，将使用当前时间戳）
 * @returns {Promise<Object|null>} 包含 client-data 和 public-key 的对象，失败时返回 null
 * @returns {string} return['client-data'] - Base64 编码的签名结果 JSON 字符串
 * @returns {string} return['public-key'] - 公钥的原始 Base64 编码
 */
async function signWithKeysInfo(signData, options = {}) {
	const {
		reqContent = 'ticket,path,timestamp',
		timestamp,
		ticket,
		tsSign,
	} = options

	// 确保 keysInfo 已初始化（自动生成密钥对）
	if (!keysInitialized) {
		await initializeKeysInfo()
	}

	// 验证必需参数
	if (!ticket) {
		console.log('[log] sign data fail: ticket is required')
		return null
	}

	if (!tsSign) {
		console.log('[log] sign data fail: ts_sign is required')
		return null
	}

	// 检查签名数据或票据是否存在
	if (!signData && !ticket) {
		console.log('[log] sign data fail: sign data and ticket is null')
		return null
	}

	try {
		// 使用自动生成的密钥对（不从外部传入）
		const cryptInfo = defaultKeysInfo.crypt || {}

		// 从加密信息中提取私钥、公钥和公钥原始 Base64 编码（自动生成的）
		const ecPrivateKey = cryptInfo.ec_privateKey
		const ecPublicKey = cryptInfo.ec_publicKey
		const publicRawKeyBase64 = cryptInfo.publicRawKeyBase64

		// 检查私钥是否存在（应该已经自动生成）
		if (!ecPrivateKey) {
			console.log(
				'[error] Private key is not available. Please ensure keys are initialized.'
			)
			return null
		}

		let cryptoKey
		try {
			cryptoKey = await importPrivateKeyFromPem(ecPrivateKey)
		} catch (error) {
			console.error(
				'[error] Failed to import private key from keysInfo:',
				error
			)
			return null
		}

		// 使用私钥对数据进行签名
		const dataToSign = signData || ticket
		console.log(
			`[request sign] before sign with: ${signData}, privateKey: ${
				ecPrivateKey ? ecPrivateKey.substring(0, 50) + '...' : 'None'
			}..., publicKey: ${
				ecPublicKey ? ecPublicKey.substring(0, 50) + '...' : 'None'
			}...`
		)

		// 调用签名方法
		const signatureHex = await signDataWithKey(cryptoKey, dataToSign)
		console.log(`[request sign] after sign: ${signatureHex}`)

		// 将签名结果转换为 base64
		const signatureBytes = hexToBuffer(signatureHex)
		const signatureBase64 = binaryToBase64(signatureBytes)
		console.log(`[request sign] after sign base64: ${signatureBase64}`)

		// 构建签名对象 (sign_obj)
		// 如果 timestamp 未提供，使用当前时间戳
		const finalTimestamp = timestamp ?? Math.floor(Date.now() / 1000)

		// reqContent 默认值为 "ticket,path,timestamp"
		const finalReqContent = reqContent

		const signObj = {
			ts_sign: tsSign,
			req_content: finalReqContent,
			req_sign: signatureBase64,
			timestamp: finalTimestamp,
		}

		// 打印加密签名信息（调试用）
		const cryptoSignInfo = {
			type: 'ECDSA-P256',
			ec_privateKey: ecPrivateKey
				? ecPrivateKey.substring(0, 50) + '...'
				: 'None...',
			ec_publicKey: ecPublicKey
				? ecPublicKey.substring(0, 50) + '...'
				: 'None...',
			ts_sign: tsSign,
			req_content: finalReqContent,
			before_sign_data: signData,
			after_sign_data: signatureHex,
			base64_sign_data: signatureBase64,
		}
		console.log('crypto sign:', JSON.stringify(cryptoSignInfo, null, 2))

		// 将 sign_obj 转换为 JSON 字符串，再编码为 base64
		// 使用紧凑格式，与 Python 的 json.dumps(sign_obj, separators=(',', ':')) 一致
		const signObjJson = JSON.stringify(signObj)
		const signObjBase64 = base64Encode(signObjJson)

		console.log(`[log] sign data success: ${signObjJson}`)
		console.log(`[log] sign_obj base64: ${signObjBase64}`)

		// 检查 publicRawKeyBase64 是否存在
		if (!publicRawKeyBase64) {
			console.log('[error] publicRawKeyBase64 is not available')
			return null
		}

		// 返回包含 client-data 和 public-key 的对象
		return {
			'client-data': signObjBase64,
			'public-key': publicRawKeyBase64,
		}
	} catch (error) {
		const errorInfo = {
			sign_data: signData || '',
			req_content: options?.reqContent || '',
			ticket: ticket || '',
			ts_sign: tsSign || '',
		}
		console.error(
			`[error] sign data with keys Info is error: ${error}, info:`,
			errorInfo
		)
		return null
	}
}
async function getDefaultBase64(){
	if (!keysInitialized) {
		await initializeKeysInfo()
	}
	const cryptInfo = defaultKeysInfo.crypt || {}
	return  cryptInfo.publicRawKeyBase64
}
// 模块加载时初始化 keysInfo（异步初始化，不阻塞模块导出）
initializeKeysInfo().catch(error => {
	console.error('[error] Failed to initialize keysInfo on module load:', error)
})

module.exports = {
	signWithKeysInfo,
	getDefaultBase64
}
