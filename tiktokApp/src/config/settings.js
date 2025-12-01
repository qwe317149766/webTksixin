require('dotenv').config();

const projectConfig = require('../../../config');

const DEFAULT_TIKTOK_API_BASE_URL = 'https://api16-normal-useast5.tiktokv.us';
const DEFAULT_TIKTOK_API_GLOBAL_BASE_URL = 'https://api22-normal-c-alisg.tiktokv.com';
const DEFAULT_TIKTOK_SDK_BASE_URL = 'https://mssdk16-normal-useast5.tiktokv.us';

class Settings {
  static get HOST() {
    return projectConfig.server?.host ?? process.env.HOST ?? '0.0.0.0';
  }

  static get PORT() {
    return projectConfig.server?.port ?? parseInt(process.env.PORT || '8000', 10);
  }

  static get NODE_ENV() {
    return projectConfig.env ?? process.env.NODE_ENV ?? 'development';
  }

  static get LOG_LEVEL() {
    return projectConfig.logLevel ?? process.env.LOG_LEVEL ?? 'info';
  }

  static get REQUEST_TIMEOUT() {
    if (projectConfig.tiktokApp?.requestTimeout) {
      return projectConfig.tiktokApp.requestTimeout;
    }

    if (typeof projectConfig.redis?.commandTimeout === 'number') {
      // redis.commandTimeout 以毫秒为单位，HTTP 超时使用秒
      return Math.max(Math.ceil(projectConfig.redis.commandTimeout / 1000), 1);
    }

    return parseInt(process.env.REQUEST_TIMEOUT || '30', 10);
  }

  static get REDIS_CONFIG() {
    return projectConfig.redis ?? null;
  }

  static get PROXY_CONFIG() {
    return projectConfig.proxy ?? null;
  }

  static get TIKTOK_API_BASE_URL() {
    return (
      process.env.TIKTOK_API_BASE_URL ||
      projectConfig.tiktok?.apiBaseUrl ||
      DEFAULT_TIKTOK_API_BASE_URL
    );
  }

  static get TIKTOK_API_GLOBAL_BASE_URL() {
    console.log('TIKTOK_API_GLOBAL_BASE_URL:',DEFAULT_TIKTOK_API_GLOBAL_BASE_URL)
    return (
      process.env.TIKTOK_API_GLOBAL_BASE_URL ||
      projectConfig.tiktok?.apiGlobalBaseUrl ||
      DEFAULT_TIKTOK_API_GLOBAL_BASE_URL
    );
  }

  static get TIKTOK_SDK_BASE_URL() {
    return (
      process.env.TIKTOK_SDK_BASE_URL ||
      projectConfig.tiktok?.sdkBaseUrl ||
      DEFAULT_TIKTOK_SDK_BASE_URL
    );
  }

  static get PROJECT_CONFIG() {
    return projectConfig;
  }
}

module.exports = Settings;

