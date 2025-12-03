/**
 * TiktokAppSdk 使用示例
 *
 * 这个文件展示了如何在外部使用 TiktokAppSdk 来发送消息
 * 可通过 `npm run example` 或 `node sdk-example.js` 运行
 */

const MessageSender = require('../services/messageSender');

async function example() {
  // 准备 Cookie 数据（可以是 JSON 字符串或对象）
  const cookieData = {"install_id":"7579511399026706198","ttreq":"","passport_csrf_token":"17ff336f82d04aaea3421684115d0896","passport_csrf_token_default":"17ff336f82d04aaea3421684115d0896","cmpl_token":"AgQQAPOYF-RPsLkRO-A76h0v805NrjTfv5QTYKNU6A","d_ticket":"14fd5b180e557ad9d32298cbb6519c447adab","multi_sids":"7579511201824556054%3A1a68ae60c4b6b49b3015f8b1205e132d","sessionid":"1a68ae60c4b6b49b3015f8b1205e132d","sessionid_ss":"1a68ae60c4b6b49b3015f8b1205e132d","sid_guard":"1a68ae60c4b6b49b3015f8b1205e132d%7C1764742804%7C15552000%7CMon%2C+01-Jun-2026+06%3A20%3A04+GMT","sid_tt":"1a68ae60c4b6b49b3015f8b1205e132d","uid_tt":"1d0e026a935e910124c9960e2008c10bb0d5a3d63feeac1f9ebb00996b5a1629","uid_tt_ss":"1d0e026a935e910124c9960e2008c10bb0d5a3d63feeac1f9ebb00996b5a1629","msToken":"-XlDFFgHKmnB4IZJDRIjFd5m6h0RdBWhP5py4AQzxQFUrWHP3YNooDHMAQK5n4r-4Sy350G_oe7sCYyAFZLVgdQW7NsHvAcC1f43gT62yAF1VHPYeRFEZ6zTx3-C","odin_tt":"9424d0f8eb1ddb8c383bef5805d32f376fa8ddbf70752b0fc1d421724d68338cd6b1a595d7e28fd5b1d25542234890a3190030ff0b9c6d9f4f11eb64f994d094da7a3ec3df7bd93d4431996f2bc25e46","store-country-code":"gb","store-country-code-src":"uid","store-country-sign":"MEIEDJboZTN9QyqJynkI9AQgalx2oS4xNEerNU6vPqI4a1NB6JWg3wiWEjvWqCTKji0EEK3ORY3h16cqL9wje-0j_s4","store-idc":"no1a","tt-target-idc":"eu-ttp2","s_v_web_id":"verify_mipm5m4o_VfjfyZzy_ZMRP_4HDV_8Onl_qXk63zjWpMbs","username":"user197991725518","X-Tt-Token":"051a68ae60c4b6b49b3015f8b1205e132d030c675e6d209a1ee4f3ee6fb4e1aad5f9f900eb1ba317143c1fbd74547d4d4641dd443e49f483006d6933b4246a809dd73484cae3db5ffd9a34f861b51365257722bb14b69972a9c71a804ec760703a1eb--0a4e0a2011ab89a5b48a14c6974dad16ee1935ddb4971d7e5cba07f71d714d7bbff5d92512205fd78f8eb65de722ffbf213f76fc0d65d491edc2618f88c4470fa8a0b2cc51a61801220674696b746f6b-3.0.1","ts_sign_ree":"ts.1.820c06b327221b91cd5f20e51331c962aee30a6e2ff32905066047b5c35ab48dffbefb97880bcfc2ea051a38c3c2953b235c0025934e7fa2ea2f8bec72eb8296","User-Agent":"Mozilla/5.0 (Linux; Android 12; PJX110 Build/MMB29K; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Mobile Safari/537.36","uid":"7579511201824556054","device_id":"7579510471267485206"}





  // 示例 1: 发送简单文本消息（会自动创建会话）
  try {
    const result1 = await MessageSender.sendPrivateMessage({
      sendType: 'app',
      receiverId: '7483070846815552513', // 接收者用户ID
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

