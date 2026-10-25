// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// T25-07（2026-10-25 用户裁定）：**渠道来源 Taint（不可信输入）**
//
// 口径（两条判据，均**不按工具名硬编码**）：
//   ① 来源：通道入站（`messageRouter` 唯一入口）⇒ `isUntrustedChannelOrigin` 为 true；
//   ② 准入：`sideEffect !== 'none'` 的工具拒绝（external + local）；未声明效果（MCP/插件）fail-closed。
//
// 端到端链路（本轮不在此测，属既有聊天链）：Router 打 metadata.untrustedOrigin
//   → streamMessageToolLoop 给会话打 `origin='channel'` → ToolExecutionService 执行前拒绝。
import { describe, expect, it } from 'bun:test';
import { FEATURE_FLAGS } from '@openliri/kernel';
import { isUntrustedChannelOrigin } from '../../src/channels/toolPolicy';
import {
  isBlockedForUntrustedOrigin,
  resolveToolEffect,
} from '../../src/tools/toolEffects';

describe('T25-07：渠道来源判定', () => {
  it('通道标识非空 ⇒ 不可信来源；空 / 缺省 ⇒ 不标记（桌面零变更）', () => {
    expect(isUntrustedChannelOrigin('telegram')).toBe(true);
    expect(isUntrustedChannelOrigin('feishu')).toBe(true);
    expect(isUntrustedChannelOrigin('unknown')).toBe(true);
    expect(isUntrustedChannelOrigin('   ')).toBe(false);
    expect(isUntrustedChannelOrigin(undefined)).toBe(false);
  });
});

describe('T25-07：不可信来源下的工具准入（判据 = TOOL_EFFECTS）', () => {
  it('external 类（bash / browser）⇒ 拒绝', () => {
    expect(resolveToolEffect('bash')?.sideEffect).toBe('external');
    expect(resolveToolEffect('browser')?.sideEffect).toBe('external');
    expect(isBlockedForUntrustedOrigin('bash')).toBe(true);
    expect(isBlockedForUntrustedOrigin('browser')).toBe(true);
  });

  it('local 类（写文件）⇒ 拒绝（用户裁定 external + local）', () => {
    expect(resolveToolEffect('write_project_file')?.sideEffect).toBe('local');
    expect(isBlockedForUntrustedOrigin('write_project_file')).toBe(true);
  });

  it('none 类（只读）⇒ 放行', () => {
    expect(resolveToolEffect('read_project_file')?.sideEffect).toBe('none');
    expect(resolveToolEffect('grep')?.sideEffect).toBe('none');
    expect(isBlockedForUntrustedOrigin('read_project_file')).toBe(false);
    expect(isBlockedForUntrustedOrigin('grep')).toBe(false);
  });

  it('未声明效果（MCP / 插件工具）⇒ fail-closed 拒绝', () => {
    expect(resolveToolEffect('mcp__unknown__tool')).toBeUndefined();
    expect(isBlockedForUntrustedOrigin('mcp__unknown__tool')).toBe(true);
  });
});

describe('T25-07：开关默认值', () => {
  it('CHANNEL_UNTRUSTED_TAINT 默认开（安全基线）', () => {
    expect(FEATURE_FLAGS.CHANNEL_UNTRUSTED_TAINT).toBe(true);
  });
});
