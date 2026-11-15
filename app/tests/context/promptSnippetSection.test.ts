/**
 * prompt_snippet 动态段（红线 S3，2026-11-15）
 *
 * 钉住四条：
 * ① **默认关闭**：开关未设置/为 0 时返回 `null`（不追加任何段 ⇒ 装配结果不变）；
 * ② **只在动态区**：`cacheBreak: true`（不进入稳定前缀）；
 * ③ **作用域隔离**：只命中 `workspaceId` 与当前项目一致的片段；
 * ④ **空则不加**：无生效片段 ⇒ `null`（不注入空壳段）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  buildPromptSnippetSection,
  isPromptSnippetEnabled,
  promptSnippetWorkspaceId,
  PROMPT_SNIPPET_ENABLE_ENV,
  PROMPT_SNIPPET_SECTION_NAME,
} from '@modules/context';
import { PromptSnippetStore } from '@modules/tasks';

const ENV_KEYS = [PROMPT_SNIPPET_ENABLE_ENV] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('isPromptSnippetEnabled（kill switch）', () => {
  it('未设置 / 0 / 空串 ⇒ 关闭；1 或 true ⇒ 打开', () => {
    expect(isPromptSnippetEnabled()).toBe(false);
    process.env[PROMPT_SNIPPET_ENABLE_ENV] = '0';
    expect(isPromptSnippetEnabled()).toBe(false);
    process.env[PROMPT_SNIPPET_ENABLE_ENV] = ' ';
    expect(isPromptSnippetEnabled()).toBe(false);
    process.env[PROMPT_SNIPPET_ENABLE_ENV] = '1';
    expect(isPromptSnippetEnabled()).toBe(true);
    process.env[PROMPT_SNIPPET_ENABLE_ENV] = 'TRUE';
    expect(isPromptSnippetEnabled()).toBe(true);
  });
});

describe('buildPromptSnippetSection（默认关闭 + 作用域 + 动态段）', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function storeWithActive(workspaceId: string): PromptSnippetStore {
    dir = mkdtempSync(join(tmpdir(), 'snippet-section-'));
    const store = new PromptSnippetStore(dir);
    store.save({
      workspaceId,
      text: '回答前先确认是否已有同名工具。',
      sourceCandidateIds: ['cand1'],
      evidence: ['score=0.30'],
      title: '先查重',
    });
    store.approve(store.list()[0], 'alice', 1_000);
    return store;
  }

  it('开关关闭 ⇒ 即使有生效片段也返回 null', () => {
    const store = storeWithActive('ws1');
    expect(
      buildPromptSnippetSection({ store, workspaceId: 'ws1', now: 2_000 })
    ).toBeNull();
  });

  it('开关打开 + 命中的作用域 ⇒ 动态段（cacheBreak=true）含包裹标记', () => {
    process.env[PROMPT_SNIPPET_ENABLE_ENV] = '1';
    const store = storeWithActive('ws1');
    const section = buildPromptSnippetSection({
      store,
      workspaceId: 'ws1',
      now: 2_000,
    });
    expect(section?.name).toBe(PROMPT_SNIPPET_SECTION_NAME);
    expect(section?.cacheBreak).toBe(true);
    const text = section?.compute() as string;
    expect(text).toContain('PROMPT_SNIPPET:BEGIN');
    expect(text).toContain('回答前先确认是否已有同名工具。');
  });

  it('作用域不匹配 ⇒ null（不跨项目注入）', () => {
    process.env[PROMPT_SNIPPET_ENABLE_ENV] = '1';
    const store = storeWithActive('ws1');
    expect(
      buildPromptSnippetSection({ store, workspaceId: 'ws2', now: 2_000 })
    ).toBeNull();
  });

  it('无生效片段 ⇒ null（不注入空壳段）', () => {
    process.env[PROMPT_SNIPPET_ENABLE_ENV] = '1';
    dir = mkdtempSync(join(tmpdir(), 'snippet-section-'));
    const empty = new PromptSnippetStore(dir);
    expect(
      buildPromptSnippetSection({ store: empty, workspaceId: 'ws1' })
    ).toBeNull();
  });

  it('workspaceId 归一：反斜杠转正斜杠并小写', () => {
    expect(promptSnippetWorkspaceId('E:\\Work\\Proj')).toBe('e:/work/proj');
  });
});
