/**
 * TiktokAppSdk 使用示例
 *
 * 这个文件展示了如何在外部使用 TiktokAppSdk 来发送消息
 * 可通过 `npm run example` 或 `node sdk-example.js` 运行
 */

const MessageSender = require('../services/messageSender');

async function example() {
  // 准备 Cookie 数据（可以是 JSON 字符串或对象）
  const cookieData = {"cmpl_token":"","d_ticket":"","install_id":"7552906341452449544","msToken":"-WqkjJBStIJSrgDHHfpn9P-ejYdoEF4F6TaE90nvtDEtus68b7f0Rd2vYM060BDFuYMx64qOf5SLKe5Pl3MY5S1LxUz-vIy1Syg8sIovSnc=","multi_sids":"","odin_tt":"36823acff777c3c6a3f0c94ad1c91e3c95a1765e6b710780810aaedf86de0bcfd31ec2509f7cf7d0267afafed89fbb8a60f0c30ad968ef04592dacaf4b18fde2aa662b8e30056da3b3c394684801cec2","passport_csrf_token":"","passport_csrf_token_default":"","sessionid":"","sessionid_ss":"","sid_guard":"8e550396f490b64441aa97b8a9146464%7C1764471688%7C10985308%7CMon%2C+06-Apr-2026+06%3A29%3A56+GMT","sid_tt":"8e550396f490b64441aa97b8a9146464","store-country-code":"","store-country-code-src":"","store-idc":"alisg","tt-target-idc":"","tt-target-idc-sign":"","ttreq":"1$f35d1d8458090c7648a785d09f3be1f3f5d9e9f6","uid_tt":"5c4f9bf0c392374ea62e3b5f97cdb92e66ec3a989a265df215fa4c27a8add675","uid_tt_ss":"","uid":"7237719112603452422","X-Tt-Token":"038e550396f490b64441aa97b8a914646401b46cf986006f5bac4b1e5f3b684b2605de125b81f29f3fb3ed4f512d0b3c53b35fc3d71028e24c8cdc273aa6fbee9161e3692f224192d3dba4719f6ff1c374eb17d6f024b7cb7447fc27ba0e93fb84eba--0a4e0a20a893b03844be6c180b6b68882a28a5e89d779143556c4d2d306818ee2a53c4091220c7a7cbeda3c56c43950109ad597466a8375af84ffb98ec403bd5813acdd4ef951801220674696b746f6b-3.0.1","device_id":"7541612193817757189","ts_sign_ree":"","User-Agent":"com.zhiliaoapp.musically.go/null Dalvik/2.1.0 (Linux; U; Android 10; VIVO Y17 Build/PPR1.180610.011)","device_brand":"vivo","device_type":"VIVO Y17"}

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

