/**
 * C-3b / H-2（2026-10-18）：工具参数描述的 **locale 选择顺序**守卫。
 *
 * 根因：主聊天流的 `getToolSchemas()` 早于 `assembleSystemPrompt()`（后者才
 * `setSectionCacheLocale`），且已存在 system message 时 assembly 被整段跳过 ⇒
 * 只读缓存会让 en-US 参数译文**晚一轮或永不生效**。
 *
 * 修复后顺序：`resolveConfiguredLanguage() ?? getSectionCacheLocale()`。
 * 本用例不依赖用户当前语言：以「配置优先，缺省用缓存」解析出期望 locale，
 * 再用同一 locale 的 `resolveToolParam` 作为期望值，断言 schema 与之一致；
 * 当配置存在且不是 en-US 时，额外断言不会误用缓存里的 en-US。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import { setSectionCacheLocale } from '@modules/constants';

import { resolveToolParam } from '../../src/services/prompt/PromptVersionManager';
import { resolveConfiguredLanguage } from '../../src/system/i18n/languageProfiles';
import { ToolRegistry } from '../../src/tools/ToolRegistry';
import { ToolFactory } from '../../src/tools/ToolFactory';
import {
  getAllBuiltinToolLoaders,
  loadTools,
} from '../../src/tools/utils/ToolManagerUtils';

function buildSchemas(): ReturnType<ToolRegistry['getToolSchemas']> {
  const tools = loadTools(new ToolFactory(), getAllBuiltinToolLoaders());
  const registry = new ToolRegistry();
  for (const tool of tools) registry.registerTool(tool);
  return registry.getToolSchemas();
}

function fileEditFilePathDescription(
  schemas: ReturnType<ToolRegistry['getToolSchemas']>
): string | undefined {
  const schema = schemas.find((s) => s.name === 'file_edit');
  const props = schema?.input_schema.properties as
    | Record<string, { description?: string }>
    | undefined;
  return props?.file_path?.description;
}

afterEach(() => {
  setSectionCacheLocale('zh-CN');
});

describe('C-3b 工具 schema 的 locale 选择', () => {
  it('配置优先于 assembly 缓存；缺省时用缓存（en-US 译文可生效）', () => {
    // 模拟「assembly 尚未运行」的缓存值
    setSectionCacheLocale('en-US');
    const configured = resolveConfiguredLanguage();
    const expectedLocale = configured ?? 'en-US';

    const description = fileEditFilePathDescription(buildSchemas());
    expect(description).toBe(
      resolveToolParam('file_edit', 'file_path', 'FALLBACK', expectedLocale)
    );

    // 配置存在且不是 en-US ⇒ 必须压过缓存里的 en-US（防「晚一轮」回归）
    if (configured && configured !== 'en-US') {
      const enValue = resolveToolParam(
        'file_edit',
        'file_path',
        'FALLBACK',
        'en-US'
      );
      expect(description).not.toBe(enValue);
    }
  });

  it('源码守卫：getToolSchemas 以 resolveConfiguredLanguage 优先、缓存兜底', () => {
    const source = readFileSync(
      new URL('../../src/tools/ToolRegistry.ts', import.meta.url),
      'utf-8'
    );
    expect(source).toContain(
      'resolveConfiguredLanguage() ?? getSectionCacheLocale()'
    );
  });
});
