/**
 * 硬编码治理 · 共享扫描工具（方案 §8 阶段②「白名单收敛」+ 阶段③「转 error 级 / CI 必绿」）
 *
 * 复用 `scripts/lint-models.ts` 的成熟框架（目录 / 扩展名 / 注释跳过 / 白名单），
 * 为 4 个门禁（lint:consts / lint:endpoints / lint:locale / lint:failmsg-refs）
 * 提供**唯一**的扫描与打印实现，避免 4 份重复。
 *
 * 口径（阶段②）：**棘轮式 —— 白名单只减不增**。每个门禁产出稳定的「键 → 计数」表，
 * 与基线 `.trae/architecture/hardcode-gate-baseline.json`（**一份**，内含四个分节）
 * 比对：出现基线没有的键、或某键计数 > 基线 ⇒ **阻断**（`process.exit(1)`）；
 * 全部 ≤ 基线 ⇒ PASS（并提示可下调的键，**仅提示、不自动改**）。
 * 对齐仓内先例 `scripts/lint-function-size-ratchet.ts`。
 *
 * 口径（阶段③）：明细文案由「⚠️ 仅上报」升级为 **error 级**（`❌ 违规`），且 4 门禁
 * 已**接入流水线**（`app/package.json` 的 `ci` 聚合脚本 + `.github/workflows/ci.yml`
 * 的 `static-check` 作业的 `Hardcode gates` 步骤）⇒ 「CI 必绿」不再是纸面承诺。
 * 基线内条目为**已裁定的豁免存量**（不阻断），**新增 / 扩大 ⇒ 阻断**。
 *
 * env 覆盖（**负向自证**用）：
 *  - `HARDCODE_GATE_BASELINE=<path>`     基线路径覆盖（缺失 ⇒ `exit(1)`）；
 *  - `HARDCODE_GATE_BASELINE_WRITE=1`    一次性播种：把**当前**结果写入基线分节。
 * 实现约束：Windows 无系统 grep，全部用 Bun/Node 内置 API。
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

/** 项目根目录：本文件位于 `scripts/lib/`，故上溯两级 */
export const PROJECT_ROOT = join(import.meta.dir, '..', '..');

/** 扫描目录（与 lint-models.ts 一致：后端 app/src + 前端 client/src） */
export const SCAN_DIRS = [
  join(PROJECT_ROOT, 'app', 'src'),
  join(PROJECT_ROOT, 'client', 'src'),
];

/** 检查的文件扩展名 */
const CHECK_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

/** 递归收集文件（返回**绝对路径**；跳过 node_modules/.git/dist/__tests__） */
export function collectFiles(dir?: string): string[] {
  const results: string[] = [];
  for (const root of dir ? [dir] : SCAN_DIRS) {
    walk(root, results);
  }
  return results;
}

function walk(dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (
      entry.name === 'node_modules' ||
      entry.name === '.git' ||
      entry.name === 'dist' ||
      entry.name === '__tests__'
    )
      continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    const ext = entry.name.slice(entry.name.lastIndexOf('.'));
    if (CHECK_EXTENSIONS.has(ext)) out.push(full);
  }
}

/** 归一化为**相对 PROJECT_ROOT** 的 `/` 分隔路径（白名单统一用 `/`） */
export function toRel(abs: string): string {
  return abs.replace(PROJECT_ROOT + sep, '').replaceAll(sep, '/');
}

/** 是否为注释行（行首 `//` / `*` / `/*` / `<!--`） */
export function isCommentLine(line: string): boolean {
  const t = line.trim();
  return (
    t.startsWith('//') ||
    t.startsWith('*') ||
    t.startsWith('/*') ||
    t.startsWith('<!--')
  );
}

/** 读取文件并按行切分（统一 CRLF/LF） */
export function readLines(abs: string): string[] {
  return readFileSync(abs, 'utf-8').split(/\r?\n/);
}

/** 白名单片段匹配（`rel` 含任一片段即算命中；片段统一 `/` 分隔） */
export function matchesWhitelist(rel: string, fragments: string[]): boolean {
  return fragments.some((frag) => rel.includes(frag));
}

/**
 * 统一打印**人类可读明细**（棘轮结论由 `ratchet(...)` 单独打印）。
 * - 0 条 ⇒ `[lint:X] ✅ 无告警`
 * - >0 条 ⇒ `[lint:X] ❌ 违规 N 条（基线内为豁免存量，不阻断；新增/扩大 ⇒ 阻断）：` 后逐条 `  说明`
 *
 * §8 阶段③：文案由「⚠️ 仅上报」升级为 **error 级**（`❌ 违规`）；基线内条目为
 * **已裁定豁免的存量**（不阻断，见 `ratchet(...)`），**新增 / 扩大 ⇒ 阻断**。
 *
 * @param name   门禁名（`[lint:<name>]`）
 * @param findings 逐条告警（`文件:行 说明`）
 * @param extraLines 置顶的信息行（统计/口径说明），恒打印
 */
export function report(
  name: string,
  findings: string[],
  extraLines: string[] = []
): void {
  const tag = `[lint:${name}]`;
  for (const line of extraLines) console.log(line);
  if (findings.length === 0) {
    console.log(`${tag} ✅ 无告警`);
  } else {
    console.log(
      `${tag} ❌ 违规 ${findings.length} 条（基线内为豁免存量，不阻断；新增/扩大 ⇒ 阻断）：`
    );
    for (const f of findings) console.log(`  ${f}`);
  }
}

/** 单个门禁的「稳定键 → 计数」表（键里不得含行号，避免随无关编辑漂移） */
export type GateCounts = Record<string, number>;

/** 基线文件形态：一份 JSON，内含四个门禁的分节（键 = `lint:<name>`） */
type BaselineFile = Record<string, GateCounts | unknown>;

/** 棘轮基线路径：默认 `.trae/architecture/hardcode-gate-baseline.json`，env 可覆盖 */
export const HARDCODE_BASELINE_PATH = process.env.HARDCODE_GATE_BASELINE
  ? resolve(process.env.HARDCODE_GATE_BASELINE)
  : join(PROJECT_ROOT, '.trae', 'architecture', 'hardcode-gate-baseline.json');

/** 一次性播种开关（`HARDCODE_GATE_BASELINE_WRITE=1`） */
const BASELINE_WRITE = process.env.HARDCODE_GATE_BASELINE_WRITE === '1';

/** 读取基线（缺失 / 解析失败 ⇒ `console.error` + `process.exit(1)`，同先例） */
function loadBaseline(): BaselineFile {
  if (!existsSync(HARDCODE_BASELINE_PATH)) {
    console.error(`基线不存在: ${HARDCODE_BASELINE_PATH}`);
    process.exit(1);
  }
  try {
    return JSON.parse(
      readFileSync(HARDCODE_BASELINE_PATH, 'utf8')
    ) as BaselineFile;
  } catch (err) {
    console.error(`基线 JSON 解析失败: ${String(err)}`);
    process.exit(1);
  }
}

/** 播种：把**当前**结果写入本门禁分节（保留其它分节，便于逐门禁依次播种） */
function seedBaseline(name: string, counts: GateCounts): void {
  const file: BaselineFile = existsSync(HARDCODE_BASELINE_PATH)
    ? loadBaseline()
    : {};
  file[`lint:${name}`] = counts;
  writeFileSync(
    HARDCODE_BASELINE_PATH,
    JSON.stringify(file, null, 2) + '\n',
    'utf8'
  );
  console.log(
    `[lint:${name}] 🌱 已播种基线分节：${Object.keys(counts).length} 键 ⇒ ${HARDCODE_BASELINE_PATH}`
  );
}

/**
 * 棘轮比对（**只减不增**）：
 * - `HARDCODE_GATE_BASELINE_WRITE=1` ⇒ 播种当前结果 ⇒ 返回 `0`；
 * - 出现基线没有的键 / 某键计数 > 基线 ⇒ 打印「新增/扩大违规」⇒ 返回 `1`；
 * - 全部 ≤ 基线 ⇒ 打印 `结果：PASS（基线只减不增）`，并提示可下调的键 ⇒ 返回 `0`。
 *
 * ⚠️ **本函数不再自行 `process.exit`**（2026-10-16 治本）：退出码**返回**给调用方，由 5 个入口
 * 脚本以 `process.exit(main())` 收尾。原因（两条）：
 * ① `scripts/lib/**` 是**库**，替宿主进程决定生死是错的分层 —— `scripts/lint-script-exit.ts`
 *    头注明确警告「给被 import 的 helper 加 `process.exit` 会杀掉宿主进程」，而本函数正是那个 helper；
 * ② 退出落在**入口文件**里，门禁的文本判据（入口必须含显式退出）**天然成立**，无需再在入口写
 *    一行运行时不可达的兜底（见台账 `LINTEXIT-ENTRY-EXPLICIT-EXIT` 的 reopenWhen ①）。
 *
 * **fail-closed 由构造成立**：入口若漏写 `process.exit(main())`，文件里就没有 `process.exit(` 记号
 * ⇒ `lint:exit` 直接判红（该门禁只扫入口文件自身），不会出现「违规却静默退出 0」。
 */
export function ratchet(name: string, counts: GateCounts): 0 | 1 {
  if (BASELINE_WRITE) {
    seedBaseline(name, counts);
    return 0;
  }
  const section = (loadBaseline()[`lint:${name}`] ?? {}) as GateCounts;
  const added: string[] = [];
  const grown: string[] = [];
  const shrinkable: string[] = [];

  for (const [key, n] of Object.entries(counts)) {
    const base = section[key];
    if (base === undefined) added.push(`${key}（新增，当前 ${n}）`);
    else if (n > base) grown.push(`${key}：基线 ${base} → 当前 ${n}`);
  }
  for (const [key, base] of Object.entries(section)) {
    const n = counts[key] ?? 0;
    if (n < base) shrinkable.push(`${key}：基线 ${base} → 当前 ${n}`);
  }

  const tag = `[lint:${name}]`;
  if (added.length > 0 || grown.length > 0) {
    console.error(`${tag} ❌ 新增/扩大违规（棘轮：白名单只减不增）:`);
    for (const a of added) console.error(`  - 新增键 ${a}`);
    for (const g of grown) console.error(`  - 计数扩大 ${g}`);
    return 1;
  }
  console.log(`${tag} 结果：PASS（基线只减不增）`);
  if (shrinkable.length > 0) {
    console.log(`${tag} ℹ️ 可下调基线的键（仅提示，不自动改）:`);
    for (const s of shrinkable) console.log(`  - ${s}`);
  }
  return 0;
}
