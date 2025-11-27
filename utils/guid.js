const { v4: uuidv4, v1: uuidv1 } = require('uuid');

/**
 * GUID 工具类
 * 提供多种生成 GUID/UUID 的方法
 */
class GuidUtil {
  /**
   * 生成 UUID v4 (随机 UUID，最常用)
   * @returns {string} UUID 字符串，格式：xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
   */
  static generate() {
    return uuidv4();
  }

  /**
   * 生成 UUID v4 (随机 UUID)
   * @returns {string} UUID 字符串
   */
  static generateV4() {
    return uuidv4();
  }

  /**
   * 生成 UUID v1 (基于时间戳的 UUID)
   * @returns {string} UUID 字符串
   */
  static generateV1() {
    return uuidv1();
  }

  /**
   * 生成不带连字符的 UUID
   * @returns {string} 32位十六进制字符串
   */
  static generateWithoutHyphens() {
    return uuidv4().replace(/-/g, '');
  }

  /**
   * 生成短 GUID (取前16位)
   * @returns {string} 16位十六进制字符串
   */
  static generateShort() {
    return uuidv4().replace(/-/g, '').substring(0, 16);
  }

  /**
   * 生成指定长度的 GUID
   * @param {number} length - 长度
   * @returns {string} 指定长度的十六进制字符串
   */
  static generateCustom(length = 32) {
    const fullGuid = uuidv4().replace(/-/g, '');
    return fullGuid.substring(0, Math.min(length, fullGuid.length));
  }

  /**
   * 验证是否为有效的 UUID
   * @param {string} uuid - 待验证的 UUID 字符串
   * @returns {boolean} 是否为有效的 UUID
   */
  static isValid(uuid) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }
}

module.exports = GuidUtil;

