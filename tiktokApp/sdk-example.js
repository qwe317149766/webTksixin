/**
 * TiktokAppSdk 使用示例
 *
 * 这个文件展示了如何在外部使用 TiktokAppSdk 来发送消息
 * 可通过 `npm run example` 或 `node sdk-example.js` 运行
 */

const MessageSender = require('../services/messageSender');

async function example() {
  // 准备 Cookie 数据（可以是 JSON 字符串或对象）
  const cookieData = {"install_id":"7579830394175063863","ttreq":"1$ca76f9f3e674838860ded072cf5525bd2d7b633f","passport_csrf_token":"2571ac5295b2fc6b0f6d1164046aaf5f","passport_csrf_token_default":"2571ac5295b2fc6b0f6d1164046aaf5f","cmpl_token":"AgQQAPNSF-RPsLkOGT9tc10081FuQPyVv4_ZYKNIBA","d_ticket":"4d8e69101ff5a0f9fc04381d401a2d41a4ba3","multi_sids":"7579830408917910541%3A242b5cf18657e1636dfd9a0cece1e647","sessionid":"242b5cf18657e1636dfd9a0cece1e647","sessionid_ss":"242b5cf18657e1636dfd9a0cece1e647","sid_guard":"242b5cf18657e1636dfd9a0cece1e647%7C1764816992%7C15552000%7CTue%2C+02-Jun-2026+02%3A56%3A32+GMT","sid_tt":"242b5cf18657e1636dfd9a0cece1e647","uid_tt":"35bb93dc7e21b5f45e8bda9da72599f564fbe17e4a64d3f02b7d83970f7acf66","uid_tt_ss":"35bb93dc7e21b5f45e8bda9da72599f564fbe17e4a64d3f02b7d83970f7acf66","msToken":"7uDaziNsz0JXoCxnrjWZeO5HDg_KAPTc1jvRncFG2OK1G3z_dBJeKLTWp5kgOvTynKJL0CtdN4HkpRDviIIogoAESvQcQj5FJWvTEap0DN99SKomobO2iymqEltV","odin_tt":"1e84f54f1377a71fdc816243b246de17b9c955b116b01b2635325ce997a448e4652a7fa2554ea508615584de9f05f5f5c0848aeef3df4e698cd0b5779e1e3f2c8d339f643d95615b18e5ad9918fdd505","store-country-code":"us","store-country-code-src":"uid","store-country-sign":"MEIEDC8OK-pHdKtIUfZWTwQgPTpn6fGIe1p0F7iunDi_ji2LkTp2QeGYY20DtfDSLQoEEDeI7YO4Pd4vULtqpKnto-s","store-idc":"useast5","tt-target-idc":"useast5","s_v_web_id":"verify_miquh6kk_EQFzOmR3_Omzv_4aCY_AulM_Nmtok1wVOJxI","username":"lddi.ofow","password":"AlkSw7445@","X-Tt-Token":"04242b5cf18657e1636dfd9a0cece1e64704ed0fb458ea8e424a4c7861059b8e8c8bfd88921f988dca0dd503351e6f2275f997aca2c0641f56e9ac6c1959c2533c743afd822c8da593015fe2fcaef774a69eb37f090823c73f42af018bdeb1cc7b793--0a4e0a20abd6a967bf842ecc86fa59e23cac26c2d0686300eaed394242f53567275133c91220d61e191f95bdbe4d159068da9466ba4835a207f8746114bbc3797631df3b161f1801220674696b746f6b-3.0.1","ts_sign_ree":"ts.1.2862940f40e44b6ce6a5e9ce5b359cc9a1bf98c2de4ae3508bbcfa2331da0be97a50e8a417df069df9a555bd16c66ef8b3639a56b642d7d8f9c881f42b9329ec","User-Agent":"Mozilla/5.0 (Linux; Android 14; PJX110 Build/UKQ1.231108.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.6613.148 Mobile Safari/537.36","uid":"7579830408917910541","device_id":"7579830247551043085","android_id":"android-d29efd2c6544070d","twofa":"5TSIMND3UF66URQ4JUXOFN6PRJGUNN2P"}

  // 示例 1: 发送简单文本消息（会自动创建会话）
  try {
    const result1 = await MessageSender.sendPrivateMessage({
      sendType: 'app',
      receiverId: '7583070846815553659', // 接收者用户ID
      messageData: 'Hello, this is a test message!', // 消息文本
      cookieObject: cookieData,
      cookiesText: JSON.stringify(cookieData),
      proxy: null,
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

