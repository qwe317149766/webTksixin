/**
 * TiktokAppSdk 使用示例
 *
 * 这个文件展示了如何在外部使用 TiktokAppSdk 来发送消息
 * 可通过 `npm run example` 或 `node sdk-example.js` 运行
 */

const { TiktokAppSdk } = require('./TiktokAppSdk');

async function example() {
  // 获取 SDK 实例
  const sdk = TiktokAppSdk.getInstance();

  // 准备 Cookie 数据（可以是 JSON 字符串或对象）
  const cookieData = {'ttreq': '1$b24668aeabf22d4915f26f12055e4c61c4ac5521', 'passport_csrf_token': '22f87a47a3ea9eddae9ffe435ea0158a', 'cmpl_token': '', 'd_ticket': '684c2c837934cef01c29925fec1657c7232a4', 'multi_sids': '', 'sessionid': '6ba67320f329ae35526d62819f9d7fb2', 'sid_guard': '6ba67320f329ae35526d62819f9d7fb2%7C1757346881%7C15552000%7CSat%2C+07-Mar-2026+15%3A54%3A41+GMT', 'uid_tt': '4004c847901abe1d8701af91c1cdd674c15ce4df2f7701d715287cb7a1bdd268', 'msToken': 'z0e50WIac9votR0AZIGFEXegLUjhHkNVOPv_CGo52HwNMNtpBu7x8krzg7iEfrOtJPZpY0Em6WSlwB4C19Bh69KnpF_TrOOmlB-E1gjcmVXkaDNVEq9al7BKlOFIxw==', 'odin_tt': '84396e3bf10a6a43c44029289b5827da82c7a56b58e2ed90db10e66ed03f038c10d0350a5b97500500a6a9d57b28caef088436b58030de3529260550edf84d88c249bdcf948e9c24c314a8c3122c9055', 'store-country-sign': '', 's_v_web_id': '', 'X-Tt-Token': '036ba67320f329ae35526d62819f9d7fb202853b974401daf1d19801290a87424b3801e44c07512972802e64b613054066da3e72c711d4b118ec8e76f0f660e043e0fb4ac3878e28f9c7aaf2d8b89463a79785b2b3b623109e99689a4830809dfa12e--0a4e0a20122c641cce063c1da2dcc2267134f759b00e23c3d0e8198ffb181ff729273c391220c87f46287ca9519a1ae252e655dc119425d496cb6b6c7ef1a6b2abb984fbc9c81801220674696b746f6b-3.0.0', 'ua': 'com.zhiliaoapp.musically/2024001040 Dalvik/2.1.0 (Linux; U; Android 8.1.0; HOT 40i Build/O11019)', 'device_id': '7511716005359945223', 'uid': '7381499542568682501', 'iid': '7511717612457166610', 'install_id': '7511717612457166610', 'device_type': 'Pixel', 'User-Agent': 'com.zhiliaoapp.musically/2024001040 Dalvik/2.1.0 (Linux; U; Android 8.1.0; HOT 40i Build/O11019)', 'ts_sign_ree': '', 'priv_hex': '0f90d7a44f96542b8c01cce75b0f5d9ff531026647dfca5c307b1fef55810a95'} ;

  // 示例 1: 发送简单文本消息（会自动创建会话）
  try {
    const result1 = await sdk.sendMessage({
      receiverId: '9876543236', // 接收者用户ID
      messageData: 'Hello, this is a test message!', // 消息文本
      cookieData: cookieData, // Cookie 数据
      proxyConfig: null, // 代理配置（可选）
    });
    console.log('发送成功:', result1);
    console.log('会话ID:', result1.conversationId);
  } catch (error) {
    console.error('发送失败:', error.message);
  }

  // // 示例 2: 使用已有的会话ID发送消息
  // try {
  //   const result2 = await sdk.sendMessage({
  //     receiverId: '9876543210',
  //     conversationId: 'existing_conversation_id', // 使用已有会话ID
  //     messageData: 'Another message',
  //     cookieData: cookieData,
  //   });
  //   console.log('发送成功:', result2);
  // } catch (error) {
  //   console.error('发送失败:', error.message);
  // }

  // // 示例 3: 发送对象格式的消息
  // try {
  //   const result3 = await sdk.sendMessage({
  //     receiverId: '9876543210',
  //     messageData: {
  //       text: 'Message with object format',
  //       // 或者使用 message 字段
  //       // message: 'Message with object format',
  //     },
  //     cookieData: cookieData,
  //   });
  //   console.log('发送成功:', result3);
  // } catch (error) {
  //   console.error('发送失败:', error.message);
  // }

  // // 示例 4: 先创建会话，再发送消息
  // try {
  //   // 创建会话
  //   const conversation = await sdk.createConversation({
  //     receiverId: '9876543210',
  //     cookieData: cookieData,
  //   });
  //   console.log('会话创建成功:', conversation);
  //   console.log('会话ID:', conversation.conversationId);
  //   console.log('聊天ID:', conversation.chatId);

  //   // 使用创建的会话ID发送消息
  //   const result4 = await sdk.sendMessage({
  //     receiverId: '9876543210',
  //     conversationId: conversation.conversationId,
  //     messageData: 'Message after creating conversation',
  //     cookieData: cookieData,
  //   });
  //   console.log('发送成功:', result4);
  // } catch (error) {
  //   console.error('操作失败:', error.message);
  // }

  // // 示例 5: 获取 Seed 和 Token
  // try {
  //   const seedResult = await sdk.getSeed({
  //     cookieData: cookieData,
  //     deviceId: '7543896640060655111',
  //   });
  //   console.log('Seed:', seedResult);

  //   const tokenResult = await sdk.getToken({
  //     cookieData: cookieData,
  //     deviceId: '7543896640060655111',
  //   });
  //   console.log('Token:', tokenResult);
  // } catch (error) {
  //   console.error('获取失败:', error.message);
  // }

  // // 示例 6: 使用代理发送消息
  // try {
  //   const result6 = await sdk.sendMessage({
  //     receiverId: '9876543210',
  //     messageData: 'Message with proxy',
  //     cookieData: cookieData,
  //     proxyConfig: 'http://proxy.example.com:8080', // 代理配置
  //   });
  //   console.log('发送成功:', result6);
  // } catch (error) {
  //   console.error('发送失败:', error.message);
  // }
}

// 运行示例
if (require.main === module) {
  example().catch(console.error);
}

module.exports = { example };

