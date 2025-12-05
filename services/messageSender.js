const config = require('../config');
const { sendText } = require('../tiktokWeb/TiktokApi');
const { TiktokAppSdk } = require('../tiktokApp/TiktokAppSdk');

const DEFAULT_CHANNEL =
  (config.task?.sender?.channel || 'web').toString().toLowerCase();
const DEFAULT_SOCKS5_PROXY =
  config.proxy?.socks5 || process.env.DEFAULT_SOCKS5_PROXY || '';

function resolveChannel(ck_type) {
  // if (preferred === 1 || preferred === '1') {
  //   return 'app';
  // }
  // if (preferred === 0 || preferred === '0') {
  //   return 'web';
  // }
  // if (typeof preferred === 'string') {
  //   const lower = preferred.toLowerCase();
  //   if (lower === 'app' || lower === 'web') {
  //     return lower;
  //   }
  // }
  return ck_type === 'web' ? 'web' : 'app';
}

function parseCookieString(cookieStr) {
  if (!cookieStr || typeof cookieStr !== 'string') {
    return {};
  }
  const trimmed = cookieStr.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch (err) {
      // fall through to semi-colon parsing
    }
  }

  const cookieObj = {};
  cookieStr.split(';').forEach(part => {
    const [rawKey, ...rawValue] = part.split('=');
    if (!rawKey || rawValue.length === 0) {
      return;
    }
    const key = rawKey.trim();
    if (!key) return;
    cookieObj[key] = rawValue.join('=').trim();
  });
  return cookieObj;
}

function ensureCookieObject(cookieObject, cookiesText) {
  if (cookieObject && typeof cookieObject === 'object' && !Array.isArray(cookieObject)) {
    return cookieObject;
  }
  const sourceText =
    (typeof cookieObject === 'string' && cookieObject.trim()) ||
    (typeof cookiesText === 'string' && cookiesText.trim()) ||
    '';
  if (!sourceText) {
    return {};
  }
  return parseCookieString(sourceText);
}

async function sendViaWeb(requestData) {
  console.log('requestData:',requestData,"1111")
  return sendText(requestData);
}

async function sendViaApp({ receiverId, messageData, cookieData, proxy }) {
  const sdk = TiktokAppSdk.getInstance();
  if (!cookieData || Object.keys(cookieData).length === 0) {
    throw new Error('App 发送需要有效的 cookie 数据');
  }
  const sendData = {
    receiverId,
    messageData,
    cookieData,
    proxyConfig: proxy || null,
  }
  return sdk.sendMessage(sendData);
}

async function sendPrivateMessage(options = {}) {
  const channel = resolveChannel(options.sendType);
  //const proxyToUse = options.proxy || DEFAULT_SOCKS5_PROXY || null;
  const proxyToUse = DEFAULT_SOCKS5_PROXY
  console.log('proxyToUse:',proxyToUse)
  console.log('channel:',channel)
  if (channel === 'app') {
    const cookieData = ensureCookieObject(options.cookieObject, options.cookiesText);
    const result = await sendViaApp({
      receiverId: options.receiverId,
      messageData: options.messageData ?? options.textMsg ?? '',
      cookieData,
      proxy: proxyToUse,
    });
    return { ...result, channel };
  }

  const cookieData = ensureCookieObject(options.cookieObject, options.cookiesText);
  const requestData = {
    ...(options.requestData || {}),
  };
  if (!requestData.proxy && proxyToUse) {
    requestData.proxy = proxyToUse;
  }
  console.log('options:',options)
  //createSequenceId 随机从10000到12000
  const createSequenceId = Math.floor(Math.random() * 2001) + 10000;
  const sendSequenceId = createSequenceId + 1;
  const result = await sendViaWeb({
    cookieParamsJson: cookieData,
    cookieParams: cookieData,
    toUid: options.receiverId,
    textMsg: options.messageData ?? options.textMsg ?? '',
    proxy: proxyToUse,
    device_id: cookieData.device_id,
    createSequenceId: createSequenceId,
    sendSequenceId: sendSequenceId,
  });
  return { ...result, channel };
}

module.exports = {
  sendPrivateMessage,
  resolveChannel,
};

