// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P1（2026-11-04）：`chatMode` → 模型档位 / 工具集 的映射守卫。
 *
 * 背景：五个模式里此前只有 `research` 有后端行为，其余四个只改图标与文案。
 * 本用例锁定唯一映射表与工具集减法口径，防止调用方各写一张表。
 */

import { describe, it, expect } from 'bun:test';
import {
  CHAT_MODES,
  filterToolSchemasByChatMode,
  resolveChatMode,
  resolveChatModePolicy,
} from '../../src/chat/chatModePolicy';

describe('P1：chatMode 归一', () => {
  it('缺失 / 非字符串 / 空串 / 脏值 ⇒ auto（不放宽任何东西）', () => {
    expect(resolveChatMode(undefined)).toBe('auto');
    expect(resolveChatMode(null)).toBe('auto');
    expect(resolveChatMode('')).toBe('auto');
    expect(resolveChatMode('   ')).toBe('auto');
    expect(resolveChatMode('turbo')).toBe('auto');
    expect(resolveChatMode(42)).toBe('auto');
  });

  it('大小写不敏感，且五个合法值原样返回', () => {
    expect(resolveChatMode('Deep')).toBe('deep');
    expect(resolveChatMode(' CODE ')).toBe('code');
    for (const mode of CHAT_MODES) {
      expect(resolveChatMode(mode)).toBe(mode);
    }
  });
});

describe('P1：chatMode → 模型档位 / 工具集 / 轮次乘子', () => {
  it('auto / research ⇒ chat 档、全量工具、预算不放大', () => {
    for (const mode of ['auto', 'research'] as const) {
      const policy = resolveChatModePolicy(mode);
      expect(policy.routeKey).toBe('chat');
      expect(policy.toolset).toBe('all');
      expect(policy.turnMultiplier).toBe(1);
    }
  });

  it('deep / code ⇒ coding 档、全量工具、预算翻倍', () => {
    for (const mode of ['deep', 'code'] as const) {
      const policy = resolveChatModePolicy(mode);
      expect(policy.routeKey).toBe('coding');
      expect(policy.toolset).toBe('all');
      expect(policy.turnMultiplier).toBe(2);
    }
  });

  it('creative ⇒ chat 档 + 去掉执行类工具 + 预算不放大', () => {
    const policy = resolveChatModePolicy('creative');
    expect(policy.routeKey).toBe('chat');
    expect(policy.toolset).toBe('no-shell');
    expect(policy.turnMultiplier).toBe(1);
  });
});

describe('P1：工具集过滤只做减法', () => {
  const schemas = [
    { name: 'bash' },
    { name: 'powershell' },
    { name: 'code_run' },
    { name: 'file_write' },
    { name: 'file_read' },
  ];

  it('auto ⇒ 原样返回全部工具', () => {
    const visible = filterToolSchemasByChatMode(
      schemas,
      resolveChatModePolicy('auto')
    );
    expect(visible.map((s) => s.name)).toEqual(schemas.map((s) => s.name));
  });

  it('creative ⇒ 移除 bash / powershell / code_run，保留读写工具', () => {
    const visible = filterToolSchemasByChatMode(
      schemas,
      resolveChatModePolicy('creative')
    );
    expect(visible.map((s) => s.name)).toEqual(['file_write', 'file_read']);
  });

  it('不修改入参（纯函数）', () => {
    const input = [...schemas];
    filterToolSchemasByChatMode(input, resolveChatModePolicy('creative'));
    expect(input).toHaveLength(schemas.length);
  });
});
