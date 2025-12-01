const protobuf = require('protobufjs');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const { decodeResponse } = require('./protobufTool');

// 使用 protobufjs 的 Long 类型处理大整数
const Long = protobuf.util.Long;

// 缓存加载的 protobuf 定义
let root = null;
let CreateAConversation = null;
let PrivateMessage = null;
let Header = null;
let KeyValuePair = null;
let Empty = null;
let Argus = null;
let ActionRecord = null;
let ChannelInfo = null;
let ExtraInfo = null;
let SeedEncrypt = null;
let SeedRequest = null;
let SeedResponse = null;
let SeedDecrypt = null;
let SeedInfo = null;
let TokenEncrypt = null;
let TokenRequest = null;
let TokenResponse = null;
let TokenDecrypt = null;
let TokenEncryptOne = null;
let Response = null;
let ResponseBody = null;
let CreateConversationV2ResponseBody = null;
let ConversationInfoV2 = null;
let SendMessageResponseBody = null;
let TokenEncryptOneOne = null;
let TokenEncryptTwo = null;

const PRIVATE_MESSAGE_SIGNATURE = '040d0a7625e16f6ec455774ebac4a3cb2400b905c0f08243f846d5b22fd1d59cdd82238a8c89c834eec05584347c72e3d0473b567188167fc1d476aec1edece247bc48bf2a21ddcbad472c2b6952ba7ab76174bca547bbfa1bc68573ae3a6e062521b--0a4e0a20eb0fc5d9308e2f041e8718e2461f368c062a3831e8293b70e51eb7a90ce8a1fb122049ba3a91495fee71c492f633d7df6c734d42af7a1948adf3e0102505849440e41801220674696b746f6b-3.0.1';
const PRIVATE_MESSAGE_UNKNOWN2 = 588691;

/**
 * 加载 protobuf 定义
 */
async function loadProtobuf() {
  if (root) {
    return root;
  }

  const protoPath = path.join(__dirname, '../../..', 'tk.proto');
  root = await protobuf.load(protoPath);
  
  // 获取消息类型
  CreateAConversation = root.lookupType('titok.CreateAConversation');
  PrivateMessage = root.lookupType('titok.PrivateMessage');
  Header = root.lookupType('titok.Header');
  KeyValuePair = root.lookupType('titok.KeyValuePair');
  Empty = root.lookupType('titok.Empty');
  Argus = root.lookupType('titok.Argus');
  ActionRecord = root.lookupType('titok.ActionRecord');
  ChannelInfo = root.lookupType('titok.ChannelInfo');
  ExtraInfo = root.lookupType('titok.ExtraInfo');
  SeedEncrypt = root.lookupType('titok.SeedEncrypt');
  SeedRequest = root.lookupType('titok.SeedRequest');
  SeedResponse = root.lookupType('titok.SeedResponse');
  SeedDecrypt = root.lookupType('titok.SeedDecrypt');
  SeedInfo = root.lookupType('titok.SeedInfo');
  TokenEncrypt = root.lookupType('titok.TokenEncrypt');
  TokenRequest = root.lookupType('titok.TokenRequest');
  TokenResponse = root.lookupType('titok.TokenResponse');
  TokenDecrypt = root.lookupType('titok.TokenDecrypt');
  TokenEncryptOne = root.lookupType('titok.TokenEncrypt_one');
  Response = root.lookupType('titok.Response');
  ResponseBody = root.lookupType('titok.ResponseBody');
  CreateConversationV2ResponseBody = root.lookupType('titok.CreateConversationV2ResponseBody');
  ConversationInfoV2 = root.lookupType('titok.ConversationInfoV2');
  SendMessageResponseBody = root.lookupType('titok.SendMessageResponseBody');
  TokenEncryptOneOne = root.lookupType('titok.TokenEncrypt_one_one');
  TokenEncryptTwo = root.lookupType('titok.TokenEncrypt_two');
  
  return root;
}

/**
 * 创建 Argus protobuf 消息
 * @param {string} deviceID - 设备ID
 * @param {string} appVersion - 应用版本
 * @param {string} sdkVersionStr - SDK 版本字符串
 * @param {number} sdkVersion - SDK 版本号
 * @param {number} createTime - 创建时间戳
 * @param {string} bodyhash - body hash (hex 字符串，12字符)
 * @param {string} queryHash - query hash (hex 字符串，12字符)
 * @param {number} signCount - 签名计数
 * @param {number} reportCount - 报告计数
 * @param {number} settingCount - 设置计数
 * @param {number} appLaunchTime - 应用启动时间
 * @param {string} secDeviceToken - 安全设备令牌
 * @param {string} pskHash - PSK hash (hex 字符串)
 * @param {string} pskCalHash - PSK 计算 hash (hex 字符串)
 * @param {number} callType - 调用类型
 * @param {string} phoneInfo - 手机信息
 * @param {number} appVersionConstant - 应用版本常量
 * @param {string} seed - 种子
 * @param {number} seedEncodeType - 种子编码类型
 * @param {string} seedEncodeHex - 种子编码 hex
 * @param {string} algorithmData1 - 算法数据1 (hex 字符串)
 * @param {string} hex32 - hex32 (hex 字符串)
 * @returns {string} 序列化后的 protobuf hex 字符串
 */
async function createArgusProtobuf(
  deviceID, appVersion, sdkVersionStr, sdkVersion, createTime,
  bodyhash, queryHash, signCount, reportCount, settingCount,
  appLaunchTime, secDeviceToken, pskHash, pskCalHash, callType,
  phoneInfo, appVersionConstant, seed, seedEncodeType, seedEncodeHex,
  algorithmData1, hex32, overrides = {}
) {
  await loadProtobuf();
  
  // 生成随机数（4字节）
  const rand = Math.floor(Math.random() * 0xFFFFFFFF);
  // Python 中固定为 2222222222 (0x8474E28E)，也可以通过 overrides 覆盖
  const fixedRand = overrides.rand !== undefined ? overrides.rand : 2222222222;
  
  // 构建消息对象
  const message = {
    magic: (0x20200929 << 1) >>> 0, // uint32，使用 >>> 0 确保无符号
    version: 2,
    rand: Long.fromNumber(fixedRand, true), // uint64，使用 Long 类型
    msAppID: '1233',
    deviceID: deviceID || '',
    licenseID: '2142840551',
    appVersion: appVersion,
    sdkVersionStr: sdkVersionStr,
    sdkVersion: (sdkVersion << 1) >>> 0, // uint32
    envCode: Buffer.from('0000000000000000', 'hex'),
    createTime: createTime * 2, // uint64, safe integer
    bodyHash: Buffer.from(bodyhash, 'hex'),
    queryHash: Buffer.from(queryHash, 'hex'),
    actionRecord: {
      signCount: 272, // Python 固定为 272
      reportSuccessCount: 262, // Python 固定为 262
      // reportCount: Python 中注释掉了
      // settingCount: Python 中注释掉了
      actionIncremental: 186, // Python 固定为 186
      appLaunchTime: (appLaunchTime << 1) >>> 0 // uint32
    },
    secDeviceToken: secDeviceToken || '',
    isAppLicense: createTime * 2, // uint64, safe integer
    pskHash: pskHash ? Buffer.from('5b9dbbb114e05c886c574bd2a3d6257c', 'hex') : undefined,
    pskCalHash: pskCalHash ? Buffer.from(pskCalHash, 'hex') : undefined,
    pskVersion: '0',
    callType: 738, // 固定值
    channelInfo: {
      phoneInfo: phoneInfo,
      metasecConstant: 18, // 固定值
      channel: 'googleplay',
      appVersionConstant: (appVersionConstant << 1) >>> 0 // uint32
    },
    seed: seed || '',
    extType: 10, // 固定值
    extraInfo: [],
    unknown28: 1006,
    unknown29: 516112,
    unknown30: 6,
    unknown31: 22222222, // Python 中固定为 22222222
    unknown32: hex32 ? Buffer.from(hex32, 'hex') : undefined,
    unknown33: 4
  };
  
  // 如果 seed_encode_type 不为空，添加 extraInfo
  if (seedEncodeType) {
    message.extraInfo.push({
      algorithm: (seedEncodeType << 1) >>> 0, // uint32
      algorithmData: Buffer.from(seedEncodeHex, 'hex')
    });
    
    message.extraInfo.push({
      algorithm: 2016, // 固定值
      algorithmData: Buffer.from(algorithmData1, 'hex')
    });
  }
  
  // 验证消息
  const errMsg = Argus.verify(message);
  if (errMsg) {
    throw new Error(`Argus verification failed: ${errMsg}`);
  }
  
  // 编码消息并返回 hex 字符串
  const buffer = Argus.encode(message).finish();
  return buffer.toString('hex');
}

/**
 * 创建 CreateAConversation protobuf 消息
 * @param {string} deviceId - 设备ID
 * @param {string} senderId - 发送者ID
 * @param {string} receiverId - 接收者ID
 * @param {string} iid - 安装ID（可选）
 * @returns {Buffer} 序列化后的 protobuf 数据
 */
async function createConversationProtobuf(deviceId, senderId, receiverId, iid = null) {
  await loadProtobuf();
  
  // 构建消息对象
  // 注意：protobufjs 将字段名转换为驼峰命名（cmdId, sequenceId），需要使用驼峰命名
  // Python: event.cmd_id = 609, event.sequence_id = 471951
  const message = {
    cmdId: Long.fromNumber(609, true),  // uint64，使用 Long 类型，注意：protobufjs 使用驼峰命名
    sequenceId: Long.fromNumber(471951, true),  // uint64，使用 Long 类型，注意：protobufjs 使用驼峰命名
    type: 'local',
    signature: '040d0a7625e16f6ec455774ebac4a3cb240107cf125b8b420dec990ca95f1d71475da1911fbf8de93fe8f5449b66b5fd2095215319ac82a556b7ebfc9543b99bc8a858ba63b2deacaf7f21c61cc0ae44749487f7411a8e787a13625520d565b138f28--0a4e0a20a36526b318b3d708bcd4908ed94a2877464a843b88da31886d83a2499a56ceef122077dbf4596cac629a3e34ba1c75f3aee323fb1036377c5b036fa57b100c338a731801220674696b746f6b-3.0.0',
    field_5: Long.fromNumber(1, true),  // uint64，使用 Long 类型
    field_6: 0,  // optional uint32，使用数字
    field_7: '0',
    messageInfo: {  // 注意：protobufjs 使用驼峰命名
      m609: {
        type: Long.fromNumber(1, true),  // uint64，使用 Long 类型
        // 对于大整数（19位），使用 Long.fromString() 转换
        id: [
          Long.fromString(String(senderId), true),   // true 表示无符号
          Long.fromString(String(receiverId), true)
        ]
      }
    },
    deviceId: deviceId,  // 注意：protobufjs 使用驼峰命名
    channel: 'googleplay',
    os: 'android',
    deviceType: 'Pixel 6',  // 注意：protobufjs 使用驼峰命名
    osVersion: '15',  // 注意：protobufjs 使用驼峰命名
    manifestVersionCode: '2024006030',  // 注意：protobufjs 使用驼峰命名
    headers: [
      { key: 'iid', value: iid || deviceId },
      { key: 'aid', value: '1233' },
      { key: 'user-agent', value: 'okhttp/3.12.13.20' },
      { key: 'locale', value: 'en' },
      { key: 'timezone_name', value: 'America/New_York' },
      { key: 'IMSDK-User-ID', value: senderId }
    ]
    // 注意：field_18 = 0 在 proto3 中会被跳过，不编码
    // Python 代码中虽然设置了 field_18 = 0，但 proto3 会跳过默认值，所以不编码
  };
  
  // 验证消息
  const errMsg = CreateAConversation.verify(message);
  if (errMsg) {
    throw new Error(`CreateAConversation verification failed: ${errMsg}`);
  }
  
  // 编码消息
  const buffer = CreateAConversation.encode(message).finish();
  return buffer;
}

/**
 * 创建 PrivateMessage protobuf 消息
 * @param {number} utime - 毫秒级时间戳
 * @param {string} deviceId - 设备ID
 * @param {string} iid - 安装ID
 * @param {string} senderId - 发送者ID
 * @param {string} receiverId - 接收者ID
 * @param {string|number} conversationId - 会话ID
 * @param {string} messageText - 消息文本
 * @param {boolean} isCard - 是否为卡片消息
 * @returns {Buffer} 序列化后的 protobuf 数据
 */
async function createPrivateMessageProtobuf(
  utime,
  deviceId,
  iid,
  senderId,
  receiverId,
  conversationId,
  messageText,
  isCard = false,
  overrides = {}
) {
  await loadProtobuf();

  const ensureLong = (value) => {
    if (value === undefined || value === null) {
      return Long.fromNumber(0, false);
    }
    if (Long.isLong(value)) {
      return value;
    }
    if (typeof value === 'object' && value !== null && 'low' in value && 'high' in value) {
      return new Long(value.low, value.high, value.unsigned || false);
    }
    if (typeof value === 'bigint') {
      return Long.fromString(value.toString(), false);
    }
    return Long.fromString(String(value), false);
  };

  const resolvedUtime = overrides.utime || utime;
  const resolvedDeviceId = overrides.deviceId || deviceId || '';
  const resolvedIid = overrides.iid || iid || resolvedDeviceId;
  const resolvedSenderId = overrides.senderId || senderId || '';
  const resolvedReceiverId = overrides.receiverId || receiverId || '';
  if (conversationId === undefined && overrides.conversationId === undefined) {
    throw new Error('conversationId is required to build PrivateMessage protobuf');
  }
  const resolvedConversationId = ensureLong(overrides.conversationId || conversationId);

  if (!resolvedDeviceId) {
    throw new Error('deviceId is required to build PrivateMessage protobuf');
  }
  if (!resolvedSenderId || !resolvedReceiverId) {
    throw new Error('senderId and receiverId are required to build PrivateMessage protobuf');
  }

  const messageUuid = overrides.messageUuid || randomUUID();
  const processId = overrides.processId || randomUUID();

  const payloadJson = overrides.payloadJson || (() => {
    if (!isCard) {
      return JSON.stringify({
        text: messageText,
        is_card: false,
        reference_scene: 0,
        sendStartTime: String(resolvedUtime),
        aweType: 700
      });
    }

    return JSON.stringify({
      aweType: 0,
      cover_url: 'https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExems1b3hiNGs3cjc1ZGdicHRoZGFvaHh2ZzZiMGhvODV5cDl5YjAzeiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/4oUC07rEsyfkhlAloS/giphy.gif',
      desc: '测试-111',
      is_card: true,
      link_url: 'https://vm.tiktok.com/t/ZTH7uxuPsg2Ku-rvyNW/',
      push_detail: 'detail',
      reference_scene: 0,
      sendStartTime: String(resolvedUtime),
      title: '测试-111'
    });
  })();

  const senderIdNum = BigInt(resolvedSenderId);
  const receiverIdNum = BigInt(resolvedReceiverId);
  const compositeId = senderIdNum < receiverIdNum
    ? `0:1:${resolvedSenderId}:${resolvedReceiverId}`
    : `0:1:${resolvedReceiverId}:${resolvedSenderId}`;

  const metadata = overrides.metadata || [
    { key: 'iid', value: String(resolvedIid) },
    { key: 'aid', value: '1233' },
    { key: 'user-agent', value: 'okhttp/3.12.13.20' },
    { key: 'locale', value: 'en' },
    { key: 'timezone_name', value: 'America/New_York' },
    { key: 'IMSDK-User-ID', value: String(resolvedSenderId) }
  ];

  const message = {
    unknownField_1: 100,
    unknown2: typeof overrides.unknown2 === 'number' ? overrides.unknown2 : PRIVATE_MESSAGE_UNKNOWN2,
    source: 'local',
    signature: overrides.signature || PRIVATE_MESSAGE_SIGNATURE,
    unknownField_5: 1,
    unknownField_7Str: '0',
    details: {
      messageContent: {
        compositeId: compositeId,
        type: 1,
        conversationId: resolvedConversationId,
        payloadJson: payloadJson,
        attributes: overrides.attributes || [
          { key: 'a:entrance_type', value: '1' },
          { key: 'a:process_id', value: processId }
        ],
        aweType: overrides.aweType ?? 7,
        messageUuid: messageUuid,
        emptyField_13: {},
        emptyField_14: {},
        emptyField_18: {},
        emptyField_19: {}
      }
    },
    deviceId: String(resolvedDeviceId),
    appStore: 'googleplay',
    os: 'android',
    deviceModel: 'Pixel 6',
    osVersion: '15',
    appVersion: '2024006030',
    metadata,
    unknownField_18: overrides.unknownField18 ?? 0,
    emptyField_21: {}
  };

  const resolvedField6 = overrides.unknownField6 ?? 0;
  if (resolvedField6 !== 0) {
    message.unknownField_6 = resolvedField6;
  }

  if (overrides.includeEmptyField21 === false) {
    delete message.emptyField_21;
  }

  // 验证消息
  const errMsg = PrivateMessage.verify(message);
  if (errMsg) {
    throw new Error(`PrivateMessage verification failed: ${errMsg}`);
  }
  
  // 编码消息
  const buffer = PrivateMessage.encode(message).finish();
  return buffer;
}

/**
 * 简单的 protobuf 字段解析器
 * 解析嵌套的 protobuf 结构，提取指定路径的字段值
 * @param {Buffer} buffer - protobuf 数据
 * @param {Array<string|number>} path - 字段路径，如 ['6', '609', '1', '2']
 * @returns {any} 字段值，如果不存在则返回 null
 */
function parseNestedProtobufField(buffer, path) {
  try {
    const reader = protobuf.Reader.create(buffer);
    const fieldMap = {};
    
    // 解析所有字段到 map
    while (reader.pos < reader.len) {
      const startPos = reader.pos;
      try {
        // 检查是否有足够的字节读取 tag（至少1字节）
        if (reader.pos >= reader.len) {
          break;
        }
        
        const tag = reader.uint32();
        const fieldNum = tag >>> 3;
        const wireType = tag & 0x7;
        
        let value;
        let skipField = false;
        
        switch (wireType) {
          case 0: // Varint
            try {
              value = reader.uint64();
            } catch (varintError) {
              console.warn(`Error reading varint for field ${fieldNum} at position ${startPos}:`, varintError.message);
              skipField = true;
            }
            break;
          case 1: // Fixed64
            if (reader.pos + 8 > reader.len) {
              console.warn(`Insufficient bytes for Fixed64 field ${fieldNum} at position ${startPos}, remaining: ${reader.len - reader.pos}`);
              skipField = true;
              break;
            }
            try {
              value = reader.fixed64();
            } catch (fixed64Error) {
              console.warn(`Error reading Fixed64 for field ${fieldNum}:`, fixed64Error.message);
              skipField = true;
            }
            break;
          case 2: // Length-delimited (string, bytes, embedded message)
            try {
              const len = reader.uint32();
              // 检查长度是否有效
              if (len < 0) {
                console.warn(`Invalid negative length for field ${fieldNum} at position ${startPos}: ${len}`);
                skipField = true;
                break;
              }
              const remaining = reader.len - reader.pos;
              if (len > remaining) {
                console.warn(`Invalid length for field ${fieldNum} at position ${startPos}: ${len}, remaining: ${remaining}, skipping field`);
                skipField = true;
                // 尝试恢复：跳过这个字段，继续解析
                break;
              }
              if (len === 0) {
                value = Buffer.alloc(0);
                break;
              }
              value = reader.bytes(len);
              // 尝试解析为嵌套消息（如果长度合理且看起来像 protobuf）
              if (len > 0 && len < 1024 * 1024) { // 限制大小，避免解析过大的数据
                try {
                  const nested = parseNestedProtobufField(value, []);
                  // 如果解析出字段，说明是嵌套消息
                  if (nested && typeof nested === 'object' && nested !== null && Object.keys(nested).length > 0) {
                    value = nested;
                  }
                  // 否则使用原始 bytes
                } catch (nestedError) {
                  // 解析嵌套消息失败，使用原始 bytes
                  // 这是正常的，因为可能是字符串或其他类型
                }
              }
            } catch (lengthError) {
              console.warn(`Error reading length-delimited field ${fieldNum} at position ${startPos}:`, lengthError.message);
              skipField = true;
            }
            break;
          case 5: // Fixed32
            if (reader.pos + 4 > reader.len) {
              console.warn(`Insufficient bytes for Fixed32 field ${fieldNum} at position ${startPos}, remaining: ${reader.len - reader.pos}`);
              skipField = true;
              break;
            }
            try {
              value = reader.fixed32();
            } catch (fixed32Error) {
              console.warn(`Error reading Fixed32 for field ${fieldNum}:`, fixed32Error.message);
              skipField = true;
            }
            break;
          case 3: // Start group (deprecated, should not appear)
          case 4: // End group (deprecated, should not appear)
            console.warn(`Deprecated wire type ${wireType} for field ${fieldNum} at position ${startPos}, skipping`);
            skipField = true;
            break;
          case 6: // Reserved
          case 7: // Reserved
            console.warn(`Reserved wire type ${wireType} for field ${fieldNum} at position ${startPos}, skipping`);
            skipField = true;
            // 对于保留的 wire type，尝试跳过当前字节
            if (reader.pos < reader.len) {
              reader.pos += 1; // 跳过当前字节
            }
            break;
          default:
            console.warn(`Unknown wire type: ${wireType} for field ${fieldNum} at position ${startPos}, skipping`);
            skipField = true;
            // 尝试跳过当前字节
            if (reader.pos < reader.len) {
              reader.pos += 1;
            }
        }
        
        // 如果字段应该被跳过，继续下一个字段
        if (skipField) {
          // 如果位置没有变化，说明无法恢复，退出循环
          if (reader.pos === startPos) {
            console.warn(`Cannot recover from error at position ${startPos}, stopping parsing`);
            break; 
          }
          continue;
        }
        
        // 成功解析字段，添加到 map
        const fieldKey = String(fieldNum);
        if (fieldMap[fieldKey]) {
          // 如果是重复字段，转换为数组
          if (!Array.isArray(fieldMap[fieldKey])) {
            fieldMap[fieldKey] = [fieldMap[fieldKey]];
          }
          fieldMap[fieldKey].push(value);
        } else {
          fieldMap[fieldKey] = value;
        }
      } catch (fieldError) {
        // 解析单个字段失败，记录错误
        console.warn(`Error parsing field at position ${startPos}:`, fieldError.message);
        
        // 如果位置没有变化，说明无法恢复，退出循环
        if (reader.pos === startPos) {
          console.warn(`Cannot recover from error at position ${startPos}, stopping parsing`);
          break;
        }
        
        // 尝试继续解析下一个字段
        if (reader.pos >= reader.len) {
          break;
        }
      }
    }
    
    // 如果 path 为空，返回整个 fieldMap
    if (path.length === 0) {
      return fieldMap;
    }
    
    // 按照路径提取值
    let current = fieldMap;
    for (let i = 0; i < path.length; i++) {
      const key = String(path[i]);
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        return null;
      }
    }
    
    return current;
  } catch (error) {
    console.error('Error parsing nested protobuf:', error);
    return null;
  }
}

/**
 * 解析 CreateAConversation 响应
 * 根据新的 proto 定义：Response -> ResponseBody (field 6) -> CreateConversationV2ResponseBody (field 609) -> ConversationInfoV2 (field 1) -> conversation_id (field 1)
 * @param {Buffer} responseData - 响应数据
 * @returns {string|number|null} conversation_id
 */
async function parseCreateConversationResponse(responseData) {
  try {
    const response = decodeResponse(responseData);

    if (!response || typeof response !== 'object') {
      throw new Error('decodeResponse returned empty object');
    }
   return response;
  } catch (error) {
    console.error('Error parsing create conversation response:', error.message || error);
    throw error;
  }
}

/**
 * 解析 PrivateMessage 响应
 * 根据新的 proto 定义：Response -> ResponseBody (field 6) -> SendMessageResponseBody (field 100)
 * @param {Buffer} responseData - 响应数据
 * @returns {Object} 解析结果
 */
async function parsePrivateMessageResponse(responseData) {
  try {
    const response = decodeResponse(responseData);

    if (!response || typeof response !== 'object') {
      throw new Error('decodeResponse returned empty object');
    }

    // 检查错误响应（status_code 字段）
    if (response.status_code) {
      const errorCode = String(response.status_code);
      if (errorCode && (errorCode.includes('200005') || errorCode.match(/^\d{6}$/))) {
        const errorDesc = response.error_desc || '';
        const logId = response.log_id || '';
        console.warn(`Send message returned error code: ${errorCode} (error_desc: ${errorDesc}, log_id: ${logId})`);
        return {
          success: false,
          message: `API returned error: ${errorCode}`,
          errorCode,
          errorDesc,
          logId,
          raw: response,
        };
      }
    }

    // 从 Response.body.send_message_body 提取信息
    let success = false;
    let message = 'Message send status unknown';
    
    if (response.body && response.body.send_message_body) {
      const sendBody = response.body.send_message_body;
      
      // 检查 status 字段（字段 3）
      if (sendBody.status !== undefined && sendBody.status !== null) {
        // status 为 0 或正数通常表示成功
        success = sendBody.status === 0 || sendBody.status > 0;
        message = success ? 'Message sent successfully' : `Message send failed with status: ${sendBody.status}`;
      }
      
      // 检查 checkCode 字段（字段 5），如果存在且为 0 表示成功
      if (sendBody.check_code !== undefined && sendBody.check_code !== null) {
        if (sendBody.check_code === 0) {
          success = true;
          message = 'Message sent successfully';
        } else {
          success = false;
          message = sendBody.check_message || `Message send failed with check_code: ${sendBody.check_code}`;
        }
      }
      
      // 检查 extraInfo 字段（字段 2），如果包含 "chat_request_sent" 表示成功
      if (sendBody.extra_info) {
        const extraInfo = String(sendBody.extra_info);
        if (extraInfo.includes('chat_request_sent')) {
          success = true;
          message = 'Message sent successfully';
        }
      }
    }
    
    return {
      success: success,
      message: message,
      response: response // 返回完整的响应对象以便调试
    };
  } catch (error) {
    console.error('Error parsing private message response:', error);
    console.error('Response hex (first 200 chars):', responseData.toString('hex').substring(0, 200));
    throw error;
  }
}

/**
 * 创建 SeedEncrypt protobuf 消息
 */
async function createSeedEncryptProtobuf(sessionId, deviceId, os = 'android', sdkVersion = 'v05.02.00') {
  await loadProtobuf();
  
  // 构建消息对象
  // 注意：protobufjs 会将 proto 文件中的下划线命名转换为驼峰命名
  // proto 中: sdk_version -> JavaScript 中: sdkVersion
  const message = {
    session: sessionId,
    deviceid: deviceId,
    os: os,
    sdkVersion: sdkVersion  // 使用驼峰命名，对应 proto 中的 sdk_version
  };
  
  const errMsg = SeedEncrypt.verify(message);
  if (errMsg) {
    throw new Error(`SeedEncrypt verification failed: ${errMsg}`);
  }
  
  // 编码消息
  const buffer = SeedEncrypt.encode(message).finish();
  return buffer.toString('hex');
}

/**
 * 创建 SeedRequest protobuf 消息
 */
async function createSeedRequestProtobuf(seedEncryptHex, utime) {
  await loadProtobuf();
  
  const message = {
    s1: Long.fromNumber(538969122 << 1, true),
    s2: Long.fromNumber(2, true),  // Python: s2 = 2
    s3: Long.fromNumber(4, true),  // Python: s3 = 4
    encrypt: Buffer.from(seedEncryptHex, 'hex'),
    utime: Long.fromNumber(utime << 1, true)
  };
  
  const errMsg = SeedRequest.verify(message);
  if (errMsg) {
    throw new Error(`SeedRequest verification failed: ${errMsg}`);
  }
  
  const buffer = SeedRequest.encode(message).finish();
  return buffer.toString('hex');
}

/**
 * 解析 SeedResponse
 */
async function parseSeedResponse(responseHex) {
  await loadProtobuf();
  
  const buffer = Buffer.from(responseHex, 'hex');
  const message = SeedResponse.decode(buffer);
  return message;
}

/**
 * 解析 SeedDecrypt
 */
async function parseSeedDecrypt(decryptHex) {
  await loadProtobuf();
  
  const buffer = Buffer.from(decryptHex, 'hex');
  const message = SeedDecrypt.decode(buffer);
  return message;
}

/**
 * 创建 TokenEncrypt protobuf 消息
 */
async function createTokenEncryptProtobuf(stime, deviceId) {
  await loadProtobuf();
  const { randomUUID } = require('crypto');
  
  // Python: random.randint(1,50)<<1 和 random.randint(50,100)<<1
  const unknown2Value = (Math.floor(Math.random() * 50) + 1) << 1;
  const unknown3Value = (Math.floor(Math.random() * 50) + 50) << 1;
  // Python: random.randint(5,20) - 注意是 5-20，不是 5-15
  const launchTimeOffset = Math.floor(Math.random() * 16) + 5; // 5-20 范围
  
  const message = {
    one: {
      notset1: '!notset!',
      changshang: 'google',
      xinghao: 'Pixel 6',
      notset2: '!netset!',
      os: 'Android',
      os_version: '15',
      tokenEncrypt_one_one: {
        unknown1: Long.fromString('3472332702763464752', true)
      },
      density_dpi: 840,
      build_id: 'BP1A.250505.005',
      os_build_time: Long.fromNumber(3346620910, true), // Python: os_build_time = 3346620910 (没有 <<1)
      appLanauge: 'en_',
      time_zone: 'America/New_York,-5',
      unknown2: Long.fromNumber(unknown2Value, true),
      unknown3: Long.fromNumber(unknown3Value, true),
      unknown4: Long.fromNumber(15887769600, true), // Python: unknown4 = 15887769600 (没有 <<1)
      stable1: Long.fromNumber(118396899328 << 1, true),
      stable2: Long.fromNumber(118396899328 << 1, true),
      unknown5: Long.fromNumber(141133357056, true), // Python: 141133357056 (没有 <<1)
      notset3: '!netset!',
      notset4: '!netset!',
      android_id: 'c65ef8e45e3962e2',
      notset5: '!notset!',
      notset6: '!notset!',
      MediaDrm: 'XGLBzRJRAagAiXYczSAvjtLEwT9VJYq86JBRjhtYTJQ=',
      laungh_time: Long.fromNumber((stime - launchTimeOffset) << 1, true),
      boot_id: randomUUID(),
      unknown6: Long.fromNumber(755285745664, true), // Python: 755285745664 (没有 <<1)
      notset7: '!netset!',
      stable3: Long.fromNumber(1999997, true),
      stable4: Long.fromNumber(1999997, true),
      notset8: '!netset!',
      default_gateway: '192.168.182.3',
      ip_dns: '192.168.182.93',
      ip_array: '["192.168.182.93","0.0.0.0"]',
      expired_time: Long.fromNumber((stime + 14350) << 1, true),
      send_time: Long.fromNumber(stime << 1, true),
      install_path: '/data/app/~~30YWW5tbWW5r3Zr412T06w==/com.zhiliaoapp.musically-5xwrN8HWz4XeNjDkfiUimQ==/base.apk',
      os_api: Long.fromNumber(70, true), // Python: os_api = 70 (没有 <<1)
      notset9: '!netset!',
      stable5: Long.fromNumber(1999997, true),
      stable6: Long.fromNumber(1999997, true),
      stable7: Long.fromNumber(1999997, true),
      stable8: Long.fromNumber(1999997, true),
      stable9: Long.fromNumber(1999997, true),
      stable10: Long.fromNumber(1999997, true),
      stable11: Long.fromNumber(1999997, true),
      stable12: Long.fromNumber(1999997, true),
      notset11: '!notset!',
      notset12: '!notset!',
      notset13: '!notset!',
      notset14: '!notset!',
      notset15: '!notset!',
      notset16: '!notset!',
      notset17: '!notset!'
    },
    last_token: 'AXab6rI6tG9L1tsZbnJH-CY_z',
    os: 'android',
    sdk_ver: 'v05.02.00-alpha.9-ov-android',
    sdk_ver_code: Long.fromNumber(84017184 << 1, true),
    msAppID: '1233',
    appVersion: '40.6.3',
    device_id: deviceId,
    two: {
      // Python: token_encrypt_two.s1 = 48 (没有 <<1，所有都是 48)
      s1: Long.fromNumber(48, true),
      s2: Long.fromNumber(48, true),
      s3: Long.fromNumber(48, true),
      s4: Long.fromNumber(48, true),
      s5: Long.fromNumber(48, true),
      s6: Long.fromNumber(48, true),
      s7: Long.fromNumber(48, true),
      s8: Long.fromNumber(48, true)
    },
    stable1: Long.fromNumber(1999997, true),
    notset1: '!netset!',
    unknown2: randomUUID(),
    stable2: Long.fromNumber(1999997, true)
  };
  
  const errMsg = TokenEncrypt.verify(message);
  if (errMsg) {
    throw new Error(`TokenEncrypt verification failed: ${errMsg}`);
  }
  
  const buffer = TokenEncrypt.encode(message).finish();
  return buffer.toString('hex');
}

/**
 * 创建 TokenRequest protobuf 消息
 */
async function createTokenRequestProtobuf(tokenEncryptHex, utime) {
  await loadProtobuf();
  
  const message = {
    s1: Long.fromNumber(538969122 << 1, true),
    s2: Long.fromNumber(2, true),  // Python: s2 = 2
    s3: Long.fromNumber(4, true),  // Python: s3 = 4
    token_encrypt: Buffer.from(tokenEncryptHex, 'hex'),
    utime: Long.fromNumber(utime << 1, true)
  };
  
  const errMsg = TokenRequest.verify(message);
  if (errMsg) {
    throw new Error(`TokenRequest verification failed: ${errMsg}`);
  }
  
  const buffer = TokenRequest.encode(message).finish();
  return buffer.toString('hex');
}

/**
 * 解析 TokenResponse
 * 参考 Python: make_token_pb.make_token_response(response)
 */
async function parseTokenResponse(responseHex) {
  await loadProtobuf();
  
  try {
    const buffer = Buffer.from(responseHex, 'hex');
    
    // 首先尝试使用标准 protobuf 解析
    try {
      const message = TokenResponse.decode(buffer);
      
      // 检查 token_decrypt 字段（字段6）
      // Python: res_pb.token_decrypt.hex() - 即使字段为空也会返回空字符串
      const tokenDecryptBuffer = message.tokenDecrypt || message.token_decrypt;
      
      // protobufjs 在字段不存在时可能返回空数组 [] 或空 Buffer
      // 如果 tokenDecryptBuffer 存在（即使是空数组或空 Buffer），直接返回 message
      // 空值在 Python 中会返回空字符串，这是正常情况，让调用代码处理
      if (tokenDecryptBuffer !== undefined && tokenDecryptBuffer !== null) {
        // 无论是 Buffer、数组还是其他类型，都返回 message
        // 调用代码会检查并转换为 hex 字符串
        return message;
      }
      
      // 如果标准解析失败，使用通用解析器
      console.warn('TokenResponse: token_decrypt field is missing in standard parse, trying generic parser');
    } catch (standardError) {
      console.warn('Standard TokenResponse decode failed, using generic parser:', standardError.message);
    }
    
    // 使用通用解析器解析响应（参考 Python 的 blackboxprotobuf 方式）
    const fieldMap = parseNestedProtobufField(buffer, []);
    
    if (!fieldMap || typeof fieldMap !== 'object' || Object.keys(fieldMap).length === 0) {
      console.error('Failed to parse TokenResponse with generic parser');
      throw new Error('Failed to parse TokenResponse');
    }
    
    // 从字段6中提取 token_decrypt（参考 Python: res_pb.token_decrypt.hex()）
    const tokenDecryptBuffer = fieldMap['6'];
    
    if (!tokenDecryptBuffer) {
      console.warn('TokenResponse: field 6 (token_decrypt) does not exist');
      console.warn('Available fields:', Object.keys(fieldMap));
      console.warn('Response hex:', responseHex);
      
      // 检查是否是错误响应（字段4通常是错误码）
      if (fieldMap['4']) {
        let errorCode = null;
        if (Buffer.isBuffer(fieldMap['4'])) {
          errorCode = fieldMap['4'].toString('utf-8');
        } else if (typeof fieldMap['4'] === 'string') {
          errorCode = fieldMap['4'];
        }
        if (errorCode) {
          console.warn(`TokenResponse contains error code: ${errorCode}`);
        }
      }
      
      // 参考 Python 代码：如果 tokenDecrypt 为空，返回空字符串
      // Python: if tokenDecrypt != "": ... else: return ""
      // 返回一个包含空 token_decrypt 的对象，让调用代码处理
      return {
        tokenDecrypt: null,
        token_decrypt: null,
        // 包含其他字段以便调试
        _fieldMap: fieldMap,
        _isEmpty: true
      };
    }
    
    // 确保 token_decrypt 是 Buffer
    let tokenDecrypt = null;
    if (Buffer.isBuffer(tokenDecryptBuffer)) {
      tokenDecrypt = tokenDecryptBuffer;
    } else if (typeof tokenDecryptBuffer === 'object' && tokenDecryptBuffer !== null) {
      // 可能是嵌套对象，尝试提取
      console.warn('Field 6 is an object, not a buffer. Structure:', Object.keys(tokenDecryptBuffer));
      // 返回空，让调用代码处理
      return {
        tokenDecrypt: null,
        token_decrypt: null,
        _fieldMap: fieldMap,
        _isEmpty: true
      };
    } else {
      console.warn(`token_decrypt field (field 6) has unexpected type: ${typeof tokenDecryptBuffer}`);
      return {
        tokenDecrypt: null,
        token_decrypt: null,
        _fieldMap: fieldMap,
        _isEmpty: true
      };
    }
    
    // 创建一个类似 TokenResponse 的对象，包含 token_decrypt 字段
    // 这样后续代码可以正常使用
    return {
      tokenDecrypt: tokenDecrypt,
      token_decrypt: tokenDecrypt,
      // 包含其他字段以便调试
      _fieldMap: fieldMap
    };
  } catch (error) {
    console.error('Error parsing TokenResponse:', error);
    console.error('Response hex (first 200 chars):', responseHex.substring(0, 200));
    console.error('Response hex length:', responseHex.length);
    throw error;
  }
}

/**
 * 解析 TokenDecrypt
 */
async function parseTokenDecrypt(decryptHex) {
  await loadProtobuf();
  
  const buffer = Buffer.from(decryptHex, 'hex');
  const message = TokenDecrypt.decode(buffer);
  return message;
}

module.exports = {
  createArgusProtobuf,
  createConversationProtobuf,
  createPrivateMessageProtobuf,
  parseCreateConversationResponse,
  parsePrivateMessageResponse,
  createSeedEncryptProtobuf,
  createSeedRequestProtobuf,
  parseSeedResponse,
  parseSeedDecrypt,
  createTokenEncryptProtobuf,
  createTokenRequestProtobuf,
  parseTokenResponse,
  parseTokenDecrypt
};

