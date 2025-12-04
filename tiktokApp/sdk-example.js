/**
 * TiktokAppSdk 使用示例
 *
 * 这个文件展示了如何在外部使用 TiktokAppSdk 来发送消息
 * 可通过 `npm run example` 或 `node sdk-example.js` 运行
 */

const MessageSender = require('../services/messageSender');

async function example() {
  // 准备 Cookie 数据（可以是 JSON 字符串或对象）
  const cookieData ={"install_id":"7566114813009479438","ttreq":"1$5c84c37a8514bed6ce0d1c681463d206a1befad2","passport_csrf_token":"bd67764c8b256dce22d5226351384d12","passport_csrf_token_default":"bd67764c8b256dce22d5226351384d12","cmpl_token":"AgQQAPNSF-RPsLk-0_DAvV0O82GlwN-Iv4zZYKOZ_g","d_ticket":"f63c5868941ee6cafe51a0cf5d3427ff67e75","multi_sids":"7566114819071247415:7370e5c90bdfa06632f8e3e7f62a753a","sessionid":"7370e5c90bdfa06632f8e3e7f62a753a","sessionid_ss":"7370e5c90bdfa06632f8e3e7f62a753a","sid_guard":"7370e5c90bdfa06632f8e3e7f62a753a|1761623692|15551999|Sun,+26-Apr-2026+03:54:51+GMT","sid_tt":"7370e5c90bdfa06632f8e3e7f62a753a","uid_tt":"9c1ab6b01ebeb2314e617e7cb38c3d8638f3dad69afbe38df2348771cc225138","uid_tt_ss":"9c1ab6b01ebeb2314e617e7cb38c3d8638f3dad69afbe38df2348771cc225138","msToken":"LkL6L6QWY92Il8kjT7mVEKtmgXTBzJQO3RXyX0VQ6vovLjUCYnXCNSTLsZG4PWJBoP2JZcgq-B_XsQaOULUZ2ctB7m0pvI_DJ3DPS6njnKbhtekRXH3t6NT3HjqQ","odin_tt":"334debca5c7157f8fba2b3541fdf7788e759f59b2e5ea663a69323f3c06a39d35e9662c7c55f8d018c3a3b6add1de44a3374a3e0b9e632b9d23b11a6e77192692cd5fc5fb3028060cd0af25219c6a2fd","store-country-code":"us","store-country-code-src":"uid","store-country-sign":"MEIEDOAL61sHJ5jcIKSNggQgloj3yuJZ2IztFE2F1zYtgDCP5xaibaZB5g2ZCJMX-2oEEDHTvnf6jPJkUlOBnF-mD4Y","store-idc":"useast5","tt-target-idc":"useast5","s_v_web_id":"","username":"ymze.cpny","password":"JKhXW597@","X-Tt-Token":"047370e5c90bdfa06632f8e3e7f62a753a022ecdb7777906b8724149f2c21870070cc48e023bf3ce5eb20089e1aeb3d4541452d7bebf5c46144342f0b2acba721060451a3070e70df3e7a55c266353ba0338591ad5ba4ca0dab2852bc55a20f82606a--0a4e0a20bf5fddb40343459498dbdd90aa41c497cf8aef6883c3038c644e4156451b94e1122046c5aa0f5948babf73a77b4294a995d1e9d77c3d7974001aa6cfc77504c12eac1801220674696b746f6b-3.0.1","Email":"","Emailpassword":"","ts_sign_ree":"ts.1.a356bcbdcdbf70beda25e67ec1fd8536584ac42c11897d7b1879ec33feac14c47a50e8a417df069df9a555bd16c66ef8b3639a56b642d7d8f9c881f42b9329ec","User-Agent":"Mozilla/5.0 (Linux; Android 12; SM-N981N Build/RP1A.200720.012; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Mobile Safari/537.36","uid":"7566114819071247415","device_id":"7574336225781237303","twofa":"","region":"US","lang":"en-GB","imApi":"https://im-api.tiktok.com"}

  // 示例 1: 发送简单文本消息（会自动创建会话）
  try {
    const result1 = await MessageSender.sendPrivateMessage({
      sendType: 'app',
      receiverId: '7483070846815552519', // 接收者用户ID
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

