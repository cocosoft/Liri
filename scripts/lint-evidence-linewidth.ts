/**
 * 会话预算纪律 · 台账「单行超长」棘轮门禁（规则 **SB03**，来源
 * `dev_docs/20261014/会话token预算与交接整改方案-20261014.md`）
 *
 * 背景（实测）：`fix-evidence-registry.json` **最长单行 13,939 字符**、`修复证据登记.md` 1,903、
 * `CHANGELOG.md` 2,426 —— 行级编辑 / 回显 / 读取均按**整行**付费 ⇒ 是会话 token 预算被吞的
 * 主要结构性原因之一。本门禁把「台账类文件的单行宽度」纳入**只减不增**的棘轮。
 *
 * 观测面（均为**写入侧**纪律对象，不含产品源码）：
 *  - `CHANGELOG.md`
 *  - `.trae/architecture/fix-evidence-registry.json`
 *  - `.trae/architecture/*.md`（登记 / 规范类文档）
 *
 * 稳定键（不含行号，避免无关编辑漂移）：
 *  - `<rel>#over300`：该文件**超过 300 字符的行数**
 *  - `<rel>#max`：该文件**最长行字符数**
 *
 * 口径：**棘轮 —— 只减不增**。出现基线外的键（如新台账文件带长行）、或某键数值扩大 ⇒ `exit(1)`；
 * 基线缺失 / 解析失败 ⇒ 同样 `exit(1)`（**fail-closed**，不得静默降级为「0 违规」）。
 * 播种：`HARDCODE_GATE_BASELINE_WRITE=1`；负向自证：`HARDCODE_GATE_BASELINE=<临时副本>`。
 *
 * 运行：cd app && bun run lint:evidence-linewidth
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  type GateCounts,
  PROJECT_ROOT,
  ratchet,
  report,
} from './lib/hardcodeScan';

/** 台账 / 登记类文件的单行上限（字符）——规则 SB03 */
const MAX_LINE_CHARS = 300;

/** 固定观测点（相对仓库根） */
const FIXED_TARGETS = [
  'CHANGELOG.md',
  '.trae/architecture/fix-evidence-registry.json',
];

/** 目录观测点：其下全部 `*.md` 纳入（台账 / 规范文档） */
const WATCH_DIRS = ['.trae/architecture'];

/** 每个文件最多打印的示例行（保持门禁输出精简 —— 规则 SB08） */
const MAX_SAMPLES_PER_FILE = 3;

/** 汇总观测面（相对仓库根的 `/` 分隔路径），仅保留真实存在的文件 */
function collectTargets(): string[] {
  const targets = new Set<string>();
  for (const rel of FIXED_TARGETS) {
    if (existsSync(join(PROJECT_ROOT, rel))) targets.add(rel);
  }
  for (const dir of WATCH_DIRS) {
    const abs = join(PROJECT_ROOT, dir);
    let names: string[];
    try {
      names = readdirSync(abs);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith('.md')) continue;
      targets.add(`${dir}/${name}`);
    }
  }
  return [...targets].sort();
}

function main(): number {
  const targets = collectTargets();
  const counts: GateCounts = {};
  const findings: string[] = [];
  let overTotal = 0;
  let globalMax = 0;

  for (const rel of targets) {
    let lines: string[];
    try {
      lines = readFileSync(join(PROJECT_ROOT, rel), 'utf-8').split(/\r?\n/);
    } catch {
      continue;
    }
    let over = 0;
    let maxLen = 0;
    for (let i = 0; i < lines.length; i++) {
      const len = lines[i].length;
      if (len > maxLen) maxLen = len;
      if (len <= MAX_LINE_CHARS) continue;
      over++;
      if (over <= MAX_SAMPLES_PER_FILE) {
        findings.push(
          `${rel}:${i + 1} 行宽 ${len} > ${MAX_LINE_CHARS}（规则 SB03：写入侧须短行）`
        );
      }
    }
    counts[`${rel}#over${MAX_LINE_CHARS}`] = over;
    counts[`${rel}#max`] = maxLen;
    overTotal += over;
    if (maxLen > globalMax) globalMax = maxLen;
  }

  findings.sort();
  report('evidence-linewidth', findings, [
    `[lint:evidence-linewidth] 观测 ${targets.length} 个台账/登记文件；` +
      `超长行合计 ${overTotal} 行（上限 ${MAX_LINE_CHARS} 字符）；` +
      `全局最长行 ${globalMax} 字符（规则 SB03）`,
  ]);
  return ratchet('evidence-linewidth', counts);
}

// 退出码由 `ratchet()` 返回（见其头注）：出口落在**入口文件**里 ⇒ `lint:exit` 判据天然成立。
process.exit(main());
