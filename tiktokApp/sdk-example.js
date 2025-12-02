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
  const cookieData = {
    'passport_csrf_token': '0d1de6a759f8f3991791427854690205', 
    'passport_csrf_token_default': '0d1de6a759f8f3991791427854690205',
     'odin_tt': 'd6a019990f9be72641ed3ef6301b01ea8a4f7345794d23a3d72a5c9c6048f9ad50f40290beb780197badb2eaae302997b04130ff95e6762cf38a6597c8fd3428f8c64344b487f5e6b851a597395dcaab', 
     'multi_sids': '7574399196598977591%3Ad7a662e2d62b27d3b773378c6148ce48',
      'cmpl_token': 'AgQQAPNSF-RPsLkjRVe0e50O83wyacIIf7XZYKNQPg',
       'sid_guard': 'd7a662e2d62b27d3b773378c6148ce48%7C1764691846%7C15552000%7CSun%2C+31-May-2026+16%3A10%3A46+GMT', 
       'uid_tt': '39710848fd2848f4e551324b7aa0d45651f1b90908e69a4b6317bf445f49e3d0',
        'uid_tt_ss': '39710848fd2848f4e551324b7aa0d45651f1b90908e69a4b6317bf445f49e3d0',
         'sid_tt': 'd7a662e2d62b27d3b773378c6148ce48',
          'sessionid': 'd7a662e2d62b27d3b773378c6148ce48', 
          'sessionid_ss': 'd7a662e2d62b27d3b773378c6148ce48',
           'tt_session_tlb_tag': 'sttt%7C3%7C16Zi4tYrJ9O3czeMYUjOSP_________zc8z4WAT_ni6YujZNm7QAhp1Ff16vox44ouZfvWTDOgA%3D',
            'reg-store-region': '',
             'store-idc': 'useast5',
              'store-country-sign': 'MEIEDGaU3upjE-fEZaUJrwQg6swiYV1LnMGfU7bI0iAE4oIWeyElCfmwigXFCmia_j8EEKhnfroJPqE1CQVQR9iAmyo',
               'store-country-code': 'us',
                'store-country-code-src': 'uid',
                 'tt-target-idc': 'useast5',
                 "uid":"7574399196598977591",
                 "install_id":"7574399283915917069",
                 "device_id":"7574398633660810807"}


  // 示例 1: 发送简单文本消息（会自动创建会话）
  try {
    const result1 = await sdk.sendMessage({
      receiverId: '7483070846815552512', // 接收者用户ID
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

