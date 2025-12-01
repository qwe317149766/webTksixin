/**
 * 数据类型定义
 */

/**
 * Cookie 数据
 */
class CookieData {
  constructor(data) {
    this.ttreq = data.ttreq || '';
    this.passport_csrf_token = data.passport_csrf_token || '';
    this.cmpl_token = data.cmpl_token || '';
    this.d_ticket = data.d_ticket || '';
    this.multi_sids = data.multi_sids || '';
    this.sessionid = data.sessionid || '';
    this.sid_guard = data.sid_guard || '';
    this.uid_tt = data.uid_tt || '';
    this.msToken = data.msToken || '';
    this.odin_tt = data.odin_tt || '';
    this['store-country-sign'] = data['store-country-sign'] || '';
    this.s_v_web_id = data.s_v_web_id || '';
    this['X-Tt-Token'] = data['X-Tt-Token'] || '';
    this['User-Agent'] = data['User-Agent'] || '';
    this.install_id = data.install_id || '';
    this.device_id = data.device_id || '';
    this.uid = data.uid || '';
  }
}

/**
 * 请求选项
 */
class RequestOptions {
  constructor(options = {}) {
    this.proxyUrl = options.proxyUrl || null;
    this.timeout = options.timeout || 30000;
    this.retries = options.retries || 1;
    this.retryDelay = options.retryDelay || 1000;
  }
}

module.exports = {
  CookieData,
  RequestOptions,
};

