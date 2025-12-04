/**
 * 将本地 config.dev.js 指定表中 status = 0 的记录迁移到 config.prod.js 对应表
 *
 * 使用:
 *   node scripts/migrateCookiesToProd.js [tableName] [batchSize]
 */

const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const devConfig = require('../config/config.dev');
const prodConfig = require('../config/config.prod');

const tableName = process.argv[2] || 'uni_cookies_3';
const tableName2 = process.argv[3] || 'uni_cookies_0';
const BATCH_SIZE = Number(process.argv[3]) || 500;

async function migrate() {
  const source = await mysql.createConnection(devConfig.mysql);
  const target = await mysql.createConnection(prodConfig.mysql);

  console.log(`🚀 迁移开始：${tableName}, batchSize=${BATCH_SIZE}`);

  let lastId = 0;
  let totalMigrated = 0;

const selectSql = `
    SELECT id, cookies_text, ck_uid, store_country_code, priority_code,
           status, used_count, day_count, job_status, error_count,
           create_time, update_time
    FROM \`${tableName}\`
    WHERE status = 1 AND is_aync = 0 AND id > ?
    ORDER BY id ASC
    LIMIT ?
  `;

  const buildInsertSql = (rows) => {
    const placeholders = rows
      .map(
        () =>
          '(?,?,?,?,?,?,?,?,?,?,?)'
      )
      .join(',');

    return {
      sql: `
        INSERT INTO \`${tableName2}\`
          (cookies_text, ck_uid, store_country_code, priority_code,
           status, used_count, day_count, job_status, error_count,
           create_time, update_time)
        VALUES ${placeholders}
        ON DUPLICATE KEY UPDATE
          cookies_text = VALUES(cookies_text),
          ck_uid = VALUES(ck_uid),
          store_country_code = VALUES(store_country_code),
          priority_code = VALUES(priority_code),
          status = VALUES(status),
          used_count = VALUES(used_count),
          day_count = VALUES(day_count),
          job_status = VALUES(job_status),
          error_count = VALUES(error_count),
          update_time = VALUES(update_time)
      `,
      params: rows.flatMap((row) => [
        row.cookies_text || '',
        Number(row.ck_uid) || 0,
        row.store_country_code || '',
        Number(row.priority_code) || 0,
        Number(row.status) || 0,
        Number(row.used_count) || 0,
        Number(row.day_count) || 0,
        Number(row.job_status) || 0,
        Number(row.error_count) || 0,
        Number(row.create_time) || Math.floor(Date.now() / 1000),
        Number(row.update_time) || Math.floor(Date.now() / 1000),
      ]),
    };
  };

  try {
    while (true) {
      const [rows] = await source.execute(selectSql, [lastId, BATCH_SIZE]);
      if (!rows.length) {
        break;
      }

      lastId = rows[rows.length - 1].id;

      const { sql, params } = buildInsertSql(rows);
      const processedIds = rows.map(row => row.id);

      try {
        await target.beginTransaction();
        await target.execute(sql, params);
        await target.commit();
        totalMigrated += rows.length;
        console.log(`  ✅ 已迁移 ${totalMigrated} 条 (最新 ID: ${lastId})`);

        const sourcePlaceholders = processedIds.map(() => '?').join(',');
        const updateSql = `
          UPDATE \`${tableName}\`
          SET is_aync = 1, update_time = UNIX_TIMESTAMP()
          WHERE id IN (${sourcePlaceholders})
        `;
        await source.execute(updateSql, processedIds);
      } catch (insertError) {
        await target.rollback();
        console.error(
          `  ❌ 批次写入失败 (ID <= ${lastId}): ${insertError.message}`
        );
        throw insertError;
      }
    }

    console.log(`\n🎉 迁移完成，累计 ${totalMigrated} 条 status=0 记录已同步到生产库 ${tableName}`);
  } catch (error) {
    console.error('❌ 迁移过程中发生错误:', error);
  } finally {
    await source.end();
    await target.end();
    console.log('🔌 数据库连接已关闭');
  }
}

migrate();

