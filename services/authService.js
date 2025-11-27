// 使用鉴权 Redis（远程服务器）进行 token 验证
const { authRedis } = require('../config/redis');
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
    //token进行md5
    console.log('token:', token);
    const hashToken = crypto.createHash('md5').update(token).digest('hex');
    console.log('${TOKEN_PREFIX}${hashToken}',`${TOKEN_PREFIX}${hashToken}`)
    // 使用鉴权 Redis 获取 token 信息
    const data = await authRedis.get(`${TOKEN_PREFIX}${hashToken}`);
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

