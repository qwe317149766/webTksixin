const redis = require('../config/redis');

/**
 * Cookies 队列工具类
 * 用于管理 Redis 中存储的正常 CK 队列
 */

class CookiesQueue {
  /**
   * 获取数据哈希键名（统一存储）
   * @returns {string} Redis 哈希键名
   */
  static getHashKey() {
    return `cookies:data:all`;
  }

  /**
   * 分页获取正常 CK 列表
   * @param {number} page - 页码（从1开始）
   * @param {number} pageSize - 每页数量
   * @param {number} priority - 优先级筛选（可选：0或1）
   * @returns {Promise<Object>} 返回 { total, page, pageSize, data }
   */
  static async getCookiesList(page = 1, pageSize = 10, priority = null) {
    try {
      const hashKey = this.getHashKey();

      // 获取 Hash 中所有数据
      const allData = await redis.hgetall(hashKey);

      // 解析所有 Cookie 数据
      let allCookies = [];
      for (const [id, value] of Object.entries(allData)) {
        try {
          const cookie = JSON.parse(value);
          // 如果指定了优先级筛选，进行过滤
          if (priority === null || cookie.priority === priority) {
            allCookies.push(cookie);
          }
        } catch (error) {
          console.error(`解析 Cookie 数据失败 (ID: ${id}):`, error);
        }
      }

      // 按优先级排序（优先级0在前，然后按更新时间倒序）
      allCookies.sort((a, b) => {
        if (a.priority !== b.priority) {
          return a.priority - b.priority; // 优先级0在前
        }
        return b.update_time - a.update_time; // 更新时间倒序
      });

      // 计算总数和分页
      const total = allCookies.length;
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      const paginatedCookies = allCookies.slice(start, end);

      return {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
        data: paginatedCookies
      };
    } catch (error) {
      console.error('获取 Cookies 列表失败:', error);
      throw error;
    }
  }

  /**
   * 获取队列总数
   * @param {number} priority - 优先级筛选（可选：0或1）
   * @returns {Promise<number>} 队列总数
   */
  static async getQueueLength(priority = null) {
    try {
      const hashKey = this.getHashKey();
      
      if (priority === null) {
        // 获取 Hash 中所有字段数量
        return await redis.hlen(hashKey);
      }
      
      // 如果指定了优先级，需要遍历统计
      const allData = await redis.hgetall(hashKey);
      let count = 0;
      
      for (const value of Object.values(allData)) {
        try {
          const cookie = JSON.parse(value);
          if (cookie.priority === priority) {
            count++;
          }
        } catch (error) {
          // 忽略解析错误
        }
      }
      
      return count;
    } catch (error) {
      console.error('获取队列长度失败:', error);
      throw error;
    }
  }

  /**
   * 从队列中移除指定的 CK
   * @param {number} id - CK ID
   * @returns {Promise<boolean>} 是否成功移除
   */
  static async removeCookie(id) {
    try {
      const hashKey = this.getHashKey();

      // 从哈希中删除
      await redis.hdel(hashKey, id.toString());

      return true;
    } catch (error) {
      console.error('移除 Cookie 失败:', error);
      throw error;
    }
  }

  /**
   * 清空队列
   * @returns {Promise<boolean>} 是否成功清空
   */
  static async clearQueue() {
    try {
      const hashKey = this.getHashKey();

      await redis.del(hashKey);

      return true;
    } catch (error) {
      console.error('清空队列失败:', error);
      throw error;
    }
  }

  /**
   * 获取指定 ID 的 Cookie 信息
   * @param {number} id - CK ID
   * @returns {Promise<Object|null>} Cookie 信息
   */
  static async getCookieById(id) {
    try {
      const hashKey = this.getHashKey();
      const value = await redis.hget(hashKey, id.toString());
      
      if (value) {
        return JSON.parse(value);
      }
      return null;
    } catch (error) {
      console.error('获取 Cookie 信息失败:', error);
      throw error;
    }
  }

  /**
   * 获取 Cookie 的状态信息
   * @param {number} id - CK ID
   * @returns {Promise<Object|null>} 状态信息 { status, cookie_status, priority }
   */
  static async getCookieStatus(id) {
    try {
      const cookie = await this.getCookieById(id);
      if (cookie) {
        return {
          id: cookie.id,
          status: cookie.status, // CK状态
          cookie_status: cookie.cookie_status, // cookies状态
          priority: cookie.priority, // 优先级
          store_country_code: cookie.store_country_code, // 国家代码
          update_time: cookie.update_time
        };
      }
      return null;
    } catch (error) {
      console.error('获取 Cookie 状态失败:', error);
      throw error;
    }
  }
}

module.exports = CookiesQueue;

