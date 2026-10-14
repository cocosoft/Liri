/**
 * 阶段 B · 提交① 存量迁移：`registry` → **写入点 JSONL** + **明细归档（chunk JSONL）**
 *
 * 共享库：`scripts/lib/evidenceStore.ts`（编解码/自检口径**单一实现**，与 `gen-evidence-views.ts` 复用）
 * 上位方案：`dev_docs/20261014/阶段B-台账单写入点与视图生成-方案.md`（§3.1 / §3.1.1 / §4）
 *
 * 幂等：重复运行结果一致。自检不过 ⇒ `exit 1`（**不落盘**）。
 * 运行：`bun run scripts/migrate-evidence-to-jsonl.ts`
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  DETAIL,
  DETAIL_REF_PREFIX,
  LOG,
  MAX_DETAIL_LINE,
  MAX_LOG_LINE,
  REGISTRY,
  encodeDetailRows,
  decodeDetailRows,
  flagCode,
  scopeOf,
  stageCode,
  type RegistryItem,
} from './lib/evidenceStore';

/** 已弃用的折行 md 归档（不可无损反解） */
const LEGACY_MD = `${dirname(DETAIL)}/evidence-notes.md`;

function main(): void {
  const reg = JSON.parse(readFileSync(REGISTRY, 'utf-8')) as {
    items: RegistryItem[];
  };
  const items = reg.items ?? [];

  // ① 写入点（结论 + 计数 + 指针）
  const logLines = items.map((it) =>
    JSON.stringify({
      id: it.id,
      scope: scopeOf(it.title),
      stages: stageCode(it.stages),
      flags: flagCode(it.flags),
      files: (it.code ?? []).length,
      tn: (it.tests ?? []).length,
      ref: `${DETAIL_REF_PREFIX}${it.id}`,
    })
  );

  // ② 明细归档
  const rows = encodeDetailRows(items);
  const detailLines = rows.map((r) => JSON.stringify(r));

  // ③ 自检（不过则不落盘）
  const problems: string[] = [];
  const logOver = logLines.filter((l) => l.length > MAX_LOG_LINE);
  if (logOver.length > 0)
    problems.push(`写入点 ${logOver.length} 行超 ${MAX_LOG_LINE}`);
  const detOver = detailLines.filter((l) => l.length > MAX_DETAIL_LINE);
  if (detOver.length > 0)
    problems.push(`归档 ${detOver.length} 行超 ${MAX_DETAIL_LINE}`);

  const back = decodeDetailRows(rows);
  if (back.size !== items.length)
    problems.push(`反解条目数 ${back.size} ≠ ${items.length}`);
  items.forEach((it, i) => {
    const rec = JSON.parse(logLines[i]) as Record<string, unknown>;
    if (rec.id !== it.id) problems.push(`${it.id}: id 不一致`);
    if (rec.stages !== stageCode(it.stages))
      problems.push(`${it.id}: stages 不一致`);
    if (rec.flags !== flagCode(it.flags))
      problems.push(`${it.id}: flags 不一致`);
    if (rec.files !== (it.code ?? []).length)
      problems.push(`${it.id}: files 计数不一致`);
    if (rec.tn !== (it.tests ?? []).length)
      problems.push(`${it.id}: tn 计数不一致`);

    const b = back.get(it.id);
    if (!b) {
      problems.push(`${it.id}: 归档反解缺失`);
      return;
    }
    for (const k of ['title', 'source', 'reopenWhen', 'notes'] as const) {
      const src = (it[k] ?? '').trim();
      if (src !== '' && b[k] !== src)
        problems.push(`${it.id}: 反解 ${k} 不一致`);
    }
    for (const field of ['code', 'tests', 'changelog'] as const) {
      const a = it[field] ?? [];
      const c = b[field] ?? [];
      if (a.length !== c.length) {
        problems.push(`${it.id}: 反解 ${field} 长度 ${c.length} ≠ ${a.length}`);
        continue;
      }
      a.forEach((el, n) => {
        if (c[n] !== el) problems.push(`${it.id}: 反解 ${field}[${n}] 不一致`);
      });
    }
  });

  if (problems.length > 0) {
    console.error('[migrate-evidence] ❌ 自检未过（未落盘）：');
    for (const p of problems.slice(0, 10)) console.error(`  - ${p}`);
    process.exit(1);
  }

  mkdirSync(dirname(DETAIL), { recursive: true });
  writeFileSync(LOG, `${logLines.join('\n')}\n`, 'utf-8');
  writeFileSync(DETAIL, `${detailLines.join('\n')}\n`, 'utf-8');
  try {
    rmSync(LEGACY_MD, { force: true });
  } catch {
    // @ignore-catch — 弃用文件可能不存在
  }

  const maxLog = logLines.reduce((m, l) => Math.max(m, l.length), 0);
  const maxDet = detailLines.reduce((m, l) => Math.max(m, l.length), 0);
  console.log(
    `[migrate-evidence] ✅ items=${items.length} · logLines=${logLines.length} · maxLog=${maxLog}/${MAX_LOG_LINE} · ` +
      `detailRows=${detailLines.length} · maxDetail=${maxDet}/${MAX_DETAIL_LINE}`
  );
}

main();
