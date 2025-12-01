const crypto = require('crypto');
const { sm3Hash } = require('./common');
const zlib = require('zlib');

// CRC32 查找表
const crcTable = [];
for (let i = 0; i < 256; i++) {
  let crc = i;
  for (let j = 0; j < 8; j++) {
    crc = (crc & 1) ? (crc >>> 1) ^ 0xEDB88320 : (crc >>> 1);
  }
  crcTable[i] = crc;
}

/**
 * hex26 相关工具函数
 * 参考 Python 版本的 make_hex26_1.py 和 argus_hex26_2.py
 */

/**
 * sub_960bc 函数
 * 对四字节 hex 进行位操作
 */
function sub960bc(wmzHex) {
  let res = '';
  for (let i = 0; i < wmzHex.length / 2; i++) {
    const byte = parseInt(wmzHex.substring(i * 2, i * 2 + 2), 16);
    const tem = ((byte & 0xaa) >> 1) | ((byte & 0x55) << 1);
    const result = (((tem & 0xcc) >> 2) | ((tem & 0x33) << 2)) & 0xff;
    res += result.toString(16).padStart(2, '0');
  }
  return res;
}

function reverseEachByte(hexStr) {
  return hexStr
    .match(/.{2}/g)
    .map(byte => byte[1] + byte[0])
    .join('');
}

/**
 * make_hex26_1
 * 根据 seed_encode_type 计算 seed_endcode_hex
 */
function makeHex26_1(seedEncodeType, queryString, xSsStub) {
  const randd = '423A35C7';
  let res = '';
  
  if (seedEncodeType === 1) {
    // 对 query_string 做 md5 并取前四字节
    const partOne = crypto.createHash('md5').update(queryString, 'utf8').digest('hex').substring(0, 8);
    // 对 x-ss-stub 做 md5 并取前四字节
    const xSsStubBytes = Buffer.from(xSsStub || '00'.repeat(16), 'hex');
    const partTwo = crypto.createHash('md5').update(xSsStubBytes).digest('hex').substring(0, 8);
    // 对 00000001 做 md5 并取其前四字节
    const partThree = crypto.createHash('md5').update(Buffer.from('00000001', 'hex')).digest('hex').substring(0, 8);
    res = partOne + partTwo + partThree;
    
  } else if (seedEncodeType === 2) {
    // 对 query_string 做 md5、取其前四字节并转换每个字节的大小端序
    const md5Query = crypto.createHash('md5').update(queryString, 'utf8').digest('hex').substring(0, 8);
    const partOne = reverseEachByte(md5Query);
    
    const md5X = crypto.createHash('md5').update(Buffer.from(xSsStub || '00'.repeat(16), 'hex')).digest('hex').substring(0, 8);
    const partTwo = reverseEachByte(md5X);
    
    const md5_01 = crypto.createHash('md5').update(Buffer.from('00000001', 'hex')).digest('hex').substring(0, 8);
    const partThree = reverseEachByte(md5_01);
    
    res = partOne + partTwo + partThree;
    
  } else if (seedEncodeType === 3) {
    // 对 query_string 做 md5、并在逐字节与 0x5a 进行异或后取其前四字节
    const md5Query = crypto.createHash('md5').update(queryString, 'utf8').digest('hex').substring(0, 8);
    const partOne = md5Query.match(/.{2}/g).map(b => (parseInt(b, 16) ^ 0x5a).toString(16).padStart(2, '0')).join('');
    
    const md5X = crypto.createHash('md5').update(Buffer.from(xSsStub || '00'.repeat(16), 'hex')).digest('hex').substring(0, 8);
    const partTwo = md5X.match(/.{2}/g).map(b => (parseInt(b, 16) ^ 0x5a).toString(16).padStart(2, '0')).join('');
    
    const md5_01 = crypto.createHash('md5').update(Buffer.from('00000001', 'hex')).digest('hex').substring(0, 8);
    const partThree = md5_01.match(/.{2}/g).map(b => (parseInt(b, 16) ^ 0x5a).toString(16).padStart(2, '0')).join('');
    
    res = partOne + partTwo + partThree;
    
  } else if (seedEncodeType === 4) {
    // 对 query_string 做 md5,然后取其前四字节参与后面运算并转换每单个字节的大小端序
    const md5Query = crypto.createHash('md5').update(queryString, 'utf8').digest('hex').substring(0, 8);
    const after960bc = sub960bc(md5Query);
    const partOne = reverseEachByte(after960bc);
    
    const md5X = crypto.createHash('md5').update(Buffer.from(xSsStub || '00'.repeat(16), 'hex')).digest('hex').substring(0, 8);
    const after960bc2 = sub960bc(md5X);
    const partTwo = reverseEachByte(after960bc2);
    
    const md5_01 = crypto.createHash('md5').update(Buffer.from('00000001', 'hex')).digest('hex').substring(0, 8);
    const after960bc3 = sub960bc(md5_01);
    const partThree = reverseEachByte(after960bc3);
    
    res = partOne + partTwo + partThree;
    
  } else if (seedEncodeType === 5) {
    // 对 query_string 做 sm3,并取最后4字节
    const partOne = sm3Hash(queryString).substring(sm3Hash(queryString).length - 8);
    
    // 对 x-ss-stub 做 sm3,并取最后4字节
    const partTwo = sm3Hash(xSsStub || '00'.repeat(16)).substring(sm3Hash(xSsStub || '00'.repeat(16)).length - 8);
    
    // 对 00000001 做 sm3,并取最后四字节
    const partThree = sm3Hash('00000001').substring(sm3Hash('00000001').length - 8);
    
    res = partOne + partTwo + partThree;
    
  } else if (seedEncodeType === 6) {
    // 对 randd 做 md5 取前8字节作为 aes 的 key、后8字节作为 aes 的 iv
    // 注意：这里的 key 和 iv 都是当成 utf8 去处理的
    const md5Randd = crypto.createHash('md5').update(Buffer.from(randd, 'hex')).digest('hex');
    const key = Buffer.from(md5Randd.substring(0, 16), 'utf8');
    const iv = Buffer.from(md5Randd.substring(16, 32), 'utf8');
    
    // PKCS7 填充函数
    function pkcs7Pad(data, blockSize) {
      const padLen = blockSize - (data.length % blockSize);
      return Buffer.concat([data, Buffer.alloc(padLen, padLen)]);
    }
    
    // 对 query_string 做 AES-OFB
    const cipher1 = crypto.createCipheriv('aes-128-ofb', key, iv);
    const padded1 = pkcs7Pad(Buffer.from(queryString, 'utf8'), 16);
    const encrypted1 = Buffer.concat([cipher1.update(padded1), cipher1.final()]);
    const partOne = encrypted1.toString('hex').substring(encrypted1.length * 2 - 8);
    
    // 对 x-ss-stub 做 AES-OFB（每次使用新的 cipher 实例）
    const cipher2 = crypto.createCipheriv('aes-128-ofb', key, iv);
    const xSsStubBytes = Buffer.from(xSsStub || '00'.repeat(16), 'hex');
    const padded2 = pkcs7Pad(xSsStubBytes, 16);
    const encrypted2 = Buffer.concat([cipher2.update(padded2), cipher2.final()]);
    const partTwo = encrypted2.toString('hex').substring(encrypted2.length * 2 - 8);
    
    // 对 00000001 做 AES-OFB
    const cipher3 = crypto.createCipheriv('aes-128-ofb', key, iv);
    const data3 = Buffer.from('00000001', 'hex');
    const padded3 = pkcs7Pad(data3, 16);
    const encrypted3 = Buffer.concat([cipher3.update(padded3), cipher3.final()]);
    const partThree = encrypted3.toString('hex').substring(encrypted3.length * 2 - 8);
    
    res = partOne + partTwo + partThree;
    
  } else if (seedEncodeType === 7) {
    // 对 query_string 做 sha256,并将其结果的每个字节与 0x5a 进行异或后取全四字节
    const sha256Query = crypto.createHash('sha256').update(queryString, 'utf8').digest('hex');
    const partOne = sha256Query.match(/.{2}/g).slice(0, 4).map(b => (parseInt(b, 16) ^ 0x5a).toString(16).padStart(2, '0')).join('');
    
    // 对 x-ss-stub 做 md5 并取最后4字节
    const partTwo = crypto.createHash('md5').update(Buffer.from(xSsStub || '00'.repeat(16), 'hex')).digest('hex').substring(24);
    
    // 对 00000001 做 rc4(key 为 md5(randd).encode("utf-8))参与后面的计算并在最后转换每个字节的大小端序得到四字节
    const rc4Key = crypto.createHash('md5').update(Buffer.from(randd, 'hex')).digest('hex');
    // Python: ARC4.new(hashlib.md5(bytes.fromhex(randd)).hexdigest().encode("utf-8")).encrypt(bytes.fromhex('00000001')).hex()
    // 注意：key 是 hexdigest 的字符串，需要 encode("utf-8")
    let partThree;
    try {
      // 尝试使用 RC4（如果支持）
      const rc4 = crypto.createCipheriv('rc4', Buffer.from(rc4Key, 'utf8'), Buffer.alloc(0));
      const ciphertext = Buffer.concat([rc4.update(Buffer.from('00000001', 'hex')), rc4.final()]).toString('hex');
      const after960bc = sub960bc(ciphertext);
      partThree = reverseEachByte(after960bc.substring(0, 8));
    } catch (e) {
      // 如果 RC4 不支持，使用简单的 RC4 实现
      // 这是一个简化的 RC4 实现，用于兼容性
      const key = Buffer.from(rc4Key, 'utf8');
      const data = Buffer.from('00000001', 'hex');
      const s = [];
      for (let i = 0; i < 256; i++) {
        s[i] = i;
      }
      let j = 0;
      for (let i = 0; i < 256; i++) {
        j = (j + s[i] + key[i % key.length]) % 256;
        [s[i], s[j]] = [s[j], s[i]];
      }
      let i = 0;
      j = 0;
      let ciphertext = '';
      for (let k = 0; k < data.length; k++) {
        i = (i + 1) % 256;
        j = (j + s[i]) % 256;
        [s[i], s[j]] = [s[j], s[i]];
        const keystreamByte = s[(s[i] + s[j]) % 256];
        ciphertext += (data[k] ^ keystreamByte).toString(16).padStart(2, '0');
      }
      const after960bc = sub960bc(ciphertext);
      partThree = reverseEachByte(after960bc.substring(0, 8));
    }
    
    res = partOne + partTwo + partThree;
    
  } else if (seedEncodeType === 8) {
    // 对 query_string 做 sha1,接着将结果的每个字节与 0x5a 进行异或后取前四字节
    const sha1Query = crypto.createHash('sha1').update(queryString, 'utf8').digest('hex');
    const partOne = sha1Query.match(/.{2}/g).slice(0, 4).map(b => (parseInt(b, 16) ^ 0x5a).toString(16).padStart(2, '0')).join('');
    
    // 对 x-sss-stub 做 crc32 取其校验和参与后面的计算并转换每个字节的大小端序得到四字节
    // 使用简单的 CRC32 实现（如果 crc-32 包不可用）
    let crcVal;
    try {
      const crc32 = require('crc-32');
      crcVal = crc32.buf(Buffer.from(xSsStub || '00'.repeat(16), 'hex'));
    } catch (e) {
      // 简单的 CRC32 实现
      const data = Buffer.from(xSsStub || '00'.repeat(16), 'hex');
      crcVal = 0xFFFFFFFF;
      for (let i = 0; i < data.length; i++) {
        crcVal = (crcVal >>> 8) ^ crcTable[(crcVal ^ data[i]) & 0xFF];
      }
      crcVal = (crcVal ^ 0xFFFFFFFF) >>> 0;
    }
    const standardCrc = (crcVal >>> 0).toString(16).padStart(8, '0');
    const after960bc = sub960bc(standardCrc);
    const partTwo = reverseEachByte(after960bc.substring(0, 8));
    
    // 对 00000001 做 sha256 之后转换每个字节的大小端序并取前四字节
    const sha256_01 = crypto.createHash('sha256').update(Buffer.from('00000001', 'hex')).digest('hex');
    const partThree = reverseEachByte(sha256_01.substring(0, 8));
    
    res = partOne + partTwo + partThree;
  }
  
  // 最后处理：与 randdd 异或并反转
  const randdd = Buffer.from(randd, 'hex').reverse().toString('hex');
  let ans = '';
  for (let i = 0; i < res.length / 2; i++) {
    const resByte = parseInt(res.substring(i * 2, i * 2 + 2), 16);
    const randddByte = parseInt(randdd.substring((i % 4) * 2, (i % 4) * 2 + 2), 16);
    ans += (resByte ^ randddByte).toString(16).padStart(2, '0');
  }
  
  // 反转整个字符串
  let anss = '';
  for (let i = ans.length / 2 - 1; i >= 0; i--) {
    anss += ans.substring(i * 2, i * 2 + 2);
  }
  
  return anss;
}

/**
 * make_hex26_2
 * 根据 p14 和 p13 计算 algorithmData1
 */
function makeHex26_2(p14Hex, p13Hex) {
  // 将 p14 和 p13 转换为小端序的 32 位整数数组
  const sm1 = [];
  for (let i = 0; i < p14Hex.length; i += 8) {
    const bytes = Buffer.from(p14Hex.substring(i, i + 8), 'hex');
    sm1.push(bytes.readUInt32LE(0));
  }
  
  const sm2 = [];
  for (let i = 0; i < p13Hex.length; i += 8) {
    const bytes = Buffer.from(p13Hex.substring(i, i + 8), 'hex');
    sm2.push(bytes.readUInt32LE(0));
  }
  
  // 调用 make_half 函数
  const res1 = makeHalf(sm1);
  const res2 = makeHalf(sm2);
  
  return res1 + res2;
}

/**
 * make_half 函数
 * 这是一个复杂的位运算函数，从 argus_hex26_2.py 完整移植
 * 完整的实现在 make_half.js 文件中
 */
const makeHalf = require('./make_half');

module.exports = {
  makeHex26_1,
  makeHex26_2
};

