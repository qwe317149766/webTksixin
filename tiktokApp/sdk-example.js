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
  const cookieData = {"install_id":"7578212112372860685","ttreq":"1$e60a2d73ff12e1c3697233d9ac7dce76dff1a3ac","passport_csrf_token":"0acd2ee739b1882fc70d16636fbb22b6","passport_csrf_token_default":"0acd2ee739b1882fc70d16636fbb22b6","cmpl_token":"AgQQAPNSF-RPsLkV2W7Af50O80qunEiSf4_ZYKMgkw","d_ticket":"9fb8859d15e30fbb0327f63739ada74672307","multi_sids":"7578212135621968951%3A3aa9f1adfaaa0f32433b4e2da6c02df4","sessionid":"3aa9f1adfaaa0f32433b4e2da6c02df4","sessionid_ss":"3aa9f1adfaaa0f32433b4e2da6c02df4","sid_guard":"3aa9f1adfaaa0f32433b4e2da6c02df4%7C1764440138%7C15551999%7CThu%2C+28-May-2026+18%3A15%3A37+GMT","sid_tt":"3aa9f1adfaaa0f32433b4e2da6c02df4","uid_tt":"6daa2c949a3523f8ac018387a15a098071434437cc2253721e5e616dac34f140","uid_tt_ss":"6daa2c949a3523f8ac018387a15a098071434437cc2253721e5e616dac34f140","msToken":"dn7eGN0VHGeKx5xlppgRsezGxrtWeTIjaP1necMCxOOhMhUk0xhvHs0WQLSQWtHr0a5eaYO69SEe1ec06suwvk6bsWQpIS3_MItbVE9TdMUDCnrgcSk16o0hNroD","odin_tt":"3029c529d6c403b25ca4c35c16f1829d970522aa3d7518bfc309c569fc78f40cfd988e51ecb6641d98d06c8637a005a2a0c117a68be3ba0f5e61e75ee6a1240dc2dcc1600a6bd43862d113e23b170dbe","store-country-code":"us","store-country-code-src":"uid","store-country-sign":"MEIEDJs055VV25UMlMIQKQQgwhTaOKFCXjbpFvNYY7kBEL_PuWKo43TETL24iE0Sw2sEEMQy2DnZ9Iywpdkq2pAKE7c","store-idc":"useast5","tt-target-idc":"useast8","s_v_web_id":"verify_mikm1gg0_GuQr6FPp_oK3B_46pU_B4hl_CbOMqdMro7E5","username":"user3248491051661","password":"jMOeq5680@","X-Tt-Token":"043aa9f1adfaaa0f32433b4e2da6c02df401901d332a0f29ab62f5678ed96973019f8c7dafc800b12a3ad9cd55f0d1dbc558d8893ae77977f39f27fd276d5ffd6819d2f2694a9ebc3bac291176eee06958c318bd4ddcc2c64aed71e2b7a70050b8b93--0a4e0a2032b563a0b6132b1601afd0ba9b48d1b749f75e801221671ba4235fc65c55430112208ab08bc329af99b3bf59b4b0e91e954fcb6e167f535d2ea07bb56e581e7aa8e41801220674696b746f6b-3.0.1","ts_sign_ree":"ts.1.3961dc137a338fabf38a305841be9b054d4bac8e99bff74a06f91d051e0aa29e7a50e8a417df069df9a555bd16c66ef8b3639a56b642d7d8f9c881f42b9329ec","User-Agent":"Mozilla/5.0 (Linux; Android 12; SM-F711N Build/SP2A.220305.013; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/108.0.5359.243 Mobile Safari/537.36","uid":"7578212135621968951","device_id":"7578212026616202765","android_id":"android-09b4a864f9b043e3","twofa":"7V76D5CLAHMMLXA6N6XPI4OY4NPUOBKV"} ;

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

