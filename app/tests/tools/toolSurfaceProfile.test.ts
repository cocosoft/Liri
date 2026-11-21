/**
 * 运行时工具面 profile（C2，2026-11-21；治理方案 v3 §14.1 / §14.6）
 *
 * 断言三档语义：
 * - `minimal`：恒定核心面（9 项，平台 shell 二选一），跳过任务裁剪与恒集；
 * - `standard`：与未配置 profile 时**逐字等价**（零行为变更）；
 * - `full`：只放开默认披露收窄，任务类别白名单仍生效。
 *
 * ⚠️ 不读真实 `settings.toolSurface`（那会依赖本机 config.json）：档位一律经入参注入；
 * `readToolSurfaceProfile` 的解析口径由 `normalizeToolSurfaceProfile` 直接覆盖。
 */
import { describe, expect, it } from 'bun:test';

import {
  DEFAULT_TOOL_SURFACE_PROFILE,
  getCoreToolNames,
  normalizeToolSurfaceProfile,
} from '../../src/tools/toolSurfaceProfile';
import {
  selectToolsForTurn,
  type ToolSelectionInput,
} from '../../src/chat/orchestrator/streamMessageToolSelection';
import type { ToolDefinition } from '@modules/ai';

const def = (name: string): ToolDefinition => ({
  type: 'function',
  function: { name, description: '', parameters: {} },
});

/** 覆盖三档差异所需的代表性工具面（顺序即断言口径） */
const ALL_TOOLS = [
  'bash',
  'powershell',
  'file_read',
  'file_write',
  'file_edit',
  'grep',
  'glob',
  'ask_user_question',
  'todo_write',
  'tool_search',
  'agent',
  'image_generate',
  'read_project_file',
  'web_fetch',
].map(def);

function selectNames(extra: Partial<ToolSelectionInput> = {}): string[] {
  return selectToolsForTurn({
    tools: ALL_TOOLS,
    explicitTaskType: 'chat',
    lastUserText: '',
    hasImages: false,
    ...extra,
  }).tools.map((t) => t.function.name);
}

describe('toolSurfaceProfile：解析与 L0 核心集', () => {
  it('非法 / 缺失 ⇒ standard（默认档，零行为变更）', () => {
    expect(DEFAULT_TOOL_SURFACE_PROFILE).toBe('standard');
    expect(normalizeToolSurfaceProfile(undefined)).toBe('standard');
    expect(normalizeToolSurfaceProfile({})).toBe('standard');
    expect(normalizeToolSurfaceProfile('bogus')).toBe('standard');
    expect(normalizeToolSurfaceProfile({ profile: 42 })).toBe('standard');
  });

  it('合法取值（字符串 / 对象两种形态）原样解析', () => {
    expect(normalizeToolSurfaceProfile('minimal')).toBe('minimal');
    expect(normalizeToolSurfaceProfile('full')).toBe('full');
    expect(normalizeToolSurfaceProfile({ profile: 'full' })).toBe('full');
  });

  it('L0 恰好 9 项，且平台 shell 二选一（含 tool_search）', () => {
    const unix = getCoreToolNames('linux');
    expect(unix).toHaveLength(9);
    expect(unix).toContain('bash');
    expect(unix).not.toContain('powershell');
    expect(unix).toContain('tool_search');
    expect(unix).toContain('todo_write');

    const win = getCoreToolNames('win32');
    expect(win).toHaveLength(9);
    expect(win).toContain('powershell');
    expect(win).not.toContain('bash');

    // 平台二选一后集合其余 8 项一致
    expect([...win].filter((n) => n !== 'powershell').sort()).toEqual(
      [...unix].filter((n) => n !== 'bash').sort()
    );
  });
});

describe('selectToolsForTurn：三档工具面', () => {
  it('minimal ⇒ 只保留核心（不含 agent / 媒体 / 默认披露之外的工具）', () => {
    const names = selectNames({ surface: 'minimal' });
    const core = new Set(getCoreToolNames());
    expect(names).toEqual(
      ALL_TOOLS.map((t) => t.function.name).filter((n) => core.has(n))
    );
    expect(names).not.toContain('agent');
    expect(names).not.toContain('image_generate');
    expect(names).not.toContain('read_project_file');
  });

  it('minimal 下 `tool_search` 已发现的工具可拉入（L2 可达性）', () => {
    const names = selectNames({
      surface: 'minimal',
      discoveredToolNames: ['image_generate'],
    });
    expect(names).toContain('image_generate');
  });

  it('minimal 下用户 `on` 覆写仍可拉入（显式意图优先）', () => {
    const names = selectNames({
      surface: 'minimal',
      overrides: { image_generate: 'on' },
    });
    expect(names).toContain('image_generate');
  });

  it('standard 与"未配置 profile"逐字等价', () => {
    expect(selectNames({ surface: 'standard' })).toEqual(selectNames());
  });

  it('full ⇒ 放开默认披露收窄，但任务类别白名单仍生效', () => {
    const standard = selectNames({ surface: 'standard' });
    const full = selectNames({ surface: 'full' });
    // 默认披露之外但类别允许（file_read）⇒ standard 裁掉、full 保留
    expect(standard).not.toContain('read_project_file');
    expect(full).toContain('read_project_file');
    // 类别不允许（image 不在 chat 白名单）⇒ full 也不含
    expect(full).not.toContain('image_generate');
  });

  it('重放（forcedVisibleTools）优先于 profile（快照可复现）', () => {
    const names = selectNames({
      surface: 'minimal',
      forcedVisibleTools: ['image_generate'],
    });
    expect(names).toEqual(['image_generate']);
  });
});
