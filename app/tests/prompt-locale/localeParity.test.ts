/**
 * C-4（2026-10-18）`en-US` 译文对照守卫。
 *
 * 判据（对应清单 §4 C-4）：
 * - **覆盖度**：en-US 的 sections/tools 文件集合 == zh-CN manifest 中静态段 + 工具提示词；
 * - **T1 协议文本守恒**：工具名、`<think>`、`[FILE_OPERATION]`、`<create|modify|delete>`、
 *   JSON/snake_case 标识符不得被翻译（清单 §4 C-3「T1 禁译」）；
 * - **占位符守恒**：`{command}` 等占位符与代码块围栏数量一致；
 * - **长度阈值**：en-US ≤ 2× zh-CN（C-5 的拒绝级；1.5× 为告警级，本守卫仅拒 2×）；
 * - **行为契约（离线）**：读文件先读后改 / 协商最多 2 轮 / 空结果禁编造 / 越权拒绝，
 *   在两个 locale 都有对应表达。
 *
 * **边界（CS06）**：本文件**不是**真实模型行为对照 —— 后者需要模型凭据与费用
 * （固定任务集 = 读文件 / 编辑 / 协商 / 拒绝越权），登记为待执行项（见台账 §4 C-4）。
 */
import { describe, it, expect } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
  normalizeLang,
  resolveConfiguredLanguage,
} from '../../src/system/i18n/languageProfiles';

const PROMPTS_ROOT = join(import.meta.dir, '../../prompts');
const ZH_ROOT = join(PROMPTS_ROOT, 'zh-CN');
const EN_ROOT = join(PROMPTS_ROOT, 'en-US');

interface ManifestEntry {
  id: string;
  layer: string;
  kind: string;
  file?: string;
}

function langEntries(): ManifestEntry[] {
  const manifest = JSON.parse(
    readFileSync(join(ZH_ROOT, 'manifest.json'), 'utf-8')
  ) as { entries: ManifestEntry[] };
  return manifest.entries.filter((e) =>
    e.layer === 'system' ? e.kind === 'static' : e.layer === 'tools'
  );
}

function listMd(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) {
      out.push(...listMd(full, base));
    } else if (name.name.endsWith('.md')) {
      out.push(relative(base, full).replace(/\\/g, '/'));
    }
  }
  return out.sort();
}

/** 每个 manifest 条目对应的双语文件路径 */
function entryFiles(entry: ManifestEntry): string {
  if (entry.layer === 'tools') return entry.file!;
  // system 静态段：manifest.file = sections/<id>.md
  return entry.file!;
}

/** 近似 token 估算（CJK 1 字 ≈ 1.5 token；拉丁 ~4 字符 ≈ 1 token） */
function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g) ?? [])
    .length;
  const latin = text.length - cjk;
  return Math.round(cjk * 1.5 + latin / 4);
}

describe('C-4 en-US 覆盖度', () => {
  it('en-US 文件集合与 manifest（静态段 + 工具提示词）一致，无缺无多', () => {
    const expected = langEntries()
      .map((e) => entryFiles(e))
      .sort();
    const actual = listMd(EN_ROOT);

    expect(expected.length).toBeGreaterThan(0);
    expect(actual).toEqual(expected);
  });

  it('每条 en-US 译文非空且在 2× token 预算以内（拒绝级）', () => {
    // 为什么按 token 而非字符：中文 1 字 ≈ 1.2-1.5 token，英文 ~4 字符 ≈ 1 token，
    // 直接比字符数会得出 2.2-3.0× 的假超标（实测）。C-5 的「1.5× 告警 / 2× 拒绝」
    // 是 prompt budget 的 token 口径，此处用同口径的近似估算。
    const offenders: string[] = [];
    for (const entry of langEntries()) {
      const rel = entryFiles(entry);
      const zh = readFileSync(join(ZH_ROOT, rel), 'utf-8').trim();
      const en = readFileSync(join(EN_ROOT, rel), 'utf-8').trim();
      if (!en) {
        offenders.push(`${rel}: empty`);
        continue;
      }
      const zhTokens = estimateTokens(zh);
      const enTokens = estimateTokens(en);
      if (enTokens > zhTokens * 2) {
        offenders.push(`${rel}: ${enTokens} > 2×${zhTokens} tokens`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ─── T1 协议文本守恒 ────────────────────────────────────────────────────────

/** T1：工具 wire 名（清单 §4 C-3「工具名禁译」） */
const T1_TOOL_NAMES = [
  'read_file',
  'write_file',
  'edit_file',
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
  'file_write',
  'file_convert',
  'pdf',
];

function extractT1(text: string): Set<string> {
  const found = new Set<string>();
  for (const name of T1_TOOL_NAMES) {
    if (new RegExp(`\\b${name}\\b`).test(text)) found.add(name);
  }
  for (const tag of [
    '<think>',
    '</think>',
    '[FILE_OPERATION]',
    '<create|modify|delete>',
  ]) {
    if (text.includes(tag)) found.add(tag);
  }
  return found;
}

/** 占位符：`{word}` / `${word}`（含 snake_case，排除 JSON 对象字面量 `{ "`） */
function extractPlaceholders(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(
    /\$\{([A-Za-z_][\w.]*)\}|\{([A-Za-z_][\w.]*)\}/g
  )) {
    out.add(m[1] ?? m[2]);
  }
  return out;
}

function fenceCount(text: string): number {
  return (text.match(/^```/gm) ?? []).length;
}

describe('C-4 T1 协议文本与占位符守恒', () => {
  it('T1 工具名 / 标签在两个 locale 完全一致（禁译）', () => {
    const mismatches: string[] = [];
    for (const entry of langEntries()) {
      const rel = entryFiles(entry);
      const zhT1 = extractT1(readFileSync(join(ZH_ROOT, rel), 'utf-8'));
      const enT1 = extractT1(readFileSync(join(EN_ROOT, rel), 'utf-8'));
      const missing = [...zhT1].filter((x) => !enT1.has(x));
      const extra = [...enT1].filter((x) => !zhT1.has(x));
      if (missing.length || extra.length) {
        mismatches.push(`${rel}: missing=[${missing}] extra=[${extra}]`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('占位符与代码块围栏数量一致（结构与插值不漂移）', () => {
    const problems: string[] = [];
    for (const entry of langEntries()) {
      const rel = entryFiles(entry);
      const zh = readFileSync(join(ZH_ROOT, rel), 'utf-8');
      const en = readFileSync(join(EN_ROOT, rel), 'utf-8');

      const zhP = extractPlaceholders(zh);
      const enP = extractPlaceholders(en);
      const missing = [...zhP].filter((x) => !enP.has(x));
      if (missing.length)
        problems.push(`${rel}: placeholders missing [${missing}]`);

      if (fenceCount(zh) !== fenceCount(en)) {
        problems.push(`${rel}: fences ${fenceCount(zh)} vs ${fenceCount(en)}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

// ─── 行为契约（离线断言：两 locale 都必须表达同一规则） ──────────────────────

interface BehaviorContract {
  id: string;
  zhPattern: RegExp;
  enPattern: RegExp;
  /** 断言哪个文件（相对 sections/ 或 tools/） */
  file: string;
}

const CONTRACTS: BehaviorContract[] = [
  {
    id: 'read-before-edit',
    file: 'sections/toolUse.md',
    zhPattern: /先读取[^。\n]*再编辑/,
    enPattern: /read[^.\n]*before editing/i,
  },
  {
    id: 'empty-result-no-fabrication',
    file: 'sections/toolIntegrity.md',
    zhPattern: /禁止编造/,
    enPattern: /never fabricate/i,
  },
  {
    id: 'negotiation-max-rounds',
    file: 'sections/taskNegotiation.md',
    zhPattern: /最多与用户协商 2 轮/,
    enPattern: /at most 2 rounds/i,
  },
  {
    id: 'todo-write-mandatory',
    file: 'sections/taskNegotiation.md',
    zhPattern: /必须立刻调用 todo_write/,
    enPattern: /must immediately call todo_write/i,
  },
  {
    id: 'deny-overreach',
    file: 'sections/toolIntegrity.md',
    zhPattern: /权限拒绝/,
    enPattern: /permission denied/i,
  },
  {
    id: 'no-body-narration',
    file: 'sections/toolUse.md',
    zhPattern: /禁止把工具执行过程叙述混入正文/,
    enPattern: /never mix tool-execution narration into the main body/i,
  },
];

describe('C-4 行为契约（两 locale 同规则）', () => {
  it('每条离线契约在 zh-CN 与 en-US 都有对应表达', () => {
    const failures: string[] = [];
    for (const c of CONTRACTS) {
      const zh = readFileSync(join(ZH_ROOT, c.file), 'utf-8');
      const en = readFileSync(join(EN_ROOT, c.file), 'utf-8');
      if (!c.zhPattern.test(zh)) failures.push(`${c.id}: zh 无对应表达`);
      if (!c.enPattern.test(en)) failures.push(`${c.id}: en 无对应表达`);
    }
    expect(failures).toEqual([]);
  });
});

// ─── 语言别名与配置入口 ─────────────────────────────────────────────────────

describe('C-4 locale 解析入口', () => {
  it('语言别名归一：en-GB / EN → en-US；未知 ⇒ undefined', () => {
    expect(normalizeLang('en-GB')).toBe('en-US');
    expect(normalizeLang('EN')).toBe('en-US');
    expect(normalizeLang('zh-hant')).toBe('zh-TW');
    expect(normalizeLang('fr-FR')).toBeUndefined();
    expect(normalizeLang('')).toBeUndefined();
  });

  it('配置驱动入口可调用（未配置 ⇒ undefined ⇒ 源语言 zh-CN）', () => {
    // 不写入用户配置：只断言函数存在且返回合法类型（真实配置值由运行环境决定）
    const resolved = resolveConfiguredLanguage();
    expect(resolved === undefined || typeof resolved === 'string').toBe(true);
  });
});

// 注：`resolvePrompt` / `resolveToolPrompt` 的 locale 路由用例（en-US 命中英文、
// ja-JP 回退 en-US）放在 `tests/prompts/resolvePromptChain.test.ts` —— 那里已隔离
// `setUserDataDirOverride` 单例；本文件只做纯资源对照，避免跨文件并发争用。

// ─── 接线守卫 ───────────────────────────────────────────────────────────────

describe('C-4 接线守卫', () => {
  it('PromptAssembler 的 locale 缺省解析走 resolveConfiguredLanguage（单一来源）', () => {
    const source = readFileSync(
      join(import.meta.dir, '../../src/services/prompt/PromptAssembler.ts'),
      'utf-8'
    );
    expect(source).toContain('resolveConfiguredLanguage');
    // 禁止在组装层重复实现配置读取 + 归一化
    expect(source).not.toContain("getConfigValue<string>('language')");
  });

  it('en-US 目录不含 manifest（键范围以 zh-CN manifest 为唯一事实源）', () => {
    expect(existsSync(join(EN_ROOT, 'manifest.json'))).toBe(false);
  });
});
