// config/index.js
const os = require('os');
const path = require('path');
const fs = require('fs');
const _ = require('lodash');

const platform = os.platform();
const env = (platform === 'linux') ? 'prod' : 'dev';

console.log(`[Config] 正在加载配置... 环境: ${env}, 平台: ${platform}`);

// 加载默认配置
const defaultConfigPath = path.resolve(__dirname, 'config.default.js');
let config = fs.existsSync(defaultConfigPath) ? require(defaultConfigPath) : {};

// 加载环境特定配置
const envConfigPath = path.resolve(__dirname, `config.${env}.js`);
if (fs.existsSync(envConfigPath)) {
  const envConfig = require(envConfigPath);
  // 使用 lodash.merge 进行深度合并
  config = _.merge(config, envConfig);
  console.log(`[Config] 成功加载环境配置: ${envConfigPath}`);
} else {
  console.warn(`[Config] 未找到环境配置文件: ${envConfigPath}，将使用默认配置。`);
}

// 将环境名称附加到配置对象
config.env = env;

// 冻结配置对象，防止意外修改
Object.freeze(config);

module.exports = config;
