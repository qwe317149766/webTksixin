# TiktokAppSdk 使用文档

`TiktokAppSdk` 是一个封装了 TikTok App API 功能的 SDK，可以在外部直接调用，无需通过 HTTP 请求。项目已经移除了 Express/HTTP 服务，所有能力都通过 SDK 暴露。

## 安装

SDK 文件位于 `tiktokApp/TiktokAppSdk.js`，直接 require 即可使用。

```javascript
const { TiktokAppSdk } = require('./TiktokAppSdk');
```

## 基本使用

### 获取 SDK 实例

```javascript
const sdk = TiktokAppSdk.getInstance();
```

SDK 使用单例模式，多次调用 `getInstance()` 会返回同一个实例。

## API 方法

### 1. sendMessage - 发送私信

发送私信消息，如果未提供 `conversationId`，会自动先创建私信关系。

**参数：**

- `receiverId` (string, 必需) - 接收者用户ID
- `messageData` (string|Object, 必需) - 消息内容
  - 字符串：直接作为消息文本
  - 对象：支持以下格式
    - `{ text: '消息文本' }` 或 `{ message: '消息文本' }`
    - `{ isCard: true, ... }` - 卡片消息
    - `{ postDataHex: 'hex字符串' }` - 自定义 postData
- `cookieData` (string|Object, 必需) - Cookie数据（JSON 字符串或对象）
- `conversationId` (string, 可选) - 会话ID，如果不提供会自动创建
- `deviceId` (string, 可选) - 设备ID
- `createTime` (number, 可选) - 创建时间戳
- `queryString` (string, 可选) - 查询字符串
- `proxyConfig` (string, 可选) - 代理配置
- `seed` (string, 可选) - Seed
- `seedType` (number, 可选) - Seed类型
- `token` (string, 可选) - Token

**返回值：**

```javascript
{
  result: {
    status: 200,
    responseHex: '...',
    decoded: {...},
    json: {...}
  },
  conversationId: 'conversation_id'
}
```

**示例：**

```javascript
// 发送简单文本消息
const result = await sdk.sendMessage({
  receiverId: '9876543210',
  messageData: 'Hello, this is a test message!',
  cookieData: cookieData,
});

// 使用已有会话ID发送消息
const result = await sdk.sendMessage({
  receiverId: '9876543210',
  conversationId: 'existing_conversation_id',
  messageData: 'Another message',
  cookieData: cookieData,
});

// 发送对象格式的消息
const result = await sdk.sendMessage({
  receiverId: '9876543210',
  messageData: {
    text: 'Message with object format',
  },
  cookieData: cookieData,
});
```

### 2. createConversation - 创建私信关系（会话）

创建与指定用户的私信会话。

**参数：**

- `receiverId` (string, 必需) - 接收者用户ID
- `cookieData` (string|Object, 必需) - Cookie数据
- `deviceId` (string, 可选) - 设备ID
- `createTime` (number, 可选) - 创建时间戳
- `queryString` (string, 可选) - 查询字符串
- `proxyConfig` (string, 可选) - 代理配置
- `seed` (string, 可选) - Seed
- `seedType` (number, 可选) - Seed类型
- `token` (string, 可选) - Token

**返回值：**

```javascript
{
  conversationId: 'conversation_id',
  chatId: 'chat_id'
}
```

**示例：**

```javascript
const conversation = await sdk.createConversation({
  receiverId: '9876543210',
  cookieData: cookieData,
});

console.log('会话ID:', conversation.conversationId);
console.log('聊天ID:', conversation.chatId);
```

### 3. getSeed - 获取 Seed

获取 Seed 和 SeedType。

**参数：**

- `cookieData` (string|Object, 必需) - Cookie数据
- `deviceId` (string, 可选) - 设备ID
- `installId` (string, 可选) - Install ID
- `proxyConfig` (string, 可选) - 代理配置

**返回值：**

```javascript
{
  seed: 'seed_string',
  seedType: 2
}
```

**示例：**

```javascript
const seedResult = await sdk.getSeed({
  cookieData: cookieData,
  deviceId: '7543896640060655111',
});
```

### 4. getToken - 获取 Token

获取 Token。

**参数：**

- `cookieData` (string|Object, 必需) - Cookie数据
- `deviceId` (string, 可选) - 设备ID
- `installId` (string, 可选) - Install ID
- `proxyConfig` (string, 可选) - 代理配置

**返回值：**

```javascript
{
  token: 'token_string'
}
```

**示例：**

```javascript
const tokenResult = await sdk.getToken({
  cookieData: cookieData,
  deviceId: '7543896640060655111',
});
```

## Cookie 数据格式

Cookie 数据可以是 JSON 字符串或对象，需要包含以下字段：

```javascript
const cookieData = {
  uid: '1234567890',                    // 用户ID
  device_id: '7543896640060655111',     // 设备ID
  install_id: '7543896640060655112',    // Install ID
  sessionid: 'your_session_id',         // Session ID
  multi_sids: '1234567890:session_id', // Multi SIDs
  // ... 其他 cookie 字段
};
```

或者使用 JSON 字符串：

```javascript
const cookieData = JSON.stringify({
  uid: '1234567890',
  device_id: '7543896640060655111',
  // ...
});
```

## 完整示例

```javascript
const { TiktokAppSdk } = require('./TiktokAppSdk');

async function main() {
  const sdk = TiktokAppSdk.getInstance();

  const cookieData = {
    uid: '1234567890',
    device_id: '7543896640060655111',
    install_id: '7543896640060655112',
    sessionid: 'your_session_id',
    multi_sids: '1234567890:your_session_id',
  };

  try {
    // 发送消息（自动创建会话）
    const result = await sdk.sendMessage({
      receiverId: '9876543210',
      messageData: 'Hello from SDK!',
      cookieData: cookieData,
      proxyConfig: null, // 可选：'http://proxy.example.com:8080'
    });

    console.log('发送成功:', result);
    console.log('会话ID:', result.conversationId);
  } catch (error) {
    console.error('发送失败:', error.message);
  }
}

main();
```

## 与 tiktokWeb 的对比

`TiktokAppSdk` 与 `tiktokWeb/TiktokSdk` 类似，都是封装了 TikTok API 功能的 SDK，主要区别：

- **TiktokAppSdk**: 基于 Android App API，使用 protobuf 格式
- **TiktokWebSdk**: 基于 Web API，使用 protobuf 格式

两者都提供了 `sendMessage` 和 `createConversation` 方法，但底层实现不同。

## 注意事项

1. SDK 会自动缓存 seed 和 token，基于 cookieData 的 hash 作为 key
2. 如果未提供 `conversationId`，`sendMessage` 会自动创建会话
3. 所有方法都是异步的，需要使用 `await` 或 `.then()`
4. 错误处理：所有方法在失败时会抛出异常，需要使用 try-catch 处理

## 更多示例

查看 `sdk-example.js` 文件获取更多使用示例。

