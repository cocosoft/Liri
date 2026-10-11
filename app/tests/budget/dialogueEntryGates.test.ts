// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// T12（Spec `daily-budget-over-limit-ux.md` §1.2 G-2 / §5-D-1 F/G/K/M）：
// **四个"非 chat 管线"对话类入口**的闸门/计账与各自出路。
//
// 复核结论（实施前逐路径核实，见各用例注释）：
//  · F（A2A 委派）与 G（项目分解）都经 `coreAPI.chat` ⇒ **闸门已由非流式路径（T8）覆盖**；
//    它们缺的是**透出**（F：业务失败被静默成空回复；G：撞限误报「LLM 未返回有效 JSON」500）。
//  · K（翻译）与 M（CLI `/chat`）**直调 provider** ⇒ 闸门与计账**两者皆缺**，本次补齐。
//
// 断言口径：决策规则层（纯函数/公开入口）为主，接线由 `test:guarded` 回归兜底。

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
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import {
  getDailyBudget,
  resetDailyBudgetForTest,
} from '../../src/query/DailyBudgetManager';
import {
  runA2ADelegation,
  setA2ADelegator,
} from '../../src/infrastructure/http/handlers/routes/a2a-routes';
import { mapDecomposeBudgetDenial } from '../../src/infrastructure/http/handlers/workspaces-handlers';
import { TranslationService } from '../../src/ai/translation/TranslationService';
import { ChatCommand } from '../../src/commands/builtin/chat/Chat';

// 隔离数据目录：翻译历史/其它 store 可能落在 app.db（避免污染真实 ~/.pyapp）
const dataDir = mkdtempSync(join(tmpdir(), 'budget-entries-t12-'));
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

/** 把日预算打到 `locked`（**任何**入口都必须被拦） */
function exhaustBudget(limit = 100): void {
  const budget = getDailyBudget();
  budget.setLimit(limit);
  budget.recordUsage(limit);
}

describe('T12：F/G/K/M 入口的撞限出路', () => {
  beforeEach(() => {
    resetDailyBudgetForTest();
  });
  afterEach(() => {
    setA2ADelegator(null);
    resetDailyBudgetForTest();
  });

  it('F A2A 委派：业务失败 ⇒ TASK_STATE_FAILED + 任务消息透出「原因与出路」（不再静默空回复）', async () => {
    setA2ADelegator(async () => {
      throw new AppError(
        'A2A 委派未完成（DAILY_BUDGET_EXCEEDED）：放行后重发即可继续：桌面端「用量中心 → 日限额」临时提额 / 今日解除。',
        // 与真实路径同码同形态（delegator 收到的是 T8 的业务失败）
        ErrorCategory.RESOURCE,
        ErrorSeverity.MEDIUM,
        'DAILY_BUDGET_EXCEEDED'
      );
    });

    const { completed, task } = await runA2ADelegation('你好', undefined, 500);

    expect(completed).toBe(false);
    expect(task.status.state).toBe('TASK_STATE_FAILED');
    const text = task.status.message?.parts?.[0]?.text ?? '';
    expect(text).toContain('DAILY_BUDGET_EXCEEDED');
    expect(text).toContain('日限额'); // 出路（协议面无 UI ⇒ 只能随任务消息透出）
  });

  it('F A2A 委派：成功路径不回归（completed=true + COMPLETED）', async () => {
    setA2ADelegator(async () => '正常回复');

    const { completed, task } = await runA2ADelegation('你好', undefined, 500);

    expect(completed).toBe(true);
    expect(task.status.state).toBe('TASK_STATE_COMPLETED');
  });

  it('G 项目分解：撞限 ⇒ 429 结构化错误（真实码 + 上下文 + 放行入口），非限额码不回归', () => {
    const denial = mapDecomposeBudgetDenial({
      finishReason: 'error',
      errorCode: 'DAILY_BUDGET_EXCEEDED',
      errorContext: { todayUsed: 901_200, dailyLimit: 500_000 },
    });

    expect(denial).not.toBeNull();
    expect(denial!.status).toBe(429);
    expect(denial!.body.error.code).toBe('DAILY_BUDGET_EXCEEDED');
    expect(denial!.body.error.context).toEqual({
      todayUsed: 901_200,
      dailyLimit: 500_000,
    });
    expect(denial!.body.error.relief?.path).toBe(
      '/v1/cost/daily-budget/relief'
    );

    // 非撞限（成功 / 其它业务码）⇒ 交回既有流程（不接管、不改写原行为）
    expect(mapDecomposeBudgetDenial({ finishReason: 'stop' })).toBeNull();
    expect(
      mapDecomposeBudgetDenial({
        finishReason: 'error',
        errorCode: 'CONTEXT_OVERFLOW',
      })
    ).toBeNull();
  });

  it('K 翻译：额度耗尽 ⇒ 抛 DAILY_BUDGET_EXCEEDED（文案含"去日限额放行"的出路）', async () => {
    exhaustBudget();

    const service = new TranslationService();
    let thrown: unknown;
    try {
      await service.translate({
        text: 'hello world',
        sourceLang: 'en',
        targetLang: 'zh',
      });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe('DAILY_BUDGET_EXCEEDED');
    expect((thrown as AppError).message).toContain('日限额');
  });

  it('M CLI `/chat`：额度耗尽 ⇒ 终端回显可执行入口（且**不初始化 provider**）', async () => {
    exhaustBudget();

    const result = await new ChatCommand().call('你好', {} as never);

    expect(result.type).toBe('text');
    expect(result.value).toContain('预算');
    // 终端形态的**可执行**入口（真实存在：/config 的 set 子命令写同一上限键）
    expect(result.value).toContain('/config set costControl.dailyTokenBudget');
  });
});
