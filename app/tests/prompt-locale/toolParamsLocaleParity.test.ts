/**
 * C-3b（2026-10-18）`tool-params.json` 的 **en-US 译文对照守卫**。
 *
 * 判据（对应清单 §4 C-3b 偏离 ①「en-US 参数描述未翻译」的关闭条件）：
 * - **键覆盖**：en-US 与 zh-CN 的 `params` 键集合**完全相同**（359 条 / 75 工具）；
 * - **非空且无中文**：译文不得留空，也不得残留 CJK（未翻译即失败）；
 * - **T1 协议文本守恒**：工具 wire 名、`globalThis.__liriRuntime`、`dev_docs://`、
 *   `~/.pyapp/output`、`%VAR%`、`select:<tool_name>` 等**不得被翻译**；
 * - **占位符与反引号守恒**：`{line, character}` 等占位符集合一致、反引号数量一致；
 * - **长度阈值**：en-US ≤ 2× zh-CN（C-5 的拒绝级；按 token 近似估算而非字符数）。
 *
 * 说明：本文件只做**纯资源对照**（不触碰 `setUserDataDirOverride` 单例）；
 * 解析链命中 en-US 的行为用例放在 `tests/prompts/resolvePromptChain.test.ts`（同文件串行）。
 */
import { describe, it, expect } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PROMPTS_ROOT = join(import.meta.dir, '../../prompts');
const ZH_PATH = join(PROMPTS_ROOT, 'zh-CN', 'tool-params.json');
const EN_PATH = join(PROMPTS_ROOT, 'en-US', 'tool-params.json');

interface ToolParamsFile {
  schemaVersion?: number;
  locale?: string;
  counts?: { tools?: number; params?: number };
  params?: Record<string, string>;
}

function load(path: string): ToolParamsFile {
  return JSON.parse(readFileSync(path, 'utf-8')) as ToolParamsFile;
}

/**
 * T1 协议文本（**禁译**）：工具 wire 名 + 运行时标识 + 路径/占位写法。
 *
 * 与 `tests/prompt-locale/localeParity.test.ts` 的 `T1_TOOL_NAMES` 同源，
 * 另加参数描述里真实出现的运行时/接口标识。
 */
const T1_TOKENS = [
  'read_file',
  'write_file',
  'edit_file',
  'file_read',
  'file_write',
  'file_edit',
  'file_list',
  'grep',
  'glob',
  'bash',
  'web_search',
  'web_fetch',
  'todo_write',
  'ask_user_question',
  'save_conversation',
  'knowledge_save',
  'create_project',
  'write_project_file',
  'doc_generate',
  'file_convert',
  'pdf',
  'globalThis.__liriRuntime',
  'dev_docs://',
  '~/.pyapp/output',
  '%VAR%',
  'select:<tool_name>',
  'SendMessage',
  'NotebookEditTool',
  'TaskCard',
  'skills_list',
];

function extractT1(text: string): Set<string> {
  const found = new Set<string>();
  for (const token of T1_TOKENS) {
    if (text.includes(token)) found.add(token);
  }
  return found;
}

/** 占位符：`{word}` / `${word}`（含点号），排除 JSON 对象字面量里的自然语言 */
function extractPlaceholders(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(
    /\$\{([A-Za-z_][\w.]*)\}|\{([A-Za-z_][\w.]*)\}/g
  )) {
    out.add(m[1] ?? m[2]);
  }
  return out;
}

/** 近似 token 估算（CJK 1 字 ≈ 1.5 token；拉丁 ~4 字符 ≈ 1 token） */
function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g) ?? [])
    .length;
  const latin = text.length - cjk;
  return Math.round(cjk * 1.5 + latin / 4);
}

const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;

describe('C-3b en-US 参数描述覆盖度', () => {
  it('en-US 文件存在、locale 正确、键集合与 zh-CN 完全一致', () => {
    expect(existsSync(EN_PATH)).toBe(true);
    const zh = load(ZH_PATH);
    const en = load(EN_PATH);

    expect(en.locale).toBe('en-US');
    expect(en.schemaVersion).toBe(1);
    expect(en.counts?.tools).toBe(zh.counts?.tools);
    expect(en.counts?.params).toBe(zh.counts?.params);

    const zhKeys = Object.keys(zh.params ?? {}).sort();
    const enKeys = Object.keys(en.params ?? {}).sort();
    expect(enKeys).toEqual(zhKeys);
    expect(enKeys.length).toBe(zh.counts?.params ?? -1);
  });

  it('每条译文非空且不残留中文（未翻译 ⇒ 失败）', () => {
    const zh = load(ZH_PATH).params ?? {};
    const en = load(EN_PATH).params ?? {};
    const problems: string[] = [];

    for (const key of Object.keys(zh)) {
      const value = en[key];
      if (!value || value.trim().length === 0) {
        problems.push(`${key}: empty`);
        continue;
      }
      if (CJK.test(value)) problems.push(`${key}: still contains CJK`);
    }
    expect(problems).toEqual([]);
  });
});

describe('C-3b en-US T1 协议文本与结构守恒', () => {
  it('T1 标识（工具名 / 运行时 / 路径写法）在两份资源中一致（禁译）', () => {
    const zh = load(ZH_PATH).params ?? {};
    const en = load(EN_PATH).params ?? {};
    const mismatches: string[] = [];

    for (const key of Object.keys(zh)) {
      const zhT1 = extractT1(zh[key]);
      const enT1 = extractT1(en[key]);
      const missing = [...zhT1].filter((x) => !enT1.has(x));
      const extra = [...enT1].filter((x) => !zhT1.has(x));
      if (missing.length || extra.length) {
        mismatches.push(`${key}: missing=[${missing}] extra=[${extra}]`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('占位符集合一致、反引号数量一致', () => {
    const zh = load(ZH_PATH).params ?? {};
    const en = load(EN_PATH).params ?? {};
    const problems: string[] = [];

    for (const key of Object.keys(zh)) {
      const zhP = [...extractPlaceholders(zh[key])].sort();
      const enP = [...extractPlaceholders(en[key])].sort();
      if (zhP.join('|') !== enP.join('|')) {
        problems.push(`${key}: placeholders [${zhP}] vs [${enP}]`);
      }
      const zhTicks = (zh[key].match(/`/g) ?? []).length;
      const enTicks = (en[key].match(/`/g) ?? []).length;
      if (zhTicks !== enTicks) {
        problems.push(`${key}: backticks ${zhTicks} vs ${enTicks}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('C-3b en-US 长度预算', () => {
  it('每条译文 ≤ 2× zh-CN token（拒绝级；1.5× 为告警级，本守卫不拒）', () => {
    const zh = load(ZH_PATH).params ?? {};
    const en = load(EN_PATH).params ?? {};
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
