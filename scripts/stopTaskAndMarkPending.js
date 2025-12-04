const TaskStore = require('../utils/taskStore');
const { stopTaskQueue } = require('../services/socketService');
const redis = require('../config/redis');
const dbPool = require('../config/database');
const authPool = dbPool.authPool;

function parseArgs(argv) {
  const parsed = {};
  argv.forEach((arg) => {
    if (arg.startsWith('--')) {
      const slice = arg.slice(2);
      if (slice.includes('=')) {
        const [key, ...rest] = slice.split('=');
        parsed[key] = rest.join('=') || '';
      } else {
        parsed[slice] = true;
      }
      return;
    }

    if (!parsed.taskId) {
      parsed.taskId = arg;
    } else if (!parsed.userId) {
      parsed.userId = arg;
    }
  });

  return parsed;
}

async function closeResources() {
  try {
    await redis.quit();
  } catch (error) {
    console.error('关闭 Redis 失败:', error.message);
  }

  try {
    if (dbPool && typeof dbPool.end === 'function') {
      await dbPool.end();
    }
  } catch (error) {
    console.error('关闭本地 MySQL 连接池失败:', error.message);
  }

  try {
    if (authPool && typeof authPool.end === 'function') {
      await authPool.end();
    }
  } catch (error) {
    console.error('关闭 Auth MySQL 连接池失败:', error.message);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const taskId = String(args.taskId || '').trim();
  let userId = args.userId ? String(args.userId).trim() : '';
  const stopReason = String(args.reason || args.r || 'script_stop_pending_settlement').trim();

  if (!taskId) {
    console.error('❌ 请提供 taskId，例如: node scripts/stopTaskAndMarkPending.js --taskId=xxx [--userId=yyy]');
    process.exitCode = 1;
    return;
  }

  try {
    if (!userId) {
      const status = await TaskStore.getTaskStatus(taskId);
      if (!status || !status.userId) {
        throw new Error('无法从任务状态中读取 userId，请通过 --userId 显式传入');
      }
      userId = status.userId;
    }

    console.log('🛑 正在停止任务:');
    console.log(`   taskId: ${taskId}`);
    console.log(`   userId: ${userId}`);
    console.log(`   reason: ${stopReason}`);

    const result = await stopTaskQueue(userId, taskId, stopReason, {
      markPendingSettlement: true,
      cleanupQueue: true,
      cleanupTaskStats: true,
    });

    const stats = result?.stats || (await TaskStore.getTaskStats(taskId));
    console.log('✅ 停止完成，当前统计:');
    console.table({
      total: stats?.total || 0,
      success: stats?.success || 0,
      fail: stats?.fail || 0,
      remaining: stats?.remaining || 0,
    });
    console.log('📌 任务状态已标记为 pending_settlement，请手动执行结算流程。');
  } catch (error) {
    console.error('❌ 脚本执行失败:', error.message);
    process.exitCode = 1;
  } finally {
    await closeResources();
  }
}

if (require.main === module) {
  main().finally(() => {
    setTimeout(() => process.exit(process.exitCode || 0), 100);
  });
}

