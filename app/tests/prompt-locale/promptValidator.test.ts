/**
 * C-5（2026-10-18）提示词资源校验器守卫。
 *
 * 验收锚点（清单 §4 C-5）：「删掉一个 `${toolName}` 必须报 `PLACEHOLDER_MISSING`」。
 *
 * 覆盖：manifest ↔ 目录 / locale 覆盖度 / 占位符守恒 / T1 标签守恒 /
 * 长度阈值（1.5× warning、2× error）/ 真实资源全量 0 error。
 */
import { describe, it, expect, afterAll } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  validatePromptResources,
  formatPromptIssues,
  extractPromptPlaceholders,
  extractPromptT1Markers,
  estimatePromptTokens,
  type PromptIssue,
} from '../../src/services/prompt/PromptValidator';

const FIXTURE_ROOT = mkdtempSync(join(tmpdir(), 'c5-prompts-'));

afterAll(() => {
  rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

/** 写入一条 section（自动建目录） */
function writeSection(
  root: string,
  locale: string,
  id: string,
  text: string
): void {
  const dir = join(root, locale, 'sections');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.md`), text, 'utf-8');
}

/** 写入 manifest（只含 system 静态条目） */
function writeManifest(
  root: string,
  locale: string,
  ids: readonly string[]
): void {
  const dir = join(root, locale);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        locale,
        entries: ids.map((id) => ({
          id: `section:${id}`,
          layer: 'system',
          kind: 'static',
          locale,
          file: `sections/${id}.md`,
        })),
      },
      null,
      2
    ),
    'utf-8'
  );
}

/** 建一个独立 fixture（每次用例互不干扰） */
function makeFixture(
  sourceText: string,
  targetText: string
): { root: string; issues: PromptIssue[] } {
  const root = mkdtempSync(join(FIXTURE_ROOT, 'case-'));
  writeManifest(root, 'zh-CN', ['demo']);
  writeManifest(root, 'en-US', ['demo']);
  writeSection(root, 'zh-CN', 'demo', sourceText);
  writeSection(root, 'en-US', 'demo', targetText);
  const { issues } = validatePromptResources({ root });
  return { root, issues };
}

function codes(issues: readonly PromptIssue[]): string[] {
  return issues.map((i) => i.code);
}

describe('C-5 占位符守恒（验收锚点）', () => {
  it('删掉一个 ${toolName} ⇒ PLACEHOLDER_MISSING（error）', () => {
    const { issues } = makeFixture(
      '调用 ${toolName} 获取结果，参见 <think> 通道。',
      'Call the tool to get the result, see the <think> channel.'
    );
    const missing = issues.filter((i) => i.code === 'PLACEHOLDER_MISSING');
    expect(missing).toHaveLength(1);
    expect(missing[0].severity).toBe('error');
    expect(missing[0].message).toContain('toolName');
  });

  it('占位符完整保留 ⇒ 无 PLACEHOLDER_MISSING / EXTRA', () => {
    const { issues } = makeFixture(
      '调用 ${toolName} 获取结果，参见 <think> 通道。',
      'Call ${toolName} to get the result, see the <think> channel.'
    );
    expect(codes(issues)).not.toContain('PLACEHOLDER_MISSING');
    expect(codes(issues)).not.toContain('PLACEHOLDER_EXTRA');
  });

  it('译文多出源文没有的占位符 ⇒ PLACEHOLDER_EXTRA（warning）', () => {
    const { issues } = makeFixture(
      '调用 ${toolName}。',
      'Call ${toolName} with ${extraArg}.'
    );
    const extra = issues.filter((i) => i.code === 'PLACEHOLDER_EXTRA');
    expect(extra).toHaveLength(1);
    expect(extra[0].severity).toBe('warning');
  });
});

describe('C-5 T1 协议文本守恒', () => {
  it('译文丢失 <think> ⇒ T1_MISSING（error）', () => {
    const { issues } = makeFixture(
      '只允许在 <think> 内叙述。',
      'Narration is only allowed in the thinking channel.'
    );
    const missing = issues.filter((i) => i.code === 'T1_MISSING');
    expect(missing).toHaveLength(1);
    expect(missing[0].message).toContain('<think>');
  });

  it('工具 wire 名不得被翻译：read_file 丢失 ⇒ T1_MISSING', () => {
    const { issues } = makeFixture(
      '优先使用 read_file 读取文件。',
      'Prefer the read tool to read files.'
    );
    expect(codes(issues)).toContain('T1_MISSING');
  });

  it('译文新增源文没有的 T1 标记 ⇒ T1_EXTRA（warning）', () => {
    const { issues } = makeFixture(
      '使用文件工具。',
      'Use the bash tool to run commands.'
    );
    const extra = issues.filter((i) => i.code === 'T1_EXTRA');
    expect(extra).toHaveLength(1);
    expect(extra[0].severity).toBe('warning');
  });
});

describe('C-5 长度阈值（token 口径）', () => {
  it('1.6× token ⇒ LENGTH_RATIO warning', () => {
    // 源：100 个汉字 ≈ 150 token；目标：960 个拉丁字符 ≈ 240 token ⇒ 1.6×
    const { issues } = makeFixture('中'.repeat(100), 'a'.repeat(960));
    const ratio = issues.filter((i) => i.code === 'LENGTH_RATIO');
    expect(ratio).toHaveLength(1);
    expect(ratio[0].severity).toBe('warning');
  });

  it('3× token ⇒ LENGTH_RATIO error', () => {
    const { issues } = makeFixture('中'.repeat(100), 'a'.repeat(1800));
    const ratio = issues.filter((i) => i.code === 'LENGTH_RATIO');
    expect(ratio).toHaveLength(1);
    expect(ratio[0].severity).toBe('error');
  });

  it('token 估算口径：CJK 1 字 ≈ 1.5、拉丁 4 字符 ≈ 1', () => {
    expect(estimatePromptTokens('中'.repeat(100))).toBe(150);
    expect(estimatePromptTokens('a'.repeat(400))).toBe(100);
  });
});

describe('C-5 manifest 与覆盖度', () => {
  it('manifest 缺失 ⇒ MANIFEST_MISSING（error）', () => {
    const root = mkdtempSync(join(FIXTURE_ROOT, 'nomanifest-'));
    mkdirSync(join(root, 'zh-CN', 'sections'), { recursive: true });
    const { issues } = validatePromptResources({ root });
    expect(codes(issues)).toContain('MANIFEST_MISSING');
  });

  it('译文文件缺失 ⇒ FILE_MISSING（error）', () => {
    const root = mkdtempSync(join(FIXTURE_ROOT, 'notarget-'));
    writeManifest(root, 'zh-CN', ['demo']);
    writeSection(root, 'zh-CN', 'demo', '内容');
    mkdirSync(join(root, 'en-US', 'sections'), { recursive: true });
    const { issues } = validatePromptResources({ root });
    expect(codes(issues)).toContain('FILE_MISSING');
  });

  it('译文为空 ⇒ FILE_EMPTY（error）', () => {
    const { issues } = makeFixture('内容', '   ');
    expect(codes(issues)).toContain('FILE_EMPTY');
  });

  it('目录存在 manifest 未登记的文件 ⇒ FILE_ORPHAN（warning）', () => {
    const root = mkdtempSync(join(FIXTURE_ROOT, 'orphan-'));
    writeManifest(root, 'zh-CN', ['demo']);
    writeSection(root, 'zh-CN', 'demo', '内容');
    writeSection(root, 'zh-CN', 'stale', '多余产物');
    writeManifest(root, 'en-US', ['demo']);
    writeSection(root, 'en-US', 'demo', 'content');
    const { issues } = validatePromptResources({ root });
    const orphan = issues.filter((i) => i.code === 'FILE_ORPHAN');
    expect(orphan.length).toBeGreaterThan(0);
    expect(orphan[0].severity).toBe('warning');
  });
});

describe('C-3b / T2 工具级资源校验（参数描述 + 工具级描述）', () => {
  /** 建一个只含工具级资源的最小 fixture（manifest 条目为空） */
  function makeToolFixture(
    zh: Record<string, string>,
    en: Record<string, string>,
    file = 'tool-params.json',
    field: 'params' | 'descriptions' = 'params'
  ): { root: string; issues: PromptIssue[] } {
    const root = mkdtempSync(join(FIXTURE_ROOT, 'tool-'));
    mkdirSync(join(root, 'zh-CN'), { recursive: true });
    mkdirSync(join(root, 'en-US'), { recursive: true });
    writeFileSync(
      join(root, 'zh-CN', 'manifest.json'),
      JSON.stringify({ schemaVersion: 1, locale: 'zh-CN', entries: [] }),
      'utf-8'
    );
    // 两种资源都写齐，避免未测文件产生额外 MISSING 噪声
    const writeResource = (
      locale: string,
      name: string,
      key: 'params' | 'descriptions',
      map: Record<string, string>
    ): void => {
      writeFileSync(
        join(root, locale, name),
        JSON.stringify({ schemaVersion: 1, locale, [key]: map }),
        'utf-8'
      );
    };
    writeResource('zh-CN', file, field, zh);
    writeResource('en-US', file, field, en);
    const other =
      file === 'tool-params.json'
        ? 'tool-descriptions.json'
        : 'tool-params.json';
    const otherField = field === 'params' ? 'descriptions' : 'params';
    writeResource('zh-CN', other, otherField, {});
    writeResource('en-US', other, otherField, {});
    const { issues } = validatePromptResources({ root, locales: ['en-US'] });
    return { root, issues };
  }

  it('键集漂移 ⇒ TOOL_KEY_DRIFT（error，含缺/多计数）', () => {
    const { issues } = makeToolFixture({ 'a.x': '甲' }, { 'b.y': 'B' });
    const drift = issues.filter((i) => i.code === 'TOOL_KEY_DRIFT');
    expect(drift).toHaveLength(1);
    expect(drift[0].severity).toBe('error');
    expect(drift[0].message).toContain('缺 1 条');
    expect(drift[0].message).toContain('多 1 条');
  });

  it('空译文 ⇒ TOOL_VALUE_EMPTY（error）', () => {
    const { issues } = makeToolFixture({ 'a.x': '甲' }, { 'a.x': '   ' });
    const empty = issues.filter((i) => i.code === 'TOOL_VALUE_EMPTY');
    expect(empty).toHaveLength(1);
    expect(empty[0].severity).toBe('error');
  });

  it('残留中文 ⇒ TOOL_VALUE_UNTRANSLATED；VFS 挂载名不误判', () => {
    const bad = makeToolFixture({ 'a.x': '甲' }, { 'a.x': '还是中文' });
    expect(
      bad.issues.filter((i) => i.code === 'TOOL_VALUE_UNTRANSLATED')
    ).toHaveLength(1);

    const ok = makeToolFixture(
      { 'a.x': '甲' },
      { 'a.x': 'Use dev_docs://配置与安全/sandbox.md' }
    );
    expect(
      ok.issues.filter((i) => i.code === 'TOOL_VALUE_UNTRANSLATED')
    ).toHaveLength(0);
  });

  it('源资源缺失 ⇒ TOOL_RESOURCE_MISSING（error）', () => {
    const root = mkdtempSync(join(FIXTURE_ROOT, 'tool-missing-'));
    mkdirSync(join(root, 'zh-CN'), { recursive: true });
    writeFileSync(
      join(root, 'zh-CN', 'manifest.json'),
      JSON.stringify({ schemaVersion: 1, locale: 'zh-CN', entries: [] }),
      'utf-8'
    );
    const { issues } = validatePromptResources({ root, locales: ['en-US'] });
    const missing = issues.filter((i) => i.code === 'TOOL_RESOURCE_MISSING');
    expect(missing.length).toBeGreaterThanOrEqual(2);
    expect(missing.every((i) => i.severity === 'error')).toBe(true);
  });

  it('占位符缺失 ⇒ TOOL_PLACEHOLDER_MISSING（error）', () => {
    const { issues } = makeToolFixture(
      { 'a.x': '需要 ${line} 参数' },
      { 'a.x': 'needs a parameter' }
    );
    const missing = issues.filter((i) => i.code === 'TOOL_PLACEHOLDER_MISSING');
    expect(missing).toHaveLength(1);
    expect(missing[0].severity).toBe('error');
    expect(missing[0].message).toContain('a.x');
  });

  it('T1 工具名缺失 ⇒ TOOL_T1_MISSING（error）', () => {
    const { issues } = makeToolFixture(
      { 'a.x': '优先调用 read_file 读取' },
      { 'a.x': 'prefer the file reader' }
    );
    const missing = issues.filter((i) => i.code === 'TOOL_T1_MISSING');
    expect(missing).toHaveLength(1);
    expect(missing[0].severity).toBe('error');
    expect(missing[0].message).toContain('read_file');
  });

  it('真实资源：参数/工具级描述均无 TOOL_* error', () => {
    const { issues } = validatePromptResources();
    const toolIssues = issues.filter((i) => i.code.startsWith('TOOL_'));
    expect(toolIssues).toEqual([]);
  });
});

describe('C-5 真实资源基线', () => {
  it('app/prompts 全量校验：0 error（warning 允许，当前应为 0）', () => {
    const { issues, locales } = validatePromptResources();
    expect(locales).toContain('en-US');
    const errors = issues.filter((i) => i.severity === 'error');
    expect(formatPromptIssues(errors)).toBe('✓ 提示词资源校验通过（0 issue）');
    expect(errors).toEqual([]);
  });

  it('辅助函数与解析链同源（占位符 / T1 提取可用）', () => {
    expect([...extractPromptPlaceholders('a ${x} b {y}')].sort()).toEqual([
      'x',
      'y',
    ]);
    expect([...extractPromptT1Markers('<think> read_file')].sort()).toEqual([
      '<think>',
      'read_file',
    ]);
  });
});
