const crypto = require('crypto');
const sm3 = require('sm-crypto').sm3;

/**
 * 通用加密工具函数
 * 确保与 Python 版本结果一致
 */

/**
 * 将数字转换为16进制字符串（去除0x前缀）
 */
function intToHexStr(num) {
  return num.toString(16);
}

/**
 * 8字节16进制字符串循环右移
 */
function ror64(value, shift) {
  const num = BigInt('0x' + value);
  shift = shift % 64;
  const result = ((num >> BigInt(shift)) | (num << BigInt(64 - shift))) & BigInt('0xFFFFFFFFFFFFFFFF');
  return result.toString(16).padStart(16, '0');
}

/**
 * 8字节16进制字符串左移
 */
function lsl64(value, shift) {
  const num = BigInt('0x' + value);
  const result = (num << BigInt(shift)) & BigInt('0xFFFFFFFFFFFFFFFF');
  return result.toString(16).padStart(16, '0');
}

/**
 * 8字节16进制字符串右移
 */
function lsr64(value, shift) {
  const num = BigInt('0x' + value);
  const result = (num >> BigInt(shift)) & BigInt('0xFFFFFFFFFFFFFFFF');
  return result.toString(16).padStart(16, '0');
}

/**
 * 将16进制字符串由大端序转换为小端序
 */
function bigEndianToLittle(hexStr) {
  // 确保长度至少为 16 个字符（8 字节）
  const paddedHex = hexStr.padStart(16, '0');
  const buffer = Buffer.from(paddedHex, 'hex');
  // 只取前 8 字节
  const num = buffer.readBigUInt64BE(0);
  const littleBuffer = Buffer.allocUnsafe(8);
  littleBuffer.writeBigUInt64LE(num, 0);
  return littleBuffer.toString('hex');
}

/**
 * 将16进制字符串由小端序转换为大端序
 */
function littleEndianToBig(hexStr) {
  // 确保长度至少为 16 个字符（8 字节）
  const paddedHex = hexStr.padStart(16, '0');
  const buffer = Buffer.from(paddedHex, 'hex');
  // 只取前 8 字节
  const num = buffer.readBigUInt64LE(0);
  const bigBuffer = Buffer.allocUnsafe(8);
  bigBuffer.writeBigUInt64BE(num, 0);
  return bigBuffer.toString('hex');
}

/**
 * Base64编码
 */
function toBase64(data) {
  if (typeof data === 'string') {
    data = Buffer.from(data, 'hex');
  }
  return data.toString('base64');
}

/**
 * Base64解码，返回16进制字符串
 */
function fromBase64(data) {
  return Buffer.from(data, 'base64').toString('hex');
}

/**
 * MD5哈希
 */
function md5(data) {
  if (typeof data === 'string') {
    data = Buffer.from(data, 'utf8');
  } else if (typeof data === 'object' && data.constructor.name === 'Array') {
    data = Buffer.from(data);
  }
  return crypto.createHash('md5').update(data).digest('hex');
}

/**
 * 生成4字节随机16进制数
 */
function makeRand() {
  return crypto.randomBytes(4).toString('hex');
}

/**
 * 固定长度的16进制字符串（补零）
 */
function toFixedHex(value, length = 16) {
  return value.padStart(length, '0');
}

/**
 * SM3哈希
 */
function sm3Hash(data) {
  if (typeof data === 'string') {
    // 16进制字符串（偶数长度）按字节处理
    if (data.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(data)) {
      return sm3(Buffer.from(data, 'hex'));
    }
    // 普通字符串直接按 UTF-8 处理
    return sm3(data);
  }
  if (Buffer.isBuffer(data)) {
    return sm3(data);
  }
  if (Array.isArray(data)) {
    return sm3(Buffer.from(data));
  }
  return sm3(data);
}

/**
 * PKCS7填充
 */
function pkcs7Pad(data, blockSize = 16) {
  const padding = blockSize - (data.length % blockSize);
  const padBuffer = Buffer.alloc(padding, padding);
  return Buffer.concat([data, padBuffer]);
}

/**
 * PKCS7去填充
 */
function pkcs7Unpad(data) {
  const padding = data[data.length - 1];
  return data.slice(0, data.length - padding);
}

module.exports = {
  intToHexStr,
  ror64,
  lsl64,
  lsr64,
  bigEndianToLittle,
  littleEndianToBig,
  toBase64,
  fromBase64,
  md5,
  makeRand,
  toFixedHex,
  sm3Hash,
  pkcs7Pad,
  pkcs7Unpad,
};

