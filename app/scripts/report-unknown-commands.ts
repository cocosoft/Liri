/**
 * report-unknown-commands — 未知命令采样报表（P4，2026-11-12）
 *
 * 背景：`未知命令 ⇒ ask` 之后，缺口的表现从"静默放行"变成"审批噪音"。
 * 分类器在未知分支记录 `permission:unknown_command`（同名每进程一次），本脚本把
 * 应用日志里的这些记录**按命令名聚合**，输出 Top N —— 供每周评审补进
 * `commandSpecs.ts`（P4 验收口径：未知命令采样进评审，而不是攒着不管）。
 *
 * 用法：
 *   bun run stats:unknown-commands              # 默认扫 ~/.pyapp/data/logs/app.log*（含轮转）
 *   bun run stats:unknown-commands --log <path> --top 30
 *
 * 说明：报表工具，**不是门禁** —— 始终 exit 0（除非日志不可读）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDataDir } from '@openliri/infra/environment';

const args = process.argv.slice(2);
const logIndex = args.indexOf('--log');
const topIndex = args.indexOf('--top');
const logsDir = join(resolveDataDir(), 'logs');
/**
 * 2026-11-12（P7）：默认覆盖**轮转日志**。埋点是当日新增，首轮采样必然落在
 * `app.log` 之外的轮转文件里；只读当前文件会得出"0 条"的错误结论。
 */
const explicitLog =
  logIndex >= 0 && args[logIndex + 1] ? args[logIndex + 1]! : null;
const logPaths = explicitLog
  ? [explicitLog]
  : existsSync(logsDir)
    ? readdirSync(logsDir)
        .filter((name) => name.startsWith('app.log'))
        .map((name) => join(logsDir, name))
    : [];
const top = topIndex >= 0 ? Number(args[topIndex + 1] ?? 20) : 20;

if (logPaths.length === 0) {
  console.log(`[unknown-commands] 日志不存在：${logsDir}（跳过）`);
  process.exit(0);
}

const counts = new Map<string, number>();
let matched = 0;
for (const logPath of logPaths) {
  for (const line of readFileSync(logPath, 'utf8').split('\n')) {
    if (!line.includes('permission:unknown_command')) continue;
    matched += 1;
    try {
      const record = JSON.parse(line) as { meta?: { head?: unknown } };
      const head = typeof record.meta?.head === 'string' ? record.meta.head : '';
      if (!head) continue;
      counts.set(head, (counts.get(head) ?? 0) + 1);
    } catch {
      // @ignore-catch — 单行解析失败不影响整体报表
    }
  }
}

const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
console.log(
  `[unknown-commands] 扫描 ${logPaths.length} 个日志 命中=${matched} 去重命令=${counts.size}`
);
if (rows.length === 0) {
  console.log('（无未收录命令记录：要么没有 auto 档会话，要么缺口已被注册表覆盖）');
  process.exit(0);
}
console.log('命令名\t次数');
for (const [head, count] of rows) console.log(`${head}\t${count}`);
console.log(
  '\n处置：把高频项按 OperationKind 补进 packages/infra/src/security/patterns/commandSpecs.ts，' +
    '并同步收紧 lint-command-coverage 的观察口径。'
);
