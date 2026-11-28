// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * PDCA 分流决策轨迹的**三条链路互不阻塞**（2026-11-28）
 *
 * 台账「自动升级未写 pdca_workflow 快照（2 次复现，pdcaBlockCount=0）」：
 * 原实现把「实时事件 → 审计库（SQLite）→ 聊天卡片快照」串成一条 `.then` 链，末尾 `.catch`
 * 全静默 ⇒ 审计写失败即**整条链中止**，用户可见的卡片静默丢失（徽标/事件看起来正常）。
 * 原现场日志已轮转、无法逐条复验，本组按**读码可证的耦合**钉住修复后的语义：
 *  ① 事件/审计任一失败 ⇒ 卡片快照仍写入；
 *  ② 事件层拒绝（`{ok:false}`）⇒ 不抛、不影响另两条；
 *  ③ 三条都被调用时，卡片事件类型/决策值与改动前一致（`assistant/pdca_workflow`）。
 */
import { describe, expect, it } from 'bun:test';

import {
  PdcaLaunchCoordinator,
  type PdcaLaunchDeps,
} from '../../src/chat/manager/pdcaLaunch';
import type { PdcaLauncher } from '../../src/chat/launchers/PdcaLauncher';
import type { ChatSession } from '@modules/session/types/session.js';

interface TraceEvent {
  type: string;
  data?: Record<string, unknown>;
}

const makeSession = (id = 'sess-trace'): ChatSession =>
  ({ id, metadata: {}, messages: [] }) as unknown as ChatSession;

/** 只记录 launch 调用的替身（本组不关心启动参数） */
function makeLauncher(): PdcaLauncher {
  return {
    launch: async (): Promise<void> => {},
    launchResearch: async (): Promise<void> => {},
  } as unknown as PdcaLauncher;
}

function makeDeps(input: {
  events: TraceEvent[];
  emit?: PdcaLaunchDeps['emitDecisionEvent'];
  audit?: PdcaLaunchDeps['writeDecisionAudit'];
  append?: (sessionId: string, event: unknown) => Promise<unknown>;
}): PdcaLaunchDeps {
  return {
    launchingSessions: new Set<string>(),
    getPdcaLauncher: () => makeLauncher(),
    shouldUsePlanDrivenLoop: () => true,
    shouldUseCodeMode: () => false,
    appendStreamEvent:
      input.append ??
      (async (_sessionId, event) => {
        input.events.push(event as TraceEvent);
        return {};
      }),
    persistSessionMetadata: async () => {},
    recentUserText: () => '梳理面板清单',
    ...(input.emit ? { emitDecisionEvent: input.emit } : {}),
    ...(input.audit ? { writeDecisionAudit: input.audit } : {}),
  };
}

/** 让 fire-and-forget 的三条链路跑完 */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
}

describe('PDCA 决策轨迹：三条链路互不阻塞', () => {
  it('① 事件与审计都失败 ⇒ 卡片快照仍写入（此前会整链中止）', async () => {
    const events: TraceEvent[] = [];
    const coordinator = new PdcaLaunchCoordinator(
      makeDeps({
        events,
        emit: async () => {
          throw new Error('event-bus-down');
        },
        audit: async () => {
          throw new Error('sqlite-busy');
        },
      })
    );

    coordinator.maybeLaunch(
      makeSession(),
      '梳理面板清单',
      'proj_1',
      '梳理面板清单'
    );
    await settle();

    const snapshot = events.filter((e) => e.type === 'assistant/pdca_workflow');
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]!.data?.['decision']).toBe('pdl');
    expect(snapshot[0]!.data?.['status']).toBe('started');
    expect(snapshot[0]!.data?.['stage']).toBe('plan');
  });

  it('② 事件层拒绝写入（{ok:false}）⇒ 不抛，审计与卡片各自独立', async () => {
    const events: TraceEvent[] = [];
    const audits: unknown[] = [];
    let emitCalls = 0;
    const coordinator = new PdcaLaunchCoordinator(
      makeDeps({
        events,
        emit: async () => {
          emitCalls += 1;
        },
        audit: async (entry) => {
          audits.push(entry);
        },
        // 事件层拒绝：返回 ok:false（appendStreamEvent 不抛错）
        append: async () => ({
          ok: false,
          reason: 'invalid-event',
          tailSeq: 0,
        }),
      })
    );

    expect(() =>
      coordinator.maybeLaunch(
        makeSession('sess-trace-refused'),
        '梳理面板清单',
        'proj_2',
        '梳理面板清单'
      )
    ).not.toThrow();
    await settle();

    expect(emitCalls).toBe(2); // auto_launched + decision
    expect(audits).toHaveLength(1);
    expect((audits[0] as { eventType?: string }).eventType).toBe(
      'pdca_decision'
    );
  });

  it('③ 全部成功 ⇒ 审计与卡片都只写一次（不重复、不互相覆盖）', async () => {
    const events: TraceEvent[] = [];
    const audits: unknown[] = [];
    const coordinator = new PdcaLaunchCoordinator(
      makeDeps({
        events,
        emit: async () => {},
        audit: async (entry) => {
          audits.push(entry);
        },
      })
    );

    coordinator.maybeLaunch(
      makeSession('sess-trace-ok'),
      '梳理面板清单',
      'proj_3',
      '梳理面板清单'
    );
    await settle();

    expect(audits).toHaveLength(1);
    expect(
      events.filter((e) => e.type === 'assistant/pdca_workflow')
    ).toHaveLength(1);
  });
});
