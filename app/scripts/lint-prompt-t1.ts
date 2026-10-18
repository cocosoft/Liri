/**
 * C-5（2026-10-18）`lint:prompt-t1` —— T1 协议文本不得参与 localize。
 *
 * 两路检查：
 * 1. 资源侧：`T1_MISSING` / `T1_EXTRA`（工具 wire 名 / `<think>` / `[FILE_OPERATION]` /
 *    `<create|modify|delete>` 在译文中守恒）；
 * 2. 源码侧：**T1 协议文件**不得出现 `t(` / `resolvePrompt(` —— 这些文件承载
 *    机器解析的协议文本（工具名、缓存边界、schema），一旦 localize 会让模型与解析器
 *    看到不同符号（`T1_LOCALIZED`）。
 *
 * 用法：`bun run scripts/lint-prompt-t1.ts [--strict] [--json]`
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  validatePromptResources,
  type PromptIssue,
} from '../src/services/prompt/PromptValidator';
import { parseGateArgs, reportPromptGate } from './lib/promptLintReport';

/** T1 协议文件（显式清单 + 理由；新增需评审） */
const T1_PROTOCOL_FILES: ReadonlyArray<{ rel: string; reason: string }> = [
  {
    rel: 'src/constants/systemPromptSections.ts',
    reason: '段框架与 CACHE_BOUNDARY（缓存断点由 provider 解析）',
  },
  {
    rel: 'src/tools/toolNameConstants.ts',
    reason: '工具 wire 名（模型调用与策略判定共用）',
  },
  {
    rel: 'src/utils/toolContract/Tool.ts',
    reason: 'ToolInfo / schema 契约类型',
  },
  {
    rel: 'src/tools/BaseTool.ts',
    reason: '工具 schema 生成（input_schema 字段名与结构）',
  },
];

const APP_ROOT = join(import.meta.dir, '..');

function scanSource(): PromptIssue[] {
  const issues: PromptIssue[] = [];
  for (const file of T1_PROTOCOL_FILES) {
    const path = join(APP_ROOT, file.rel);
    if (!existsSync(path)) continue;
    const source = readFileSync(path, 'utf-8');

    // t( 调用：\b 保证不会误伤 format( / insert( 等
    const localizedCall = /\bt\s*\(/.test(source);
    const promptResolve = source.includes('resolvePrompt(');
    if (localizedCall || promptResolve) {
      const hits = [
        localizedCall ? '`t(`' : null,
        promptResolve ? '`resolvePrompt(`' : null,
      ]
        .filter(Boolean)
        .join(' / ');
      issues.push({
        code: 'T1_LOCALIZED',
        severity: 'error',
        entry: file.rel,
        message: `T1 协议文件出现 localize 调用 ${hits}（${file.reason}）`,
      });
    }
  }
  return issues;
}

const { issues } = validatePromptResources();
const resourceIssues = issues.filter(
  (i) => i.code === 'T1_MISSING' || i.code === 'T1_EXTRA'
);

reportPromptGate(
  't1',
  [...resourceIssues, ...scanSource()],
  parseGateArgs(process.argv.slice(2))
);
// lint:exit —— 入口脚本必须显式退出，避免依赖拉起的句柄让命令卡住
process.exit(0);
