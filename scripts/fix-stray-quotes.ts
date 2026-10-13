#!/usr/bin/env bun
/**
 * CS08 修复器：机器可读 JSON 内**未转义的 ASCII 双引号**（字符串提前闭合）→ 中文引号「」。
 *
 * 规范：`.trae/rules/coding-standards.md` §CS08 —— 机器可读文本（`.json`/`.yaml`）的字符串
 * **内容**里要引用词句时，一律用中文引号「」；确需 ASCII 引号时源文件必须写作 `\"`。
 *
 * 为什么需要它（本仓实证）：`.trae/architecture/fix-evidence-registry.json` 的 `notes` /
 * `reopenWhen` 里夹 ASCII `"`（中文语境引号的自然写法）⇒ 字符串提前闭合 ⇒ 整份 JSON
 * 解析失败 ⇒ `lint:fix-evidence` 崩、CI `doc-gate` 红。`scripts/lint-fix-evidence.ts:62`
 * 自述「已在登记表上**三次**因此使 JSON 破损」，且**每轮都在事后手修**（2026-10-13 又
 * 一次性引入 4 处）。本脚本把那次「成对替换器」固化为**仓库工具**。
 *
 * 用法：
 *   bun scripts/fix-stray-quotes.ts [file...]         # 就地修复（默认目标 = 修复证据登记表）
 *   bun scripts/fix-stray-quotes.ts --dry-run [f...]  # 只报告，不落盘（有待修处则退出 1）
 *   bun scripts/lint-fix-evidence.ts --fix            # 门禁侧：解析失败时自动修复后复检
 *
 * 两条保险（缺一不可）：
 *   ① **成对校验**：同一条字符串内 stray 引号数必须为偶数，否则拒绝改写（防「引号不成对」被
 *      静默改成看似合法、语义错误的文本）；
 *   ② **写回前 `JSON.parse` 预检**：修复后仍无法解析 ⇒ **不落盘**。
 *
 * ⚠️ 如实边界：本脚本只做 **JSON**（YAML 的引号形式更多，未纳入）。它保证「解析得开」，
 * **不保证**「配对语义 100% 正确」—— 修复后仍应 `git diff` 肉眼确认引号落位。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_TARGET = resolve(
  import.meta.dir,
  '..',
  '.trae/architecture/fix-evidence-registry.json'
);

/**
 * 把 JSON 源文本里**字符串内部的**裸 ASCII 双引号替换为中文引号「」（open/close 交替）。
 *
 * 判定「字符串提前闭合」与 `scripts/lint-fix-evidence.ts` 的 `locateStrayQuote` 同口径：
 * 一个 `"` 若**处于字符串内**、且其后的下一个非空白字符**不是** `,` `}` `]` `:` 之一，
 * 则它**不是**合法的字符串结束符 ⇒ 属「内容里的引号」。
 *
 * 交替规则：以**每条字符串**为单位重置奇偶（合法结束即换下一条）⇒ 首个 stray = 「、次个 = 」。
 * 若某条字符串结束时 stray 计数为**奇数**（引号不成对）⇒ 返回 `null`（拒绝改写）。
 *
 * @returns 修复后的文本与替换处数；**无法安全修复**（不成对 / 字符串未闭合）时返回 `null`。
 */
export function fixStrayQuotes(
  src: string
): { fixed: string; changed: number } | null {
  let out = '';
  let inStr = false;
  let stray = 0; // 当前字符串内已替换的 stray 引号数（决定 open/close）
  let changed = 0;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i] as string;

    if (!inStr) {
      out += ch;
      if (ch === '"') {
        inStr = true;
        stray = 0;
      }
      continue;
    }

    // 字符串内
    if (ch === '\\') {
      out += ch + (src[i + 1] ?? ''); // 跳过已转义字符
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < src.length && /\s/.test(src[j] as string)) j++;
      const nxt = src[j];
      const isLegitClose =
        nxt === ',' || nxt === '}' || nxt === ']' || nxt === ':';
      if (isLegitClose && stray % 2 === 0) {
        out += '"';
        inStr = false; // 合法结束 ⇒ 换下一条字符串（奇偶重置）
        continue;
      }
      out += stray % 2 === 0 ? '「' : '」';
      stray++;
      changed++;
      continue;
    }
    out += ch;
  }

  if (inStr) return null; // 字符串未闭合 ⇒ 不安全的输入，拒绝改写
  return { fixed: out, changed };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const files = argv.filter((a) => !a.startsWith('--'));
  const targets = files.length > 0 ? files : [DEFAULT_TARGET];

  let bad = 0;
  for (const f of targets) {
    const abs = resolve(f);
    if (!existsSync(abs)) {
      console.error(`✗ 文件不存在: ${abs}`);
      bad++;
      continue;
    }
    const src = readFileSync(abs, 'utf8');

    let originallyOk = true;
    try {
      JSON.parse(src);
    } catch {
      originallyOk = false;
    }
    if (originallyOk) {
      console.log(`✓ 无需修复（JSON 本可解析）：${abs}`);
      continue;
    }

    const res = fixStrayQuotes(src);
    if (!res) {
      console.error(`✗ 无法安全修复（引号不成对 / 字符串未闭合）：${abs}`);
      bad++;
      continue;
    }
    if (res.changed === 0) {
      console.error(`✗ JSON 解析失败，但未发现可修复的 stray 引号：${abs}`);
      bad++;
      continue;
    }

    try {
      JSON.parse(res.fixed);
    } catch (err) {
      console.error(
        `✗ 修复后仍无法解析（**拒绝落盘**）：${abs}\n  ${String(err)}`
      );
      bad++;
      continue;
    }

    if (dryRun) {
      console.log(
        `• 待修复 stray 引号 ${res.changed} 处（--dry-run 未落盘）：${abs}`
      );
      bad++;
      continue;
    }

    writeFileSync(abs, res.fixed, 'utf8');
    console.log(`✓ 已修复 ${res.changed} 处 stray 引号，复检可解析：${abs}`);
  }

  process.exit(bad > 0 ? 1 : 0);
}
