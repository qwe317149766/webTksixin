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
  const cookieData = {"install_id":"7578178925471565623","ttreq":"1$381ef294425e7ecae7be70d47b012bf1796106b5","passport_csrf_token":"7955c90a6d96f010b3dcff8f30b95b1f","passport_csrf_token_default":"7955c90a6d96f010b3dcff8f30b95b1f","cmpl_token":"AgQQAPNSF-RPsLkV9zButp0380qATffX_4zZYKMvEw","d_ticket":"32dc09b31b88aeb1324c637c705dbe9b48723","multi_sids":"7578178938179175438%3A39993913565a393e017a11ebb32a39cb","sessionid":"39993913565a393e017a11ebb32a39cb","sessionid_ss":"39993913565a393e017a11ebb32a39cb","sid_guard":"39993913565a393e017a11ebb32a39cb%7C1764432477%7C15552000%7CThu%2C+28-May-2026+16%3A07%3A57+GMT","sid_tt":"39993913565a393e017a11ebb32a39cb","uid_tt":"661325200e4b443919d2bee417d1db0418d206f065478bd9a275a740795a51d9","uid_tt_ss":"661325200e4b443919d2bee417d1db0418d206f065478bd9a275a740795a51d9","msToken":"zLMZYBkH6Fv5YfIq7_oyLwmIukZJxnieOWeujH82Ru9gmkaNyM0SJTe4WWD8YiQLBeX71PFcFAScHxWNM-f_7RBEIJXOSvlixX4s6r3U2368xzfg7vfi6szfpOqQ","odin_tt":"ae3ae9a0f1a87187be0d8df8e00bb021b249fe01b50da95e3a4e264e5447fa8193202df42d4f5b7cbba6fb946e9e1ff02a807211ca9dfec3181a73f15c88ceedfcc035956d31cc0c9cd7895b96bf7366","store-country-code":"us","store-country-code-src":"uid","store-country-sign":"MEIEDChhXqm0mJ3YdLar0AQgNzh070jS-PFHXizQbRa9k6Q-gvfCJn6bwgfIcdjy__IEEOYCP5fFMXEY7RBViFKdeSM","store-idc":"useast5","tt-target-idc":"useast5","s_v_web_id":"verify_mikhfyab_XjuhMzBY_C4Cp_4Esq_9Wm1_uB2nZI9jUNEc","username":"user5546614743440","password":"WMIRn902@","X-Tt-Token":"0439993913565a393e017a11ebb32a39cb044103c0f9f517f0034566ff5ade2da2c1060b6a15594164d95ebac7440dd2db4663817c25e94aca98e374acf3bc60a7f98520ea1497df235d91952248a2529f083260dcf5b5a234183d7e181863e32fea9--0a4e0a20729839926334ac5d334b38384e03d875f23c61610c896822d3960ea362c8dbf812201295430ab188fb2fe133caabbbe47f5401d79f4a8ed42c3eb5db3b1bc4f46ade1801220674696b746f6b-3.0.1","ts_sign_ree":"ts.1.d11867bacfbf896002fd73797395f4e3c79bb39b9e347a06596bf5f7e7117d627a50e8a417df069df9a555bd16c66ef8b3639a56b642d7d8f9c881f42b9329ec","User-Agent":"Mozilla/5.0 (Linux; Android 12; SM-A515F Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/108.0.5359.243 Mobile Safari/537.36","uid":"7578178938179175438","device_id":"7578178828418729486","twofa":"G5HHZBNSPISXDT7BVTETQZ2CVTZQ6XQ4"} ;

  // 示例 1: 发送简单文本消息（会自动创建会话）
  try {
    const result1 = await sdk.sendMessage({
      receiverId: '9876543212', // 接收者用户ID
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

