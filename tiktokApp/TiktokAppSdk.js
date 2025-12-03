const TikTokService = require('./src/services/tiktok.service');

/**
 * TikTok App SDK 主类
 * 封装 sendMessage 相关功能，可在外部直接调用
 */
class TiktokAppSdk {
  constructor() {
    if (TiktokAppSdk._instance) {
      return TiktokAppSdk._instance;
    }

    // 初始化空配置，所有参数在方法调用时传递
    this.cookies = {};
    this.proxy = null;

    TiktokAppSdk._instance = this;
  }

  /**
   * 获取单例实例
   * @returns {TiktokAppSdk} 单例实例
   */
  static getInstance() {
    if (!TiktokAppSdk._instance) {
      TiktokAppSdk._instance = new TiktokAppSdk();
    }
    return TiktokAppSdk._instance;
  }

  /**
   * 重置单例实例（主要用于测试）
   */
  static resetInstance() {
    TiktokAppSdk._instance = null;
  }

  /**
   * 创建私信关系（会话）
   * @param {Object} options - 选项对象
   * @param {string} options.receiverId - 接收者用户ID
   * @param {string|Object} options.cookieData - Cookie数据（JSON 字符串或对象）
   * @param {string} [options.deviceId] - 设备ID（可选，会从 cookieData 中提取或自动生成）
   * @param {number} [options.createTime] - 创建时间戳（可选，默认当前时间）
   * @param {string} [options.queryString] - 查询字符串（可选，会自动生成）
   * @param {string} [options.proxyConfig] - 代理配置（可选）
   * @param {string} [options.seed] - Seed（可选，会从缓存或接口获取）
   * @param {number} [options.seedType] - Seed类型（可选）
   * @param {string} [options.token] - Token（可选，会从缓存或接口获取）
   * @returns {Promise<Object>} 包含 conversationId 和 chatId 的结果
   */
  async createConversation(options = {}) {
    try {
      const {
        receiverId,
        cookieData,
        deviceId,
        createTime,
        queryString,
        proxyConfig,
        seed,
        seedType,
        token,
      } = options;

      if (!receiverId || !cookieData) {
        throw new Error('Missing required parameters: receiverId, cookieData');
      }

      const proxyUrl = proxyConfig || null;
      
      // 获取缓存的 seed 和 token
      const memorySeedData = await TikTokService.getCachedSeedFromMemory(
        cookieData,
        deviceId,
        null,
        proxyUrl
      );
      const cachedSeed = memorySeedData ? memorySeedData[0] : null;
      const cachedSeedType = memorySeedData ? memorySeedData[1] : null;
      const cachedToken = await TikTokService.getCachedTokenFromMemory(
        cookieData,
        deviceId,
        null,
        proxyUrl
      );

      // 使用传入的参数或缓存的值
      const finalSeed = seed ?? cachedSeed ?? null;
      const finalSeedType = seedType ?? cachedSeedType ?? null;
      const finalToken = token ?? cachedToken ?? null;

      const result = await TikTokService.createConversation(
        receiverId,
        cookieData,
        deviceId,
        createTime,
        queryString,
        proxyUrl,
        finalSeed,
        finalSeedType,
        finalToken
      );

      return result;
    } catch (error) {
      console.error('Error creating conversation:', error);
      throw error;
    }
  }

  /**
   * 发送私信
   * 自动先创建私信关系（如果没有提供 conversationId），然后发送消息
   * @param {Object} options - 选项对象
   * @param {string} options.receiverId - 接收者用户ID（必需）
   * @param {string} [options.conversationId] - 会话ID（可选，如果没有会自动创建）
   * @param {string|Object} options.messageData - 消息内容（必需）
   *   - 如果是字符串，直接作为消息文本
   *   - 如果是对象，支持以下格式：
   *     - { text: '消息文本' } 或 { message: '消息文本' }
   *     - { isCard: true, ... } 卡片消息
   *     - { postDataHex: 'hex字符串' } 自定义 postData
   * @param {string|Object} options.cookieData - Cookie数据（JSON 字符串或对象，必需）
   * @param {string} [options.deviceId] - 设备ID（可选）
   * @param {number} [options.createTime] - 创建时间戳（可选）
   * @param {string} [options.queryString] - 查询字符串（可选）
   * @param {string} [options.proxyConfig] - 代理配置（可选）
   * @param {string} [options.seed] - Seed（可选）
   * @param {number} [options.seedType] - Seed类型（可选）
   * @param {string} [options.token] - Token（可选）
   * @returns {Promise<Object>} 发送结果，包含 result 和 conversationId
   */
  async sendMessage(options = {}) {
    try {
      const {
        receiverId,
        conversationId,
        messageData,
        cookieData,
        deviceId,
        createTime,
        queryString,
        proxyConfig,
        seed,
        seedType,
        token,
      } = options;

      if (!receiverId || !messageData || !cookieData) {
        throw new Error('Missing required parameters: receiverId, messageData, cookieData');
      }

      const proxyUrl = proxyConfig || null;

      // 获取缓存的 seed 和 token
      const memorySeedData = await TikTokService.getCachedSeedFromMemory(
        cookieData,
        deviceId,
        null,
        proxyUrl
      );
      const cachedSeed = memorySeedData ? memorySeedData[0] : null;
      const cachedSeedType = memorySeedData ? memorySeedData[1] : null;
      const cachedToken = await TikTokService.getCachedTokenFromMemory(
        cookieData,
        deviceId,
        null,
        proxyUrl
      );

      // 使用传入的参数或缓存的值
      const seedForUse = seed ?? cachedSeed ?? null;
      const seedTypeForUse = seedType ?? cachedSeedType ?? null;
      const tokenForUse = token ?? cachedToken ?? null;

      // 解析消息数据
      const isCardMessage = typeof messageData === 'object' && messageData.isCard === true;
      const messageText = typeof messageData === 'string'
        ? messageData
        : (messageData && (messageData.text || messageData.message)) || '';
      const postDataHexOverride = (typeof messageData === 'object' && messageData.postDataHex)
        ? String(messageData.postDataHex).trim()
        : null;

      // 如果没有提供 conversationId，先创建私信关系
      const buildResponse = (code, msg, data) => ({
        code,
        msg,
        data
      });
      let finalConvId = conversationId;
      if (!finalConvId) {
        try {
          const conversationResult = await TikTokService.createConversation(
            receiverId,
            cookieData,
            deviceId,
            createTime,
            queryString,
            proxyUrl,
            seedForUse,
            seedTypeForUse,
            tokenForUse
          );
          finalConvId = conversationResult.conversationId;

          if (!finalConvId) {
            throw new Error('FailedConversation');
          }
        } catch (conversationError) {
          console.error('Error creating conversation:', conversationError);
          throw new Error(`Failed to create conversation: ${conversationError.message}`);
        }
      }

      // 发送消息
      const sdkResult = await TikTokService.sendMessageStandalone(
        receiverId,
        finalConvId,
        isCardMessage,
        messageText,
        seedTypeForUse || 0,
        seedForUse || '',
        tokenForUse || '',
        cookieData,
        proxyUrl,
        { postDataHex: postDataHexOverride }
      );

      const sendBody = sdkResult;
      const status = sendBody?.status;
      const filterReason = sendBody?.filter_reason;
      const checkMessageRaw =
        sendBody?.check_message || sendBody?.checkMessage || null;
      let checkMessage = null;
      if (typeof checkMessageRaw === 'string') {
        try {
          checkMessage = JSON.parse(checkMessageRaw);
        } catch {
          checkMessage = checkMessageRaw;
        }
      } else if (checkMessageRaw && typeof checkMessageRaw === 'object') {
        checkMessage = checkMessageRaw;
      }

    
      console.log("[status:]",status === 0)
      console.log("[filterReason:]",filterReason)
      console.log("[checkMessage:]",checkMessage)
      if (!sendBody) {
        return buildResponse(-1, '发送结果为空', null);
      }

      if (status === 0) {
        return buildResponse(0, '发送消息成功', {
          ...sendBody,
          filter_reason: filterReason,
        });
      }

      const cm = checkMessage || {};
      let statusCode = cm.status_code ?? cm.statusCode ?? null;
      statusCode = parseInt(statusCode);

      if (statusCode === 7192) {
        return buildResponse(0, '发送消息成功', {...sendBody,filter_reason: filterReason});
      }

      if (statusCode === 7193) {
        return buildResponse(10001, '重复发送', sendBody);
      }

      if ([7202, 7278, 7409].includes(statusCode)) {
        return buildResponse(10001, '接收者被限制', sendBody);
      }

      if ([7201, 7289, 7290].includes(statusCode)) {
        return buildResponse(10004, '发送端限制私信', sendBody);
      }

      if (statusCode === 7180) {
        return buildResponse(10002, '您发送太快了', sendBody);
      }

      if ([7195, 7179].includes(statusCode)) {
        return buildResponse(-10000, '维护社区', sendBody);
      }

      return buildResponse(-1, '发送消息失败', checkMessage || sendBody);
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  }

  /**
   * 获取 Seed
   * @param {Object} options - 选项对象
   * @param {string|Object} options.cookieData - Cookie数据（必需）
   * @param {string} [options.deviceId] - 设备ID（可选）
   * @param {string} [options.installId] - Install ID（可选）
   * @param {string} [options.proxyConfig] - 代理配置（可选）
   * @returns {Promise<Object>} 包含 seed 和 seedType 的结果
   */
  async getSeed(options = {}) {
    try {
      const {
        cookieData,
        deviceId,
        installId,
        proxyConfig,
      } = options;

      if (!cookieData) {
        throw new Error('Missing required parameters: cookieData');
      }

      const proxyUrl = proxyConfig || null;

      const [seed, seedType] = await TikTokService.getSeed(
        cookieData,
        deviceId,
        installId,
        proxyUrl
      );

      return {
        seed,
        seedType
      };
    } catch (error) {
      console.error('Error getting seed:', error);
      throw error;
    }
  }

  /**
   * 获取 Token
   * @param {Object} options - 选项对象
   * @param {string|Object} options.cookieData - Cookie数据（必需）
   * @param {string} [options.deviceId] - 设备ID（可选）
   * @param {string} [options.installId] - Install ID（可选）
   * @param {string} [options.proxyConfig] - 代理配置（可选）
   * @returns {Promise<Object>} 包含 token 的结果
   */
  async getToken(options = {}) {
    try {
      const {
        cookieData,
        deviceId,
        installId,
        proxyConfig,
      } = options;

      if (!cookieData) {
        throw new Error('Missing required parameters: cookieData');
      }

      const proxyUrl = proxyConfig || null;

      const token = await TikTokService.getToken(
        cookieData,
        deviceId,
        installId,
        proxyUrl
      );

      return {
        token
      };
    } catch (error) {
      console.error('Error getting token:', error);
      throw error;
    }
  }
}

module.exports = { TiktokAppSdk };

