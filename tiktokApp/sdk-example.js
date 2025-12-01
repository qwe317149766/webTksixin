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
  const cookieData = {"install_id":"7561564683074357005","ttreq":"1$3ef099f4b7e9fd5b82617b3965fd078f274f28e6","passport_csrf_token":"cb48c8ee301c40d0cee321bc164a8c24","passport_csrf_token_default":"cb48c8ee301c40d0cee321bc164a8c24","cmpl_token":"AgQQAPNSF-RPsLjO_aRT8V008pGLrukT_7XZYNwk-g","d_ticket":"d93f57f4274b76e169801e02d5419909fbc27","multi_sids":"7561564681647916045%3A1108ec571bf3557c93138a3cf88bb7d2","sessionid":"1108ec571bf3557c93138a3cf88bb7d2","sessionid_ss":"1108ec571bf3557c93138a3cf88bb7d2","sid_guard":"1108ec571bf3557c93138a3cf88bb7d2%7C1760564088%7C15552000%7CMon%2C+13-Apr-2026+21%3A34%3A48+GMT","sid_tt":"1108ec571bf3557c93138a3cf88bb7d2","uid_tt":"44c2da635c74794e75c2971a5dea86d46b0f7a14b4efc0cc746c2a8f7e37178f","uid_tt_ss":"44c2da635c74794e75c2971a5dea86d46b0f7a14b4efc0cc746c2a8f7e37178f","msToken":"ME4n4H-ce_x-8g9X3cFU0PIoUXHDM72KTuIXsGtYcGNX2v-nxY0GCMGff-h4AEv-xkR62ZymZSlJ3xgQVzLk6RIa4DOX-bg39d7VlUblHHcSUw99lWSWOLMZ5_Ue","odin_tt":"c076b134d98ce2cd6ceef3809945dfcb51269534bb0472a7b85918e9001b09afa1a79a64e1c8627e2f28b57be8af9caf80b86c6e5b402f2751429ec70e92adae","store-country-code":"us","store-country-code-src":"uid","store-country-sign":"MEIEDDv1IyOmKXxIv_qKBwQghnmPrUBY5jKyOfFwHeIBqrGX-ic0R8Xp88VI2-9F400EEEeYkBhrkiSi6E-9UibLLH0","store-idc":"useast5","tt-target-idc":"useast8","s_v_web_id":"","username":"rps.ekap","password":"vjXF14966@","X-Tt-Token":"041108ec571bf3557c93138a3cf88bb7d20435772934ff82416b3bfad3468853fb2311984ed51f7db01551a40f62ef6f66a9029ab9ce16293526911daf3485efdbd3190f58266f7e365616cf28211b48359aad30c54e4eb64b3789202f54d2c2b6349--0a4e0a20a3f05ead4556bf9725bda1143992a391784f244eb0473b2fa718b30f0690857d12203705e267e82cb77f34c0005edc63cd8f962add8986247b1aac459048888893991801220674696b746f6b-3.0.1","phone":"l2tycyj@sisii.fun","url":"r2fzfr0q","ts_sign_ree":"ts.1.86196eac2cedf2e040294d516041232836d4d6b65cdf5624612ad47572f060a17a50e8a417df069df9a555bd16c66ef8b3639a56b642d7d8f9c881f42b9329ec","User-Agent":"Mozilla/5.0 (Linux; Android 12; SM-S9180 Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Mobile Safari/537.36","uid":"7561564681647916045","device_id":"7561564241057859127","twofa":""}

  // 示例 1: 发送简单文本消息（会自动创建会话）
  try {
    const result1 = await sdk.sendMessage({
      receiverId: '9876543235', // 接收者用户ID
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

