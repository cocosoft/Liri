// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// T13（Spec `daily-budget-over-limit-ux.md` §4 **D-j** / §5-D-2）：
// **无人看后台不并入日预算** —— 负向夹具守卫（防"将来有人把后台误接进日预算"）。
//
// 背景：后台入口（H 做梦 / I 会话摘要 / J 自动标题 / N 记忆·进化）**没有人当场可见**，
// 若并入日预算就会**替用户吃掉额度**、让用户更早被拦（Spec §2 反目标）⇒ 一律"单独核算"。
//
// 断言口径（两层）：
//  ① **行为负向夹具**（J / I）：真触发一次后台流程（并确认模型**确实被调用**，避免空转假绿），
//     断言 `getDailyBudget().getMode().todayUsed` **不增长**；
//  ② **边界守卫**：后台模块源码**不得**出现日预算写入调用（H/N 等无进程内接缝的入口靠这一层兜住）。
//
// 登记（CD05"先摘入口再删实现"，本次**不动**）：**O `BtwHandler`**（`agent/BtwHandler.ts`）
// 全仓无 import（疑未接线）⇒ 只登记于此，不接线、不改实现。

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatManager } from '@modules/chat';
import {
  getDailyBudget,
  resetDailyBudgetForTest,
} from '../../src/query/DailyBudgetManager';
import { SessionTitling } from '../../src/runtime/api/sessionTitling';
import { SessionSummarizer } from '../../src/chat/services/SessionSummarizer';

// 会话摘要会落 `projects/<id>/summaries.json` ⇒ 隔离数据目录（避免污染真实 ~/.pyapp）
const dataDir = mkdtempSync(join(tmpdir(), 'budget-sidechannel-t13-'));
process.env.LIRI_DATA_DIR = dataDir;

afterAll(() => {
  delete process.env.LIRI_DATA_DIR;
  try {
    rmSync(dataDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  } catch {
    /* 临时目录清理失败不影响测试结论 */
  }
});

/** 极简假 provider（后台路径直调它 ⇒ 只回文本，不产生任何日预算写入） */
function makeFakeLlmClient(onCall?: () => void): {
  client: unknown;
  calls: () => number;
} {
  let calls = 0;
  const client = {
    providerId: 'fake-bg-provider',
    sendMessage: async () => {
      calls += 1;
      onCall?.();
      return {
        content: '后台标题',
        usage: { prompt_tokens: 30, completion_tokens: 20 },
      };
    },
    chat: async () => {
      calls += 1;
      onCall?.();
      return {
        content: '这是后台摘要',
        usage: { prompt_tokens: 30, completion_tokens: 20 },
      };
    },
  };
  return { client, calls: () => calls };
}

/** ChatManager 桩：显式提供被用到的成员，其余一律返回 no-op 函数（未枚举面不影响断言语义） */
function makeFakeChatManager(overrides: Record<string, unknown>): ChatManager {
  return new Proxy(overrides, {
    get: (target, key) =>
      key in target
        ? (target as Record<string, unknown>)[key as string]
        : () => undefined,
  }) as unknown as ChatManager;
}

/** 等后台 fire-and-forget 链跑完（`setImmediate` + awaits） */
async function settleBackground(assertCalled: () => number): Promise<void> {
  for (let i = 0; i < 50 && assertCalled() === 0; i += 1) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('T13：后台不并入日预算（D-j 负向夹具）', () => {
  beforeEach(() => {
    resetDailyBudgetForTest();
  });
  afterEach(() => {
    resetDailyBudgetForTest();
  });

  it('J 自动标题：后台触发后日预算 used **不增长**', async () => {
    const { client, calls } = makeFakeLlmClient();
    const session = {
      id: 'sess-j',
      title: '新对话',
      metadata: {},
      messages: [
        { role: 'user', content: '把日志按日期分组统计' },
        { role: 'assistant', content: '好的，我来分析日志结构' },
      ],
    };
    const titling = new SessionTitling({
      getChatManager: () =>
        makeFakeChatManager({
          getSessions: () => [session],
          getLLMClient: () => client,
        }),
    });

    const before = getDailyBudget().getMode().todayUsed;
    titling.autoGenerateTitle('sess-j', '把日志按日期分组统计', '好的');
    await settleBackground(calls);

    expect(calls()).toBeGreaterThan(0); // 非空转：后台**确实**调了模型
    expect(getDailyBudget().getMode().todayUsed).toBe(before);
  });

  it('I 会话摘要：后台触发后日预算 used **不增长**', async () => {
    const { client, calls } = makeFakeLlmClient();
    const summarizer = new SessionSummarizer(
      client as unknown as ConstructorParameters<typeof SessionSummarizer>[0]
    );
    const session = {
      id: 'sess-i',
      metadata: { projectId: 'proj-t13' },
      messages: [
        { role: 'user', content: '需求 A' },
        { role: 'assistant', content: '回复 A' },
        { role: 'user', content: '需求 B' },
      ],
    };

    const before = getDailyBudget().getMode().todayUsed;
    await summarizer.summarize(
      session as never,
      { id: 'm1', role: 'assistant', content: '回复 B' } as never
    );

    expect(calls()).toBeGreaterThan(0); // 非空转：摘要**确实**调了模型
    expect(getDailyBudget().getMode().todayUsed).toBe(before);
  });

  it('边界守卫：后台模块源码不得出现日预算写入（H/I/J/N/O）', () => {
    // 无人看后台 = 不并入日预算（D-j）。若将来有人在此写入，本用例立即变红。
    const backgroundFiles = [
      'chronos/autoDream/AutoDream.ts', // H 做梦
      'chat/services/SessionSummarizer.ts', // I 会话摘要
      'runtime/api/sessionTitling.ts', // J 自动标题
      'tasks/evolution/AdaptationEvolutionService.ts', // N 记忆/进化
      'agent/BtwHandler.ts', // O 只登记（疑未接线，CD05）
    ] as const;

    for (const rel of backgroundFiles) {
      const code = readFileSync(
        join(import.meta.dir, '..', '..', 'src', rel),
        'utf-8'
      );
      expect(code).not.toMatch(/recordDailyBudgetFromUsage\s*\(/);
      expect(code).not.toMatch(/getDailyBudget\(\)/);
      expect(code).not.toMatch(/\.recordChatResponseUsage\s*\(/);
    }
  });
});
