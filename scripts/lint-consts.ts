/**
 * 硬编码治理 · 重复事实源检测（方案 §8 阶段②「白名单收敛」）
 *
 * (a) **同名常量**（`const UPPER_SNAKE =`）定义于 ≥2 文件；
 * (b) **同值 URL/host 字面量**（scheme://host[:port] / localhost:port / 127.0.0.1）
 *     出现于 ≥2 文件。
 *
 * 白名单（真源）内的文件不上报（见下方 TRUTH_SOURCE_FRAGMENTS，可逐条注释）。
 * 结果：**棘轮式（只减不增）** —— 稳定键（`同名常量:<NAME>` / `同值host:<LITERAL>`，
 * 计数 = 命中文件数）与基线 `.trae/architecture/hardcode-gate-baseline.json`
 * 的 `lint:consts` 分节比对；**新增键 / 计数扩大 ⇒ `process.exit(1)`**。
 * 播种（初始化 / 下调）：`HARDCODE_GATE_BASELINE_WRITE=1`；负向自证：
 * `HARDCODE_GATE_BASELINE=<临时副本>`。
 *
 * 运行：cd app && bun run lint:consts
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  collectFiles,
  type GateCounts,
  isCommentLine,
  matchesWhitelist,
  ratchet,
  readLines,
  report,
  toRel,
} from './lib/hardcodeScan';

/**
 * 真源白名单（等同值 / 同名常量若**定义于此**，属唯一事实源，不视为重复）。
 * 片段匹配（`rel.includes(frag)`），统一 `/` 分隔 —— 可在此按需增删。
 */
const TRUTH_SOURCE_FRAGMENTS = [
  'core/paths.ts', // 后端路径真源
  'core/ports.ts', // 后端端口真源
  'core/endpoints.ts', // 后端端点真源
  'core/providerEndpoints.ts', // 官方供应商 API 端点真源
  'client/src/services/endpoints.ts', // 前端端点真源
  'client/src/constants/locale.ts', // 前端 locale 真源
  'client/src/constants/events.ts', // 前端事件名真源
  'client/src/constants/storage.ts', // 前端存储键真源
  'client/src/constants/capabilities.ts', // 前端能力名真源
  'tests/', // 仓库级测试目录
  '__tests__/', // 测试目录（collectFiles 已跳过，双保险）
  '.test.', // *.test.*
  '.spec.', // *.spec.*
];

/**
 * **vendored（本地整体抄入的上游副本）目录**：**不纳入统计**，不参与本仓「重复事实源」治理。
 *
 * 判据与理由：这些目录是**整体抄入的上游包源码** —— 当前 `ink` **未**在本仓 `package.json`
 * 声明依赖 ⇒ `app/src/ink/ink/` 即上游 ink 源码的本地副本。上游代码与本仓真源「同名同值」属
 * **正常现象**；为过门禁而改名/合并会**破坏"可与上游逐字对照"的可维护性**（将来重新 vendoring
 * 时无法比对）。实证：`ELLIPSIS = '…'`（本仓 `constants/figures.ts` 真源 vs vendored `wrap-text.ts`）
 * —— 本仓那份为**死导出**（全仓 0 消费者），活的一份正在 vendored 侧，按域消歧两边都不合适。
 *
 * ⚠️ 与 {@link TRUTH_SOURCE_FRAGMENTS} 的**语义区别**（勿混用）：后者是「**本仓**真源 —— 同名/同值
 * 若**定义于此**不算重复（计入统计但不报警）」；本项是「**非本仓来源**的代码 —— 直接不纳入统计」。
 */
const VENDORED_FRAGMENTS = ['app/src/ink/ink/'];

/**
 * **跨包 / 跨语言契约常量**：同名同值属**有意为之** —— 两侧分属不同包（甚至不同语言），
 * **无法 import**，只能各自声明并要求**逐字同值**。故不视为「重复事实源」，**不纳入统计**。
 *
 * ⚠️ 准入条件（三条同时满足，缺一不可）：
 *  1. 两侧**确实无法共享代码**（不同包 / 不同语言），而不是"懒得归一化"；
 *  2. 同名是**刻意**的（名字本身就是契约信号，grep 一处即可找到全部落点）；
 *  3. **必须配套守卫测试**断言各侧取值逐字一致 —— 否则"保留同名"只是把不一致藏起来，
 *     比改名更糟（改名至少不会让人以为它们同源）。
 *
 * 键 = 常量名；值 = 契约说明（含全部落点文件，供人工复核与守卫测试对照）。
 */
const CROSS_PACKAGE_CONTRACT_CONSTS: Record<string, string> = {
  DEFAULT_MODEL_SENTINEL:
    '「未选模型」哨兵（由后端 SmartRouter 兜底）：app/src/constants/common.ts ↔ ' +
    'client/src/services/chatService.ts ↔ client/src-tauri/src/commands/chat.rs；' +
    '守卫见 app/tests/constants/sameNameConstsB2.test.ts 的 B5-2-68（三方逐字同值断言）',
  ROUND_SUMMARY_MAX_CHARS:
    '按轮摘要单条字符上限（B2）：app/src/runtime/api/roundSummaries.ts ↔ ' +
    'client/src/utils/roundSummaries.ts；两侧分属不同包（client 不依赖后端包，无法 import），' +
    '同名即契约信号；' +
    '守卫见 app/tests/constants/sameNameConstsB2.test.ts 的 B5-2-69（两侧逐字同值断言）',
};

/**
 * 常量定义：`[\export ]const UPPER_SNAKE (: 标量基础类型)? =`（≥3 字符，全大写/数字/下划线）。
 *
 * ⚠️ **补门禁盲区**（2026-10-15）：原正则要求 `=` 紧跟常量名 ⇒ `const X: T = …` **一律漏检**
 * （带类型写法的同名常量对棘轮完全不可见）。
 *
 * **口径：只纳入「标量基础类型」**（`string` / `number` / `boolean` / `bigint`，可加 `readonly`）。
 * 判据是**同名是否可能等于同一事实**，而这取决于值能否比较；实测两类反例都指向"越窄越对"：
 *  - 放宽到**任意类型标注** ⇒ 一次性涌入 **69 个键**，其中 `DEFAULT_CONFIG` 一个键横跨 **93 个文件**
 *    （各模块的私有默认配置对象）——那是**惯例名**，收进基线等于"什么都豁免"；
 *  - 放宽到**数组**（`string[]`）⇒ 抓到 4 键，但逐个取证后仍是惯例名高发区，最有说服力的是
 *    `BINARY_EXTS: string[]`：app 侧 `['.pdf','.docx','.mp3',…]`、client 侧 `['.exe','.dll','.so',…]`
 *    —— **同名同类型却完全不同的事实**，正是"集合同名 ≠ 同一事实"的实证。
 *  故只纳入**标量**（值可直接比较，如 `const DEFAULT_TIMEOUT: number = 30000`，同名同值即真重复）；
 *  数组 / 对象 / 接口 / 联合类型不纳入（其同名多数是命名惯例，且已由各域真源/契约测试另行覆盖）。
 */
const CONST_DEF_RE =
  /^\s*(?:export\s+)?const\s+([A-Z][A-Z0-9_]{2,})\s*(?::\s*(?:readonly\s+)?(?:string|number|boolean|bigint)\s*)?=/;

/** 字符串字面量（单/双/反引号，内容不含引号与换行） */
const STRING_LITERAL_RE = /['"`]([^'"`\n]+)['"`]/g;

/** URL（scheme + host + 可选端口）—— 按 `scheme://host[:port]` 聚合 */
const URL_RE = /https?:\/\/[A-Za-z0-9.-]+(?::\d+)?/g;

/** 本机 host（localhost / 127.0.0.1 + 可选端口） */
const LOCAL_HOST_RE = /(?:localhost|127\.0\.0\.1)(?::\d+)?/g;

interface Hit {
  file: string;
  line: number;
}

function push(map: Map<string, Hit[]>, key: string, hit: Hit): void {
  const list = map.get(key);
  if (list) list.push(hit);
  else map.set(key, [hit]);
}

/** 扫描：返回「同名常量」与「同值字面量」两张聚合表 */
function collect(files: string[]): {
  consts: Map<string, Hit[]>;
  values: Map<string, Hit[]>;
} {
  const consts = new Map<string, Hit[]>();
  const values = new Map<string, Hit[]>();
  for (const abs of files) {
    const rel = toRel(abs);
    if (matchesWhitelist(rel, TRUTH_SOURCE_FRAGMENTS)) continue;
    // vendored 上游副本：不纳入统计（见 VENDORED_FRAGMENTS 注释）
    if (matchesWhitelist(rel, VENDORED_FRAGMENTS)) continue;
    const lines = readLines(abs);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (isCommentLine(line)) continue;
      const def = line.match(CONST_DEF_RE);
      // 跨包契约常量：同名同值属**有意为之**（准入三条 + 三方同值守卫，见上表注释）⇒ 不纳入统计
      if (def && !(def[1] in CROSS_PACKAGE_CONTRACT_CONSTS)) {
        push(consts, def[1], { file: rel, line: i + 1 });
      }
      for (const lit of line.matchAll(STRING_LITERAL_RE)) {
        for (const m of lit[1].matchAll(URL_RE)) {
          push(values, m[0], { file: rel, line: i + 1 });
        }
        for (const m of lit[1].matchAll(LOCAL_HOST_RE)) {
          push(values, m[0], { file: rel, line: i + 1 });
        }
      }
    }
  }
  return { consts, values };
}

/** 仅保留「出现于 ≥2 个**不同文件**」的聚合项 */
function duplicates(
  map: Map<string, Hit[]>
): Array<{ key: string; hits: Hit[]; files: string[] }> {
  const out: Array<{ key: string; hits: Hit[]; files: string[] }> = [];
  for (const [key, hits] of map) {
    const files = [...new Set(hits.map((h) => h.file))];
    if (files.length >= 2) out.push({ key, hits, files });
  }
  return out;
}

/**
 * D-1（2026-10-18）`@kind` 四分类校验（清单 §5 D-1）。
 *
 * 规则：
 * 1. `constants/*.ts` 的**每个 `export const`** 必须有 `@kind A|B|C|D`；
 *    文件头 40 行内的 `@kind-default X` 可作为该文件全部常量的默认类（仅限单一类文件）。
 * 2. **C 类禁止**出现在 `constants/` —— 模型 window / 价格 / 能力只允许 DB / 注册表。
 * 3. 豁免：`index.ts`（barrel）与 `*.generated.ts`（自动生成，不可手改）。
 *
 * 标签取**紧邻注释块**（向上跳过空行；遇到注释块结尾才解析）——避免把上一个常量的
 * `@kind` 误判给下一个（`export const` 之间常有多个常量而无独立注释）。
 */
const KIND_TAG_RE = /@kind\s+([ABCD])\b/;
const KIND_DEFAULT_RE = /@kind-default\s+([ABCD])\b/;

/** 常量所在目录（本脚本位于仓库根 `scripts/`） */
const CONSTANTS_DIR = resolve(import.meta.dir, '../app/src/constants');

/**
 * D-2（2026-10-18）B 类裸字面量：`const X_(TIMEOUT|LIMIT|THRESHOLD|MS) = <数字>`
 *
 * 口径（清单 §5 D-2 第 1 条）：
 * - 只匹配**数字开头**的赋值（`30_000` / `1000` / `30 * 1000`），
 *   `= B.xxx`（defaults 转发）与 `= SOME_CONST`（已归一化）不算；
 * - 允许位置：`app/src/constants/` 与任意 `defaults.ts`；
 * - **推进阶段 = 上报 + 棘轮**：存量进基线（只减不增），新增文件/条数 ⇒ 阻断。
 */
const BARE_LITERAL_RE =
  /^\s*(?:export\s+)?const\s+[A-Z][A-Z0-9_]*(?:_TIMEOUT|_LIMIT|_THRESHOLD|_MS)\s*(?::\s*(?:readonly\s+)?number\s*)?=\s*[\d_]+/;

/** 扫描 B 类裸字面量：返回按文件聚合的计数 + 总数 */
function scanBareNumberLiterals(files: string[]): {
  counts: GateCounts;
  total: number;
} {
  const counts: GateCounts = {};
  let total = 0;
  for (const abs of files) {
    const rel = toRel(abs);
    if (!rel.startsWith('app/src/')) continue;
    if (rel.startsWith('app/src/constants/')) continue;
    if (rel.endsWith('/defaults.ts')) continue;
    let n = 0;
    for (const line of readLines(abs)) {
      if (isCommentLine(line)) continue;
      if (BARE_LITERAL_RE.test(line)) n++;
    }
    if (n > 0) {
      counts[`裸字面量:${rel}`] = n;
      total += n;
    }
  }
  return { counts, total };
}

/** 取紧邻注释块中的 `@kind`；没有紧邻注释块 ⇒ undefined */
function kindOfNearestBlock(
  lines: string[],
  index: number
): string | undefined {
  let i = index - 1;
  while (i >= 0 && lines[i].trim() === '') i--;
  if (i < 0 || !lines[i].trim().endsWith('*/')) return undefined;

  const block: string[] = [];
  while (i >= 0) {
    block.unshift(lines[i]);
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('/**') || trimmed.startsWith('/*')) break;
    i--;
  }
  return block.join('\n').match(KIND_TAG_RE)?.[1];
}

function checkKindTags(): string[] {
  const findings: string[] = [];
  for (const name of readdirSync(CONSTANTS_DIR)) {
    if (!name.endsWith('.ts')) continue;
    if (name === 'index.ts' || name.endsWith('.generated.ts')) continue;

    const lines = readFileSync(join(CONSTANTS_DIR, name), 'utf-8').split('\n');
    const head = lines.slice(0, 40).join('\n');
    const defaultKind = head.match(KIND_DEFAULT_RE)?.[1];

    if (defaultKind === 'C') {
      findings.push(
        `src/constants/${name}:1  @kind-default C —— C 类（模型 window/价格/能力）禁止出现在 constants/`
      );
    }

    for (let i = 0; i < lines.length; i++) {
      const def = lines[i].match(/^export\s+const\s+([A-Za-z_]\w*)/);
      if (!def) continue;
      const kind = kindOfNearestBlock(lines, i) ?? defaultKind;
      if (!kind) {
        findings.push(
          `src/constants/${name}:${i + 1}  常量 ${def[1]} 缺少 @kind A|B|C|D 标签`
        );
      } else if (kind === 'C') {
        findings.push(
          `src/constants/${name}:${i + 1}  常量 ${def[1]} 为 C 类 —— 模型 window/价格/能力只允许 DB/注册表`
        );
      }
    }
  }
  return findings;
}

/**
 * D-2（2026-10-18）单位后缀检查：`*_MS` / `*_BYTES` / `*_TOKENS` 的值量级。
 *
 * 只校验**纯数字字面量**（`X_MS = 30` 这类"把秒写成毫秒"的典型错误）；
 * `= B.xxx`（defaults 转发）与表达式由类型/默认值层保证，不在本规则内。
 * 当前仓库 0 命中（4 个后缀常量均为转发），本规则为未来新增兜底。
 */
const UNIT_SUFFIX_RULES = [
  { suffix: 'MS', min: 10, hint: '毫秒值应 ≥ 10（30 秒应写 30_000）' },
  { suffix: 'BYTES', min: 1024, hint: '字节值应 ≥ 1024' },
  { suffix: 'TOKENS', min: 1, hint: 'token 值应 ≥ 1' },
] as const;

function checkUnitSuffixes(): string[] {
  const findings: string[] = [];
  for (const name of readdirSync(CONSTANTS_DIR)) {
    if (!name.endsWith('.ts')) continue;
    if (name === 'index.ts' || name.endsWith('.generated.ts')) continue;
    const lines = readFileSync(join(CONSTANTS_DIR, name), 'utf-8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(
        /^export\s+const\s+([A-Z][A-Z0-9_]*_(MS|BYTES|TOKENS))\s*=\s*(\d[\d_]*)\s*;/
      );
      if (!m) continue;
      const [, constName, suffix, raw] = m;
      const rule = UNIT_SUFFIX_RULES.find((r) => r.suffix === suffix);
      if (!rule) continue;
      const value = Number(raw.replace(/_/g, ''));
      if (value < rule.min) {
        findings.push(
          `src/constants/${name}:${i + 1}  ${constName} = ${value} 与单位后缀不符（${rule.hint}）`
        );
      }
    }
  }
  return findings;
}

function main(): number {
  const files = collectFiles();
  const { consts, values } = collect(files);
  const constDups = duplicates(consts);
  const valueDups = duplicates(values);
  const kindFindings = checkKindTags();
  const unitFindings = checkUnitSuffixes();
  const bare = scanBareNumberLiterals(files);

  const findings: string[] = [];
  for (const d of constDups) {
    findings.push(
      `${d.hits[0].file}:${d.hits[0].line}  同名常量 ${d.key} 定义于 ` +
        `${d.files.length} 文件（${d.files.join(', ')}）`
    );
  }
  for (const d of valueDups) {
    findings.push(
      `${d.hits[0].file}:${d.hits[0].line}  同值字面量 ${d.key} 出现于 ` +
        `${d.files.length} 文件（${d.files.join(', ')}）`
    );
  }
  findings.push(...kindFindings);
  findings.push(...unitFindings);

  // 棘轮稳定键：`同名常量:<NAME>` / `同值host:<LITERAL>`，计数 = 命中文件数
  const counts: GateCounts = {};
  for (const d of constDups) counts[`同名常量:${d.key}`] = d.files.length;
  for (const d of valueDups) counts[`同值host:${d.key}`] = d.files.length;

  report('consts', findings, [
    `[lint:consts] 扫描 ${files.length} 个文件（白名单外），同名常量重复 ` +
      `${constDups.length} 组 / 同值字面量重复 ${valueDups.length} 组`,
    `[lint:consts] @kind 分类检查：${kindFindings.length} 项（缺标签 / C 类混入）`,
    `[lint:consts] 单位后缀检查：${unitFindings.length} 项（*_MS / *_BYTES / *_TOKENS 量级）`,
    `[lint:consts] B 类裸字面量：${bare.total} 处 / ${Object.keys(bare.counts).length} 文件` +
      `（棘轮：存量豁免，新增文件或条数扩大 ⇒ 阻断）`,
  ]);
  // D-1：@kind 缺失或 C 类混入 = 硬失败（不走棘轮，直接阻断）
  // D-2：单位后缀量级不符 = 硬失败（语义错误，不进基线）
  if (kindFindings.length > 0 || unitFindings.length > 0) return 1;
  const dupExit = ratchet('consts', counts);
  // D-2：B 类裸字面量棘轮（白名单 = 基线分节 `lint:consts-bare`；只减不增）
  const bareExit = ratchet('consts-bare', bare.counts);
  return Math.max(dupExit, bareExit);
}

// 退出码由 `ratchet()` 返回（见其头注）：出口落在**入口文件**里 ⇒ `lint:exit` 判据天然成立。
process.exit(main());
