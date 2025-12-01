const {
  md5,
  makeRand,
  toFixedHex,
  toBase64,
  bigEndianToLittle,
  littleEndianToBig,
  ror64,
} = require('./common');

const HEX_MASK_64 = BigInt('0xFFFFFFFFFFFFFFFF');

function padHex64(value) {
  return value.toString(16).padStart(16, '0');
}

/**
 * Ladon 加密算法
 * 确保与 Python 版本结果完全一致
 */

/**
 * Ladon 数据处理 1Of1
 */
function makeLadonData1Of1(aa, a0, i) {
  if (i === 0) {
    return aa;
  } else {
    // Python: a0=int(a0,16)
    // Python: tem=(ror64(aa,8)+a0)&0xffffffffffffffff
    // Python: aa=tem^(i-1)
    // Python: a0=ror64(int_to_hexstr(a0),61)^aa
    const a0Num = BigInt('0x' + a0);
    const rorResult = BigInt('0x' + ror64(aa, 8));
    const tem = (rorResult + a0Num) & BigInt('0xFFFFFFFFFFFFFFFF');
    const newAa = (tem ^ BigInt(i - 1)) & HEX_MASK_64;
    // Python 中 int_to_hexstr(a0) 是把数字转成 hex，但这里 a0 已经是字符串了
    // 所以应该是 ror64(a0, 61)
    const newA0 = (BigInt('0x' + ror64(a0, 61)) ^ newAa) & HEX_MASK_64;
    return [padHex64(newAa), padHex64(newA0)];
  }
}

/**
 * Ladon 数据处理 2Of1
 */
function makeLadonData2Of1(b0, b1) {
  const b0Num = BigInt('0x' + b0);
  const rorResult = BigInt('0x' + ror64(b1, 8));
  const tem = (b0Num + rorResult) & HEX_MASK_64;
  return padHex64(tem);
}

/**
 * Ladon 数据处理 1Of2
 */
function makeLadonData1Of2(b0) {
  return padHex64(BigInt('0x' + ror64(b0, 0x3d)));
}

/**
 * Ladon 数据处理
 */
function makeLadonData(md5Res, timeSign) {
  let res = '';
  
  // 确保 md5Res 和 timeSign 长度足够
  const md5ResPadded = md5Res.padEnd(64, '0');
  const timeSignPadded = timeSign.padEnd(64, '0');
  
  let a0 = bigEndianToLittle(md5ResPadded.substring(0, 16));
  let a1 = bigEndianToLittle(md5ResPadded.substring(16, 32));
  let a2 = bigEndianToLittle(md5ResPadded.substring(32, 48));
  let a3 = bigEndianToLittle(md5ResPadded.substring(48, 64));
  let b0 = bigEndianToLittle(timeSignPadded.substring(0, 16));
  let b1 = bigEndianToLittle(timeSignPadded.substring(16, 32));
  let b2 = bigEndianToLittle(timeSignPadded.substring(32, 48));
  let b3 = bigEndianToLittle(timeSignPadded.substring(48, 64));
  
  let aa = [a1, a2, a3];
  
  // 第一轮循环
  for (let i = 0; i < 34; i++) {
    if (i !== 0) {
      const cs = (i % 3 !== 0) ? (i % 3 - 1) : 2;
      const result = makeLadonData1Of1(aa[cs], a0, i);
      aa[cs] = result[0];
      a0 = result[1];
    }
    const tem = makeLadonData2Of1(b0, b1);
    const a0Num = BigInt('0x' + a0);
    const temNum = BigInt('0x' + tem);
    b1 = padHex64((a0Num ^ temNum) & HEX_MASK_64);
    b0 = makeLadonData1Of2(b0);
    const b0Num = BigInt('0x' + b0);
    const b1Num = BigInt('0x' + b1);
    b0 = padHex64((b0Num ^ b1Num) & HEX_MASK_64);
  }
  
  res += littleEndianToBig(b0) + littleEndianToBig(b1);
  
  // 重置 a0
  a0 = bigEndianToLittle(md5Res.substring(0, 16));
  aa = [a1, a2, a3];
  
  // 第二轮循环
  for (let i = 0; i < 34; i++) {
    if (i !== 0) {
      const cs = (i % 3 !== 0) ? (i % 3 - 1) : 2;
      const result = makeLadonData1Of1(aa[cs], a0, i);
      aa[cs] = result[0];
      a0 = result[1];
    }
    const tem = makeLadonData2Of1(b2, b3);
    const a0Num = BigInt('0x' + a0);
    const temNum = BigInt('0x' + tem);
    b3 = padHex64((a0Num ^ temNum) & HEX_MASK_64);
    b2 = makeLadonData1Of2(b2);
    const b2Num = BigInt('0x' + b2);
    const b3Num = BigInt('0x' + b3);
    b2 = padHex64((b2Num ^ b3Num) & HEX_MASK_64);
  }
  
  res += littleEndianToBig(b2) + littleEndianToBig(b3);
  
  return res;
}

/**
 * 主函数：生成 ladon
 */
function makeLadon(khronos = "1758533246", aid = "31323333", overrides = null) {
  const debug = overrides || {};
  const theFirstFour = debug.theFirstFour || makeRand();
  // Python: md5_res=md5(bytearray.fromhex(the_first_four+aid)).encode().hex()
  // md5 返回 hex 字符串，然后 .encode().hex() 是把字符串编码成字节再转 hex
  // 但在 JavaScript 中，md5 已经返回 hex，所以需要把 hex 字符串转成 Buffer 再转回 hex
  const md5Hex = md5(Buffer.from(theFirstFour + aid, 'hex'));
  // 模拟 Python 的 .encode().hex()：把 hex 字符串当作普通字符串编码
  const md5Res = Buffer.from(md5Hex, 'utf8').toString('hex');
  
  // Python: time_sign=(khronos+"-2142840551-1233").encode().hex()+"060606060606"
  const timeSign = Buffer.from(khronos + "-2142840551-1233", 'utf8').toString('hex') + "060606060606";
  
  const data = makeLadonData(md5Res, timeSign);
  const ladon = toBase64(Buffer.from(theFirstFour + data, 'hex'));
  
  if (debug.detailed) {
    return {
      theFirstFour,
      md5Res,
      timeSign,
      data,
      ladon,
    };
  }

  return ladon;
}

module.exports = {
  makeLadon,
};

