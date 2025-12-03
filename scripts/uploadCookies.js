const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const config = require('../config');

/**
 * 上传 Cookies 到数据库脚本
 * 
 * 使用方法:
 * node scripts/uploadCookies.js <txt文件路径> [表后缀]
 * 
 * 示例:
 * node scripts/uploadCookies.js cookies.txt
 * node scripts/uploadCookies.js cookies.txt 1
 * node scripts/uploadCookies.js cookies.txt 2
 */

// 解析命令行参数
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('❌ 错误: 请提供 txt 文件路径');
  console.log('\n使用方法:');
  console.log('  node scripts/uploadCookies.js <txt文件路径> [表后缀]');
  console.log('\n示例:');
  console.log('  node scripts/uploadCookies.js cookies.txt');
  console.log('  node scripts/uploadCookies.js cookies.txt 1');
  console.log('  node scripts/uploadCookies.js cookies.txt 2');
  process.exit(1);
}

const txtFilePath = args[0];
const tableSuffix = args[1] || ''; // 默认不带后缀

// 构建表名
const tableName = tableSuffix ? `uni_cookies_${tableSuffix}` : 'uni_cookies';
const BATCH_SIZE = Number(config.upload?.batchSize) || 200;

console.log('📋 配置信息:');
console.log(`   文件路径: ${txtFilePath}`);
console.log(`   表名: ${tableName}`);
console.log('');

// 检查文件是否存在
if (!fs.existsSync(txtFilePath)) {
  console.error(`❌ 错误: 文件不存在: ${txtFilePath}`);
  process.exit(1);
}

// 读取并解析 cookies
function parseCookiesFromFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    console.log(`📄 读取到 ${lines.length} 行数据`);
    
    return lines;
  } catch (error) {
    console.error(`❌ 读取文件失败: ${error.message}`);
    process.exit(1);
  }
}

// 解析 cookie 字符串为对象
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

// 根据 cookie 信息计算优先级（store-country-code = us -> 0，否则 1）
function getPriorityInfo(cookieObj = {}) {
  const rawCountry =
    cookieObj['store-country-code'] ||
    cookieObj.store_country_code ||
    '';
  const normalized = String(rawCountry || '')
    .trim()
    .toLowerCase();

  return {
    priorityCode: normalized === 'us' ? 0 : 1,
    storeCountryCode: normalized.toUpperCase(),
  };
}

// 上传 cookies 到数据库
async function uploadCookies() {
  let connection;
  
  try {
    // 读取 cookies
    const cookieLines = parseCookiesFromFile(txtFilePath);
    
    if (cookieLines.length === 0) {
      console.error('❌ 错误: 文件中没有有效的 cookies 数据');
      process.exit(1);
    }

    // 创建数据库连接
    console.log('🔌 正在连接数据库...');
    connection = await mysql.createConnection(config.mysql);
    console.log('✅ 数据库连接成功');

    // 检查表是否存在，如果不存在则创建
    await ensureTableExists(connection, tableName);

    // 开始事务
    await connection.beginTransaction();
    console.log('📦 开始事务...');

    let successCount = 0;
    let failCount = 0;
    const errors = [];

    const preparedRows = [];

    for (let i = 0; i < cookieLines.length; i++) {
      const cookieLine = cookieLines[i];
      try {
        const cookieObj = parseCookieString(cookieLine);
        const { priorityCode, storeCountryCode } = getPriorityInfo(cookieObj);
        let ckUid = 0;

        if (cookieObj.uid || cookieObj['uid']) {
          const uid = cookieObj.uid || cookieObj['uid'];
          ckUid = parseInt(uid, 10) || 0;
        } else {
          const multiSids = cookieObj.multi_sids || cookieObj['multi_sids'];
          if (multiSids) {
            const match = String(multiSids).match(/^(\d+)/);
            if (match) {
              ckUid = parseInt(match[1], 10) || 0;
            }
          }
        }

        const sessionid = cookieObj.sessionid || cookieObj['sessionid'] || null;
        const cookieHash = crypto
          .createHash('sha1')
          .update(cookieLine.trim())
          .digest('hex');

        preparedRows.push({
          cookiesText: cookieLine,
          cookieHash,
          ckUid,
          storeCountryCode: storeCountryCode || '',
          priorityCode,
          sessionPreview: sessionid ? `${sessionid.substring(0, 10)}...` : 'sessionid: 无',
          lineNumber: i + 1,
        });
      } catch (error) {
        failCount++;
        const errorMsg = `第 ${i + 1} 行处理失败: ${error.message}`;
        errors.push(errorMsg);
        console.error(`  ❌ [${i + 1}/${cookieLines.length}] ${errorMsg}`);
      }
    }

    const insertSqlBase = `
      INSERT INTO ${tableName}
        (cookies_text, ck_uid, store_country_code, priority_code, is_aync, create_time, update_time)
      VALUES %VALUES%
      ON DUPLICATE KEY UPDATE
        cookies_text = VALUES(cookies_text),
        ck_uid = VALUES(ck_uid),
        store_country_code = VALUES(store_country_code),
        priority_code = VALUES(priority_code),
        is_aync = VALUES(is_aync),
        update_time = VALUES(update_time)
    `;

    const singleInsertSql = insertSqlBase.replace('%VALUES%', '(?,?,?,?,?,UNIX_TIMESTAMP(),UNIX_TIMESTAMP())');

    for (let start = 0; start < preparedRows.length; start += BATCH_SIZE) {
      const chunk = preparedRows.slice(start, start + BATCH_SIZE);
      const placeholders = chunk
        .map(() => '(?,?,?,?,?,UNIX_TIMESTAMP(),UNIX_TIMESTAMP())')
        .join(',');
      const params = [];
      chunk.forEach(row => {
        params.push(
          row.cookiesText,
          row.ckUid,
          row.storeCountryCode,
          row.priorityCode,
          0
        );
      });

      try {
        await connection.execute(insertSqlBase.replace('%VALUES%', placeholders), params);
        successCount += chunk.length;
        console.log(
          `  ✅ 批次 ${Math.floor(start / BATCH_SIZE) + 1} 写入 ${chunk.length} 条 (累计 ${successCount})`
        );
      } catch (chunkError) {
        console.warn(
          `⚠️  批次 ${Math.floor(start / BATCH_SIZE) + 1} 批量插入失败，降级为单条处理: ${chunkError.message}`
        );
        for (const row of chunk) {
          try {
            await connection.execute(singleInsertSql, [
              row.cookiesText,
              row.ckUid,
              row.storeCountryCode,
              row.priorityCode,
              0,
            ]);
            successCount++;
            console.log(
              `    ✅ 行 ${row.lineNumber} 写入成功 (${row.sessionPreview}, CK UID: ${row.ckUid || 'N/A'})`
            );
          } catch (rowError) {
            failCount++;
            const errorMsg = `行 ${row.lineNumber} 降级写入失败: ${rowError.message}`;
            errors.push(errorMsg);
            console.error(`    ❌ ${errorMsg}`);
          }
        }
      }
    }

    // 提交事务
    await connection.commit();
    console.log('\n📊 处理完成:');
    console.log(`   成功: ${successCount} 条`);
    console.log(`   失败: ${failCount} 条`);
    
    if (errors.length > 0) {
      console.log('\n⚠️  错误详情:');
      errors.forEach(err => console.log(`   ${err}`));
    }

    console.log(`\n✅ 所有数据已上传到表: ${tableName}`);

  } catch (error) {
    if (connection) {
      await connection.rollback();
      console.error('❌ 事务已回滚');
    }
    console.error('❌ 上传失败:', error.message);
    if (config.env === 'dev') {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('🔌 数据库连接已关闭');
    }
  }
}

// 确保表存在
async function ensureTableExists(connection, tableName) {
  try {
    // 检查表是否存在
    const [tables] = await connection.execute(
      `SELECT COUNT(*) as count FROM information_schema.tables 
       WHERE table_schema = ? AND table_name = ?`,
      [config.mysql.database, tableName]
    );

    if (tables[0].count === 0) {
      console.log(`📋 表 ${tableName} 不存在，正在创建...`);
      
      // 创建表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS \`${tableName}\` (
          \`id\` int(11) unsigned NOT NULL AUTO_INCREMENT,
          \`cookies_text\` varchar(6000) NOT NULL DEFAULT '' COMMENT 'cookies',
          \`ck_uid\` bigint(18) NOT NULL DEFAULT '0' COMMENT 'ck的uid',
          \`status\` tinyint(1) NOT NULL DEFAULT '0' COMMENT '账号状态{radio}(0:待检测,1:已检测,2:已风控,3:已退出,4:已封禁,5:维护社区,6:发送太快)',
          \`used_count\` int(11) NOT NULL DEFAULT '0' COMMENT '总使用次数',
          \`day_count\` int(11) NOT NULL DEFAULT '0' COMMENT '当前使用次数',
          \`priority_code\` tinyint(1) NOT NULL DEFAULT '0' COMMENT '使用优先级',
          \`create_time\` int(11) NOT NULL DEFAULT '0' COMMENT '创建时间',
          \`update_time\` int(11) NOT NULL DEFAULT '0' COMMENT '更新时间',
          \`job_status\` tinyint(1) NOT NULL DEFAULT '0' COMMENT '脚本状态{radio}(0:待使用,1:使用中)',
          \`store_country_code\` varchar(100) NOT NULL DEFAULT '' COMMENT '国家代码',
          \`error_count\` int(11) NOT NULL DEFAULT '0' COMMENT '脚本执行错误次数',
           \`is_aync\` int(11) NOT NULL DEFAULT '0' COMMENT '脚本执行错误次数',
          PRIMARY KEY (\`id\`) USING BTREE,
          KEY \`idx_job_status\` (\`job_status\`) USING BTREE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);
      
      console.log(`✅ 表 ${tableName} 创建成功`);
    } else {
      console.log(`✅ 表 ${tableName} 已存在`);
      await ensureColumnExists(connection, tableName, 'day_count', `ALTER TABLE \`${tableName}\` ADD COLUMN \`day_count\` int(11) NOT NULL DEFAULT '0' COMMENT '当前使用次数' AFTER \`used_count\``);
      await ensureColumnExists(connection, tableName, 'job_status', `ALTER TABLE \`${tableName}\` ADD COLUMN \`job_status\` tinyint(1) NOT NULL DEFAULT '0' COMMENT '脚本状态{radio}(0:待使用,1:使用中)' AFTER \`update_time\``);
      await ensureColumnExists(connection, tableName, 'store_country_code', `ALTER TABLE \`${tableName}\` ADD COLUMN \`store_country_code\` varchar(100) NOT NULL DEFAULT '' COMMENT '国家代码' AFTER \`job_status\``);
      await ensureColumnExists(connection, tableName, 'error_count', `ALTER TABLE \`${tableName}\` ADD COLUMN \`error_count\` int(11) NOT NULL DEFAULT '0' COMMENT '脚本执行错误次数' AFTER \`store_country_code\``);
      await ensureIndexExists(connection, tableName, 'idx_job_status', `ALTER TABLE \`${tableName}\` ADD KEY \`idx_job_status\` (\`job_status\`) USING BTREE`);
      await ensureColumnDefinition(connection, tableName, 'status', `ALTER TABLE \`${tableName}\` MODIFY COLUMN \`status\` tinyint(1) NOT NULL DEFAULT '0' COMMENT '账号状态{radio}(0:待检测,1:已检测,2:已风控,3:已退出,4:已封禁,5:维护社区,6:发送太快)'`);
      await ensureColumnDefinition(connection, tableName, 'store_country_code', `ALTER TABLE \`${tableName}\` MODIFY COLUMN \`store_country_code\` varchar(100) NOT NULL DEFAULT '' COMMENT '国家代码'`);
    }
  } catch (error) {
    console.error(`❌ 检查/创建表失败: ${error.message}`);
    throw error;
  }
}

// 确保表字段存在（用于兼容老表结构）
async function ensureColumnExists(connection, tableName, columnName, alterSql) {
  const [columns] = await connection.execute(
    `SELECT COUNT(*) as count FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?`,
    [config.mysql.database, tableName, columnName]
  );
  if (columns[0].count === 0) {
    console.log(`ℹ️  表 ${tableName} 缺少字段 ${columnName}，正在补充...`);
    await connection.execute(alterSql);
    console.log(`✅ 字段 ${columnName} 添加成功`);
  }
}

// 确保索引存在
async function ensureIndexExists(connection, tableName, indexName, alterSql) {
  const [indexes] = await connection.execute(
    `SELECT COUNT(1) AS count FROM information_schema.statistics WHERE table_schema = ? AND table_name = ? AND index_name = ?`,
    [config.mysql.database, tableName, indexName]
  );
  if (indexes[0].count === 0) {
    console.log(`ℹ️  表 ${tableName} 缺少索引 ${indexName}，正在补充...`);
    await connection.execute(alterSql);
    console.log(`✅ 索引 ${indexName} 添加成功`);
  }
}

// 调整现有字段定义
async function ensureColumnDefinition(connection, tableName, columnName, alterSql) {
  try {
    await connection.execute(alterSql);
    console.log(`✅ 字段 ${columnName} 定义已同步`);
  } catch (error) {
    // 如果数据库不支持重复修改，忽略错误
    console.warn(`⚠️  同步字段 ${columnName} 失败: ${error.message}`);
  }
}

// 运行脚本
uploadCookies().catch(error => {
  console.error('❌ 脚本执行失败:', error);
  process.exit(1);
});

