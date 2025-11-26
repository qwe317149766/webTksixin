const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// 仅 mock 日志，避免依赖 ee-core/log
const originalLoad = Module._load;
const mockLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

Module._load = function mockedLoad(request, parent, isMain) {
  if (request === 'ee-core/log') {
    return mockLog;
  }
  return originalLoad(request, parent, isMain);
};

const { CurlHttpSdk } = require('../CurlHttpSdk');

// 还原默认 loader，避免影响其他测试
Module._load = originalLoad;

test('createConnection 为 SOCKS5 代理动态生成用户名', t => {
  const proxy = 'socks5://user:pass@127.0.0.1:1080';
  const sdk = new CurlHttpSdk({ proxy });
  const conn = sdk.createConnection(proxy);

  assert.ok(
    conn.proxyUrl.startsWith('socks5://user-conn'),
    '应当重写 SOCKS5 用户名'
  );
  assert.notEqual(conn.proxyUrl, proxy, '代理地址应与原值不同');
  assert.equal(conn.originalProxyUrl, proxy);

  sdk.destroy();
});

test('waitForSlot 在并发已满时进入队列，releaseSlot 后被唤醒', async t => {
  const sdk = new CurlHttpSdk();
  sdk.maxConcurrentRequests = 1;
  sdk.currentConcurrentRequests = 1;

  const waitPromise = sdk.waitForSlot();
  assert.equal(sdk.requestQueue.length, 1, '应当排入等待队列');

  const resolved = waitPromise.then(() => true);

  sdk.releaseSlot();

  assert.equal(
    await resolved,
    true,
    '释放槽位后等待中的请求应被唤醒'
  );
  assert.equal(sdk.requestQueue.length, 0, '队列应被清空');

  sdk.destroy();
});

test(
  '真实请求 httpbin，返回 IP 且保持 keep-alive',
  { timeout: 30000 },
  async t => {
    const sdk = new CurlHttpSdk({
      timeout: 15000,
      connectTimeout: 8000,
      headers: { 'User-Agent': 'CurlHttpSdk-Test/1.0' },
    });

    const res1 = await sdk.get('https://httpbin.org/ip');
    assert.equal(res1.status, 200, '第一次请求应成功');
    const ipInfo = await res1.json();
    assert.ok(ipInfo.origin || ipInfo.ip, '响应应包含 IP 信息');

    const res2 = await sdk.get('https://httpbin.org/get');
    assert.equal(res2.status, 200, '第二次请求也应成功');
    const connectionHeader =
      res2.headers.connection || res2.headers['connection'] || '';
    assert.ok(
      connectionHeader.toLowerCase().includes('keep-alive'),
      '响应 header 应包含 keep-alive'
    );
    const payload = await res2.json();
    assert.equal(payload.url, 'https://httpbin.org/get');

    sdk.destroy();
  }
);

