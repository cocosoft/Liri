/**
 * 阶段 B · 提交① 存量迁移：`registry` → **写入点 JSONL** + **明细归档（chunk JSONL）**
 *
 * 共享库：`scripts/lib/evidenceStore.ts`（编解码/自检口径**单一实现**，与 `gen-evidence-views.ts` 复用）
 * 上位方案：`dev_docs/20261014/阶段B-台账单写入点与视图生成-方案.md`（§3.1 / §3.1.1 / §4）
 *
 * 幂等：重复运行结果一致。自检不过 ⇒ `exit 1`（**不落盘**）。
 * 运行：`bun run scripts/migrate-evidence-to-jsonl.ts`
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

import {
  CHANGELOG,
  CL_BEGIN,
  CL_BLOCK_ID,
  CL_BLOCK_KEY,
  CL_END,
  DETAIL,
  DETAIL_REF_PREFIX,
  LOG,
  MAX_DETAIL_LINE,
  MAX_LOG_LINE,
  REGISTRY,
  chunkText,
  encodeDetailRows,
  decodeDetailRows,
  findAnchor,
  findUnreleasedBlock,
  flagCode,
  isFreshBullet,
  joinField,
  readJsonl,
  scopeOf,
  stageCode,
  type DetailRow,
  type RegistryItem,
} from './lib/evidenceStore';

/** 已弃用的折行 md 归档（不可无损反解） */
const LEGACY_MD = `${dirname(DETAIL)}/evidence-notes.md`;

/** 去掉生成物短化尾巴（指针 + 省略号）⇒ 得到「短化头」（原文前缀） */
const stripShort = (s: string): string =>
  s.replace(/（全文见 [^）]*）$/, '').replace(/…$/, '');

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
  // ⚠️ **不得**用**生成物 registry**（已短化）重建条目明细 —— 那会把原文缩短（数据损失）。
  //    实测教训（2026-10-14）：曾因此把归档 3,524 行截成 2,971 行；已从 git 恢复并加此守卫。
  // `--detail <file>`：**新片**追加明细（一个 JSON 对象：id/title/source/reopenWhen/notes/code/tests/changelog）
  const detailIdx = process.argv.indexOf('--detail');
  const detailArg = detailIdx >= 0 ? process.argv[detailIdx + 1] : undefined;
  const extraItems: RegistryItem[] = detailArg
    ? [JSON.parse(readFileSync(detailArg, 'utf-8')) as RegistryItem]
    : [];
  const regMeta = JSON.parse(readFileSync(REGISTRY, 'utf-8')) as Record<
    string,
    unknown
  >;
  const generated = String(regMeta.$comment ?? '').includes('生成物');
  const existing = existsSync(DETAIL) ? readJsonl<DetailRow>(DETAIL) : [];
  const extraIds = new Set(extraItems.map((i) => i.id));
  const itemRows = generated
    ? [
        ...existing.filter((r) => r.id !== CL_BLOCK_ID && !extraIds.has(r.id)),
        ...encodeDetailRows(extraItems),
      ]
    : encodeDetailRows([...items, ...extraItems]);
  const rows: DetailRow[] = [...itemRows];

  // ②b CHANGELOG「未发布段」→ 归档块（**首次**执行时顺带插入锚点；此后按锚点界定 ⇒ 幂等）
  const clLines = readFileSync(CHANGELOG, 'utf-8').split('\n');
  const anchor = findAnchor(clLines);
  let clOut: string | null = null;
  let blockText: string;
  if (anchor) {
    const raw = clLines.slice(anchor.begin + 1, anchor.end);
    // ⚠️ 归档前**必须剔除**上一次生成的新片 bullet —— 否则「生成物」会被并回历史块，
    //    下次 gen 再渲染一遍 ⇒ **每片递归多一层重复**（实测 2026-10-15：4 层嵌套）。
    //    判定同粒度用 `isFreshBullet`（与 `freshBullet` 同源 ⇒ 形态恒一致）。
    let i = 0;
    while (i < raw.length && (isFreshBullet(raw[i]) || raw[i].trim() === '')) i++;
    blockText = raw.slice(i).join('\n');
  } else {
    const blk = findUnreleasedBlock(clLines);
    if (!blk) {
      console.error(
        '[migrate-evidence] ❌ CHANGELOG 未找到「未发布段」（需 `## [未发布]` 与紧随的 `---`）'
      );
      process.exit(1);
    }
    blockText = clLines.slice(blk.start, blk.end + 1).join('\n');
    clOut = [
      ...clLines.slice(0, blk.start),
      CL_BEGIN,
      ...clLines.slice(blk.start, blk.end + 1),
      CL_END,
      ...clLines.slice(blk.end + 1),
    ].join('\n');
  }
  chunkText(blockText).forEach((c, i) =>
    rows.push({ id: CL_BLOCK_ID, k: CL_BLOCK_KEY, i, c })
  );
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
  const backCount =
    [...back.keys()].filter((k) => k !== CL_BLOCK_ID).length - extraIds.size;
  if (backCount !== items.length)
    problems.push(`反解条目数 ${backCount} ≠ ${items.length}`);
  if (joinField(rows, CL_BLOCK_ID, CL_BLOCK_KEY) !== blockText) {
    problems.push('CHANGELOG 归档块「反解 ≠ 原文」');
  }
  // 归档块必须只剩**历史正文**：空 ⇒ gen 会 fail-closed 拒渲染；仍含生成物 ⇒ 递归重复风险
  if (blockText.trim() === '')
    problems.push('CHANGELOG 归档块为空（未发布段被生成物 bullet 占满？）');
  if (blockText.split('\n').some(isFreshBullet))
    problems.push('CHANGELOG 归档块仍含「新片 bullet」⇒ 会产生重复');
  if (generated) {
    // 既有条目明细**逐字节保持不变**（只允许 `--detail` 新增/替换**指定 id**）
    const key = (r: DetailRow): string => JSON.stringify(r);
    const pick = (src: DetailRow[]): string[] =>
      src
        .filter((r) => r.id !== CL_BLOCK_ID && !extraIds.has(r.id))
        .map(key)
        .sort();
    if (JSON.stringify(pick(existing)) !== JSON.stringify(pick(rows))) {
      problems.push(
        `既有条目明细被改动（${pick(existing).length} → ${pick(rows).length} 行）—— 生成物模式禁止`
      );
    }
    for (const id of extraIds) {
      if (!rows.some((r) => r.id === id))
        problems.push(`--detail 条目无明细行：${id}`);
    }
    const missing = items
      .filter((it) => !rows.some((r) => r.id === it.id))
      .map((i) => i.id);
    if (missing.length > 0) {
      problems.push(
        `生成物模式：${missing.length} 条目归档无明细（如 ${missing[0]}）`
      );
    }
  }
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
      if (src === '') continue;
      if (generated) {
        // 生成物模式：registry 已是**短化**文本 ⇒ 归档原文须以「短化头」为前缀
        const head = stripShort(src);
        if (head !== '' && !(b[k] ?? '').startsWith(head)) {
          problems.push(`${it.id}: 归档 ${k} 非「registry 短化头」前缀`);
        }
      } else if (b[k] !== src) {
        problems.push(`${it.id}: 反解 ${k} 不一致`);
      }
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
  // 生成物模式下 **不重写写入点**（否则会抹掉新追加的行 —— 实测教训 2026-10-14）
  if (!generated) writeFileSync(LOG, `${logLines.join('\n')}\n`, 'utf-8');
  writeFileSync(DETAIL, `${detailLines.join('\n')}\n`, 'utf-8');
  if (clOut !== null) writeFileSync(CHANGELOG, clOut, 'utf-8');
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
