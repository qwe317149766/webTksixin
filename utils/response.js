/**
 * 统一响应格式工具
 * code: 0 为成功，其他为失败
 */
class ApiResponse {
  success(res, data = null, msg = 'success', code = 0) {
    res.status(200).json({
      code,
      data,
      msg,
    });
  }

  error(res, msg = 'error', code = -1, data = null, status = 400) {
    res.status(status).json({
      code,
      data,
      msg,
    });
  }
}

module.exports = new ApiResponse();

