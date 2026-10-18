/**
 * T2（2026-10-18）`tool-descriptions.json` 的 **en-US 译文对照守卫**。
 *
 * 背景：工具级描述（模型侧 `tools[].description`）此前是源码硬编码中文，
 * en-US 下 55 个工具仍输出中文。现收敛为单文件资源（键 = 工具 wire 名），
 * 由 `ToolRegistry.getToolSchemas()` 单点替换。
 *
 * 判据：
 * - **键覆盖**：en-US 与 zh-CN 键集合完全相同，且等于 `counts.tools`；
 * - **非空且无中文**：译文不得留空、不得残留 CJK（VFS/URL 标识符中的中文除外 —— 挂载名是 T1）；
 * - **运行时标识守恒**：工具名 / `__liriRuntime` / `dev_docs://` / `~/.pyapp/output` /
 *   `%TEMP%` / `cmd.exe` / `searchPath` 等**不得被翻译**（zh 出现 ⇒ en 必须出现）；
 * - **长度预算**：en-US ≤ 2× zh-CN token（近似估算）。
 */
import { describe, it, expect } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveToolDescription } from '../../src/services/prompt/PromptVersionManager';

const PROMPTS_ROOT = join(import.meta.dir, '../../prompts');
const ZH_PATH = join(PROMPTS_ROOT, 'zh-CN', 'tool-descriptions.json');
const EN_PATH = join(PROMPTS_ROOT, 'en-US', 'tool-descriptions.json');

interface ToolDescriptionsFile {
  schemaVersion?: number;
  locale?: string;
  counts?: { tools?: number };
  descriptions?: Record<string, string>;
}

function load(path: string): ToolDescriptionsFile {
  return JSON.parse(readFileSync(path, 'utf-8')) as ToolDescriptionsFile;
}

/** VFS / URL 标识符（authority 可能含中文，属 T1 禁译）—— 判 CJK 前剔除 */
const VFS_PATH_RE = /[a-zA-Z][\w+.-]*:\/\/\S*/g;
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;

function hasUntranslatedCjk(text: string): boolean {
  return CJK.test(text.replace(VFS_PATH_RE, ''));
}

/** 运行时标识（禁译）：zh 里出现 ⇒ en 里也必须出现 */
const T1_TOKENS = [
  'file_read',
  'file_write',
  'file_edit',
  'write_project_file',
  'skills_list',
  'skill_view',
  'media_pdf_extract',
  'music_generate',
  'image_generate',
  'video_generate',
  'select:<tool_name>',
  '__liriRuntime',
  'dev_docs://',
  '~/.pyapp/output',
  'VFS_READ_ONLY_MOUNT',
  'invalidRegex',
  'cmd.exe',
  'powershell -Command',
  'CronScheduler',
  'searchPath',
  'headLimit',
  'content_file',
  'source_file',
  '%TEMP%',
  '%USERPROFILE%',
];

function extractT1(text: string): Set<string> {
  const found = new Set<string>();
  for (const token of T1_TOKENS) {
    if (text.includes(token)) found.add(token);
  }
  return found;
}

/** 近似 token 估算（CJK 1 字 ≈ 1.5 token；拉丁 ~4 字符 ≈ 1 token） */
function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g) ?? [])
    .length;
  return Math.round(cjk * 1.5 + (text.length - cjk) / 4);
}

describe('T2 en-US 工具级描述覆盖度', () => {
  it('en-US 文件存在、locale 正确、键集合与 zh-CN 完全一致', () => {
    expect(existsSync(EN_PATH)).toBe(true);
    const zh = load(ZH_PATH);
    const en = load(EN_PATH);

    expect(en.locale).toBe('en-US');
    expect(en.schemaVersion).toBe(1);
    expect(en.counts?.tools).toBe(zh.counts?.tools);

    const zhKeys = Object.keys(zh.descriptions ?? {}).sort();
    const enKeys = Object.keys(en.descriptions ?? {}).sort();
    expect(enKeys).toEqual(zhKeys);
    expect(enKeys.length).toBe(zh.counts?.tools ?? -1);
  });

  it('每条译文非空且不残留中文（VFS 挂载名除外）', () => {
    const zh = load(ZH_PATH).descriptions ?? {};
    const en = load(EN_PATH).descriptions ?? {};
    const problems: string[] = [];

    for (const key of Object.keys(zh)) {
      const value = en[key];
      if (!value || value.trim().length === 0) {
        problems.push(`${key}: empty`);
        continue;
      }
      if (hasUntranslatedCjk(value))
        problems.push(`${key}: still contains CJK`);
    }
    expect(problems).toEqual([]);
  });

  it('运行时标识（工具名 / 协议 / 路径写法）不得被翻译', () => {
    const zh = load(ZH_PATH).descriptions ?? {};
    const en = load(EN_PATH).descriptions ?? {};
    const mismatches: string[] = [];

    for (const key of Object.keys(zh)) {
      const zhT1 = extractT1(zh[key]);
      const enT1 = extractT1(en[key]);
      const missing = [...zhT1].filter((token) => !enT1.has(token));
      if (missing.length > 0) {
        mismatches.push(`${key}: missing=[${missing}]`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('每条译文 ≤ 2× zh-CN token', () => {
    const zh = load(ZH_PATH).descriptions ?? {};
    const en = load(EN_PATH).descriptions ?? {};
    const offenders: string[] = [];

    for (const key of Object.keys(zh)) {
      const zhTokens = estimateTokens(zh[key]);
      const enTokens = estimateTokens(en[key]);
      if (enTokens > zhTokens * 2) {
        offenders.push(`${key}: ${enTokens} > 2×${zhTokens} tokens`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('T2 工具级描述解析链', () => {
  it('en-US：命中包内资源（与 en-US 文件同值）', () => {
    const en = load(EN_PATH).descriptions ?? {};
    const expected = en['file_edit'];
    expect(expected).toBeDefined();
    expect(resolveToolDescription('file_edit', '源码兜底', 'en-US')).toBe(
      expected
    );
  });

  it('zh-CN：命中包内中文资源，行为与源码一致', () => {
    const zh = load(ZH_PATH).descriptions ?? {};
    expect(resolveToolDescription('file_edit', '源码兜底', 'zh-CN')).toBe(
      zh['file_edit']
    );
  });

  it('未登记的工具名 ⇒ 源码兜底原样返回', () => {
    expect(
      resolveToolDescription('__no_such_tool__', '源码兜底', 'en-US')
    ).toBe('源码兜底');
  });
});
