// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * PR4 — Dedup 消息处理态模型测试（2026-10-09）
 *
 * 覆盖 `.trae/specs/dedup-message-state.md` §5 验收：
 * A1 行为等价（RECEIVED/ADMITTED/REJECTED 各自阻断语义）；
 * A3 状态转移 + 再入判定。
 */
import { describe, it, expect } from 'bun:test';
import {
  claimMessage,
  finalizeMessage,
  rejectMessage,
  releaseProcessing,
  isMessageProcessed,
  getDedupStats,
  MESSAGE_PROCESSING_STATES,
} from '../../src/channels/dedup/index.js';

/** 唯一 id，避免共享模块级状态相互干扰 */
let seq = 0;
function uid(): string {
  seq++;
  return `dedup-test-${Date.now()}-${seq}`;
}

describe('PR4 Dedup 处理态模型', () => {
  it('状态枚举为唯一事实源（RECEIVED/ADMITTED/REJECTED）', () => {
    expect([...MESSAGE_PROCESSING_STATES]).toEqual([
      'RECEIVED',
      'ADMITTED',
      'REJECTED',
    ]);
  });

  it('claim → RECEIVED；再入 ⇒ inflight（处理中占用）', () => {
    const id = uid();
    expect(claimMessage(id)).toBe('claimed');
    expect(isMessageProcessed(id)).toBe(true);
    expect(claimMessage(id)).toBe('inflight'); // RECEIVED ⇒ 处理中
  });

  it('finalize → ADMITTED；再入 ⇒ duplicate', () => {
    const id = uid();
    expect(claimMessage(id)).toBe('claimed');
    expect(finalizeMessage(id, true)).toBe(true);
    expect(claimMessage(id)).toBe('duplicate'); // ADMITTED ⇒ 已出结局
  });

  it('reject → REJECTED；再入 ⇒ duplicate（阻断重传，防重复计费）', () => {
    const id = uid();
    expect(claimMessage(id)).toBe('claimed');
    rejectMessage(id);
    expect(isMessageProcessed(id)).toBe(true);
    expect(claimMessage(id)).toBe('duplicate'); // REJECTED 仍阻断
  });

  it('releaseProcessing → 删除记录 ⇒ 再入可重新 claimed（允许重试）', () => {
    const id = uid();
    expect(claimMessage(id)).toBe('claimed');
    releaseProcessing(id);
    expect(isMessageProcessed(id)).toBe(false);
    expect(claimMessage(id)).toBe('claimed');
  });

  it('超时语义等价链：release（通用异常）后 reject ⇒ 仍阻断', () => {
    const id = uid();
    expect(claimMessage(id)).toBe('claimed');
    // 模拟 messageRouter 超时路径：外层先 release，再 reject
    releaseProcessing(id);
    rejectMessage(id);
    expect(claimMessage(id)).toBe('duplicate');
  });

  it('空/空白 messageId ⇒ invalid', () => {
    expect(claimMessage('')).toBe('invalid');
    expect(claimMessage('   ')).toBe('invalid');
    expect(claimMessage(undefined)).toBe('invalid');
    expect(claimMessage(null)).toBe('invalid');
  });

  it('getDedupStats：inflight=RECEIVED，processed=ADMITTED+REJECTED', () => {
    const before = getDedupStats();
    const inflightId = uid();
    const admittedId = uid();
    const rejectedId = uid();
    claimMessage(inflightId);
    claimMessage(admittedId);
    finalizeMessage(admittedId, true);
    claimMessage(rejectedId);
    rejectMessage(rejectedId);

    const after = getDedupStats();
    expect(after.inflight - before.inflight).toBe(1);
    expect(after.processed - before.processed).toBe(2);
  });
});
