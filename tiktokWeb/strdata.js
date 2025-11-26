/* encrypt3.mjs – full ES-module port of the Python reference */
/* eslint-disable */
/* strdata.mjs – 1-for-1 port of the Python reference */
const crypto =  require('node:crypto');

/* ── bit helpers ──────────────────────────────────────────────── */
const MASK32 = 0xFFFF_FFFF;
const u32    = x => (x >>> 0);
const rotl32 = (x, n) => u32((x << n) | (x >>> (32 - n)));

/* ── ChaCha core ──────────────────────────────────────────────── */
function q(s, a, b, c, d) {
  s[a] = u32(s[a] + s[b]);   s[d] = rotl32(s[d] ^ s[a], 16);
  s[c] = u32(s[c] + s[d]);   s[b] = rotl32(s[b] ^ s[c], 12);
  s[a] = u32(s[a] + s[b]);   s[d] = rotl32(s[d] ^ s[a],  8);
  s[c] = u32(s[c] + s[d]);   s[b] = rotl32(s[b] ^ s[c],  7);
}
function chachaBlock(st, rounds) {
  const x = st.slice();
  for (let r = 0; r < rounds; ) {
    q(x,0,4,8,12); q(x,1,5,9,13); q(x,2,6,10,14); q(x,3,7,11,15);
    if (++r >= rounds) break;
    q(x,0,5,10,15); q(x,1,6,11,12); q(x,2,7,12,13); q(x,3,4,13,14);
    ++r;
  }
  for (let i = 0; i < 16; i++) x[i] = u32(x[i] + st[i]);
  return x;
}
const bump = s => { s[12] = u32(s[12] + 1); };

/* ── tables copied verbatim from Python ───────────────────────── */
const aa = [
  73,110,149,151,103,107,13,5,4294967296,154,2718276124,211147047,2931180889,142,
  185100057,17,37,7,3212677781,217618912,16,79,4294967295,4,120,175,133,2,
  /\s*\(\)\s*{\s*\[\s*native\s+code\s*]\s*}/,600974999,200,188,14,36,3,124,156,
  2633865432,163,1451689750,3863347763,8,2157053261,112,28,138,288,258,3732962506,
  172,101,1,116,83,203,11,1196819126,1498001188,15,122,118,77,159,136,2903579748,
  147,92,12,193,6,18,10,114,32,9,0,131,128,42,2517678443,
];
const me = [
  aa[79], aa[10], aa[18], aa[37], aa[19], aa[12], aa[57], aa[42],
  aa[11], aa[14], aa[64], aa[48],
  aa[22] & Date.now(),
  crypto.randomInt(aa[8]), crypto.randomInt(aa[8]), crypto.randomInt(aa[8]),
];
const ge = [aa[56], aa[29], aa[40], aa[39]];
let   ye = aa[75];

/* ── PRNG identical to Python _rand() ─────────────────────────── */
function _rand() {
  const rf = [4294965248, 0, 4294967296, 2, 8, 11, 53, 7];
  const blk = chachaBlock(me, rf[4]);
  const t = blk[ye];
  const r = (rf[0] & blk[ye + rf[4]]) >>> rf[5];
  if (ye === rf[7]) { bump(me); ye = 0; } else ++ye;
  return (t + rf[2] * r) / 2 ** rf[6];
}

/* ── LZW (encode & decode) – byte‑for‑byte parity ─────────────── */
function lzwEncode(buf) {
  const dict = new Map(Array.from({ length: 256 }, (_, i) => [String.fromCharCode(i), i]));
  let next = 256, width = 8, bucket = 0, filled = 0, out = [];

  const flush = code => {
    bucket |= code << filled;
    filled += width;
    while (filled >= 8) { out.push(bucket & 0xFF); bucket >>= 8; filled -= 8; }
  };

  let w = '';
  for (const b of buf) {
    const c  = String.fromCharCode(b);
    const wc = w + c;
    if (dict.has(wc)) { w = wc; continue; }
    flush(dict.get(w), width);
    dict.set(wc, next++);
    if (next > (1 << width)) ++width;
    w = c;
  }
  if (w) flush(dict.get(w), width);
  if (filled) out.push(bucket & 0xFF);
  return Uint8Array.from(out);
}

function lzwDecode(bytes) {
  const dict = new Map(Array.from({ length: 256 }, (_, i) => [i, [i]]));
  let next = 256, width = 8, bucket = 0, filled = 0, idx = 0;

  const read = () => {
    while (filled < width) {
      if (idx >= bytes.length) return null;
      bucket |= bytes[idx++] << filled;
      filled += 8;
    }
    const code = bucket & ((1 << width) - 1);
    bucket >>>= width;
    filled -= width;
    return code;
  };

  const first = read(); if (first === null) return Uint8Array.of();
  let w = dict.get(first).slice(), out = [...w];

  while (true) {
    if (next === (1 << width)) ++width;        // widen before read
    const k = read(); if (k === null) break;

    let entry;
    if (dict.has(k))        entry = dict.get(k).slice();
    else if (k === next)    entry = w.concat(w[0]);
    else                    throw new Error('Corrupt LZW stream');

    out.push(...entry);
    dict.set(next++, w.concat(entry[0]));
    w = entry;
  }
  return Uint8Array.from(out);
}

/* ── ChaCha XOR helper ─────────────────────────────────────────── */
function xorChaCha(keyWords, rounds, bytes) {
  const words = new Uint32Array(Math.ceil(bytes.length / 4));
  for (let i = 0; i < bytes.length; i++) {
    words[i >>> 2] |= bytes[i] << ((i & 3) << 3);
  }
  const st = keyWords.slice();
  let off = 0;
  while (off + 16 < words.length) {
    const ks = chachaBlock(st, rounds); bump(st);
    for (let j = 0; j < 16; j++) words[off + j] ^= ks[j];
    off += 16;
  }
  const ksTail = chachaBlock(st, rounds);
  for (let j = off; j < words.length; j++) words[j] ^= ksTail[j - off];
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = (words[i >>> 2] >>> ((i & 3) << 3)) & 0xFF;
  }
}

/* ── wrapper gg6 (Python _gg6) ─────────────────────────────────── */
const gg6 = (key, rounds, txt) => {
  const st  = ge.concat(key);
  const buf = Uint8Array.from(txt, c => c.charCodeAt(0));
  xorChaCha(st, rounds, buf);
  return String.fromCharCode(...buf);
};

/* ── key maker ─────────────────────────────────────────────────── */
function makeKey() {
  const key = [], keyBytes = [];
  let acc = 0;
  for (let i = 0; i < 12; i++) {
    const num = u32(Math.floor(_rand() * 2 ** 32));
    key.push(num); acc = (acc + (num & 15)) & 15;
    keyBytes.push(num & 0xFF, (num>>>8)&0xFF, (num>>>16)&0xFF, (num>>>24)&0xFF);
  }
  return { key, keyBytes, rounds: acc + 5 };
}

/* ── custom Base‑64 ─────────────────────────────────────────────── */
const CS = 'Dkdpgh4ZKsQB80/Mfvw36XI1R25+WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe=';
const PAD = CS[64];
const INV = Object.fromEntries([...CS].map((c,i)=>[c,i]));

const b64enc = raw => {
  let out = '', i = 0;
  for (; i + 2 < raw.length; i += 3) {
    const v = (raw.charCodeAt(i)<<16)|(raw.charCodeAt(i+1)<<8)|raw.charCodeAt(i+2);
    out += CS[(v>>18)&63]+CS[(v>>12)&63]+CS[(v>>6)&63]+CS[v&63];
  }
  const rem = raw.length - i;
  if (rem) {
    const v = rem===1 ? raw.charCodeAt(i)<<16
                      : (raw.charCodeAt(i)<<16)|(raw.charCodeAt(i+1)<<8);
    out += CS[(v>>18)&63]+CS[(v>>12)&63]+(rem===1?PAD+PAD:CS[(v>>6)&63]+PAD);
  }
  return out;
};
const b64dec = str => {
  const bytes = [];
  for (let i = 0; i < str.length; i += 4) {
    const a=INV[str[i]], b=INV[str[i+1]];
    const c=str[i+2]===PAD?0:INV[str[i+2]];
    const d=str[i+3]===PAD?0:INV[str[i+3]];
    const v=(a<<18)|(b<<12)|(c<<6)|d;
    bytes.push((v>>16)&255);
    if(str[i+2]!==PAD)bytes.push((v>>8)&255);
    if(str[i+3]!==PAD)bytes.push(v&255);
  }
  return Buffer.from(bytes).toString('latin1');   // 1 char ↔ 1 byte
};

/* ── ENCRYPT ────────────────────────────────────────────────────── */
function encryptStr(plain) {
  const { key, keyBytes, rounds } = makeKey();

  /* step 1 – UTF‑8 → LZW */
  const lzwBytes = lzwEncode(Buffer.from(plain,'utf8'));
  const lzwStr   = Buffer.from(lzwBytes).toString('latin1');

  /* step 2 – ChaCha XOR */
  const cipher = gg6(key, rounds, lzwStr);

  /* step 3 – splice key bytes */
  let split = 0;
  for (const b of keyBytes) split = (split + b) % (lzwBytes.length + 1);
  for (const ch of cipher)  split = (split + ch.charCodeAt(0)) % (lzwBytes.length + 1);
  const merged = 'L' + cipher.slice(0, split) +
                 Buffer.from(keyBytes).toString('latin1') +
                 cipher.slice(split);

  /* step 4 – custom Base‑64 */
  return b64enc(merged);
}

/* ── DECRYPT ────────────────────────────────────────────────────── */
function decryptStr(token, sample = 8) {
  const raw = b64dec(token);
  if (!raw || raw[0] !== 'L') throw new Error('Malformed ciphertext');
  const merged = raw.slice(1);              // remove 'L'
  const TOTAL  = merged.length - 48;        // minus key chunk

  for (let split = 0; split <= TOTAL; split++) {
    const keyChunk = merged.slice(split, split + 48);
    if (keyChunk.length < 48) break;

    /* rebuild 12 little‑endian unsigned 32‑bit words */
    const key = [];
    for (let i = 0; i < 48; i += 4) {
      const w = (
        keyChunk.charCodeAt(i)        |
        (keyChunk.charCodeAt(i+1)<<8) |
        (keyChunk.charCodeAt(i+2)<<16)|
        (keyChunk.charCodeAt(i+3)<<24)
      ) >>> 0;            // unsigned cast
      key.push(w);
    }
    const rounds = ((key.reduce((s,w)=>s+(w&15),0)) & 15) + 5;
    if (rounds > 20) continue;

    const cipher = merged.slice(0, split) + merged.slice(split + 48);

    /* probe a tiny prefix */
    try {
      const probe = gg6(key, rounds, cipher.slice(0, sample));
      const probePlain = Buffer.from(
        lzwDecode([...probe].map(c=>c.charCodeAt(0)))
      ).toString('utf8');
      const asciiOK = [...probePlain.slice(0,32)]
        .every(ch => (ch.charCodeAt(0) > 31 && ch.charCodeAt(0) < 127)
                 || '\r\n\t'.includes(ch));
      if (!asciiOK) continue;
    } catch { continue; }

    /* full decrypt */
    const full    = gg6(key, rounds, cipher);
    const plain   = Buffer.from(
      lzwDecode([...full].map(c=>c.charCodeAt(0)))
    ).toString('utf8');
    return plain;
  }
  throw new Error('Unable to decrypt – key insertion point not found');
}

//导出
module.exports = { encryptStr, decryptStr };