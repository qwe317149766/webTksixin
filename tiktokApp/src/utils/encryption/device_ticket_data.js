const crypto = require('crypto');
const { ec: EC } = require('elliptic');

const ec = new EC('p256'); // Same curve as SECP256R1

function formatKeyPair(keyPair) {
  const privHex = keyPair.getPrivate('hex').padStart(64, '0');
  const uncompressed = Buffer.from(keyPair.getPublic().encode('hex', false), 'hex');
  const ttPublicKeyB64 = uncompressed.toString('base64');

  return {
    privHex,
    ttPublicKeyB64,
    keyPair,
  };
}

function generateDeltaKeypair() {
  const keyPair = ec.genKeyPair();
  return formatKeyPair(keyPair);
}

function loadKeypairFromPrivHex(privHex) {
  if (!privHex) {
    throw new Error('privHex is required to load keypair.');
  }
  const keyPair = ec.keyFromPrivate(privHex, 'hex');
  return formatKeyPair(keyPair);
}

function deltaSign(unsigned, keyPair) {
  if (!unsigned) {
    throw new Error('unsigned string is required for signing.');
  }
  if (!keyPair) {
    throw new Error('keyPair is required for signing.');
  }

  const digest = crypto.createHash('sha256').update(unsigned, 'utf8').digest();
  const signature = keyPair.sign(digest, { canonical: true });
  const derBuffer = Buffer.from(signature.toDER());
  return derBuffer.toString('base64');
}

function base64Json(data) {
  return Buffer.from(JSON.stringify(data), 'utf8').toString('base64');
}

function buildGuard({
  deviceGuardData = {},
  cookie = {},
  path = '/aweme/v1/aweme/stats/',
  timestamp = null,
  privHex = null,
  isTicket = false,
} = {}) {
  const finalTimestamp = Number.isFinite(timestamp) ? timestamp : Math.floor(Date.now() / 1000);
  const keyPair = privHex ? loadKeypairFromPrivHex(privHex) : generateDeltaKeypair();

  if (!isTicket) {
    const deviceToken = deviceGuardData.device_token;
    const dtokenSign = deviceGuardData.dtoken_sign;

    if (!deviceToken || !dtokenSign) {
      throw new Error('deviceGuardData must include device_token and dtoken_sign for device guard mode.');
    }

    const unsigned = `device_token=${deviceToken}&path=${path}&timestamp=${finalTimestamp}`;
    const dreqSignB64 = deltaSign(unsigned, keyPair.keyPair);

    const guardPayload = {
      device_token: deviceToken,
      timestamp: finalTimestamp,
      req_content: 'device_token,path,timestamp',
      dtoken_sign: dtokenSign,
      dreq_sign: dreqSignB64,
    };

    return {
      'tt-device-guard-iteration-version': '1',
      'tt-ticket-guard-public-key': keyPair.ttPublicKeyB64,
      'tt-ticket-guard-version': '3',
      'tt-device-guard-client-data': base64Json(guardPayload),
    };
  }
  
  const xTtToken = cookie['x-tt-token'] || cookie['x_tt_token'] || cookie['X-Tt-Token'];
  const tsSign = cookie.ts_sign_ree || cookie['ts_sign_ree'] || cookie.ts_sign || cookie['ts_sign'] || cookie['tsSign'];
  console.log('tsSign:',tsSign)
  console.log('xTtToken:',xTtToken)
  if (!xTtToken || !tsSign) {
    throw new Error('cookie must include x-tt-token and ts_sign for ticket mode.');
  }

  const unsigned = `${xTtToken}&path=${path}&timestamp=${finalTimestamp}`;
  const reqSign = deltaSign(unsigned, keyPair.keyPair);

  const ticketPayload = {
    req_content: 'ticket,path,timestamp',
    req_sign: reqSign,
    timestamp: finalTimestamp,
    ts_sign: tsSign,
  };

  return {
    'tt-ticket-guard-client-data': base64Json(ticketPayload),
    'tt-ticket-guard-iteration-version': '0',
    'tt-ticket-guard-public-key': keyPair.ttPublicKeyB64,
    'tt-ticket-guard-version': '3',
  };
}

module.exports = {
  generateDeltaKeypair,
  loadKeypairFromPrivHex,
  deltaSign,
  buildGuard,
};

