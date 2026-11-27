// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P2-3（2026-11-28，真机 `session_mwz477wj251057474e`）：PDCA 计划终态回写会话状态。
 *
 * 现象：该轮以 `circuit_breaker` 收尾 ⇒ 会话被置 `error`；随后 PDCA 播报「✅ 3/3 步完成」，
 * 但会话状态仍是 `error`（终态进度消息不带 `terminationReason` ⇒ 状态收敛函数无从迁移）。
 * 现口径：终态进度消息带 `terminationReason`（无失败 ⇒ `completed`、有失败 ⇒ `error`），
 * 中间进度不带（不改状态）。
 */
import { describe, expect, it } from 'bun:test';

import { planTerminalReason } from '../../src/chat/launchers/PdcaLauncher';
import { resolveSessionStateAfterMessage } from '../../src/chat/manager/messagePersistence';
import { DataSessionStatus } from '@modules/session/types/session.js';
import { MessageRole } from '@modules/session/types/message/enums';

describe('planTerminalReason · 计划终态 → 会话状态', () => {
  it('终态且无失败 ⇒ completed（可清掉历史 error 徽标）', () => {
    expect(planTerminalReason({ isDone: true, failed: 0 })).toBe('completed');
  });

  it('终态但有失败 ⇒ error（如实反映未达成）', () => {
    expect(planTerminalReason({ isDone: true, failed: 2 })).toBe('error');
  });

  it('中间进度 ⇒ undefined（不得改动会话状态）', () => {
    expect(planTerminalReason({ isDone: false, failed: 0 })).toBeUndefined();
  });

  it('该字段确实驱动会话状态收敛（completed ⇒ active，error ⇒ error）', () => {
    const msg = (reason: string) => ({
      role: MessageRole.ASSISTANT,
      metadata: { terminationReason: reason },
      finishReason: undefined,
    });
    expect(
      resolveSessionStateAfterMessage(msg('completed'), DataSessionStatus.ERROR)
    ).toBe(DataSessionStatus.ACTIVE);
    expect(
      resolveSessionStateAfterMessage(msg('error'), DataSessionStatus.ACTIVE)
    ).toBe(DataSessionStatus.ERROR);
  });
});
