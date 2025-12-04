#!/usr/bin/env node
/**
 * 批量发送私信脚本
 *
 * 使用方法：
 *   node tiktokApp/batch-send.js \
 *     --cookies-file ./cookies.txt \
 *     --receiver 1234567890 \
 *     --message "hello from sdk"
 *
 * cookies-file 中每行代表一个账号 Cookie，可以是 JSON 字符串，
 * 也可以是 `key=value; key2=value2` 的形式。
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const MessageSender = require('../services/messageSender');

// === 可根据需求修改的固定参数 ===
const DEFAULT_COOKIES_FILE = path.resolve(__dirname, 'cookies.txt');
const DEFAULT_RECEIVER_ID = '7502761795141452807';
// const DEFAULT_RECEIVER_ID = '7231173793783251965';
const DEFAULT_MESSAGE = 'Hello from batch script';
const DEFAULT_PROXY = null; // 例如 'http://127.0.0.1:8888'
// ===============================

function parseCookieLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('["') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      console.warn('JSON 解析失败，尝试按 cookie 字符串处理:', error.message);
    }
  }

  const cookieObj = {};
  trimmed.split(';').forEach(part => {
    const [rawKey, ...rawValue] = part.split('=');
    if (!rawKey || rawValue.length === 0) {
      return;
    }
    const key = rawKey.trim();
    const value = rawValue.join('=').trim();
    if (!key) return;
    cookieObj[key] = value;
  });
  return cookieObj;
}

async function readCookieLines(filePath) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`找不到 cookies 文件: ${absolutePath}`);
  }

  const lines = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(absolutePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const parsed = parseCookieLine(line);
    if (parsed && Object.keys(parsed).length > 0) {
      lines.push(parsed);
    }
  }

  if (lines.length === 0) {
    throw new Error('没有有效的 cookie 行，请检查文件内容');
  }

  return lines;
}

async function main() {
  const cookiesFile = DEFAULT_COOKIES_FILE;
  const receiverId = DEFAULT_RECEIVER_ID;
  const messageText = DEFAULT_MESSAGE;
  const proxy = DEFAULT_PROXY || null;

  const cookieList = await readCookieLines(cookiesFile);

  console.log(`共 ${cookieList.length} 个账号，将向用户 ${receiverId} 发送同一条私信。`);

  let successCount = 0;
  let failCount = 0;
  let filterPassed = 0;

  for (let index = 0; index < cookieList.length; index += 1) {
    const cookieData = cookieList[index];
    const label = cookieData.uid || cookieData.user_id || cookieData.device_id || `line-${index + 1}`;

    try {
      const result = await MessageSender.sendPrivateMessage({
        sendType: 'app',
        receiverId,
        messageData: messageText,
        cookieObject: cookieData,
        cookiesText: JSON.stringify(cookieData),
        proxy,
      });
      const status = result.code;
      const filterReason = result?.data?.filter_reason || result?.filter_reason;

      if (status === 0) {
        successCount += 1;
      }
      if (filterReason === 0) {
        filterPassed += 1;
      }

      console.log(
        `[${index + 1}/${cookieList.length}] ✅ 成功 => ${label}, ` +
        `status=${status}, filterReason=${filterReason}, conversationId=${result.conversationId || 'unknown'}`
      );
    } catch (error) {
      failCount += 1;
      console.error(`[${index + 1}/${cookieList.length}] ❌ 失败 => ${label}`, error.message);
    }
  }

  console.log('全部任务处理完成。');
  console.log(
    `status=0：${successCount}，失败：${failCount}，成功率：${((successCount / cookieList.length) * 100).toFixed(2)}%`
  );
  console.log(`filter_reason=0（未进过滤）：${filterPassed}`);
}

main().catch(error => {
  console.error('脚本执行失败:', error);
  process.exit(1);
});

