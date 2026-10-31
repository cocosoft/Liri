/**
 * 会话数据保留策略执行器（2026-10-31，台账「数据保留策略」项）
 *
 * 用法：
 *   bun run prune:sessions                 # 演练（只统计"会删哪些"，不动文件）
 *   bun run prune:sessions -- --apply      # 按策略真删（软删除：rename 到 <sessionsDir>/.trash）
 *   bun run prune:sessions -- --dir <path> # 指定会话目录（默认按 worktree 解析）
 *
 * 阈值来源：`~/.pyapp/config.json` 的 `dataRetention` 段（类型见
 * `src/config/types.ts#DataRetentionConfig`）；缺省 100 会话 / 90 天 / 500MB。
 *
 * 安全取向（与 `code-deletion.md` 一致）：
 *  - 缺省**演练**，`--apply` 才落盘；
 *  - 落盘也是**软删除**（`.trash`，可人工恢复），不做不可逆 unlink；
 *  - `LIRI_DATA_DIR` 参与解析 ⇒ 测试/隔离实例不会碰到真实数据。
 */
import { existsSync, readFileSync } from 'node:fs';

import {
  resolveSessionsDir,
  resolveUserConfigPath,
} from '../src/environment/paths';
import {
  DEFAULT_DATA_RETENTION,
  SessionPruning,
  buildPruningConfig,
  type DataRetentionConfig,
  type PruningConfig,
} from '../src/session/SessionPruning';

/** 读取 `dataRetention` 段（缺失/损坏 ⇒ undefined，按缺省策略） */
function readRetention(
  configPath: string
): DataRetentionConfig | undefined {
  if (!existsSync(configPath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8')) as {
      dataRetention?: DataRetentionConfig;
    };
    return parsed.dataRetention;
  } catch (error) {
    console.warn(
      `⚠️ 配置无法解析，按缺省保留策略处理：${String(error)}（${configPath}）`
    );
    return undefined;
  }
}

function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const configPath = resolveUserConfigPath();
  const retention = readRetention(configPath);
  const sessionsDir = argValue(argv, '--dir') ?? resolveSessionsDir();

  const config: PruningConfig = buildPruningConfig({
    retention,
    sessionsDir,
    forceApply: apply,
    forceDryRun: !apply,
  });

  const policyEnabled = retention?.enabled ?? DEFAULT_DATA_RETENTION.enabled;

  console.log('=== 会话数据保留策略 ===');
  console.log(`会话目录: ${config.sessionsDir}`);
  console.log(
    `阈值: 最多 ${config.maxSessions} 个会话 / 最旧 ${config.maxAgeDays} 天 / 上限 ${config.maxSizeMB} MB`
  );
  console.log(
    `模式: ${config.dryRun ? '演练（不移动文件）' : '执行（软删除到 .trash）'}`
  );
  console.log(`配置项 dataRetention.enabled: ${policyEnabled ? 'true' : 'false'}`);

  // `enabled` 是**落盘联锁**（不是"是否允许运行"）：演练随时可跑，真删必须先显式开启策略。
  if (!config.dryRun && !policyEnabled) {
    console.error(
      '\n❌ dataRetention.enabled=false ⇒ 拒绝执行落盘删除。\n' +
        '   请先在 ~/.pyapp/config.json 设置 {"dataRetention":{"enabled":true}} 后重试；\n' +
        '   若要预览将被删除的会话，去掉 --apply（演练）。'
    );
    process.exit(2);
  }

  if (!existsSync(config.sessionsDir)) {
    console.log('会话目录不存在 ⇒ 无需修剪。');
    return;
  }

  const result = await new SessionPruning(config).prune();

  console.log('');
  console.log(
    `${config.dryRun ? '将修剪' : '已修剪'} ${result.sessionsPruned} 个会话，` +
      `合计 ${(result.bytesFreed / 1024 / 1024).toFixed(2)} MB`
  );
  for (const name of result.prunedSessions.slice(0, 20)) {
    console.log(`  - ${name}`);
  }
  if (result.prunedSessions.length > 20) {
    console.log(`  … 其余 ${result.prunedSessions.length - 20} 个略`);
  }
  for (const err of result.errors) {
    console.warn(`  ⚠️ ${err}`);
  }
  if (config.dryRun && result.sessionsPruned > 0) {
    console.log('\n如需实际清理：bun run prune:sessions -- --apply');
  }
}

await main();

// 显式退出（台账 N-16 / N-49）：入口脚本必须主动结束进程 —— 一旦将来引入长驻句柄
// （定时器 / DB / OAuth 等），逻辑跑完后进程不会自行退出，表现为"命令卡住不返回"。
process.exit(0);
