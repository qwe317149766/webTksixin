/**
 * TiktokAppSdk 使用示例
 *
 * 这个文件展示了如何在外部使用 TiktokAppSdk 来发送消息
 * 可通过 `npm run example` 或 `node sdk-example.js` 运行
 */

const MessageSender = require('../services/messageSender');

async function example() {
  // 准备 Cookie 数据（可以是 JSON 字符串或对象）
  const cookieData ={"install_id":"7579343637801715469","ttreq":"","passport_csrf_token":"cc7f8df84d8eed548910b53e89c7aed2","passport_csrf_token_default":"cc7f8df84d8eed548910b53e89c7aed2","cmpl_token":"AgQQAPNSF-RPsLkR0kaZdZ00806ljNhSv4zZYKNRRA","d_ticket":"d96c3599ec03cd75ae3a23f88deeb5f669056","multi_sids":"7579343635243025421%3A2967082e3fa28c9aaba5321399d0c1c7","sessionid":"2967082e3fa28c9aaba5321399d0c1c7","sessionid_ss":"2967082e3fa28c9aaba5321399d0c1c7","sid_guard":"2967082e3fa28c9aaba5321399d0c1c7%7C1764705654%7C15551999%7CSun%2C+31-May-2026+20%3A00%3A53+GMT","sid_tt":"2967082e3fa28c9aaba5321399d0c1c7","uid_tt":"f40ae6b7b643adb650ba6f70285d5593381ff18b7d0eff7952b312c857d0ef48","uid_tt_ss":"f40ae6b7b643adb650ba6f70285d5593381ff18b7d0eff7952b312c857d0ef48","msToken":"uTafDGXRJaqw79qlHH15lRlGy_mo9MTvXcPOXUyqp8-pcYxw-tVii8YQrqUL8xdcAXEtAHVHovTjxL188UKq1P1DL3tN2fDsFQb10mdALvgWjjwsCCX1KK1z_A==","odin_tt":"c000831360b2dcf4dc4680d10846f349bc8c119914ff53d2ae83097a4ebcfd8d709fb69038ae0bcb0dc8be9c9d35cc0fadfcf454afc188099f987cd4d45c85641ae5d93b5b9791b971d42cc1c9e349bc","store-country-code":"us","store-country-code-src":"uid","store-country-sign":"MEIEDHn3rZad6Z1DGM5QqgQgTWHuyM6lMe5pMR7tgwbj9Vo2AID_tmMgY9P0JkDX7mEEELiWYMYKgSk0ooev8f5ihuw","store-idc":"useast5","tt-target-idc":"useast5","s_v_web_id":"","username":"ckc.qxpo","password":"bnbd137@","X-Tt-Token":"042967082e3fa28c9aaba5321399d0c1c7006c9ec271216d3ea7a95e3ee5b6c9b67aba61d6b849e1e57c40e8139ab44a1fbb55aac69a32365aaba31cfd992822ecfd1ee3a4f3a839b210994a75c9bf37f141c0b5e3380ee3383bb45ded754d39dec50--0a4e0a20b17871163a04b1ebbc75f2b1d47bd0561af8d9e2246e4e836a9f12ca3de199e512201f0ec92e1f38063d044b0b8f5afd00ac5de9f71629bcc36f634521e3217a0a9d1801220674696b746f6b-3.0.1","Email":"","Emailpassword":"","ts_sign_ree":"ts.1.b53b5aa91b77d16e1ca9d79111656205388c57d343b0cb2a2ad31bcc37a807007a50e8a417df069df9a555bd16c66ef8b3639a56b642d7d8f9c881f42b9329ec","User-Agent":"Mozilla/5.0 (Linux; Android 14; V2157A Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.219 Mobile Safari/537.36","uid":"7579343635243025421","device_id":"7579343490934212110","twofa":""}





  // 示例 1: 发送简单文本消息（会自动创建会话）
  try {
    const result1 = await MessageSender.sendPrivateMessage({
      sendType: 'app',
      receiverId: '7483070846815552513', // 接收者用户ID
      messageData: 'Hello, this is a test message!', // 消息文本
      cookieObject: cookieData,
      cookiesText: JSON.stringify(cookieData),
      proxy: 'socks5h://accountId-5086-tunnelId-12988-area-us-sessID-1222233-sessTime-5:a123456@proxyas.starryproxy.com:10000',
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

