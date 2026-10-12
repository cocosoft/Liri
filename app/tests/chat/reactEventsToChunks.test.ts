/**
 * A1 T5：挂起结算的实时下发映射单测。
 *
 * 断言 `suspension_settled` ReActEvent → `status` chunk，且 `statusType` 取共享契约值
 * （⇒ 不在瞬态集合内 ⇒ 前端按既有 status block 渲染，零新 UI）。
 */
import { describe, it, expect } from 'bun:test';
import { reactEventsToChunks } from '../../src/chat/reactEventsToChunks.js';
import { STATUS_TYPE, isTransientStatusType } from '@shared/types';
// 状态机方案 阶段 2.2（2026-10-12）：chunk 层工具调用状态**单源** = `execution/types.ts`
import {
  TOOL_CALL_INITIAL_STATUS,
  TOOL_CALL_COMPLETED_STATUS,
  TOOL_CALL_FAILED_STATUS,
} from '@modules/execution';

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

/**
 * 状态机方案 阶段 2.2：工具调用状态**单一事实源**（G14 残留消除）的行为锁。
 *
 * 两道锁：① 取值**未变**（`running`/`completed`/`failed` ⇒ 线上/前端契约零行为变更）；
 * ② 取值**来自共享常量** ⇒ 上游改词表时本层编译期即暴露（不再"各写一份字面量"）。
 */
describe('reactEventsToChunks：工具调用状态单源（阶段 2.2）', () => {
  it('常量取值与既有 wire 词表一致（零行为变更）', () => {
    expect(TOOL_CALL_INITIAL_STATUS).toBe('running');
    expect(TOOL_CALL_COMPLETED_STATUS).toBe('completed');
    expect(TOOL_CALL_FAILED_STATUS).toBe('failed');
  });

  it('tool_start ⇒ toolCall.status = 共享「初始态」常量', () => {
    const chunks = reactEventsToChunks(
      {
        type: 'tool_start',
        callId: 'c1',
        name: 'read_file',
        input: { path: 'a.ts' },
        messageId: 'm1',
      },
      's1'
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].toolCall?.status).toBe(TOOL_CALL_INITIAL_STATUS);
  });

  it('tool_end(success) ⇒ toolCall.status = 共享「完成态」常量', () => {
    const chunks = reactEventsToChunks(
      {
        type: 'tool_end',
        callId: 'c1',
        result: {
          toolCallId: 'c1',
          name: 'read_file',
          status: 'success',
          output: 'ok',
        },
      },
      's1'
    );
    const toolCallChunk = chunks.find((c) => c.type === 'tool_call');
    expect(toolCallChunk?.toolCall?.status).toBe(TOOL_CALL_COMPLETED_STATUS);
    expect(toolCallChunk?.toolCall?.error).toBeUndefined();
  });

  it('tool_end(error) ⇒ toolCall.status = 共享「失败态」常量（并带 error）', () => {
    const chunks = reactEventsToChunks(
      {
        type: 'tool_end',
        callId: 'c1',
        result: {
          toolCallId: 'c1',
          name: 'read_file',
          status: 'error',
          error: 'boom',
        },
      },
      's1'
    );
    const toolCallChunk = chunks.find((c) => c.type === 'tool_call');
    expect(toolCallChunk?.toolCall?.status).toBe(TOOL_CALL_FAILED_STATUS);
    expect(toolCallChunk?.toolCall?.error).toBe('boom');
  });
});
