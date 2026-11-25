/**
 * 审批放行规则巡检（2026-11-25）
 *
 * 用法：
 *   bun run audit:approval-rules                 # 只扫描（发现 high ⇒ 退出码 2）
 *   bun run audit:approval-rules -- --show-ok    # 连精确/指纹规则一起列出
 *   bun run audit:approval-rules -- --json       # 机器可读输出
 *   bun run audit:approval-rules -- --fix        # 删除 high 风险规则（先备份）
 *
 * 判据（唯一实现）：`@openliri/infra/permission/approvalRuleAudit`
 *  - high：解释器/壳内建前缀、危险命令头前缀、命令类工具整工具放行；
 *  - review：无法解析命令头 / 非只读可变前缀；
 *  - low：只读命令前缀；ok：精确匹配 / 参数指纹。
 *
 * 安全取向：
 *  - 缺省**只读演练**；`--fix` 才落盘；
 *  - `--fix` 只删 `origin=approval` 的 high 规则（用户手建规则不自动删除）；
 *  - 落盘前备份到 `~/.pyapp/backups/tool_rules-pre-cleanup-<ts>.json`；
 *  - 若本机 Liri 正在运行（`.liri.lock` 的 PID 存活），走 HTTP `DELETE`（同时清放行缓存），
 *    否则直接改规则文件（原子写）。两者都不会产生"内存覆盖磁盘"的双写。
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import {
  resolvePermissionsDir,
  resolvePyappHome,
} from '@openliri/infra/environment/paths';
import {
  auditApprovalRules,
  type ApprovalRuleAuditReport,
  type AuditRuleInput,
} from '@openliri/infra/permission';

interface LiveApi {
  baseUrl: string;
  pid: number;
}

function argFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function rulesFilePath(): string {
  return join(resolvePermissionsDir(), 'tool_rules.json');
}

function readRules(): AuditRuleInput[] {
  const path = rulesFilePath();
  if (!existsSync(path)) return [];
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (!Array.isArray(raw)) {
    throw new Error(`规则文件格式异常（期望数组）：${path}`);
  }
  return raw as AuditRuleInput[];
}

/** 合并命中计数（`data/permission/rule_hits.json`；缺失/损坏 ⇒ 0） */
function readHitCounts(): Record<string, number> {
  const path = join(resolvePyappHome(), 'data', 'permission', 'rule_hits.json');
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      rules?: Record<string, { count?: number }>;
    };
    const out: Record<string, number> = {};
    for (const [id, entry] of Object.entries(raw.rules ?? {})) {
      out[id] = Number(entry?.count ?? 0);
    }
    return out;
  } catch {
    return {};
  }
}

/** 本机 Liri 是否在跑（读 `.liri.lock` 并校验 PID 存活） */
function resolveLiveApi(): LiveApi | null {
  const lockPath = join(resolvePyappHome(), 'data', '.liri.lock');
  if (!existsSync(lockPath)) return null;
  try {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as {
      pid?: number;
      port?: number;
      host?: string;
    };
    const pid = Number(lock.pid);
    const port = Number(lock.port);
    if (!pid || !port) return null;
    process.kill(pid, 0); // 不存在 ⇒ 抛 ESRCH
    const host =
      lock.host === '0.0.0.0' ? '127.0.0.1' : (lock.host ?? '127.0.0.1');
    return { baseUrl: `http://${host}:${port}`, pid };
  } catch {
    return null;
  }
}

async function deleteViaApi(api: LiveApi, ids: string[]): Promise<string[]> {
  const succeeded: string[] = [];
  for (const id of ids) {
    const res = await fetch(
      `${api.baseUrl}/v1/permissions/rules/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    );
    if (res.ok) {
      succeeded.push(id);
      console.log(`DELETE ${id} ok`);
    } else {
      console.warn(`DELETE ${id} failed: HTTP ${res.status}`);
    }
  }
  return succeeded;
}

function deleteViaFile(ids: ReadonlySet<string>): void {
  const path = rulesFilePath();
  const rules = readRules();
  const kept = rules.filter((rule) => !ids.has(rule.id));
  if (kept.length === rules.length) return;

  mkdirSync(join(resolvePyappHome(), 'backups'), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = join(
    resolvePyappHome(),
    'backups',
    `tool_rules-pre-cleanup-${stamp}.json`
  );
  copyFileSync(path, backup);
  console.log(`BACKUP ${backup}`);

  const tmp = `${path}.tmp-${process.pid}`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(tmp, `${JSON.stringify(kept, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
  console.log(`WROTE ${path}（删除 ${rules.length - kept.length} 条）`);
}

function printReport(report: ApprovalRuleAuditReport, showOk: boolean): void {
  console.log(`TOTAL_RULES ${report.total}`);
  console.log(`AUDITED ${report.audited.length}（命令类工具的 allow）`);
  console.log(
    `COUNTS high=${report.counts.high} review=${report.counts.review} low=${report.counts.low} ok=${report.counts.ok}`
  );
  const rows = showOk
    ? report.audited
    : report.audited.filter((row) => row.level !== 'ok');
  if (rows.length === 0) {
    console.log('（没有需要关注的规则）');
  }
  for (const row of rows) {
    console.log(
      `${row.level.toUpperCase().padEnd(6)} ${row.kind.padEnd(16)} head=${(
        row.head || '-'
      ).padEnd(
        12
      )} hit=${String(row.hitCount).padStart(4)} origin=${row.origin.padEnd(
        8
      )} id=${row.id} pattern=${row.pattern}`
    );
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const fix = argFlag(argv, '--fix');
  const asJson = argFlag(argv, '--json');
  const showOk = argFlag(argv, '--show-ok');

  const hits = readHitCounts();
  const rules = readRules().map((rule) => ({
    ...rule,
    hitCount: hits[rule.id] ?? 0,
  }));
  const report = auditApprovalRules(rules);

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report, showOk);
  }

  if (!fix) {
    if (report.high.length > 0) process.exitCode = 2;
    return;
  }

  // --fix：只处理审批生成的 high 规则（用户手建规则不自动删除）
  const fixable = report.high.filter((row) => row.origin === 'approval');
  const skipped = report.high.filter((row) => row.origin !== 'approval');
  if (skipped.length > 0) {
    console.warn(
      `SKIP_USER_RULES ${skipped.length} 条 high 规则非审批生成，未自动删除：${skipped
        .map((row) => row.id)
        .join(', ')}`
    );
  }
  if (fixable.length === 0) {
    console.log('NOTHING_TO_FIX');
    return;
  }

  const ids = fixable.map((row) => row.id);
  const api = resolveLiveApi();
  if (api) {
    console.log(`MODE api ${api.baseUrl}（pid=${api.pid}）`);
    await deleteViaApi(api, ids);
  } else {
    console.log('MODE file（本机 Liri 未运行）');
    deleteViaFile(new Set(ids));
  }

  // 复核
  const after = auditApprovalRules(
    readRules().map((rule) => ({ ...rule, hitCount: hits[rule.id] ?? 0 }))
  );
  console.log(
    `AFTER high=${after.counts.high} review=${after.counts.review} low=${after.counts.low} ok=${after.counts.ok}`
  );
  if (after.high.length > 0) process.exitCode = 1;
}

await main();
