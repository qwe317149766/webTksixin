/**
 * hex26 辅助函数
 * 从 Python 的 argus_hex26_2.py 移植
 */

// 32位无符号整数运算辅助函数
function add(a, b) {
  return (a + b) >>> 0;
}

function sub(a, b) {
  return (a - b) >>> 0;
}

function mul(a, b) {
  return Math.imul(a | 0, b | 0) >>> 0;
}

function lsl(v, n) {
  return (v << n) >>> 0;
}

function lsr(v, n) {
  return (v >>> n) >>> 0;
}

function asr(v, n) {
  if (v & 0x80000000) {
    return ((v >> n) | (0xffffffff << (32 - n))) >>> 0;
  }
  return (v >> n) >>> 0;
}

function ror(v, n) {
  n = n & 0x1f;
  return ((v >>> n) | (v << (32 - n))) >>> 0;
}

function bytesXor(rc1, rc2) {
  // rc1单字节 rc2 4字节
  if (rc1 !== "") {
    return rc1 ^ (rc2 & 0xff) ^ ((rc2 >> 8) & 0xff) ^ ((rc2 >> 16) & 0xff) ^ ((rc2 >> 24) & 0xff);
  } else {
    return (rc2 & 0xff) ^ ((rc2 >> 8) & 0xff) ^ ((rc2 >> 16) & 0xff) ^ ((rc2 >> 24) & 0xff);
  }
}

module.exports = {
  add,
  sub,
  mul,
  lsl,
  lsr,
  asr,
  ror,
  bytesXor
};

