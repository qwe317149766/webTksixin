const redis = require('../config/redis');
const crypto = require('crypto');
const phpserialize = require('php-serialize');

const TOKEN_PREFIX = 'ACCESS_TOKEN:';

/**
 * 校验 token，返回 { uid, quota? ... }
 * 预期 token 信息预先写入 redis：SET auth:token:<token> '{"uid":"123","extra":...}'
 */
async function verifyToken(token) {
  if (!token || typeof token !== 'string') {
    return null;
  }

  try {
    //token进行mds
    console.log('token:', token);
    const hashToken = crypto.createHash('md5').update(token).digest('hex');
    console.log('${TOKEN_PREFIX}${hashToken}',`${TOKEN_PREFIX}${hashToken}`)
    const data = await redis.get(`${TOKEN_PREFIX}${hashToken}`);
    console.log('data:', data);
    const result = phpserialize.unserialize(data);
    if (!result || !result.uid) return null;
    return result;
  } catch (error) {
    console.error('verifyToken error:', error.message);
    return null;
  }
}

module.exports = {
  verifyToken,
};

