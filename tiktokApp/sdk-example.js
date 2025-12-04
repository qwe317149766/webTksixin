/**
 * TiktokAppSdk 使用示例
 *
 * 这个文件展示了如何在外部使用 TiktokAppSdk 来发送消息
 * 可通过 `npm run example` 或 `node sdk-example.js` 运行
 */

const MessageSender = require('../services/messageSender');

async function example() {
  // 准备 Cookie 数据（可以是 JSON 字符串或对象）
  const cookieData = 'msToken=wzCdPuVxAsaaFSAcd9nypn-lqo2MEK2UjBRZksqzzAnqN-dxdpxNacHAhujMYwtag1yDytS_-38B55Cu0MlUmw90fw0ODXU0y1r6tjykdT0CcakkktV9vGj1IsYpO5zsaIdrEuU2MHwhviL7Wk9gu3S5; tt_csrf_token=GUqiM5Wt-5sPxs1ZZ8BHxOVlzeBLjruBj3gU; ttwid=1%7CWx40P8Uwtg4QPKtOf3ZsoACI5shfQjXzphNk5DbdAss%7C1754530592%7C558000b44f086641ac2a4cf1dd00889fa7c13194616d70d9a1f67ab7baf8ba4c; tt_chain_token=EQzJDVnp/d7rg9sQloMhoQ; s_v_web_id=verify_me0q7sid_wsv7TSAs_fouE_48P4_Aw1y_3GfiGLL0XINe; passport_csrf_token=8f61a55477806181f2649166b51a18c0; passport_csrf_token_default=8f61a55477806181f2649166b51a18c0; passport-sotl-auth-token-nonce_o1TEC3zan6TS5ghEUdT1emsBqZ9uOZ7moFqlvekRR8w=o1TEC3zan6TS5ghEUdT1emsBqZ9uOZ7moFqlvekRR8w; passport-sotl-auth-token-nonce_KkCkvTbZR6YTLVdRHTdM--3bNSZ05kBnvGqx6YfnVzo=KkCkvTbZR6YTLVdRHTdM--3bNSZ05kBnvGqx6YfnVzo; passport-sotl-auth-token-nonce_jOKKMVB0EWC8Y07X5Z54efhs6sY4PkFsVZvRZKH7qPY=jOKKMVB0EWC8Y07X5Z54efhs6sY4PkFsVZvRZKH7qPY; passport-sotl-auth-token-nonce_NRxJjgdyEVUyY_7o7hwEKZEVHwjT2FEidBxnHLNkATY=NRxJjgdyEVUyY_7o7hwEKZEVHwjT2FEidBxnHLNkATY; d_ticket=d2a471a754f03b01ee97d39fa66867531ea91; multi_sids=6811788155961213957%3Ae5a18b371cfeb92cebef96bd473db955; cmpl_token=AgQQAPPdF-RO0o62u5tBet088vWaL8vPv5QQYN2rtQ; sid_guard=e5a18b371cfeb92cebef96bd473db955%7C1754530629%7C15552000%7CTue%2C+03-Feb-2026+01%3A37%3A09+GMT; uid_tt=ae6b619da58878a107b10c10fc0ca11f768888d48f5a195ff01285676ea266d8; uid_tt_ss=ae6b619da58878a107b10c10fc0ca11f768888d48f5a195ff01285676ea266d8; sid_tt=e5a18b371cfeb92cebef96bd473db955; sessionid=e5a18b371cfeb92cebef96bd473db955; sessionid_ss=e5a18b371cfeb92cebef96bd473db955; sid_ucp_v1=1.0.0-KDNiNmVhNDI2YWJkMjA5MThlMjAyNmQzMzUyM2Y4OWMwZjUwMzk3ODQKGAiFiKDKzKeVxF4QxYbQxAYYsws4AUDqBxAFGgRubzFhIiBlNWExOGIzNzFjZmViOTJjZWJlZjk2YmQ0NzNkYjk1NQ; ssid_ucp_v1=1.0.0-KDNiNmVhNDI2YWJkMjA5MThlMjAyNmQzMzUyM2Y4OWMwZjUwMzk3ODQKGAiFiKDKzKeVxF4QxYbQxAYYsws4AUDqBxAFGgRubzFhIiBlNWExOGIzNzFjZmViOTJjZWJlZjk2YmQ0NzNkYjk1NQ; store-idc=no1a; store-country-sign=MEIEDNvm2uGMRbdexmdr7AQgJ3UNTCUNIBCYHEAxcejqlWisQE6X2rsStWNmIXmeJ-wEEI_BSvqXNsMlF6xJkS2Kwsk; store-country-code=fr; store-country-code-src=uid; tt-target-idc=eu-ttp2; tt-target-idc-sign=ZSHYXzoA3CbIjlngOR3QhLg3YYsjRVy1jrDcCFdJIL84GwpWgvLKbI1ygZtBhDsiHsEjp4SS6BjAPJZS-wkRiEhiMtRqZjpT6iPLqqLsvBH9sfuIh3XtNKN3a5Ng7vwAYLMuD9XGlldqBEKLmyfLXdgJYv8s_FLP7T78mE4deET7k1COBUOQCXJ4ZzpvEdcWa1iwJXY9WDy46GEC7RofAtCTXXFPT6jB-3DOwa2JUYOLruwfqaiVbVKqTSZKRBaz8z3FUVpY1WvPgVMQvWpwZY_JZ3eseEOM4FrGWfUqr5cS3ckV3P6lSFvRP_-gphFpVfoSRPp6YTJt2BHLNmcOgOrBzNRWYZ9ZpZRPgbWBFdkzqeHkaFpf9JVMgTjYNrS_r-zwvS75jHP0bSd7u4dxDlOTGVQ47DlXuVZFOTnQLpzA5Me3f85JbTr_k-xYL4y5eyiL-qGJnP4r3JW1OCQRw4yg5VJRR5wLdbcoKoiYxSLynKSL_FS65D5HxSsmcuQe; device_id=7535651496974648854; uid=6811788155961213957; imApi=https%3A%2F%2Fim-api.tiktok.com; userAgent=Mozilla%2F5.0%20(Windows%20NT%2010.0%3B%20Win64%3B%20x64)%20AppleWebKit%2F537.36%20(KHTML%2C%20like%20Gecko)%20Chrome%2F132.0.0.0%20Safari%2F537.36; region=US; lang=fr'

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

