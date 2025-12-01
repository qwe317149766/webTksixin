const { md5, makeRand, toFixedHex } = require('./common');

/**
 * Gorgon 加密算法
 * 确保与 Python 版本结果完全一致
 */

/**
 * RC4 初始化
 */
function makeGorgonRc4Init(key) {
  const Sbox = Array.from({ length: 256 }, (_, i) => i);
  const keyBytes = Buffer.from(key, 'hex');
  let prevIndex = 0;
  
  function getKeyByte(idx) {
    if (0 <= idx && idx < keyBytes.length) {
      return keyBytes[idx];
    }
    return 0;
  }
  
  for (let i = 0; i < 256; i++) {
    const j = i + 7 < 0 ? i : i;
    const keyOffset = i - (j & 0xFFFFFFF8);
    const k = getKeyByte(keyOffset);
    const b = Sbox[i];
    const inner = 2 * (prevIndex | b) - (prevIndex ^ b);
    let v47 = 2 * (inner | k) - (inner ^ k);
    const temp2 = v47 >= 0 ? v47 : v47 + 255;
    let jIdx = v47 - (temp2 & 0xFFFFFF00);
    jIdx = jIdx % 256;
    Sbox[i] = Sbox[jIdx];
    prevIndex = jIdx;
  }
  
  return Sbox;
}

/**
 * RC4 加密
 */
function makeGorgonRc4(data, keyLen, Sbox) {
  const sbox = [...Sbox];
  let v55 = 0;
  let v56 = 0;
  let v57 = 0;
  
  while (true) {
    const v59 = (v56 + 1) & 0xFF;
    const temp = (v55 ^ sbox[v59]) + 2 * (v55 & sbox[v59]);
    const v62 = temp & 0xFF;
    const v63 = sbox[v62];
    sbox[v59] = v63;
    sbox[v62] = v63;
    let index = (sbox[v59] | v63) + (sbox[v59] & v63);
    index &= 0xFF;
    data[v57] ^= sbox[index];
    v57 = 2 * (v57 & 1) + (v57 ^ 1);
    v55 = v62;
    v56 = v59;
    
    if (v57 >= keyLen) {
      break;
    }
    if (v57 === 0) {
      v55 = 0;
      v56 = 0;
      v57 = 0;
    }
  }
  
  return data;
}

/**
 * 最后处理
 */
function makeGorgonLast(data) {
  let res = '';
  const dataArray = Array.from(data);
  
  for (let i = 0; i < dataArray.length; i++) {
    const nextByte = i !== dataArray.length - 1 ? dataArray[i + 1] : dataArray[0];
    dataArray[i] = ((dataArray[i] >> 4 | dataArray[i] << 4) ^ nextByte) & 0xff;
    
    const tem1 = (dataArray[i] << 1) & 0xffaa;
    const tem2 = (dataArray[i] >> 1) & 0x55;
    const tem3 = tem1 | tem2;
    const tem4 = ((tem3 << 2) & 0xffffcf) | ((tem3 >> 2) & 0x33);
    const tem5 = (tem4 >> 4) & 0xf;
    const mask = (1 << 28) - 1; // 0x0FFFFFFF
    const lsb = 4;
    let ans = (tem5 & ~(((1 << 28) - 1) << lsb)) | ((tem4 & mask) << lsb);
    ans = (ans ^ 0xffffffeb) & 0xff;
    dataArray[i] = ans;
    // Python: hex(ans).split("0x")[1] - 不添加前导零，与 Python 行为一致
    res += ans.toString(16);
  }
  
  return res;
}

/**
 * 主函数：生成 gorgon
 */
function makeGorgon(khronos = "1751607382", queryString = "", key = "4a0016a8476c0080", xSsStub = "0000000000000000000000000000000") {
  const Sbox = makeGorgonRc4Init(key);
  const md5Hash = md5(queryString);
  // Python: hex(int(khronos)).split("0x")[1] - 确保长度一致
  const khronosHex = parseInt(khronos).toString(16);
  const dataStr = md5Hash.substring(0, 8) + xSsStub.substring(0, 8) + "0000000020000205" + khronosHex;
  const data = Buffer.from(dataStr, 'hex');
  const keyLen = data.length;
  const encrypted = makeGorgonRc4(data, keyLen, Sbox);
  const lastTwenty = makeGorgonLast(encrypted);
  const res = "840480a80000" + lastTwenty;
  
  return res;
}

module.exports = {
  makeGorgon,
};

