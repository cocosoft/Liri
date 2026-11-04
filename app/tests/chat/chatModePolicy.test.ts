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
  isChatMode,
  resolveChatMode,
  resolveChatModePolicy,
  resolveRequestChatModeUpdate,
} from '../../src/chat/chatModePolicy';
import { resolveChatModeToolTurns } from '../../src/chat/loopTurnLimits';

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

describe('P1：轮次预算按 chatMode 放大', () => {
  it('deep / code ⇒ 基础轮次 ×2', () => {
    expect(resolveChatModeToolTurns(30, 'deep')).toBe(60);
    expect(resolveChatModeToolTurns(30, 'code')).toBe(60);
    expect(resolveChatModeToolTurns(30, 'CODE')).toBe(60);
  });

  it('auto / research / creative / 缺失 / 脏值 ⇒ 基础轮次不变', () => {
    for (const chatMode of [
      'auto',
      'research',
      'creative',
      undefined,
      null,
      '',
      'turbo',
      42,
    ]) {
      expect(resolveChatModeToolTurns(30, chatMode)).toBe(30);
    }
  });

  it('尊重调用方传入的基数（env 覆盖后的非默认值同样被放大）', () => {
    expect(resolveChatModeToolTurns(45, 'deep')).toBe(90);
    // 恢复路径的 Math.max 首项：基数放大后仍需与剩余工具数取大
    expect(Math.max(resolveChatModeToolTurns(30, 'code'), 12 + 40 + 5)).toBe(
      60
    );
  });
});

describe('P1：请求体 chat_mode 的边界与落库口径', () => {
  it('isChatMode：五个合法值（大小写/空白不敏感）通过，其余拒绝', () => {
    for (const mode of CHAT_MODES) {
      expect(isChatMode(mode)).toBe(true);
      expect(isChatMode(` ${mode.toUpperCase()} `)).toBe(true);
    }
    for (const bad of [undefined, null, '', '   ', 'turbo', 42, {}]) {
      expect(isChatMode(bad)).toBe(false);
    }
  });

  it('请求值合法且与会话不同 ⇒ 返回归一值（落库）', () => {
    expect(
      resolveRequestChatModeUpdate({
        requestChatMode: ' Deep ',
        sessionChatMode: 'auto',
      })
    ).toBe('deep');
    expect(
      resolveRequestChatModeUpdate({
        requestChatMode: 'code',
        sessionChatMode: undefined,
      })
    ).toBe('code');
  });

  it('请求值与会话一致 ⇒ undefined（不重复写库）', () => {
    expect(
      resolveRequestChatModeUpdate({
        requestChatMode: 'deep',
        sessionChatMode: 'deep',
      })
    ).toBeUndefined();
    // 存量脏值按 auto 归一后与 'auto' 相同 ⇒ 也不写库
    expect(
      resolveRequestChatModeUpdate({
        requestChatMode: 'auto',
        sessionChatMode: 'turbo',
      })
    ).toBeUndefined();
  });

  it('缺失 / 脏值 ⇒ undefined（老客户端不传，会话保留原档位）', () => {
    for (const bad of [undefined, null, '', 'turbo', 42]) {
      expect(
        resolveRequestChatModeUpdate({
          requestChatMode: bad,
          sessionChatMode: 'deep',
        })
      ).toBeUndefined();
    }
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
