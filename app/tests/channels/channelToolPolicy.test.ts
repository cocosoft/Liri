/**
 * G-2（2026-10-18）通道级工具面最小权限（PoLP）守卫。
 *
 * 三件事：① 目录内每个通道都映射到 `messaging`；② 无来源 / 未知通道保持 `full`（零变更）；
 * ③ `messaging` 任务面确实裁掉执行 / 写盘类工具，且复用同一条 `filterToolsByTask` 过滤链。
 */
import { describe, it, expect } from 'bun:test';

import { CHANNEL_CATALOG } from '../../src/channels/ChannelCatalog.js';
import {
  CHANNEL_MESSAGING_TASK_TYPE,
  resolveChannelTaskTypeOverride,
  resolveChannelToolPolicy,
} from '../../src/channels/toolPolicy.js';
import {
  filterToolsByTask,
  getRealToolNamesForTask,
} from '../../src/tools/toolCategories.js';

describe('G-2 通道级工具面最小权限', () => {
  it('目录内每个通道缺省都是 messaging（不漏任何一个已注册通道）', () => {
    expect(CHANNEL_CATALOG.length).toBeGreaterThan(0);
    for (const entry of CHANNEL_CATALOG) {
      expect(resolveChannelToolPolicy(entry.type)).toBe('messaging');
    }
  });

  it('无通道来源 / 未知通道 ⇒ full（本地 REPL 与既有会话零变更）', () => {
    expect(resolveChannelToolPolicy(undefined)).toBe('full');
    expect(resolveChannelToolPolicy('repl')).toBe('full');
  });

  it('开关关 ⇒ 不注入 taskType；开 ⇒ 远程通道注入 messaging', () => {
    expect(resolveChannelTaskTypeOverride('telegram', false)).toBeUndefined();
    expect(resolveChannelTaskTypeOverride('telegram', true)).toBe(
      CHANNEL_MESSAGING_TASK_TYPE
    );
    expect(resolveChannelTaskTypeOverride('repl', true)).toBeUndefined();
    // 默认取 `CHANNEL_TOOL_POLICY`（当前默认 false ⇒ 零行为变更）
    expect(resolveChannelTaskTypeOverride('telegram')).toBeUndefined();
  });

  it('messaging 工具面：无执行 / 写盘，保留只读与交互', () => {
    const names = getRealToolNamesForTask(CHANNEL_MESSAGING_TASK_TYPE);
    for (const banned of [
      'bash',
      'powershell',
      'code_run',
      'file_write',
      'file_edit',
    ]) {
      expect(names).not.toContain(banned);
    }
    expect(names).toContain('file_read');
    expect(names).toContain('web_search');
    // mandatory 恒保留（协作基础能力，不受任务面影响）
    expect(names).toContain('agent');
  });

  it('filterToolsByTask 同口径：远程面裁掉执行类，本地 default 保留', () => {
    const tools = [
      { name: 'bash' },
      { name: 'file_write' },
      { name: 'file_read' },
    ];
    expect(
      filterToolsByTask(tools, CHANNEL_MESSAGING_TASK_TYPE).map((t) => t.name)
    ).toEqual(['file_read']);
    expect(filterToolsByTask(tools, undefined).map((t) => t.name)).toContain(
      'bash'
    );
  });
});
