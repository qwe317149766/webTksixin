const config = require('../config');
const { sendText } = require('../tiktokWeb/TiktokApi');
const { TiktokAppSdk } = require('../tiktokApp/TiktokAppSdk');

const DEFAULT_CHANNEL =
  (config.task?.sender?.channel || 'web').toString().toLowerCase();

function resolveChannel(preferred) {
  if (preferred === 1 || preferred === '1') {
    return 'app';
  }
  if (preferred === 0 || preferred === '0') {
    return 'web';
  }
  if (typeof preferred === 'string') {
    const lower = preferred.toLowerCase();
    if (lower === 'app' || lower === 'web') {
      return lower;
    }
  }
  return DEFAULT_CHANNEL === 'app' ? 'app' : 'web';
}

function parseCookieString(cookieStr) {
  if (!cookieStr || typeof cookieStr !== 'string') {
    return {};
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

async function sendViaWeb(requestData) {
  return sendText(requestData);
}

async function sendViaApp({ receiverId, messageData, cookieData, proxy }) {
  const sdk = TiktokAppSdk.getInstance();
  if (!cookieData || Object.keys(cookieData).length === 0) {
    throw new Error('App 发送需要有效的 cookie 数据');
  }
  return sdk.sendMessage({
    receiverId,
    messageData,
    cookieData,
    proxyConfig: proxy || null,
  });
}

async function sendPrivateMessage(options = {}) {
  const channel = resolveChannel(options.sendType);
  if (channel === 'app') {
    const cookieData =
      options.cookieObject && Object.keys(options.cookieObject).length > 0
        ? options.cookieObject
        : parseCookieString(options.cookiesText || '');

    const result = await sendViaApp({
      receiverId: options.receiverId,
      messageData: options.messageData ?? options.textMsg ?? '',
      cookieData,
      proxy: options.proxy,
    });
    return { ...result, channel };
  }

  const result = await sendViaWeb(options.requestData || {});
  return { ...result, channel };
}

module.exports = {
  sendPrivateMessage,
  resolveChannel,
};

