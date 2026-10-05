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

import type { TodoBlockData } from '@modules/runtime/api/todo-types';
import type {
  TodoExpansionState,
  ToolTurnBudget as ToolTurnBudgetState,
} from '@modules/core';
import type { ToolLoopContext } from './ToolLoopRunner.js';
import {
  DYNAMIC_TURNS_PER_PENDING_TODO,
  EXTERNAL_FETCH_EXPANSION_TURNS,
  MAX_DYNAMIC_TOOL_TURNS_CAP,
} from './loopTurnLimits.js';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('chat:reactToolLoop');

/** 轮次预算/扩容所需的宿主循环状态（最小结构面，避免入参整型 `ReActToolLoopState`） */
export interface ToolTurnBudgetLoopState {
  pendingTodos: TodoBlockData[];
  toolTurnCount: number;
  hasExternalFetchActivity?: boolean;
}

/** `ToolTurnBudget` 的宿主依赖（全部 getter：宿主状态在 run 期内可变） */
export interface ToolTurnBudgetDeps {
  getLoopState: () => ToolTurnBudgetLoopState;
  getCtx: () => ToolLoopContext;
  getBaseMaxToolTurns: () => number;
}

/**
 * Todo 扩容 / 轮次预算 / 长任务信号（C8）。
 *
 * 2026-10-05 纯搬迁自 `chat/ReActToolLoop.ts`（文件规模债拆分 B1，见
 * `.trae/specs/file-size-debt-partition-plan.md` §19）——方法体、注释、日志文案逐字保留，
 * 仅将宿主状态改为经 `ToolTurnBudgetDeps` 的 getter 读取。
 */
export class ToolTurnBudget {
  /** 跨 run 预算的会话级任务键（无 goalId 的续跑：yield 恢复 / self-wake） */
  private static readonly DEFAULT_BUDGET_TASK_KEY = 'session-task';
  /**
   * 长任务信号之一：未完成 todo 任务数阈值（G3，2026-09-25，`.trae/specs/long-task-routing.md`）。
   * 与"已耗轮次 ≥ 一个基础档"取 **OR** —— 两者都是可观测状态量（CS02），非文案匹配。
   */
  private static readonly LONG_TASK_PENDING_TODO_THRESHOLD = 3;

  /**
   * 缺陷 C 修复（2026-09-25）+ 跨 run 持久化（2026-09-25，`.trae/specs/todo-expansion-persistence.md`）：
   * todo 扩容的**输入快照**（键 = planId ?? title，值 = 该计划**未完成任务数**）。
   *
   * 为什么需要独立快照：`pendingTodos` 的语义是"**待消费**队列"——`getPendingTodos()`
   * 取走即清空，而流式主路径的消费侧（`streamMessageFlow`，tool_end 后与循环 flush 两处）
   * 每轮都会取走它。扩容读的却是同一个数组 ⇒ 扩容执行时数组已被清空，todo 项恒为 0，
   * 即"有 todo 清单的长任务拿不到 todo 扩容"。本快照与消费侧生命周期解耦：
   * 消费侧清空 `pendingTodos` 不影响扩容读数（按计划覆盖为最新快照，天然去重）。
   *
   * 为什么只存**计数**：唯一消费方是 `_pendingTodoCount()`（动态扩容 + 长任务信号）
   * ⇒ 与持久载具 `TodoExpansionState` 同形，回填时无需重构整棵 `TodoBlockData`。
   *
   * 跨 run：续跑段由 `_initTodoExpansion()` 从 `session.metadata.todoExpansion` 回填
   * （判据与 `budgetBaseline` 同源）；用户消息 / 换任务则随 `resetRunState()` 清空。
   */
  private todoExpansionSnapshot = new Map<string, number>();
  /**
   * 跨 run 预算基线（**同一任务累计已消耗**的工具轮次，2026-09-25）。
   *
   * 背景：`toolTurnCount` 是实例内计数，而生产路径每条消息新建 loop 实例 ⇒ 任务被切成
   * 若干段（yield 恢复 / self-wake / goal 空闲续接）后每段重新从基础阈值起步。
   * 基线由 `_initToolTurnBudget()` 在 `run()` 起始从 `session.metadata.toolTurnBudget` 回填
   * （仅当本次 run 是**同任务续跑**），用于让续期公式以"任务累计消耗"为口径
   * ⇒ **续段不回退续期斜坡**（spec §3.5 最小变体：本段仍可再至硬顶，长任务可持续推进）。
   */
  private budgetBaseline = 0;
  /** 本段任务标识（`taskKey`）：`goalId ?? 'session-task'`（与持久值比对，防跨任务继承） */
  private budgetTaskKey = ToolTurnBudget.DEFAULT_BUDGET_TASK_KEY;
  /** 本段是否系统续跑（`options.metadata.systemResume === true`），供日志与基线判定 */
  private budgetIsContinuation = false;

  constructor(private readonly deps: ToolTurnBudgetDeps) {}

  /** todo 登记（消费队列 + 扩容快照双写；见 `todoExpansionSnapshot` 注释） */
  _recordPendingTodo(todoData: TodoBlockData): void {
    this.deps.getLoopState().pendingTodos.push(todoData);
    this.todoExpansionSnapshot.set(
      todoData.planId ?? todoData.title,
      ToolTurnBudget.countUnfinishedTodoTasks(todoData.tasks)
    );
    // 跨 run 持久化（spec §3.4-1）：快照变化即同步内存 metadata（零 IO）；
    // 落盘复用既有「每 5 轮检查点 + 轮次边界 persistSessionMetadata」
    this._publishTodoExpansion();
  }

  /** 「未完成」= `pending` / `in_progress`（口径与修复前逐字一致） */
  private static countUnfinishedTodoTasks(
    tasks: TodoBlockData['tasks']
  ): number {
    let count = 0;
    for (const task of tasks) {
      if (task.status === 'pending' || task.status === 'in_progress') count++;
    }
    return count;
  }

  /** 内存写：把快照投影为 `session.metadata.todoExpansion`（零 IO，metadata 缺失即跳过） */
  private _publishTodoExpansion(): void {
    const metadata = this._sessionMetadata();
    if (!metadata) return;
    metadata.todoExpansion = this._snapshotTodoExpansion();
  }

  /** 快照投影（内存 Map → 持久结构；与 `TodoExpansionState` 同形 ⇒ 回填零转换） */
  private _snapshotTodoExpansion(): TodoExpansionState {
    return {
      taskKey: this.budgetTaskKey,
      plans: Object.fromEntries(this.todoExpansionSnapshot),
      updatedAt: Date.now(),
    };
  }

  /**
   * todo 扩容量初始化（`.trae/specs/todo-expansion-persistence.md` §3.3）。
   *
   * 与 `budgetBaseline` **同判据**（`systemResume` + `taskKey`）：
   * - 续跑且同任务 ⇒ 回填持久 `plans`（未完成数）⇒ 续段仍拿得到 todo 扩容；
   * - 用户消息 / 任务不同 ⇒ 保持 `resetRunState()` 的清空结果，并把持久值归零
   *   （不把上一任务的未完成数带给新任务）。
   */
  private _initTodoExpansion(
    metadata: Record<string, unknown> | undefined
  ): void {
    const stored = metadata?.todoExpansion as TodoExpansionState | undefined;
    const inheritable =
      this.budgetIsContinuation && stored?.taskKey === this.budgetTaskKey;
    if (inheritable && stored) {
      for (const [planKey, count] of Object.entries(stored.plans ?? {})) {
        // 非法值不落地（与 `normalizeWeight` 同一取向：坏数据不得污染扩容）
        if (Number.isFinite(count) && count > 0) {
          this.todoExpansionSnapshot.set(planKey, Math.floor(count));
        }
      }
    }
    logger.info('reactToolLoop:todo_expansion_restored', {
      sessionId: this.deps.getCtx().session.id,
      taskKey: this.budgetTaskKey,
      systemResume: this.budgetIsContinuation,
      restored: inheritable,
      planCount: this.todoExpansionSnapshot.size,
      pendingTodoCount: this._pendingTodoCount(),
    });
    if (metadata) {
      metadata.todoExpansion = this._snapshotTodoExpansion();
    }
  }

  /** 会话 metadata（`ToolLoopContext.session` 即宿主实时 `ChatSession`；测试桩可能无 metadata） */
  private _sessionMetadata(): Record<string, unknown> | undefined {
    const session = this.deps.getCtx().session as unknown as {
      metadata?: Record<string, unknown>;
    };
    return session?.metadata;
  }

  /**
   * 跨 run 预算基线初始化（2026-09-25，见 `.trae/specs/tool-turn-budget-persistence.md`）。
   *
   * 规则：
   * - **系统续跑**（`options.metadata.systemResume === true`）且 `taskKey` 相同 ⇒ 继承 `consumed`；
   * - **用户消息**（无该标记）/ `taskKey` 不同 ⇒ 视为新任务：基线 0，并**清零**持久值（D5）。
   *
   * 判据是**布尔标记与标识符**，不是文案/字符串匹配（CS02）。
   */
  _initToolTurnBudget(): void {
    const metadata = this._sessionMetadata();
    const optsMeta = (this.deps.getCtx().options?.metadata ?? {}) as Record<
      string,
      unknown
    >;
    this.budgetIsContinuation = optsMeta.systemResume === true;
    this.budgetTaskKey =
      typeof optsMeta.goalId === 'string' && optsMeta.goalId
        ? optsMeta.goalId
        : ToolTurnBudget.DEFAULT_BUDGET_TASK_KEY;

    const stored = metadata?.toolTurnBudget as ToolTurnBudgetState | undefined;
    const inheritable =
      this.budgetIsContinuation &&
      stored?.taskKey === this.budgetTaskKey &&
      Number.isFinite(stored?.consumed) &&
      (stored?.consumed ?? 0) > 0;
    this.budgetBaseline = inheritable ? Math.floor(stored!.consumed) : 0;

    logger.info('reactToolLoop:tool_turn_budget_inherited', {
      sessionId: this.deps.getCtx().session.id,
      taskKey: this.budgetTaskKey,
      systemResume: this.budgetIsContinuation,
      baseline: this.budgetBaseline,
      cap: MAX_DYNAMIC_TOOL_TURNS_CAP,
    });

    // 用户消息 ⇒ 清零旧任务计数（不留下一个任务的消耗被下一个任务继承）
    if (metadata) {
      metadata.toolTurnBudget = {
        taskKey: this.budgetTaskKey,
        consumed: this.budgetBaseline,
        updatedAt: Date.now(),
      };
    }

    // todo 扩容量**同源同口径**（2026-09-25，`.trae/specs/todo-expansion-persistence.md`）：
    // 预算基线跨段继承，则「未完成 todo 数」也必须跨段 —— 否则续段的 todo 扩容恒为 0
    //（快照只活在实例内存，而生产路径每段新建实例）。
    this._initTodoExpansion(metadata);
  }

  /** 「任务累计已消耗」= 基线 + 本段已执行轮次（续期与额度判定的**唯一口径**） */
  private _taskConsumedTurns(): number {
    return this.budgetBaseline + this.deps.getLoopState().toolTurnCount;
  }

  /**
   * 内存写：更新 `session.metadata.toolTurnBudget`（每轮调用，**零 IO**）。
   *
   * 落盘节流（D6）：每 5 轮随既有 `saveCheckpointWithData`（其 metadata 形参即本对象）落检查点，
   * 轮次结束由宿主 `persistSessionMetadata()` 写回会话存储。
   */
  _publishToolTurnBudget(): void {
    const metadata = this._sessionMetadata();
    if (!metadata) return;
    metadata.toolTurnBudget = {
      taskKey: this.budgetTaskKey,
      consumed: this._taskConsumedTurns(),
      updatedAt: Date.now(),
    };
  }

  /**
   * 未完成 todo 任务数（`pending` / `in_progress`）—— **同一派生源**，供
   * ① 动态扩容（`_resolveDynamicMaxIterations`）与 ② 长任务信号（`_isLongTaskSignal`）共用。
   * 读的是**扩容快照**（消费侧取走 `pendingTodos` 不影响），详见 `todoExpansionSnapshot`。
   */
  private _pendingTodoCount(): number {
    let count = 0;
    for (const unfinished of this.todoExpansionSnapshot.values()) {
      count += unfinished;
    }
    return count;
  }

  /**
   * 长任务信号（G3，2026-09-25，`.trae/specs/long-task-routing.md`）：**客观状态量**判定
   * （未完成 todo 数 ≥ 阈值 **或** 已耗轮次 ≥ 一个基础档），**不做任何文案/字符串匹配**（CS02）。
   *
   * 用途：仅在**收尾**时给出"可改用编排继续"的可执行建议 —— 不做自动切换
   *（既有自动升级通道在消息意图/目标层，已在产品中生效，见 spec §1.1）。
   */
  _isLongTaskSignal(): boolean {
    return (
      this._pendingTodoCount() >=
        ToolTurnBudget.LONG_TASK_PENDING_TODO_THRESHOLD ||
      this._taskConsumedTurns() >= this.deps.getBaseMaxToolTurns()
    );
  }

  /**
   * 长任务信号（公开读数，供宿主做**运行中分流**判定 —— D3，2026-09-25）。
   *
   * 纯读数、无副作用；宿主（`streamMessageFlow` → `ChatManager`）据此决定是否按**既有**升级
   * 通道把任务接给 PDCA 编排（闸门见 `chat/longTaskEscalation.ts`）。
   */
  getLongTaskSignal(): {
    isLongTask: boolean;
    pendingTodoCount: number;
    consumedTurns: number;
  } {
    return {
      isLongTask: this._isLongTaskSignal(),
      pendingTodoCount: this._pendingTodoCount(),
      consumedTurns: this._taskConsumedTurns(),
    };
  }

  /** 动态扩容计算：基础阈值 + 未完成 todo 项数 × 每项轮次 + 探索续期，封顶 500（口径 = 任务累计消耗） */
  _resolveDynamicMaxIterations(): {
    max: number;
    breakdown: {
      pendingTodoCount: number;
      todo: number;
      fetch: number;
      renewal: number;
      /** 跨 run 基线（同任务已消耗） */
      baseline: number;
      /** 任务累计消耗 = 基线 + 本段轮次 */
      taskConsumed: number;
    };
  } {
    // 缺陷 C 修复（2026-09-25）：读**扩容快照**而非 `pendingTodos`（后者被消费侧取走即清空，
    // 详见 `todoExpansionSnapshot`）。快照已按 planId/title 覆盖，天然去重 —— 旧实现
    // 每次 `extractTodoData` 都无条件 push，故需要额外 Set 去重，这里由 Map 键承担。
    const pendingTodoCount = this._pendingTodoCount();
    // P10（2026-09-01）：无 todo 但涉及外部获取/技能探索的任务同样扩容——
    // 此类任务需多轮尝试（抓取→失败→换源→查询→求助），基础 30 轮偏紧。
    const todoExpansion = pendingTodoCount * DYNAMIC_TURNS_PER_PENDING_TODO;
    const fetchExpansion = this.deps.getLoopState().hasExternalFetchActivity
      ? EXTERNAL_FETCH_EXPANSION_TURNS
      : 0;
    // 8.4②（2026-09-16，治缺陷 1）+ 缺陷 A 修复（2026-09-25，治结构性撞线）
    // + 跨 run 预算（2026-09-25）：口径是**任务累计消耗**（`budgetBaseline + 本段轮次`），
    // 使续跑段不回退续期斜坡（见 `.trae/specs/tool-turn-budget-persistence.md`）。
    // 修复前是 `expansion += floor(toolTurnCount / 2)`：每消耗 1 轮只回收 0.5 轮，
    // 净余量以 **0.5 轮/轮** 单调衰减 ⇒ 数学上必然撞线（base=30 时约第 59 轮），
    // 且撞线远早于硬顶 ⇒ `MAX_DYNAMIC_TOOL_TURNS_CAP` 永远不可达（死代码）。
    // 现改为**按 base 续期**：每消耗满 base 轮续期 base 轮（收支比 1:1）⇒ 剩余额度稳定在
    // 约 [base, 2×base)，硬顶重新成为**真实止损点**；简单对话（消耗未过 base/2）不受影响。
    const consumed = this._taskConsumedTurns();
    const renewal =
      consumed > this.deps.getBaseMaxToolTurns() / 2
        ? this.deps.getBaseMaxToolTurns() *
          Math.ceil(consumed / this.deps.getBaseMaxToolTurns())
        : 0;
    const max = Math.min(
      this.deps.getBaseMaxToolTurns() +
        todoExpansion +
        fetchExpansion +
        renewal,
      MAX_DYNAMIC_TOOL_TURNS_CAP
    );
    return {
      max,
      breakdown: {
        pendingTodoCount,
        todo: todoExpansion,
        fetch: fetchExpansion,
        renewal,
        baseline: this.budgetBaseline,
        taskConsumed: consumed,
      },
    };
  }

  /** run 级复位（宿主 `resetRunState()` 调用；归零不等于丢弃，续跑由 `_initToolTurnBudget()` 回填） */
  resetRunState(): void {
    this.todoExpansionSnapshot.clear();
    this.budgetBaseline = 0;
    this.budgetTaskKey = ToolTurnBudget.DEFAULT_BUDGET_TASK_KEY;
    this.budgetIsContinuation = false;
  }
}
