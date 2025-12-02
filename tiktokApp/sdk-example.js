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
  const cookieData = {"install_id":"7563554715746846478","ttreq":"1$587548036ae6391d3b9a0471ea397f780ed29f33","passport_csrf_token":"e4c8298e7084b33d146941c20afac24f","passport_csrf_token_default":"e4c8298e7084b33d146941c20afac24f","cmpl_token":"AgQQAPNSF-RPsLjJy5SiYR008pa9hvVLf4_ZYNxCzw","d_ticket":"972d5fb657578e498761b063ea32f30cfc172","multi_sids":"7563555000875729933%3A9b3dfec887ff50f186b5b534f0c22909","sessionid":"9b3dfec887ff50f186b5b534f0c22909","sessionid_ss":"9b3dfec887ff50f186b5b534f0c22909","sid_guard":"9b3dfec887ff50f186b5b534f0c22909%7C1761027513%7C15552000%7CSun%2C+19-Apr-2026+06%3A18%3A33+GMT","sid_tt":"9b3dfec887ff50f186b5b534f0c22909","uid_tt":"677300e9209dbf940909fdc1877625f024868a33622323108f09606b5d222805","uid_tt_ss":"677300e9209dbf940909fdc1877625f024868a33622323108f09606b5d222805","msToken":"4c-mhv0QmWKEW7Ofql2Tbf6_KV6HVP9zcXcVv63PAZJ08W1NsxGlXXiuUfmggATN2n7kIWQugpjgO2ZnvfBgfoxBdU7OQzo3FKcQ_BiFapEKe6BSIxyT_QiGO3yn","odin_tt":"06b693f3d27d5746a4ff8a6d02522758319a89e131a4097f891df15c59bdbcb22578c2d119f514cc56cbc5efb17b06858bf6a0a79a4a7882b0cfcf83df12e9208f548e5843846cd668d3e5df92ec6a2a","store-country-code":"us","store-country-code-src":"uid","store-country-sign":"MEIEDBlT9dukg9nw6GZTwQQgeViP63oUTT_XciLYLywDmKJaSkA6aV2VltaYccx-2OEEEG6CkaTrCBXOz0jl8lsYPqU","store-idc":"useast5","tt-target-idc":"useast5","s_v_web_id":"verify_mh069l79_3bVX4GAM_VQ0f_4ZNA_APz9_OWN3Male8Fnz","username":"user1202040481288","password":"EDMaF996@","X-Tt-Token":"049b3dfec887ff50f186b5b534f0c22909003a5707bafb533a92d9b34124732d21fa3d6be939b7cb0443a543e289303a3d522890d3f9aa7eb49f656642f031fc833d21897c71ce805ead545354348d61bee17bd12232f33faf1fd1b54b5c8df47bf95--0a4e0a20ea8fabe3f88bc992d66ca32bb5be168e43dbe55341355453eddee64238ab64c1122080babf544216f9728c1cdcb3eaeedf77d7c9bc3eae8163173e3ad79e0720b5dd1801220674696b746f6b-3.0.1","phone":"5739434454","url":"https://a.62-us.com/api/get_sms?key=62sms_95f8236cc2cc506b13eb1ceb4a3917fe","ts_sign_ree":"ts.1.4e283261e9c88299f772917675363feb118fcbccab72ad27e123d7fc56f417047a50e8a417df069df9a555bd16c66ef8b3639a56b642d7d8f9c881f42b9329ec","User-Agent":"Mozilla/5.0 (Linux; Android 12; SM-S9180 Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Mobile Safari/537.36","uid":"7563555000875729933","device_id":"7563554460523578893","twofa":"J5LCS5CBCFRGJ4SN3QX6A7NPFN7IFFUU"}


  // 示例 1: 发送简单文本消息（会自动创建会话）
  try {
    const result1 = await sdk.sendMessage({
      receiverId: '7483070846815552511', // 接收者用户ID
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

