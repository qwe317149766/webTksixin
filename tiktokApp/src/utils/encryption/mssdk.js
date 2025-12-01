const crypto = require('crypto');
const zlib = require('zlib');
const { randomBytes } = require('crypto');

/**
 * MSSDK 加密/解密工具
 * 参考 Python 版本的 mssdk_endecode.py
 */

// CRC16 查找表
const word_19DED0 = [
  0, 0x1021, 0x2042, 0x3063, 0x4084, 0x50A5, 0x60C6, 0x70E7,
  0x8108, 0x9129, 0xA14A, 0xB16B, 0xC18C, 0xD1AD, 0xE1CE, 0xF1EF,
  0x1231, 0x210, 0x3273, 0x2252, 0x52B5, 0x4294, 0x72F7, 0x62D6,
  0x9339, 0x8318, 0xB37B, 0xA35A, 0xD3BD, 0xC39C, 0xF3FF, 0xE3DE,
  0x2462, 0x3443, 0x420, 0x1401, 0x64E6, 0x74C7, 0x44A4, 0x5485,
  0xA56A, 0xB54B, 0x8528, 0x9509, 0xE5EE, 0xF5CF, 0xC5AC, 0xD58D,
  0x3653, 0x2672, 0x1611, 0x630, 0x76D7, 0x66F6, 0x5695, 0x46B4,
  0xB75B, 0xA77A, 0x9719, 0x8738, 0xF7DF, 0xE7FE, 0xD79D, 0xC7BC,
  0x48C4, 0x58E5, 0x6886, 0x78A7, 0x840, 0x1861, 0x2802, 0x3823,
  0xC9CC, 0xD9ED, 0xE98E, 0xF9AF, 0x8948, 0x9969, 0xA90A, 0xB92B,
  0x5AF5, 0x4AD4, 0x7AB7, 0x6A96, 0x1A71, 0xA50, 0x3A33, 0x2A12,
  0xDBFD, 0xCBDC, 0xFBBF, 0xEB9E, 0x9B79, 0x8B58, 0xBB3B, 0xAB1A,
  0x6CA6, 0x7C87, 0x4CE4, 0x5CC5, 0x2C22, 0x3C03, 0xC60, 0x1C41,
  0xEDAE, 0xFD8F, 0xCDEC, 0xDDCD, 0xAD2A, 0xBD0B, 0x8D68, 0x9D49,
  0x7E97, 0x6EB6, 0x5ED5, 0x4EF4, 0x3E13, 0x2E32, 0x1E51, 0xE70,
  0xFF9F, 0xEFBE, 0xDFDD, 0xCFFC, 0xBF1B, 0xAF3A, 0x9F59, 0x8F78,
  0x9188, 0x81A9, 0xB1CA, 0xA1EB, 0xD10C, 0xC12D, 0xF14E, 0xE16F,
  0x1080, 0xA1, 0x30C2, 0x20E3, 0x5004, 0x4025, 0x7046, 0x6067,
  0x83B9, 0x9398, 0xA3FB, 0xB3DA, 0xC33D, 0xD31C, 0xE37F, 0xF35E,
  0x2B1, 0x1290, 0x22F3, 0x32D2, 0x4235, 0x5214, 0x6277, 0x7256,
  0xB5EA, 0xA5CB, 0x95A8, 0x8589, 0xF56E, 0xE54F, 0xD52C, 0xC50D,
  0x34E2, 0x24C3, 0x14A0, 0x481, 0x7466, 0x6447, 0x5424, 0x4405,
  0xA7DB, 0xB7FA, 0x8799, 0x97B8, 0xE75F, 0xF77E, 0xC71D, 0xD73C,
  0x26D3, 0x36F2, 0x691, 0x16B0, 0x6657, 0x7676, 0x4615, 0x5634,
  0xD94C, 0xC96D, 0xF90E, 0xE92F, 0x99C8, 0x89E9, 0xB98A, 0xA9AB,
  0x5844, 0x4865, 0x7806, 0x6827, 0x18C0, 0x8E1, 0x3882, 0x28A3,
  0xCB7D, 0xDB5C, 0xEB3F, 0xFB1E, 0x8BF9, 0x9BD8, 0xABBB, 0xBB9A,
  0x4A75, 0x5A54, 0x6A37, 0x7A16, 0xAF1, 0x1AD0, 0x2AB3, 0x3A92,
  0xFD2E, 0xED0F, 0xDD6C, 0xCD4D, 0xBDAA, 0xAD8B, 0x9DE8, 0x8DC9,
  0x7C26, 0x6C07, 0x5C64, 0x4C45, 0x3CA2, 0x2C83, 0x1CE0, 0xCC1,
  0xEF1F, 0xFF3E, 0xCF5D, 0xDF7C, 0xAF9B, 0xBFBA, 0x8FD9, 0x9FF8,
  0x6E17, 0x7E36, 0x4E55, 0x5E74, 0x2E93, 0x3EB2, 0xED1, 0x1EF0
];

/**
 * XTEA 加密/解密类
 */
class XTEA {
  constructor(key, rounds = 32) {
    if (key.length !== 16) {
      throw new Error('密钥长度必须是 16 字节');
    }
    this.rounds = rounds;
    this.delta = 0x9E3779B9;
    // 将 key 转换为大端序的 4 个 32 位整数
    this.key = [
      key.readUInt32BE(0),
      key.readUInt32BE(4),
      key.readUInt32BE(8),
      key.readUInt32BE(12)
    ];
  }

  encryptBlock(block) {
    if (block.length !== 8) {
      throw new Error('数据块长度必须是 8 字节');
    }

    let v0 = block.readUInt32BE(0);
    let v1 = block.readUInt32BE(4);
    let s = 0;

    for (let i = 0; i < this.rounds; i++) {
      v0 = (v0 + ((((v1 << 4) ^ (v1 >>> 5)) + v1) ^ (s + this.key[s & 3]))) >>> 0;
      s = (s + this.delta) >>> 0;
      v1 = (v1 + ((((v0 << 4) ^ (v0 >>> 5)) + v0) ^ (s + this.key[(s >>> 11) & 3]))) >>> 0;
    }

    const result = Buffer.allocUnsafe(8);
    result.writeUInt32BE(v0, 0);
    result.writeUInt32BE(v1, 4);
    return result;
  }

  decryptBlock(block) {
    if (block.length !== 8) {
      throw new Error('数据块长度必须是 8 字节');
    }

    let v0 = block.readUInt32BE(0);
    let v1 = block.readUInt32BE(4);
    let s = (this.delta * this.rounds) >>> 0;

    for (let i = 0; i < this.rounds; i++) {
      v1 = (v1 - ((((v0 << 4) ^ (v0 >>> 5)) + v0) ^ (s + this.key[(s >>> 11) & 3]))) >>> 0;
      s = (s - this.delta) >>> 0;
      v0 = (v0 - ((((v1 << 4) ^ (v1 >>> 5)) + v1) ^ (s + this.key[s & 3]))) >>> 0;
    }

    const result = Buffer.allocUnsafe(8);
    result.writeUInt32BE(v0, 0);
    result.writeUInt32BE(v1, 4);
    return result;
  }
}

/**
 * 生成随机数（4字节）
 */
function makeRand() {
  return randomBytes(4).toString('hex');
}

/**
 * 获取 XTEA report key
 */
function getTeaReportKey() {
  const data = Buffer.from('v05.02.00-ov-android', 'utf8');
  let w12 = 0x26000;
  let w11 = 0x280000;
  let w13 = 0x9000;
  let w17 = (w12 + (3 << 12)) & 0xFFFFFFFF;
  const w14 = 0x15000000;
  const w15 = data[2];
  const w0 = data[5];
  const w10 = data[8];
  let w16 = 0x5f00000;
  
  let w2 = (w15 << 8) & 0xFFFFFFFF;
  w17 = w2 ^ w17;
  w13 = w2 & w13;
  w2 = w12 | 0x200;
  w11 = (w11 | (w0 << 20)) & 0xFFFFFFFF;
  const w0Shifted = (w0 << 0x18) & 0xFFFFFFFF;
  w13 = w17 | w13;
  w17 = w17 & w2;
  w2 = w0Shifted & 0xfdffffff;
  const w0Masked = w0Shifted & w14;
  const w14Xor = w2 ^ w14;
  w2 = (w10 << 8) & 0xFFFFFFFF;
  const w15Shifted = (w15 << 0x10) & 0xFFFFFFFF;
  const w10Shifted = (w10 << 0x14) & 0xFFFFFFFF;
  w16 = w15Shifted ^ w16;
  const w15Masked = w15Shifted & 0xf00000;
  const w10Masked = w10Shifted & 0xfeffffff;
  const w15Or = w15Masked | w16;
  const w16Masked = w2 & 0x6000;
  const w10Or = w10Masked | 0x38000000;
  w12 = w16Masked ^ w12;
  const w10Xor = w11 ^ w10Or;
  const w11Or = w14Xor | w0Masked;
  const w14Const = 0x216249;
  const w16Const = 0x3f47825;
  const w10Xor2 = w10Xor ^ w14Const;
  
  const w14Or = w11Or | w16Const;
  const w11Masked = w11Or & 0x1000000;
  const w10Or2 = w13 | w10Xor2;
  const w11Or2 = w11Masked | 0x200000;
  const w10Sub = (w10Or2 - w17) & 0xFFFFFFFF;
  const dataFirst4Bytes = Buffer.allocUnsafe(4);
  dataFirst4Bytes.writeUInt32LE(w10Sub, 0);
  
  const w11Sub = (w14Or - w11Or2) & 0xFFFFFFFF;
  const w8 = w15Or & ~w11Sub;
  const w10And = w11Sub & ~w15Or;
  const w12Add = (w12 + w2) & 0xFFFFFFFF;
  const w8Or = w8 | w10And;
  const w10Or3 = w8Or | w12Add;
  const w8And = w8Or & w12Add;
  const w8Sub = (w10Or3 - w8And) & 0xFFFFFFFF;
  const dataSecond4Bytes = Buffer.allocUnsafe(4);
  dataSecond4Bytes.writeUInt32LE(w8Sub, 0);
  
  return Buffer.concat([dataFirst4Bytes, dataSecond4Bytes]).toString('hex');
}

/**
 * 计算 two_part (CRC16-like hash)
 */
function makeTwoPart(dataHex) {
  const data = Buffer.from(dataHex, 'hex');
  const length = data.length;
  
  if (length < 1) {
    return '00';
  }
  
  let hashVal = 0;
  
  for (let i = 0; i < length; i++) {
    const currentByte = data[i];
    const byte1OfHash = (hashVal >> 8) & 0xFF;
    const tableIndex = currentByte ^ byte1OfHash;
    const lookupValue = word_19DED0[tableIndex];
    const shiftedHash = hashVal << 8;
    const newHash = lookupValue ^ shiftedHash;
    hashVal = newHash & 0xFFFFFFFF;
  }
  
  const dataLen = length;
  let w9 = (-dataLen) & 0x7;
  let w10 = w9 ^ 7;
  w9 = (w9 << 1) & 0b111;
  let w24 = (w9 + w10) & 0xFFFFFFFF;
  w9 = (w24 + 3) & 0xFFFFFFFF;
  w9 = w24 < 0 ? w9 : w24;
  w9 = w9 & 0xFFFFFFFC;
  const w21 = (w24 - w9);
  const shift = (4 - w21) * 8;
  const result = ((hashVal << shift) & 0xFFFFFFFF) >>> shift;
  
  const resultBuffer = Buffer.allocUnsafe(w21);
  resultBuffer.writeUIntBE(result, 0, w21);
  return resultBuffer.toString('hex');
}

/**
 * 获取 XTEA key
 */
function getXTEAKey(isReport) {
  if (!isReport) {
    return '782399bdfacedead3230313030343034';
  } else {
    return getTeaReportKey() + '3230313030343034';
  }
}

/**
 * 字节异或
 */
function xorBytes(b1, b2) {
  if (b1.length !== b2.length) {
    throw new Error('字节长度必须相等');
  }
  const result = Buffer.allocUnsafe(b1.length);
  for (let i = 0; i < b1.length; i++) {
    result[i] = b1[i] ^ b2[i];
  }
  return result;
}

/**
 * CBC XTEA 加密/解密
 */
function cbcXTEAEncryptOrDecrypt(ivHex, keyHex, dataHex, isEncrypt) {
  let data = Buffer.from(dataHex, 'hex');
  
  // 填充至 8 字节的倍数
  const paddingLen = 16 - (data.length % 8);
  if (paddingLen !== 16) {
    const padding = Buffer.alloc(paddingLen, 0);
    data = Buffer.concat([data, padding]);
  }
  
  // 通过 IV 计算轮数
  const ivBytes = Buffer.from(ivHex, 'hex');
  const v14 = ivBytes.readUInt32LE(0);
  const rounds = (8 * (((2 * (v14 % 5)) & 8) | (v14 % 5))) ^ 0x20;
  
  const derivedKey = Buffer.from(keyHex, 'hex');
  const cipher = new XTEA(derivedKey, rounds);
  
  const chainingBlock = Buffer.from(ivHex, 'hex');
  const outputData = [];
  
  for (let i = 0; i < data.length; i += 8) {
    const currentBlock = data.slice(i, i + 8);
    
    if (isEncrypt) {
      const blockToEncrypt = xorBytes(currentBlock, chainingBlock);
      const encryptedBlock = cipher.encryptBlock(blockToEncrypt);
      outputData.push(encryptedBlock);
      // 更新 chaining block
      encryptedBlock.copy(chainingBlock);
    } else {
      const decryptedBlock = cipher.decryptBlock(currentBlock);
      const plaintextBlock = xorBytes(decryptedBlock, chainingBlock);
      outputData.push(plaintextBlock);
      // 更新 chaining block
      currentBlock.copy(chainingBlock);
    }
  }
  
  return Buffer.concat(outputData).toString('hex');
}

/**
 * 最后的 AES 加密
 */
function lastAesEncrypt(dataHex) {
  const data = Buffer.from(dataHex, 'hex');
  const key = Buffer.from('b8d72ddec05142948bbf2dc81d63759c', 'hex');
  const iv = Buffer.from('d6c3969582f9ac5313d39c180b54a2bc', 'hex');
  
  // PKCS7 填充
  const blockSize = 16;
  const padding = blockSize - (data.length % blockSize);
  const paddedData = Buffer.concat([
    data,
    Buffer.alloc(padding, padding)
  ]);
  
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  cipher.setAutoPadding(false);
  
  const encrypted = Buffer.concat([
    cipher.update(paddedData),
    cipher.final()
  ]);
  
  return encrypted.toString('hex');
}

/**
 * 最后的 AES 解密
 */
function lastAesDecrypt(ciphertextHex) {
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const key = Buffer.from('b8d72ddec05142948bbf2dc81d63759c', 'hex');
  const iv = Buffer.from('d6c3969582f9ac5313d39c180b54a2bc', 'hex');
  
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
  decipher.setAutoPadding(false);
  
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]);
  
  // 移除填充（兼容 PKCS7 和 000003 两种填充方式）
  const padLength = decrypted[decrypted.length - 1] * 2; // 转换为 hex 字符数
  return decrypted.slice(0, decrypted.length - decrypted[decrypted.length - 1]).toString('hex');
}

/**
 * MSSDK 加密
 */
function mssdkEncrypt(pbHex, isReport) {
  // 1. zlib 压缩
  const pbBytes = Buffer.from(pbHex, 'hex');
  const zlibRes = zlib.deflateSync(pbBytes, { level: 1 }).toString('hex');
  
  // 2. 添加长度前缀（小端序）
  const pbLength = pbHex.length / 2;
  const threePart = Buffer.allocUnsafe(4);
  threePart.writeUInt32LE(pbLength, 0);
  let zlibResWithLength = threePart.toString('hex') + zlibRes;
  
  // 3. 计算 byte_one 和 part_two
  const lastByte = parseInt(zlibRes.slice(-2), 16);
  const byteOne = ((((lastByte ^ (pbLength & 0xff)) << 1) & 0xf8) | 0x7).toString(16).padStart(2, '0');
  const partTwo = makeTwoPart(zlibResWithLength);
  const forXtea = byteOne + partTwo + zlibResWithLength;
  
  // 4. XTEA 加密
  const key = getXTEAKey(isReport);
  // IV 范围: 0xc0133eb0 - 0xc0133ebf
  const ivForByte = Math.floor(Math.random() * (0xc0133ebf - 0xc0133eb0 + 1) + 0xc0133eb0).toString(16);
  const xteaEncrypted = cbcXTEAEncryptOrDecrypt(
    ivForByte + '27042020',
    key,
    forXtea,
    true
  );
  
  // 5. 修改第一个字节
  const firstXteaByte = parseInt(xteaEncrypted.substring(0, 2), 16);
  const modifiedByte = (firstXteaByte ^ 0x3).toString(16).padStart(2, '0');
  const forAes = modifiedByte + xteaEncrypted + ivForByte;
  
  // 6. AES 加密
  const res = lastAesEncrypt(forAes);
  return res;
}

/**
 * MSSDK 解密
 */
function mssdkDecrypt(encryptedHex, isReport, isRequest) {
  // 1. 解密 AES
  const decryptedAesHex = lastAesDecrypt(encryptedHex);
  const decryptedAesBytes = Buffer.from(decryptedAesHex, 'hex');
  
  // 2. 提取 XTEA 密文和 IV
  const xteaEncryptedHex = decryptedAesBytes.slice(1, decryptedAesBytes.length - 4).toString('hex');
  const randomIvFourByte = decryptedAesBytes.slice(decryptedAesBytes.length - 4).toString('hex');
  
  // 3. 解密 XTEA
  const key = getXTEAKey(isReport);
  const decryptedXteaHex = cbcXTEAEncryptOrDecrypt(
    randomIvFourByte + '27042020',
    key,
    xteaEncryptedHex,
    false
  );
  
  // 4. 提取 zlib 数据
  let zlibResHex;
  if (isRequest) {
    zlibResHex = '7801' + decryptedXteaHex.split('7801')[1];
  } else {
    zlibResHex = '78da' + decryptedXteaHex.split('78da')[1];
  }
  
  // 5. 解压缩 zlib
  const zlibBytes = Buffer.from(zlibResHex, 'hex');
  const originalPbBytes = zlib.inflateSync(zlibBytes);
  const originalPbHex = originalPbBytes.toString('hex');
  
  return originalPbHex;
}

module.exports = {
  mssdkEncrypt,
  mssdkDecrypt,
  makeRand,
  getTeaReportKey,
  getXTEAKey
};

