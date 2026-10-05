/**
 * A1 T5：挂起结算的实时下发映射单测。
 *
 * 断言 `suspension_settled` ReActEvent → `status` chunk，且 `statusType` 取共享契约值
 * （⇒ 不在瞬态集合内 ⇒ 前端按既有 status block 渲染，零新 UI）。
 */
import { describe, it, expect } from 'bun:test';
import { reactEventsToChunks } from '../../src/chat/reactEventsToChunks.js';
import { STATUS_TYPE, isTransientStatusType } from '@shared/types';

describe('reactEventsToChunks：suspension_settled（A1 T5）', () => {
  it('映射为 status chunk，statusType=suspension_settled', () => {
    const chunks = reactEventsToChunks(
      { type: 'suspension_settled', content: '本次提问等待已超时，已结算。' },
      's1'
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('status');
    expect(chunks[0].content).toBe('本次提问等待已超时，已结算。');
    expect(chunks[0].statusType).toBe(STATUS_TYPE.SUSPENSION_SETTLED);
  });

  it('statusType 不在瞬态集合内 ⇒ 前端可见（fail-visible，不静默）', () => {
    expect(isTransientStatusType(STATUS_TYPE.SUSPENSION_SETTLED)).toBe(false);
  });
});
