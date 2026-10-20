/**
 * 状态字面量**棘轮核心**（纯函数，零 I/O / 零依赖 —— 供 CLI 与负向自证测试复用）。
 *
 * 背景（外部建议 ⑦「Register-or-Fail」，2026-10-20 落地）：全仓状态机词汇已集中在
 * `app/src/state/engine/stateMachineCatalog.ts`（`STATE_MACHINES` 逐台登记 + `BOUNDARY_STATE_MACHINES`
 * 同名不同物登记），但「**新增**一个未报备的状态字面量」此前无人拦 ⇒ 本门禁扫描
 * `app/src` 的**字符串字面量**，凡取值落在已登记状态词汇表内、且 (value, file) 不在
 * 基线也不在事实源白名单 ⇒ **CI 阻断**（要么改用规范枚举/常量，要么显式登记 + 更新基线）。
 *
 * 误报控制（**棘轮**口径）：现存合法出现点全部收编基线 —— 门禁**只拦增量、不追溯清理**，
 * 与 `lint:complexity` / `lint:fn-size` 同哲学。
 *
 * 已知盲区（词法级扫描的固有权衡，如实登记）：
 * - **正则字面量**内含引号时可能误吞后续代码（不产生误报，只可能漏报一处）；
 * - **模板字面量**内容整体跳过（`${'status'}` 形态漏报）；
 * - 扫描范围限 `app/src`（`client/` 前端词汇表镜像另册管理，见目录 `budgetMode` 条目 note）。
 */

/** 目录条目的最小结构（避免核心反向依赖 catalog 模块；边界条目无 states） */
export interface StateMachineCatalogLike {
  states?: readonly string[];
  /** 事实源文件（repo 相对 POSIX 路径，如 `app/src/execution/types.ts`） */
  sourceFile: string;
}

/** 一次扫描的输入文件（CLI 负责 fs 遍历，核心保持纯函数） */
export interface ScannedFile {
  /** repo 相对 POSIX 路径（与基线键同口径） */
  file: string;
  text: string;
}

/** 一处状态词汇命中 */
export interface StateLiteralHit {
  value: string;
  file: string;
}

/** 棘轮基线（`value → files[]`，value 字典序 / files 内字典序，保证 diff 稳定） */
export interface StateLiteralBaseline {
  version: number;
  note?: string;
  files: Record<string, string[]>;
}

/** 从目录条目收集状态词汇表（多台机器同名取值自动去重） */
export function collectVocabulary(
  machines: readonly StateMachineCatalogLike[]
): Set<string> {
  const set = new Set<string>();
  for (const m of machines) {
    if (!m.states) continue;
    for (const s of m.states) set.add(s);
  }
  return set;
}

/**
 * 单遍词法扫描：提取 `'…'` / `"…"` 字符串字面量内容；
 * 跳过行注释 / 块注释 / 模板字面量（含转义处理）。
 * 未闭合引号按「非字面量」处理（不抛错 —— 扫描器必须对残缺源码鲁棒）。
 */
export function extractQuotedLiterals(source: string): string[] {
  const out: string[] = [];
  const n = source.length;
  let i = 0;
  while (i < n) {
    const c = source[i];
    const d = i + 1 < n ? source[i + 1] : '';
    if (c === '/' && d === '/') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '`') {
      i++;
      while (i < n && source[i] !== '`') {
        if (source[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let buf = '';
      while (j < n && source[j] !== c) {
        if (source[j] === '\\') {
          j += 2;
          continue;
        }
        buf += source[j];
        j++;
      }
      if (j < n) {
        out.push(buf);
        i = j + 1;
        continue;
      }
      i++;
      continue;
    }
    i++;
  }
  return out;
}

/** 事实源白名单：目录登记的 `sourceFile` 即该词汇的**定义地**（豁免，不需基线报备） */
export function collectSourceFileWhitelist(
  machines: readonly StateMachineCatalogLike[]
): Set<string> {
  return new Set(machines.map((m) => m.sourceFile));
}

/** 扫描一批文件：命中词汇表且不在白名单文件的 (value, file) 对 */
export function collectHits(
  files: readonly ScannedFile[],
  vocabulary: ReadonlySet<string>,
  whitelistFiles: ReadonlySet<string>
): StateLiteralHit[] {
  const hits: StateLiteralHit[] = [];
  for (const f of files) {
    if (whitelistFiles.has(f.file)) continue;
    for (const lit of extractQuotedLiterals(f.text)) {
      if (vocabulary.has(lit)) hits.push({ value: lit, file: f.file });
    }
  }
  return dedupeHits(hits);
}

/** 去重 + 排序（同一 (value,file) 多次出现只记一条；输出顺序稳定保证 diff 可复现） */
export function dedupeHits(
  hits: readonly StateLiteralHit[]
): StateLiteralHit[] {
  const seen = new Set<string>();
  const out: StateLiteralHit[] = [];
  for (const h of hits) {
    const key = `${h.value}\u0000${h.file}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ value: h.value, file: h.file });
  }
  out.sort((a, b) =>
    a.value === b.value
      ? a.file.localeCompare(b.file)
      : a.value.localeCompare(b.value)
  );
  return out;
}

/** 命中列表 → 基线形态（`value → files[]`） */
export function toBaselineFiles(
  hits: readonly StateLiteralHit[]
): Record<string, string[]> {
  const files: Record<string, string[]> = {};
  for (const h of dedupeHits(hits)) {
    (files[h.value] ??= []).push(h.file);
  }
  return files;
}

/** 棘轮 diff：`newHits` = 基线外新增（阻断）；`shrinkable` = 基线已不再出现（提示下调） */
export function diffBaseline(
  hits: readonly StateLiteralHit[],
  baseline: StateLiteralBaseline
): { newHits: StateLiteralHit[]; shrinkable: StateLiteralHit[] } {
  const current = toBaselineFiles(hits);
  const newHits: StateLiteralHit[] = [];
  for (const h of dedupeHits(hits)) {
    const listed = baseline.files[h.value];
    if (!listed || !listed.includes(h.file)) newHits.push(h);
  }
  const shrinkable: StateLiteralHit[] = [];
  for (const value of Object.keys(baseline.files).sort()) {
    const now = current[value] ?? [];
    for (const file of baseline.files[value]) {
      if (!now.includes(file)) shrinkable.push({ value, file });
    }
  }
  return { newHits, shrinkable };
}
