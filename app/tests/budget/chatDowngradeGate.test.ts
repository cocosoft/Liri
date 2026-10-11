// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// G-2 补漏（2026-10-11，Spec `daily-budget-over-limit-ux.md` §1.2 G-2 / §5-D-1）：
// **ChatManager 降级路径**（`_sendMessageDowngradePath`）补日预算闸门。
//
// 背景：TAORLoop 失败后走本降级路径，它**直调** `activeClient.sendMessage`（不经
// `sendMessageFlow.invokeLlm` 的闸门）⇒ 撞限后仍能"换条路再烧一遍额度"（G-2 的绕过路径）。
//
// 断言口径：
//  ① 额度耗尽 ⇒ 抛 `DAILY_BUDGET_EXCEEDED`，且**不调用模型**（判定在最前 ⇒ 连工具副作用也不做）；
//  ② 额度充足 ⇒ 既有行为不回归（照调模型、照返回助手消息）。

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppError } from '@modules/error';
import { createChatManager } from '../../src/chat/ChatManager';
import {
  getDailyBudget,
  resetDailyBudgetForTest,
} from '../../src/query/DailyBudgetManager';

// 放行分支会落盘助手消息 ⇒ 隔离数据目录（避免污染真实 ~/.pyapp）
const dataDir = mkdtempSync(join(tmpdir(), 'budget-downgrade-'));
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

/** 只暴露本用例用到的私有入口 */
type ManagerWithPrivates = {
  _sendMessageDowngradePath: (
    session: unknown,
    toolCalls: unknown[],
    apiMessages: unknown[],
    client: unknown,
    options?: unknown
  ) => Promise<{ content?: unknown }>;
};

function makeClient(): { client: unknown; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    client: {
      sendMessage: async () => {
        calls += 1;
        return { content: '降级回复' };
      },
    },
  };
}

describe('G-2：ChatManager 降级路径的日预算闸门', () => {
  beforeEach(() => {
    resetDailyBudgetForTest();
  });
  afterEach(() => {
    resetDailyBudgetForTest();
  });

  it('额度耗尽 ⇒ 抛 DAILY_BUDGET_EXCEEDED 且**不调用模型**（判定早于工具执行）', async () => {
    const budget = getDailyBudget();
    budget.setLimit(100);
    budget.recordUsage(100);
    expect(budget.getMode().mode).toBe('locked');

    const manager = createChatManager() as unknown as ManagerWithPrivates;
    const { client, calls } = makeClient();

    let thrown: unknown;
    try {
      await manager._sendMessageDowngradePath(
        { id: 'sess-downgrade-locked', messages: [] },
        // 非空 toolCalls：若闸门放在工具执行之后，这里会先产生**工具副作用**
        [
          {
            id: 't1',
            name: 'file_write',
            arguments: { path: 'x', content: 'y' },
          },
        ],
        [{ role: 'user', content: 'hi' }],
        client
      );
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe('DAILY_BUDGET_EXCEEDED');
    expect((thrown as AppError).message).toContain('日限额'); // 出路随之透出
    expect(calls()).toBe(0);
  });

  it('额度充足 ⇒ 既有行为不回归（照调模型并返回助手消息）', async () => {
    const manager = createChatManager() as unknown as ManagerWithPrivates;
    const { client, calls } = makeClient();

    const msg = await manager._sendMessageDowngradePath(
      { id: 'sess-downgrade-ok', messages: [] },
      [], // 无工具调用 ⇒ 只检验"闸门放行后照常调模型"
      [{ role: 'user', content: 'hi' }],
      client
    );

    expect(calls()).toBe(1);
    expect(msg.content).toBe('降级回复');
  });
});
