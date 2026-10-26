// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * LRO-11（2026-10-26）：长任务路由的**两处修正**守卫。
 *
 * 真机实证（`session_mvoqs1ho875ea6b95e`）：长任务信号已触发升级（未完成 todo=10），
 * 但首条消息只有 39 字 ⇒ 被"消息长度 ≤60"判为 simple ⇒ **跳过分解、单步直执行**
 * （`decomposed=false, stepCount=1`），931 次工具调用仍留在普通对话循环；且用户**看不到**
 * "当前是普通循环 / 编排只跑了单步"。
 *
 * 本文件锁定：
 *  1. `decideSimplePath`：长任务信号（`forceDecompose`）**压过**长度门；
 *  2. `formatPdcaModeHint`：三种执行模式（simple/decomposed/direct）都有可见文案；
 *  3. `PdcaLaunchCoordinator.onLongTaskSignal`：项目会话跳过升级时**告知用户**（每会话一次），
 *     裸会话升级时**透传 forceDecompose=true**。
 */
import { describe, it, expect } from 'bun:test';
import { decideSimplePath } from '../../src/tasks/PlanDrivenLoop.js';
import { buildFastPathPolicy } from '@modules/types/fastPath';
import { formatPdcaModeHint } from '../../src/chat/launchers/PdcaLauncher.js';
import { PdcaLaunchCoordinator } from '../../src/chat/manager/pdcaLaunch.js';
import type { ChatSession } from '../../src/session/types/session.js';

const POLICY = buildFastPathPolicy(null).policy;

describe('LRO-11：长任务信号压过消息长度门', () => {
  it('短消息（≤60 字）默认判简单 ⇒ 走单步快速路径', () => {
    const message =
      '测试一下长程任务，请你自己完成超级玛丽的1和2两关的程序，完成后向我报告即可。';
    expect(message.length).toBeLessThanOrEqual(60);
    expect(decideSimplePath({ message, policy: POLICY })).toBe(true);
  });

  it('同一短消息 + 长任务信号（forceDecompose）⇒ 不再走快速路径（强制分解）', () => {
    const message =
      '测试一下长程任务，请你自己完成超级玛丽的1和2两关的程序，完成后向我报告即可。';
    expect(
      decideSimplePath({ message, policy: POLICY, forceDecompose: true })
    ).toBe(false);
  });

  it('长消息无论信号与否都不走快速路径', () => {
    const message = 'x'.repeat(61);
    expect(decideSimplePath({ message, policy: POLICY })).toBe(false);
    expect(
      decideSimplePath({ message, policy: POLICY, forceDecompose: true })
    ).toBe(false);
  });
});

describe('LRO-11：执行模式可见文案', () => {
  it('simple ⇒ 明确"单步快速路径（未分步）"+ /goal start 入口', () => {
    const text = formatPdcaModeHint('simple');
    expect(text).toContain('单步快速路径');
    expect(text).toContain('未分步');
    expect(text).toContain('/goal start');
  });

  it('decomposed / direct ⇒ 分别说明"分步"与"降级单步"', () => {
    expect(formatPdcaModeHint('decomposed')).toContain('分步执行');
    expect(formatPdcaModeHint('direct')).toContain('降级为单步');
  });
});

/** 协调器桩依赖（不触真实项目/文件） */
function makeCoordinator(hints: string[]) {
  const coordinator = new PdcaLaunchCoordinator({
    launchingSessions: new Set<string>(),
    getPdcaLauncher: () => null,
    shouldUsePlanDrivenLoop: () => true,
    shouldUseCodeMode: () => false,
    getOrCreateTAORLoop: () =>
      ({ applyVerifierConfig: () => {} }) as unknown as never,
    getStreamTailSeq: async () => 1,
    appendStreamEvent: async () => undefined,
    persistSessionMetadata: async () => {},
    recentUserText: () => '帮我做个超级玛丽两关',
    lastAssistantText: () => '好的，我来做',
    notifyUser: (_sid, text) => {
      hints.push(text);
    },
  });
  return coordinator;
}

function makeSession(metadata: Record<string, unknown>): ChatSession {
  return {
    id: 'sess-lro11',
    metadata,
    messages: [
      { role: 'user', content: '帮我做个超级玛丽两关' },
      { role: 'user', content: '继续' },
    ],
  } as unknown as ChatSession;
}

describe('LRO-11：长任务信号跳过升级时的可见告知', () => {
  it('项目会话跳过升级 ⇒ 告知"仍在普通对话循环"，且每会话只提示一次', async () => {
    const hints: string[] = [];
    const coordinator = makeCoordinator(hints);
    const session = makeSession({ projectId: 'proj_1' });

    await coordinator.onLongTaskSignal(session, {
      pendingTodoCount: 10,
      consumedTurns: 7,
    });
    await coordinator.onLongTaskSignal(session, {
      pendingTodoCount: 10,
      consumedTurns: 8,
    });

    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('普通对话循环');
    expect(hints[0]).toContain('/goal start');
  });

  it('裸会话升级 ⇒ 透传 forceDecompose=true（不再被长度门降级为单步）', async () => {
    const hints: string[] = [];
    const coordinator = makeCoordinator(hints);
    const captured: Array<{ forceDecompose?: boolean }> = [];
    // 只验证"升级入参"——把真实建项目/启动链路替换为捕获
    (
      coordinator as unknown as {
        escalateViaBareSession: (p: {
          forceDecompose?: boolean;
        }) => Promise<void>;
      }
    ).escalateViaBareSession = async (p) => {
      captured.push(p);
    };

    await coordinator.onLongTaskSignal(makeSession({}), {
      pendingTodoCount: 10,
      consumedTurns: 7,
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.forceDecompose).toBe(true);
    // 裸会话走升级，不应出现"仍在普通循环"的提示
    expect(hints).toHaveLength(0);
  });
});
