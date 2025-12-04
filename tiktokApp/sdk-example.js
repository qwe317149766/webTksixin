/**
 * TiktokAppSdk 使用示例
 *
 * 这个文件展示了如何在外部使用 TiktokAppSdk 来发送消息
 * 可通过 `npm run example` 或 `node sdk-example.js` 运行
 */

const MessageSender = require('../services/messageSender');

async function example() {
  // 准备 Cookie 数据（可以是 JSON 字符串或对象）
  const cookieData = {"cmpl_token":"AgQQAPM9F-ROXbemiLysut0r_fnIEllL_4W2YNmZOw","d_ticket":"6218a301266939e18332aee52992249d5b65d","install_id":"7464828707296184072","msToken":"gJ0urQOmaCHtJaSgMbxUmh_bTZdIE5v55pTgARX6Ns_uIkGiQzJ06FaBPu6aS-rNABdMVnpzy5qn2jUAy1oWJTpPS4CMycpf1ZA-FiodwVn-aF8Kfl_ebC3kkA==","multi_sids":"","odin_tt":"84b10d2ea9f893fe422cf5304d4fa8bc1c8ebf59709d43903d1fa5ca217ab56be0ca808d160938ace08789a31542446fcb9712416dffa5fc4711c186356149ce9dcca29374e11b3a0f709c47c62ab187","passport_csrf_token":"","passport_csrf_token_default":"","sessionid":"b0a133cf413a3472470749601a2b1f5a","sessionid_ss":"b0a133cf413a3472470749601a2b1f5a","sid_guard":"b0a133cf413a3472470749601a2b1f5a%7C1757693111%7C15552000%7CWed%2C+11-Mar-2026+16%3A05%3A11+GMT","sid_tt":"b0a133cf413a3472470749601a2b1f5a","store-country-code":"mg","store-country-code-src":"uid","store-idc":"maliva","tt-target-idc":"useast1a","tt-target-idc-sign":"g_TyA3wcX05T6xkrA3GcRxxLhcl-3-3Qaf-3DUY2AsjKrSN1PBb008m-aCHMzxaSbkRJwvySTQxlPTy4kZY7FEFKJKgi3ctj4lNkIhqe4AvrZ4cuF1JkTgXDgEZQX3YxxhD_oEzM1nmwCNks6DAwWuocDnMR754gzJPCDmF7z6y3fUM5Ukiu8UpRPpj8eq1yHD0s2lUtB-jxAZ3Y_57Kr3eHEBbBJ0gyg8C1shLcwFxVf9AfepBSAs5OQmJNnetx3sMne8orb1iOLQ41mXalys-3qA7qIa02VkhRnK8BpEO0xOQi1qEZiynMud6xK30lFC91LNV3NdmvocZm6ZHzeieBufx9dh52j1Jm6EFsOFMsU_MHt9vlvCZWdobLHtjzf9YR6hHNNMba1h3Yf-iYW_GuX2CbUPIgRhI0l45e_ZbEKnAAXze1DNUUyQeIneRJubGUdAHoUfW4lIpsuPaVJlA2njKXlTFHmqPOJiv0E6zeNJHPY_WOAW2WFT6RvPAd","ttreq":"1$ac481a9dc964ca45845a03ce664d2aa3cdf8fd98","uid_tt":"d7c30d998bbb9e1ac6c3178cf149149a29a5dbbf2bdf75a4abfdf15a8790af32","uid_tt_ss":"d7c30d998bbb9e1ac6c3178cf149149a29a5dbbf2bdf75a4abfdf15a8790af32","uid":"7464828649129640978","X-Tt-Token":"03b0a133cf413a3472470749601a2b1f5a05bf982908034143dc3762a836fa4367889aeecff174f0423166bf519dd730fd41fcf5c05821887d86ee3e7109469c1f18cc614f65da697215872ef9db7ae0ebe99dd82ac0b0a51e885537bdb85622b1655--0a4e0a20f7a48dea868b126a3edaa2853ec4afd4beeca090987aba724af4c75314654b0c1220bec4e7741ec7fc610eb6a5e686bf107c16db6f392167e12d3596e04dff9f4b781801220674696b746f6b-3.0.1","device_id":"7579631050457925176","ts_sign_ree":"","User-Agent":"com.zhiliaoapp.musically.go/null Dalvik/2.1.0 (Linux; U; Android 9; Redmi 6 MIUI/V11.0.5.0.PCGMlXM)","device_brand":"xiaomi","device_type":"","region":"US","lang":"en","imApi":"https://im-api-va.tiktok.com"}

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

