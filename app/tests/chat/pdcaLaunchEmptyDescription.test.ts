// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P0（2026-11-24，真机 `session_mwq5ookl21aa28ea96`）：**升级描述不得为空**。
 *
 * 事故链：turn 5 是只读问答（34 轮 grep/file_read），却触发了长任务升级；
 * 工具轮把 assistant 消息以 `content=''` 落盘，`lastAssistantText` 不跳过空串 ⇒
 * 以 `description=''` 建项目 + 3 阶段链 ⇒ requirement 子任务烧 2.32M tokens 产出一份
 * 无人认领的 PRD，随后停在无卡的阶段审批门，重启即被孤儿收口。
 *
 * 本文件锁定三层闸门：取数（跳过空串）→ 升级入口（回退用户文本/放弃升级）→
 * launch 出口（空描述不建任务）。
 */
import { describe, expect, it } from 'bun:test';
import {
  PdcaLaunchCoordinator,
  type PdcaLaunchDeps,
} from '../../src/chat/manager/pdcaLaunch';
import type { PdcaLauncher } from '../../src/chat/launchers/PdcaLauncher';
import { lastAssistantTextInCurrentTurn } from '../../src/chat/manager/sessionAccessors';
import type { ChatSession } from '@modules/session/types/session.js';

const makeSession = (
  messages: Array<{ role: string; content: unknown }>,
  metadata: Record<string, unknown> = {}
): ChatSession =>
  ({ id: 'sess-empty-desc', metadata, messages }) as unknown as ChatSession;

function makeDeps(input: {
  launcher: PdcaLauncher | null;
  recentUserText?: string;
}): PdcaLaunchDeps {
  return {
    launchingSessions: new Set<string>(),
    getPdcaLauncher: () => input.launcher,
    shouldUsePlanDrivenLoop: () => true,
    shouldUseCodeMode: () => false,
    appendStreamEvent: async () => ({}),
    persistSessionMetadata: async () => {},
    recentUserText: () => input.recentUserText ?? '',
  };
}

/** 记录 launch 入参的 launcher 替身（只关心描述） */
function makeLauncher(calls: string[]): PdcaLauncher {
  return {
    launch: async (_projectId: string, description: string): Promise<void> => {
      calls.push(description);
    },
    launchResearch: async (
      _projectId: string,
      description: string
    ): Promise<void> => {
      calls.push(description);
    },
  } as unknown as PdcaLauncher;
}

describe('lastAssistantTextInCurrentTurn：只取本轮（最后一条 user 之后）', () => {
  it('本轮有非空正文 ⇒ 取本轮', () => {
    const session = makeSession([
      { role: 'user', content: '上一轮问题' },
      { role: 'assistant', content: '上一轮结论' },
      { role: 'user', content: '本轮问题' },
      { role: 'assistant', content: '本轮结论' },
    ]);
    expect(lastAssistantTextInCurrentTurn(session)).toBe('本轮结论');
  });

  it('本轮只有空/工具消息 ⇒ 空串（不跨轮取旧答案）', () => {
    const session = makeSession([
      { role: 'user', content: '上一轮问题' },
      { role: 'assistant', content: '上一轮结论' },
      { role: 'user', content: '你画一张鹈鹕骑自行车的图片' },
      { role: 'assistant', content: '' },
    ]);
    expect(lastAssistantTextInCurrentTurn(session)).toBe('');
  });

  it('全部为空 ⇒ 空串（由调用方回退用户文本）', () => {
    const session = makeSession([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: '   ' },
    ]);
    expect(lastAssistantTextInCurrentTurn(session)).toBe('');
  });
});

describe('onLongTaskSignal：空描述不得升级', () => {
  it('模型产出与用户文本都为空 ⇒ 放弃升级（不调用升级入口）', async () => {
    const coordinator = new PdcaLaunchCoordinator(
      makeDeps({ launcher: makeLauncher([]), recentUserText: '' })
    );
    const escalated: Array<{ assistantContent?: string }> = [];
    (
      coordinator as unknown as {
        escalateViaBareSession: (p: {
          assistantContent?: string;
        }) => Promise<void>;
      }
    ).escalateViaBareSession = async (p) => {
      escalated.push(p);
    };

    // 用户消息 ≥2（轮次闸通过），但 recentUserText 取不到正文 ⇒ 描述为空
    await coordinator.onLongTaskSignal(
      makeSession([
        { role: 'user', content: 'q1' },
        { role: 'user', content: 'q2' },
        { role: 'assistant', content: '' },
      ]),
      { pendingTodoCount: 0, consumedTurns: 34 }
    );

    expect(escalated).toHaveLength(0);
  });

  it('模型产出为空、用户文本可用 ⇒ 用用户文本作描述（不建空任务）', async () => {
    const coordinator = new PdcaLaunchCoordinator(
      makeDeps({
        launcher: makeLauncher([]),
        recentUserText: '帮我梳理前端面板清单',
      })
    );
    const escalated: Array<{ assistantContent?: string }> = [];
    (
      coordinator as unknown as {
        escalateViaBareSession: (p: {
          assistantContent?: string;
        }) => Promise<void>;
      }
    ).escalateViaBareSession = async (p) => {
      escalated.push(p);
    };

    await coordinator.onLongTaskSignal(
      makeSession([
        { role: 'user', content: 'q1' },
        { role: 'user', content: '帮我梳理前端面板清单' },
        { role: 'assistant', content: '' },
      ]),
      { pendingTodoCount: 0, consumedTurns: 34 }
    );

    expect(escalated).toHaveLength(1);
    expect(escalated[0]?.assistantContent).toBe('帮我梳理前端面板清单');
  });

  /**
   * P2-1（2026-11-28，真机 `session_mwz477wj251057474e`）：上一轮的助手正文**不得**被当成
   * "已确认的执行计划"并入本轮目标（该轮把上一轮图片解读 945 字塞进了「画一张 SVG」）。
   */
  it('本轮无正文、上一轮有旧答案 ⇒ 只用本轮用户原话作描述', async () => {
    const coordinator = new PdcaLaunchCoordinator(
      makeDeps({
        launcher: makeLauncher([]),
        recentUserText: '你画一张鹈鹕骑自行车的图片。SVG的吧。',
      })
    );
    const escalated: Array<{ assistantContent?: string }> = [];
    (
      coordinator as unknown as {
        escalateViaBareSession: (p: {
          assistantContent?: string;
        }) => Promise<void>;
      }
    ).escalateViaBareSession = async (p) => {
      escalated.push(p);
    };

    await coordinator.onLongTaskSignal(
      makeSession([
        { role: 'user', content: '这两幅图呢？' },
        {
          role: 'assistant',
          content: '两张都是广州：图一是珠江夜景…（945 字旧答案）',
        },
        { role: 'user', content: '你画一张鹈鹕骑自行车的图片。SVG的吧。' },
        { role: 'assistant', content: '' },
      ]),
      { pendingTodoCount: 0, consumedTurns: 34 }
    );

    expect(escalated).toHaveLength(1);
    expect(escalated[0]?.assistantContent).toBe(
      '你画一张鹈鹕骑自行车的图片。SVG的吧。'
    );
  });
});

describe('escalateViaBareSession：空描述不得建项目', () => {
  it('两路描述都为空 ⇒ 不建项目、不 launch', async () => {
    const launchCalls: string[] = [];
    const coordinator = new PdcaLaunchCoordinator(
      makeDeps({ launcher: makeLauncher(launchCalls) })
    );
    const created: unknown[] = [];
    (
      coordinator as unknown as {
        autoCreateProject: (...args: unknown[]) => Promise<string>;
        maybeLaunch: (...args: unknown[]) => void;
      }
    ).autoCreateProject = async (...args) => {
      created.push(args);
      return 'proj_should_not_exist';
    };
    (
      coordinator as unknown as { maybeLaunch: (...args: unknown[]) => void }
    ).maybeLaunch = (...args) => {
      launchCalls.push(String(args[1]));
    };

    await coordinator.escalateViaBareSession({
      session: makeSession([{ role: 'user', content: 'q' }]),
      assistantContent: '',
      lastUserContent: '',
    });

    expect(created).toHaveLength(0);
    expect(launchCalls).toHaveLength(0);
  });

  it('助手正文为空 ⇒ 用用户文本建项目并 launch（描述非空）', async () => {
    const launchCalls: string[] = [];
    const coordinator = new PdcaLaunchCoordinator(
      makeDeps({ launcher: makeLauncher(launchCalls) })
    );
    let goalSummary = '';
    (
      coordinator as unknown as {
        autoCreateProject: (
          session: ChatSession,
          workspaceId: unknown,
          result: { goalSummary?: string }
        ) => Promise<string>;
        maybeLaunch: (
          session: ChatSession,
          description: string,
          projectId: string,
          lastUserContent: string
        ) => void;
      }
    ).autoCreateProject = async (_session, _ws, result) => {
      goalSummary = result.goalSummary ?? '';
      return 'proj_ok';
    };
    (
      coordinator as unknown as {
        maybeLaunch: (
          session: ChatSession,
          description: string,
          projectId: string,
          lastUserContent: string
        ) => void;
      }
    ).maybeLaunch = (_session, description) => {
      launchCalls.push(description);
    };

    await coordinator.escalateViaBareSession({
      session: makeSession([{ role: 'user', content: '做一个记账小工具' }]),
      assistantContent: '',
      lastUserContent: '做一个记账小工具',
    });

    expect(goalSummary).toContain('做一个记账小工具');
    expect(launchCalls).toEqual(['做一个记账小工具']);
  });
});

describe('maybeLaunch：launch 出口的空描述闸门', () => {
  it('助手正文与用户文本都为空 ⇒ 不调用 launcher.launch', () => {
    const calls: string[] = [];
    const coordinator = new PdcaLaunchCoordinator(
      makeDeps({ launcher: makeLauncher(calls) })
    );

    coordinator.maybeLaunch(
      makeSession([{ role: 'user', content: '' }]),
      '',
      'proj_1',
      undefined
    );

    expect(calls).toHaveLength(0);
  });

  it('助手正文为空但用户文本可用 ⇒ 以用户文本作为描述', async () => {
    const calls: string[] = [];
    const coordinator = new PdcaLaunchCoordinator(
      makeDeps({ launcher: makeLauncher(calls) })
    );

    coordinator.maybeLaunch(
      makeSession([{ role: 'user', content: '梳理面板' }]),
      '',
      'proj_1',
      '梳理面板'
    );
    // launch 为异步、且前置有 trace 旁路 ⇒ 让事件循环转一圈
    await new Promise((r) => setTimeout(r, 0));

    expect(calls).toEqual(['梳理面板']);
  });
});
