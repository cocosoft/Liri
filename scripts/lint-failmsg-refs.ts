/**
 * 硬编码治理 · 报错/提示文本引用的规范条目须真实存在（方案 §8 阶段②「白名单收敛」）
 *
 * 扫 `scripts/lint-*.ts`（含本阶段新增的 4 个）中**字符串字面量**里的规范引用：
 *  - **路径型**：`.trae/rules/<name>.md`、`.trae/architecture/<name>.{md,json}`、
 *    `.trae/specs/<name>.md`、`.trae/docs/<name>.md`；
 *  - **规则 ID 型**：`CS\d{2}` / `R\d{2}-\d{3}` / `AR-\d`。
 *
 * 引用**不存在** ⇒ 上报（§2.10①「规范悬空」的根因治理：门禁不得指向不存在的真源）。
 * 字符串字面量内 vs 注释内**分别标注**（口径：提示文本为主，注释内一并扫描并注明）。
 *
 * 结果：**棘轮式（只减不增）** —— 稳定键 = `规则ID:<ID>` / `路径:<.trae/...>`，
 * 计数 = 违规出现次数；与基线 `.trae/architecture/hardcode-gate-baseline.json` 的
 * `lint:failmsg-refs` 分节比对；**新增键 / 计数扩大 ⇒ `process.exit(1)`**。
 * 播种（初始化 / 下调）：`HARDCODE_GATE_BASELINE_WRITE=1`；负向自证：
 * `HARDCODE_GATE_BASELINE=<临时副本>`。
 *
 * 运行：cd app && bun run lint:failmsg-refs
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  type GateCounts,
  PROJECT_ROOT,
  isCommentLine,
  ratchet,
  report,
} from './lib/hardcodeScan';

/** 待扫脚本目录（仓库根 `scripts/`） */
const SCRIPTS_DIR = join(PROJECT_ROOT, 'scripts');

/** 目标文件：`lint-*.ts` */
const TARGET_RE = /^lint-.*\.ts$/;

/** 路径型引用（到扩展名为止；冒号/引号/括号/中文标点均截断） */
const PATH_REF_RE =
  /\.trae\/(?:rules|architecture|specs|docs)\/[^\s'"`（），,;:]+[.](?:md|json)/g;

/** 规则 ID 型引用 */
const ID_REF_RE = /\b(?:CS\d{2}|R\d{2}-\d{3}|AR-\d)\b/g;

/** 规则 ID 语料：`.trae/rules/` 下全部 `.md` 全文（ID 须能在其中找到字样） */
function loadRuleCorpus(): string {
  const dir = join(PROJECT_ROOT, '.trae', 'rules');
  let text = '';
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return text;
  }
  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    try {
      text += readFileSync(join(dir, name), 'utf-8');
    } catch {
      /* 跳过不可读文件 */
    }
  }
  return text;
}

/** 字符串字面量区间（逐字符状态机，处理反斜杠转义） */
function stringSpans(line: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const start = i;
      i++;
      while (i < line.length) {
        if (line[i] === '\\') {
          i += 2;
          continue;
        }
        if (line[i] === ch) {
          i++;
          break;
        }
        i++;
      }
      spans.push([start, i]);
    } else {
      i++;
    }
  }
  return spans;
}

/** 行注释 / 块注释起点（不在字符串区间内） */
function commentStart(line: string, spans: Array<[number, number]>): number {
  const inSpan = (idx: number): boolean =>
    spans.some(([s, e]) => idx >= s && idx < e);
  for (let i = 0; i < line.length - 1; i++) {
    if (line[i] !== '/') continue;
    const next = line[i + 1];
    if ((next === '/' || next === '*') && !inSpan(i)) return i;
  }
  return -1;
}

/** 判定某个下标处于「字符串 / 注释 / 代码」哪一侧 */
function contextOf(line: string, index: number): 'string' | 'comment' | 'code' {
  const spans = stringSpans(line);
  for (const [s, e] of spans) {
    if (index >= s && index < e) return 'string';
  }
  const c = commentStart(line, spans);
  if (c >= 0 && index >= c) return 'comment';
  return 'code';
}

function label(ctx: 'string' | 'comment' | 'code'): string {
  if (ctx === 'comment') return '（注释内）';
  if (ctx === 'string') return '（报错文本）';
  return '（代码内）';
}

function main(): void {
  const corpus = loadRuleCorpus();
  let names: string[];
  try {
    names = readdirSync(SCRIPTS_DIR);
  } catch {
    names = [];
  }
  const targets = names.filter((n) => TARGET_RE.test(n)).sort();

  const findings: string[] = [];
  const seen = new Set<string>();
  const counts: GateCounts = {};
  let pathRefs = 0;
  let idRefs = 0;

  for (const name of targets) {
    const abs = join(SCRIPTS_DIR, name);
    const lines = readFileSync(abs, 'utf-8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const no = i + 1;
      const lineIsComment = isCommentLine(line);
      for (const m of line.matchAll(PATH_REF_RE)) {
        const ref = m[0];
        // 跳过模板占位（`<name>` / `*` / `**`）—— 非具体文件引用，不是可达性对象
        if (/[<>*]/.test(ref)) continue;
        pathRefs++;
        if (existsSync(join(PROJECT_ROOT, ref))) continue;
        counts[`路径:${ref}`] = (counts[`路径:${ref}`] ?? 0) + 1;
        const ctx = lineIsComment ? 'comment' : contextOf(line, m.index ?? 0);
        const key = `scripts/${name}:${no}:${ref}:${ctx}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push(
          `scripts/${name}:${no}  ${label(ctx)} 路径引用不存在：${ref}`
        );
      }
      for (const m of line.matchAll(ID_REF_RE)) {
        idRefs++;
        const ref = m[0];
        if (corpus.includes(ref)) continue;
        counts[`规则ID:${ref}`] = (counts[`规则ID:${ref}`] ?? 0) + 1;
        const ctx = lineIsComment ? 'comment' : contextOf(line, m.index ?? 0);
        const key = `scripts/${name}:${no}:${ref}:${ctx}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push(
          `scripts/${name}:${no}  ${label(ctx)} 规则 ID 未在 ` +
            `.trae/rules/**.md 找到：${ref}`
        );
      }
    }
  }

  findings.sort();
  report('failmsg-refs', findings, [
    `[lint:failmsg-refs] 扫描 ${targets.length} 个 lint 脚本；规范引用 ` +
      `路径型 ${pathRefs} 处 / 规则 ID 型 ${idRefs} 处`,
  ]);
  ratchet('failmsg-refs', counts);
}

main();
// 兜底显式收尾（`lint:exit` 门禁要求）：正常路径已在 `ratchet()` 内部退出（其返回类型为
// `never`）；此处保证「若日后 `ratchet` 不再自退出，入口仍显式结束」，不会挂在长驻句柄上。
process.exit(0);
