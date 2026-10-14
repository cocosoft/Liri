/**
 * 阶段 B · 提交③：台账视图「**生成物一致性**」drift 门禁（**仅 CI**；方案 §3.3 / Q3 裁定）
 *
 * 做什么：把生成器跑到**临时目录**（不污染工作区），与仓库**提交物**逐字节比对；
 *   不一致 ⇒ `exit 1`，并指出「哪份文件、首个差异行」。
 * 为什么：`registry` / `修复证据登记.md` 已改为**生成物** ⇒
 *   ① **手改生成物**，或 ② **改了 JSONL/归档未重新生成**，都必须被拦。
 * fail-closed（AR-3）：生成器失败 / 文件缺失 ⇒ `exit 1`，**不得**静默当作「0 违规」。
 *
 * 运行：`bun run scripts/lint-evidence-views-drift.ts`（CI 步骤；本地由作者跑 `gen-evidence-views.ts`）
 */

import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { DETAIL, DOC, LOG, PROJECT_ROOT, REGISTRY } from './lib/evidenceStore';

const GEN = join(PROJECT_ROOT, 'scripts', 'gen-evidence-views.ts');
/** 每份文件最多打印的差异行数（保持门禁输出精简 —— SB08） */
const MAX_DIFF_LINES = 2;

const problems: string[] = [];
const tmp = mkdtempSync(join(tmpdir(), 'evidence-views-'));

try {
  const r = spawnSync(process.execPath, [GEN], {
    env: { ...process.env, EVIDENCE_VIEWS_OUT_DIR: tmp },
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (r.status !== 0) {
    console.error(
      '[lint:evidence-views-drift] ❌ 生成器执行失败（fail-closed）：'
    );
    console.error(
      `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n').slice(-6).join('\n')
    );
    process.exit(1);
  }

  const pairs: Array<[string, string, string]> = [
    [
      'fix-evidence-registry.json',
      REGISTRY,
      join(tmp, 'fix-evidence-registry.json'),
    ],
    ['修复证据登记.md', DOC, join(tmp, '修复证据登记.md')],
  ];
  for (const [label, committed, generated] of pairs) {
    if (!existsSync(committed)) {
      problems.push(`${label}: 提交物缺失`);
      continue;
    }
    if (!existsSync(generated)) {
      problems.push(`${label}: 生成结果缺失`);
      continue;
    }
    const a = readFileSync(committed, 'utf8');
    const b = readFileSync(generated, 'utf8');
    if (a === b) continue;
    const la = a.split('\n');
    const lb = b.split('\n');
    let first = 0;
    while (first < la.length && first < lb.length && la[first] === lb[first])
      first++;
    problems.push(
      `${label}: 与生成结果不一致（首个差异行 ${first + 1}）—— ` +
        '手改了生成物，或改了 JSONL/归档后未重新生成'
    );
    for (let i = first; i < first + MAX_DIFF_LINES; i++) {
      if (la[i] === undefined && lb[i] === undefined) break;
      problems.push(`   提交物: ${(la[i] ?? '<eof>').slice(0, 150)}`);
      problems.push(`   生成物: ${(lb[i] ?? '<eof>').slice(0, 150)}`);
    }
  }

  for (const [label, p] of [
    ['写入点 JSONL', LOG],
    ['明细归档', DETAIL],
  ] as Array<[string, string]>) {
    if (!existsSync(p)) problems.push(`${label}缺失: ${p}`);
  }
} finally {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    // @ignore-catch — 临时目录清理失败不影响判定
  }
}

console.log('=== 台账视图 drift 门禁（阶段 B） ===');
if (problems.length > 0) {
  console.error('❌ 存在漂移/缺失：');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('✅ 生成物与提交物一致（registry + 修复证据登记.md）');
