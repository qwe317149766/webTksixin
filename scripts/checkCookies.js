const mysql = require('mysql2/promise');
const config = require('../config');
const MessageSender = require('../services/messageSender');
const redis = require('../config/redis');

const fs = require('fs');

/**
 * 检查 Cookies 状态脚本（支持并发处理）
 * 
 * 使用方法:
 * node scripts/checkCookies.js [表后缀] [批量大小] [接收人txt文件路径] [并发数量]
 * 
 * 示例:
 * node scripts/checkCookies.js 1 10 receivers.txt
 * node scripts/checkCookies.js 1 10 receivers.txt 5
 */

// 解析命令行参数
const args = process.argv.slice(2);
const tableSuffix = args[0] || ''; // 默认不带后缀
const batchSize = parseInt(args[1]) || 10; // 默认批量大小 10
const receiversFilePath = args[2] || null; // 接收人txt文件路径
const concurrency = parseInt(args[3]) || 5; // 并发数量，默认 5

// 构建表名
const tableName = tableSuffix ? `uni_cookies_${tableSuffix}` : 'uni_cookies';

const STATUS_MAP = {
  0: '待检测',
  1: '已检测',
  2: '已风控',
  3: '已退出',
  4: '已封禁',
  5: '维护社区',
  6: '发送太快',
};

const ERROR_CODE_TO_STATUS = {
  0: 1,
  '-10001': 3,
  10004: 2,
  7290: 2,
  7289: 2,
  '-10000': 5,
  10002: 6,
};

// 需要换接收人重试的错误码（不更新状态，尝试下一个接收人）
const RETRY_WITH_NEXT_RECEIVER = ['-1', '-10002', '10001'];

// 解析 cookie 字符串为对象（从 uploadCookies.js 复制）
function parseCookieString(cookieStr) {
  // 如果已经是对象，直接返回
  if (typeof cookieStr !== 'string') {
    return cookieStr;
  }

  // 尝试解析为 JSON 格式
  try {
    // 检查是否可能是 JSON 格式（以 { 或 [ 开头）
    const trimmed = cookieStr.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || 
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      const parsed = JSON.parse(trimmed);
      // 如果解析成功且是对象，返回解析后的对象
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed;
      }
    }
  } catch (error) {
    // JSON 解析失败，继续按 cookie 字符串格式解析
  }

  // 按 cookie 字符串格式解析（格式：key1=value1;key2=value2）
  const cookieObj = {};
  cookieStr.split(';').forEach(part => {
    const [key, ...val] = part.trim().split('=');
    if (key && val.length > 0) {
      cookieObj[key] = val.join('=');
    }
  });
  
  return cookieObj;
}

// 读取接收人列表
function readReceivers(filePath) {
  if (!filePath) {
    console.error('❌ 错误: 请提供接收人txt文件路径');
    console.log('使用方法: node scripts/checkCookies.js [表后缀] [批量大小] [接收人txt文件路径]');
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`❌ 错误: 文件不存在: ${filePath}`);
    process.exit(1);
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const receivers = content.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
    
    if (receivers.length === 0) {
      console.error('❌ 错误: 接收人文件为空');
      process.exit(1);
    }

    console.log(`📄 读取到 ${receivers.length} 个接收人`);
    return receivers;
  } catch (error) {
    console.error(`❌ 读取接收人文件失败: ${error.message}`);
    process.exit(1);
  }
}

// 是否存入 Redis 的配置
const saveToRedis = config.cookies && config.cookies.saveToRedis !== false; // 默认启用

console.log('📋 配置信息:');
console.log(`   表名: ${tableName}`);
console.log(`   批量大小: ${batchSize}`);
console.log(`   并发数量: ${concurrency}`);
console.log(`   接收人文件: ${receiversFilePath || '未指定'}`);
console.log(`   存入Redis: ${saveToRedis ? '是' : '否'}`);
console.log('');

// 检查 Cookies 状态
async function checkCookies() {
  let connection;
  
  try {
    // 创建数据库连接
    console.log('🔌 正在连接数据库...');
    connection = await mysql.createConnection(config.mysql);
    console.log('✅ 数据库连接成功');

    // 检查表是否存在
    const [tables] = await connection.execute(
      `SELECT COUNT(*) as count FROM information_schema.tables 
       WHERE table_schema = ? AND table_name = ?`,
      [config.mysql.database, tableName]
    );

    if (tables[0].count === 0) {
      console.error(`❌ 错误: 表 ${tableName} 不存在`);
      process.exit(1);
    }

    // 读取接收人列表
    const receivers = readReceivers(receiversFilePath);
    let receiverIndex = 0; // 当前使用的接收人索引

    // Redis 存储键名（统一存储，不区分表）
    const redisHashKey = `cookies:data:all`; // 存储所有正常CK的详细信息（Hash结构）

    let totalProcessed = 0;
    let successCount = 0;
    let failCount = 0;
    const statusCounts = {
      0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0,
    };

    // 循环处理，直到没有待检测的记录
    while (true) {
      // 批量获取待检测的记录
      const [records] = await connection.execute(
        `SELECT id, cookies_text, ck_uid FROM ${tableName} 
         WHERE status = 0 
         LIMIT ?`,
        [batchSize]
      );

      if (records.length === 0) {
        console.log('\n✅ 没有更多待检测的记录');
        break;
      }

      console.log(`\n📦 获取到 ${records.length} 条待检测记录，开始并发检测（并发数: ${concurrency}）...`);

      // 并发控制函数 - 确保队列中始终有指定数量的任务在执行
      async function processWithConcurrency(items, concurrencyLimit, processor) {
        const results = [];
        let currentIndex = 0;
        
        // 创建一个工作函数，处理单个任务
        async function worker() {
          while (currentIndex < items.length) {
            const index = currentIndex++;
            if (index >= items.length) break;
            
            try {
              const result = await processor(items[index]);
              results[index] = result;
            } catch (error) {
              results[index] = { error };
            }
          }
        }
        
        // 启动指定数量的工作线程
        const workers = [];
        const actualConcurrency = Math.min(concurrencyLimit, items.length);
        
        for (let i = 0; i < actualConcurrency; i++) {
          workers.push(worker());
        }
        
        // 等待所有工作线程完成
        await Promise.all(workers);
        
        return results;
      }

      // 处理单条记录的函数
      async function processRecord(record, index) {
        const { id, cookies_text, ck_uid } = record;
        let recordConnection = null;

        try {
          // 为每条记录创建独立的数据库连接（避免并发冲突）
          recordConnection = await mysql.createConnection(config.mysql);

          let retryCount = 0;
          const maxRetries = Math.min(receivers.length, 3); // 最多重试3次或接收人数量
          let result = null;
          let success = false;
          let newStatus = null;

          // 如果遇到 10001，尝试换接收人重试
          while (retryCount < maxRetries && !success) {
            // 原子性地获取接收人索引
            const currentIndex = receiverIndex++;
            const toUid = receivers[currentIndex % receivers.length];

            if (retryCount === 0) {
              console.log(`[${index + 1}/${records.length}] 检测 ID: ${id}, UID: ${ck_uid || '未知'}, 接收人: ${toUid}`);
            } else {
              console.log(`  🔄 [${index + 1}] 重试 (${retryCount}/${maxRetries - 1}): 换接收人 ${toUid}`);
            }

            // 构建请求数据并调用发送接口
            try {
              const cookieObj = parseCookieString(cookies_text);
              result = await MessageSender.sendPrivateMessage({
                sendType: 'app',
                receiverId: toUid,
                messageData: 'test',
                cookieObject: cookieObj,
                cookiesText: cookies_text,
                requestData: {
                  toUid,
                  textMsg: 'test',
                  cookieParams: cookies_text,
                  createSequenceId: Math.floor(Math.random() * 500) + 10000,
                  sendSequenceId: Math.floor(Math.random() * 500) + 10013,
                },
              });
            } catch (error) {
              const errorMsg =
                error?.error_msg ||
                (typeof error?.message === 'string' ? error.message : '');
              const isFailedConversation =
                errorMsg === 'FailedConversation' ||
                (typeof errorMsg === 'string' &&
                  errorMsg.includes('FailedConversation'));

              if (!isFailedConversation) {
                console.error(`  ❌ [${index + 1}] 创建会话/发送失败: ${errorMsg || error}`);
                throw error;
              }

              console.error(`  ❌ [${index + 1}] 创建私信关系失败 (FailedConversation): ${errorMsg}`);
              await recordConnection.execute(
                `UPDATE ${tableName} SET error_count = IFNULL(error_count, 0) + 1, update_time = UNIX_TIMESTAMP() WHERE id = ?`,
                [id]
              );
              const [errorRows] = await recordConnection.execute(
                `SELECT error_count FROM ${tableName} WHERE id = ?`,
                [id]
              );
              const currentErrorCount = Number(errorRows[0]?.error_count || 0);
              if (currentErrorCount >= 3) {
                await recordConnection.execute(
                  `UPDATE ${tableName} SET status = 3, update_time = UNIX_TIMESTAMP() WHERE id = ?`,
                  [id]
                );
                statusCounts[3] = (statusCounts[3] || 0) + 1;
                console.log(`  ⚠️  [${index + 1}] error_count 达到 ${currentErrorCount}，标记为 ${STATUS_MAP[3]} (3)`);
              }
              totalProcessed++;
              failCount++;
              success = true; // 标记为已处理，继续后续记录
              break;
            }

            // 如果返回码是 10001（接收者被限制），尝试换接收人
            if (result.code === 10001) {
              retryCount++;
              if (retryCount < maxRetries) {
                console.log(`  ⚠️  [${index + 1}] 接收者被限制，尝试换接收人...`);
                await new Promise(resolve => setTimeout(resolve, 500)); // 延迟500ms后重试
                continue;
              } else {
                // 重试次数用完，跳过这条记录（不更新状态）
                console.log(`  ⏭️  [${index + 1}] 所有接收人都被限制，跳过此记录（不更新状态）`);
                totalProcessed++;
                break;
              }
            }

            // 如果返回码是 -1 或 -10002，不处理，跳过
            if (result.code === -1 || result.code === -10002) {
              console.log(`  ⏭️  [${index + 1}] 临时错误 (${result.msg})，跳过此记录（不更新状态）`);
              totalProcessed++;
              success = true; // 标记为已处理，但不更新状态
              break;
            }

            // 其他情况，根据返回码更新状态
            newStatus = ERROR_CODE_TO_STATUS[result.code];
            
            if (newStatus !== null && newStatus !== undefined) {
              // 更新数据库状态（使用独立连接）
              await recordConnection.execute(
                `UPDATE ${tableName} SET status = ?, update_time = UNIX_TIMESTAMP() WHERE id = ?`,
                [newStatus, id]
              );

              // 如果状态是 1（已检测/正常），根据配置决定是否存入 Redis
              if (newStatus === 1 && saveToRedis) {
                try {
                  // 解析 cookies 获取 store-country-code
                  const cookieObj = parseCookieString(cookies_text);
                  const storeCountryCode = cookieObj['store-country-code'] || cookieObj.store_country_code || '';
                  
                  // 计算优先级：store-country-code 为 'us' 则优先级为 0，否则为 1
                  const priority = (storeCountryCode.toLowerCase() === 'us') ? 0 : 1;

                  const cookieData = {
                    id: id,
                    table_name: tableName, // 记录来源表名
                    ck_uid: ck_uid || 0,
                    cookies_text: cookies_text,
                    status: newStatus, // CK状态（1:已检测）
                    cookie_status: 1, // cookies状态（1:正常）
                    priority: priority, // 优先级（0:US, 1:其他）
                    store_country_code: storeCountryCode,
                    update_time: Math.floor(Date.now() / 1000)
                  };

                  // 只使用 Redis Hash 存储详细信息（key: cookies:data:all, field: id, value: JSON）
                  // 不维护单独的队列，所有数据都在 Hash 中
                  await redis.hset(redisHashKey, id.toString(), JSON.stringify(cookieData));
                  
                  console.log(`  📦 [${index + 1}] CK 已存入 Redis (ID: ${id}, 优先级: ${priority}, 国家: ${storeCountryCode || '未知'})`);
                } catch (redisError) {
                  console.error(`  ⚠️  [${index + 1}] Redis 存储失败: ${redisError.message}`);
                  // Redis 存储失败不影响主流程
                }
              } else if (newStatus === 1 && !saveToRedis) {
                console.log(`  ℹ️  [${index + 1}] CK 检测正常，但未存入 Redis（配置已禁用）`);
              }

              // 使用互斥锁更新统计（简单实现）
              statusCounts[newStatus] = (statusCounts[newStatus] || 0) + 1;

              if (result.code === 0) {
                successCount++;
                console.log(`  ✅ [${index + 1}] 检测成功 - 状态更新为: ${STATUS_MAP[newStatus]} (${newStatus})`);
              } else {
                failCount++;
                console.log(`  ⚠️  [${index + 1}] 检测结果: ${result.msg} - 状态更新为: ${STATUS_MAP[newStatus]} (${newStatus})`);
              }
            } else {
              // 未知的返回码，跳过（不更新状态）
              console.log(`  ⏭️  [${index + 1}] 未知返回码: ${result.code} (${result.msg})，跳过此记录（不更新状态）`);
            }

            totalProcessed++;
            success = true;
          }

        } catch (error) {
          failCount++;
          totalProcessed++;
          console.error(`  ❌ [${index + 1}] 检测失败: ${error.message}`);
          
          // 异常错误，不更新状态，跳过
          console.log(`  ⏭️  [${index + 1}] 异常错误，跳过此记录（不更新状态）`);
        } finally {
          if (recordConnection) {
            await recordConnection.end();
          }
        }
      }

      // 并发处理所有记录
      await processWithConcurrency(
        records.map((record, index) => ({ record, index })),
        concurrency,
        ({ record, index }) => processRecord(record, index)
      );

      console.log(`\n✅ 本批次处理完成 (${records.length} 条)`);

      // 如果获取的记录数少于批量大小，说明已经处理完所有记录
      if (records.length < batchSize) {
        break;
      }
    }

    // 输出统计信息
    console.log('\n' + '='.repeat(50));
    console.log('📊 检测完成统计:');
    console.log(`   总处理数: ${totalProcessed}`);
    console.log(`   成功数: ${successCount}`);
    console.log(`   失败数: ${failCount}`);
    console.log('\n状态分布:');
    Object.keys(statusCounts).forEach(status => {
      if (statusCounts[status] > 0) {
        console.log(`   ${STATUS_MAP[status]} (${status}): ${statusCounts[status]} 条`);
      }
    });
    
    // 显示 Redis 存储信息（如果启用了 Redis 存储）
    if (saveToRedis) {
      try {
        const queueLength = await redis.hlen(redisHashKey);
        console.log(`\n📦 Redis 存储信息:`);
        console.log(`   数据哈希键名: ${redisHashKey}`);
        console.log(`   正常 CK 数量: ${queueLength} 条`);
      } catch (redisError) {
        console.log(`\n⚠️  无法获取 Redis 存储信息: ${redisError.message}`);
      }
    } else {
      console.log(`\nℹ️  Redis 存储已禁用（配置: cookies.saveToRedis = false）`);
    }
    
    console.log('='.repeat(50));

  } catch (error) {
    console.error('❌ 检测过程出错:', error.message);
    if (config.env === 'dev') {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n🔌 数据库连接已关闭');
    }
  }
}

// 运行脚本
checkCookies().catch(error => {
  console.error('❌ 脚本执行失败:', error);
  process.exit(1);
});

