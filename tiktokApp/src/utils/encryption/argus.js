const crypto = require('crypto');
const { 
  intToHexStr, 
  ror64, 
  lsr64, 
  bigEndianToLittle, 
  littleEndianToBig, 
  toBase64, 
  fromBase64, 
  md5, 
  makeRand, 
  toFixedHex,
  sm3Hash,
  pkcs7Pad
} = require('./common');

/**
 * Argus 加密算法
 * 确保与 Python 版本结果完全一致
 */

/**
 * 生成 argus 加密所需的 key
 */
function makeArgusRes1Aes3AndKey(signKey = "wC8lD4bMTxmNVwY5jSkqi3QWmrphr/58ugLko7UZgWM=", overrides = {}) {
  const part1_3 = fromBase64(signKey);
  // Python: part2 = to_fixed_hex(make_rand(),4)  # 4字节 = 8个hex字符
  // Python: res1, res3 = part2[:4], part2[4:]  # res1是前4个字符，res3是后4个字符
  const part2 = overrides.part2 || toFixedHex(makeRand(), 8); // 8个hex字符 = 4字节
  const res1 = part2.substring(0, 4); // 前4个字符
  const res3 = part2.substring(4); // 后4个字符
  
  const forSm3 = part1_3 + part2 + part1_3;
  const sm3Res = sm3Hash(forSm3);
  
  // 将 SM3 结果从大端序转换为小端序
  const res = bigEndianToLittle(sm3Res.substring(0, 16)) + 
              bigEndianToLittle(sm3Res.substring(16, 32)) + 
              bigEndianToLittle(sm3Res.substring(32, 48)) + 
              bigEndianToLittle(sm3Res.substring(48, 64));
  
  return [res1, res3, res];
}

/**
 * 生成 EOR 数据的 key 列表
 */
function makeArgusEorDataKeyList(k) {
  const s1 = BigInt('0xf2101d113b815d60');
  const s2 = BigInt('0xdefe2eec47ea29f');
  const s3 = BigInt('0x8db0dcd8e81a9b3e');
  const s4 = BigInt('0x724f232717e564c1');
  const s5 = BigInt('0xc236b3c5fb929874');
  
  for (let i = 4; i < 75; i++) {
    const k4 = BigInt('0x' + k[i - 1]);
    const k2 = BigInt('0x' + k[i - 3]);
    const k1 = BigInt('0x' + k[i - 4]);
    
    // Python: ror64(int_to_hexstr(k4), 3) - ror64 返回整数，int_to_hexstr 把整数转成 hex 字符串
    // 在 Node.js 中，ror64 返回字符串，所以需要先转换
    // 但 Python 的 ror64 接受字符串，返回整数，所以这里应该：
    // 1. k4 是 BigInt，需要转成字符串
    // 2. ror64 接受字符串，返回字符串
    // 3. 但 Python 中 ror64 返回整数，所以我们需要直接计算
    const k4Str = k4.toString(16).padStart(16, '0');
    const ror64Result = BigInt('0x' + ror64(k4Str, 3));
    const lsr64Result = BigInt('0x' + lsr64(k4Str, 3));
    const tem1 = s1 & ror64Result;
    const tem2 = s2 & lsr64Result;
    const tem3 = tem1 | tem2;
    const tem4 = k2 ^ tem3;
    const tem5 = BigInt('0xe000000000000000') ^ tem4;
    
    // Python: ror64(int_to_hexstr(tem5), 1) - tem5 是整数，int_to_hexstr 转成字符串，ror64 返回整数
    const tem5Str = tem5.toString(16).padStart(16, '0');
    const tem6 = s3 & BigInt('0x' + ror64(tem5Str, 1));
    const tem7 = s4 & BigInt('0x' + lsr64(tem5Str, 1));
    
    const shift = (i - 4) <= 0x3d ? (i - 4) : ((i - 4) % 0x3d - 1);
    // Python: lsr64(int_to_hexstr(s5), shift) - s5 是整数，int_to_hexstr 转成字符串，lsr64 返回整数
    const s5Str = s5.toString(16).padStart(16, '0');
    const tem8 = BigInt('0x' + lsr64(s5Str, shift));
    
    const tem9 = k1 ^ tem5;
    const tem10 = tem6 | tem7;
    const num = tem8 & BigInt(1);
    const tem11 = tem9 ^ tem10;
    const tem12 = BigInt('0xfffffffffffffffd') ^ num;
    const tem13 = tem11 ^ BigInt('0x9000000000000000');
    const tem14 = tem13 & tem12;
    const tem15 = tem11 | tem12;
    const k5 = (tem15 - tem14) & BigInt('0xFFFFFFFFFFFFFFFF');
    
    k.push(k5.toString(16).padStart(16, '0'));
  }
  
  return k;
}

/**
 * 单轮 EOR 运算
 */
function makeArgusEorDataRound(p1, p2, k) {
  const p2_1 = BigInt('0x' + ror64(p2, 0x38));
  const p2_2 = BigInt('0x' + ror64(p2, 0x3f));
  const p2_4 = BigInt('0x' + ror64(p2, 0x3e));
  const p2_3 = p2_1 & p2_2;
  
  const p1Num = BigInt('0x' + p1);
  const tem1 = p1Num ^ p2_3;
  const tem2 = p2_4 ^ tem1;
  const kNum = BigInt('0x' + k);
  const result = (kNum ^ tem2) & BigInt('0xFFFFFFFFFFFFFFFF');
  
  return [p2, result.toString(16).padStart(16, '0')];
}

/**
 * EOR 数据加密
 */
function makeArgusEorData(protobuf, key) {
  // PKCS7 填充
  const protobufBuffer = Buffer.from(protobuf, 'hex');
  const paddedBuffer = pkcs7Pad(protobufBuffer, 16);
  const paddedHex = paddedBuffer.toString('hex');
  
  let res = '';
  const k = [
    key.substring(0, 16),
    key.substring(16, 32),
    key.substring(32, 48),
    key.substring(48, 64)
  ];
  
  const keyList = makeArgusEorDataKeyList([...k]);
  
  for (let i = 0; i < paddedHex.length / 32; i++) {
    let p1 = littleEndianToBig(paddedHex.substring(i * 32, i * 32 + 16));
    let p2 = littleEndianToBig(paddedHex.substring(i * 32 + 16, i * 32 + 32));
    
    for (let j = 0; j < 72; j++) {
      [p1, p2] = makeArgusEorDataRound(p1, p2, keyList[j]);
    }
    
    res += toFixedHex(p1, 16) + toFixedHex(p2, 16);
  }
  
  return res;
}

/**
 * AES 数据加密
 */
function makeArgusAesData(eor1, eor2, aes3, p14_1, overrides = {}) {
  let res = '';
  
  // 第一个字节固定为 0xec
  res += 'ec';
  
  // 生成随机字符串（与 Python: to_fixed_hex(make_rand(),4) 保持一致）
  const randStr = overrides.randStr || toFixedHex(makeRand(), 4);
  
  // 计算 x18
  const p14Num = BigInt('0x' + p14_1);
  // Python: x18 = to_fixed_hex(int_to_hexstr( ... >> 32), 4)
  const x18Value = (((p14Num & BigInt(0x3f)) << BigInt(0x2e)) |
                     BigInt('0x1800000000000000') | 
                     BigInt('0x100000000000') | 
                    BigInt('0x100000000')) >> BigInt(32);
  const x18 = toFixedHex(intToHexStr(Number(x18Value & BigInt(0xffffffff))), 4);
  
  res += littleEndianToBig(x18 + randStr);
  
  // 倒序遍历 eor1 进行异或
  const eor2Num = BigInt('0x' + eor2);
  const blocks = Math.floor(eor1.length / 32);
  for (let i = blocks - 1; i >= 0; i--) {
    const blockStart = i * 32;
    const hex1 = ((BigInt('0x' + eor1.substring(blockStart, blockStart + 8)) ^ eor2Num) & BigInt('0xFFFFFFFF')).toString(16).padStart(8, '0');
    const hex2 = ((BigInt('0x' + eor1.substring(blockStart + 8, blockStart + 16)) ^ eor2Num) & BigInt('0xFFFFFFFF')).toString(16).padStart(8, '0');
    const hex3 = ((BigInt('0x' + eor1.substring(blockStart + 16, blockStart + 24)) ^ eor2Num) & BigInt('0xFFFFFFFF')).toString(16).padStart(8, '0');
    const hex4 = ((BigInt('0x' + eor1.substring(blockStart + 24, blockStart + 32)) ^ eor2Num) & BigInt('0xFFFFFFFF')).toString(16).padStart(8, '0');
    
    res += hex3 + hex4 + hex1 + hex2;
  }
  
  res += eor2 + eor2;
  res += aes3;
  
  // 生成 malloc_addr
  const mallocAddr = overrides.mallocAddr !== undefined
    ? overrides.mallocAddr
    : Math.floor(Math.random() * (0x7b0c6fffff - 0x7b0c611111 + 1)) + 0x7b0c611111;
  
  // 填充模式
  const resBytes = Buffer.from(res.substring(0, 16), 'hex');
  let xorSum = 0;
  for (let i = 0; i < 8; i++) {
    xorSum ^= resBytes[i];
  }
  
  res += intToHexStr((mallocAddr >> 0x16) & 0xff).padStart(2, '0') +
         intToHexStr((mallocAddr >> 0x14) & 0xff).padStart(2, '0') +
         intToHexStr((mallocAddr >> 0x12) & 0xff).padStart(2, '0') +
         intToHexStr((mallocAddr >> 0x10) & 0xff).padStart(2, '0') +
         intToHexStr((mallocAddr >> 0xe) & 0xff).padStart(2, '0') +
         intToHexStr((mallocAddr >> 0xc) & 0xff).padStart(2, '0') +
         intToHexStr((mallocAddr >> 0xa) & 0xff).padStart(2, '0') +
         intToHexStr((mallocAddr >> 0x8) & 0xff).padStart(2, '0') +
         intToHexStr((mallocAddr >> 0x6) & 0xff).padStart(2, '0') +
         intToHexStr((mallocAddr >> 0x4) & 0xff).padStart(2, '0') +
         intToHexStr((mallocAddr >> 0x2) & 0xff).padStart(2, '0') +
         intToHexStr(xorSum).padStart(2, '0') + '0d';
  
  return res;
}

/**
 * AES 加密
 */
function makeArgusAes(data, signKey) {
  const hexKey = Buffer.from(signKey, 'base64').toString('hex');
  const key = md5(Buffer.from(hexKey.substring(0, 32), 'hex'));
  const iv = md5(Buffer.from(hexKey.substring(32, 64), 'hex'));
  
  const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(key, 'hex'), Buffer.from(iv, 'hex'));
  cipher.setAutoPadding(false);
  
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  return encrypted.toString('hex');
}

/**
 * 主函数：生成 argus
 */
function makeArgus(protobuf, p14_1, signKey = "wC8lD4bMTxmNVwY5jSkqi3QWmrphr/58ugLko7UZgWM=", overrides = null) {
  const debug = overrides || {};
  const [res1, res3, key] = makeArgusRes1Aes3AndKey(signKey, debug);
  
  const eor1 = makeArgusEorData(protobuf, key);
  
  // 计算 eor2
  // Python: tem = int(res3[:2], 16)  # 前2个字符
  // Python: tem1 = int(res3[2:], 16)  # 从第2个字符开始到结尾
  // res3 应该是4个字符，所以 tem1 是后2个字符
  const tem = parseInt(res3.substring(0, 2) || '00', 16);
  const tem1 = parseInt(res3.substring(2) || '00', 16);
  // Python: eor2 = int_to_hexstr((~((((tem << 0xb) | (tem1)) ^ (tem >> 5)) ^ tem | 0)) & 0xffffffff)
  // 注意：JavaScript 的 ~ 操作符会产生负数，需要转换为无符号整数
  let eor2Value = (~((((tem << 0xb) | tem1) ^ (tem >> 5)) ^ tem | 0)) >>> 0; // >>> 0 转换为无符号32位整数
  eor2Value = eor2Value & 0xffffffff; // 确保是32位
  // 确保转换为无符号整数，避免负数
  if (eor2Value < 0) {
    eor2Value = eor2Value + 0x100000000;
  }
  const eor2 = eor2Value.toString(16).padStart(8, '0');
  
  const aesData = makeArgusAesData(eor1, eor2, res3, p14_1, debug);
  const res2 = makeArgusAes(Buffer.from(aesData, 'hex'), signKey);
  
  const forBase64 = res1 + res2;
  const argus = toBase64(Buffer.from(forBase64, 'hex'));
  
  return argus;
}

function makeArgusDebug(protobuf, p14_1, signKey = "wC8lD4bMTxmNVwY5jSkqi3QWmrphr/58ugLko7UZgWM=", overrides = null) {
  const debug = overrides || {};
  const [res1, res3, key] = makeArgusRes1Aes3AndKey(signKey, debug);
  const eor1 = makeArgusEorData(protobuf, key);
  const tem = parseInt(res3.substring(0, 2) || '00', 16);
  const tem1 = parseInt(res3.substring(2) || '00', 16);
  let eor2Value = (~((((tem << 0xb) | tem1) ^ (tem >> 5)) ^ tem | 0)) >>> 0;
  eor2Value = eor2Value & 0xffffffff;
  if (eor2Value < 0) {
    eor2Value += 0x100000000;
  }
  const eor2 = eor2Value.toString(16).padStart(8, '0');
  const aesData = makeArgusAesData(eor1, eor2, res3, p14_1, debug);
  const res2 = makeArgusAes(Buffer.from(aesData, 'hex'), signKey);
  const argus = toBase64(Buffer.from(res1 + res2, 'hex'));
  return {
    res1,
    res3,
    key,
    eor1,
    eor2,
    aes_data: aesData,
    res2,
    argus,
  };
}

module.exports = {
  makeArgus,
  makeArgusDebug,
  makeArgusRes1Aes3AndKey,
  makeArgusEorData,
  makeArgusAes,
};

