/**
 * P2-B（2026-11-17）：本地桌面会话缺省 `auto-local` 的映射回归。
 *
 * 背景：长程任务的打断源之一是"工作区内的正常写也要问"。口径（灰度收敛）：
 * - 本地桌面会话（`session.type==='local'` 或 `metadata.sessionType==='local'`）**缺省 auto-local**；
 * - 渠道 / 无人值守会话保持 `ask`；
 * - 显式 `metadata.approvalMode` 永远优先（含显式 `ask`）；
 * - 总闸 `FEATURE_SESSION_AUTO_LOCAL=false` ⇒ 全部回到 `ask`。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { getSessionApprovalMode } from '../../src/chat/manager/sessionAccessors';

const FLAG = 'FEATURE_SESSION_AUTO_LOCAL';

type FakeSession = {
  id: string;
  type?: string;
  metadata?: Record<string, unknown>;
};

function lookup(session: FakeSession) {
  return {
    get: (id: string) => (id === session.id ? (session as never) : undefined),
  };
}

let prev: string | undefined;
beforeEach(() => {
  prev = process.env[FLAG];
  delete process.env[FLAG];
});
afterEach(() => {
  if (prev === undefined) delete process.env[FLAG];
  else process.env[FLAG] = prev;
});

describe('getSessionApprovalMode 缺省口径（P2-B）', () => {
  it('本地会话（type=local）缺省 ⇒ auto-local', () => {
    expect(
      getSessionApprovalMode(
        lookup({ id: 's1', type: 'local', metadata: { sessionType: 'local' } }),
        's1'
      )
    ).toBe('auto-local');
  });

  it('本地会话（仅 metadata.sessionType=local）⇒ auto-local', () => {
    expect(
      getSessionApprovalMode(
        lookup({ id: 's2', metadata: { sessionType: 'local' } }),
        's2'
      )
    ).toBe('auto-local');
  });

  it('渠道会话缺省 ⇒ ask（不因本机默认放宽）', () => {
    expect(
      getSessionApprovalMode(
        lookup({ id: 's3', metadata: { sessionType: 'channel' } }),
        's3'
      )
    ).toBe('ask');
  });

  it('显式 approvalMode 优先（ask / auto-local 都尊重）', () => {
    expect(
      getSessionApprovalMode(
        lookup({ id: 's4', type: 'local', metadata: { approvalMode: 'ask' } }),
        's4'
      )
    ).toBe('ask');
    expect(
      getSessionApprovalMode(
        lookup({
          id: 's5',
          metadata: { sessionType: 'channel', approvalMode: 'auto-local' },
        }),
        's5'
      )
    ).toBe('auto-local');
  });

  it('总闸关闭 ⇒ 本地会话也回到 ask', () => {
    process.env[FLAG] = 'false';
    expect(
      getSessionApprovalMode(
        lookup({ id: 's6', type: 'local', metadata: { sessionType: 'local' } }),
        's6'
      )
    ).toBe('ask');
  });

  it('缺省 sessionId ⇒ ask', () => {
    expect(getSessionApprovalMode(lookup({ id: 's7' }), undefined)).toBe('ask');
  });
});
