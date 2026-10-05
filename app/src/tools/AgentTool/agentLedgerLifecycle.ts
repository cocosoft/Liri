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

import { randomUUID } from 'crypto';
import type { AgentType, AgentInput } from './types';
import { ToolExecutionStatus, type ToolResult } from '../types/ToolResult';
import type { ToolUseContext } from '../types/ToolUseContext';
import type { ToolCallProgress } from '../types/Tool';
import type { AgentToolProgress } from '../types/ToolProgress';
import { getAgentRunStore } from './AgentRunStore';
import { getAgentRunLedger } from './AgentRunLedger';
// 接线期③ ③-A（2026-09-24）：未完成 run 的失败归因类型（随台账落盘）
import type { AgentRunAttribution } from './runAttribution';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('tools:agentTool');

/**
 * `AgentLedgerLifecycle` 的宿主依赖（全部 getter/闭包：宿主状态在 run 期内可变）。
 *
 * `notifyYieldSettlement` 必须**经箭头闭包捕获宿主 `this`** —— 测试
 * `swarmDescriptorResolution.test.ts` 以 `Reflect.set(tool, 'notifyYieldSettlement', spy)`
 * 猴补**实例成员**，并期望 `settleRun` 经实例调用它；闭包在**调用时**解析实例成员
 * ⇒ 猴补生效。`emitStart` 同理转发宿主 `this.agentToolPool.emitStart`（B1 模块方法）。
 */
export interface AgentLedgerLifecycleDeps {
  /** 宿主工具名（`failureResult` 的 `toolName` 字段） */
  getName: () => string;
  /** 宿主 `this.agentToolPool.emitStart`（B1 模块方法，进度发射） */
  emitStart: (
    onProgress: ToolCallProgress<AgentToolProgress> | undefined,
    agentId: string,
    agentName: string
  ) => void;
  /** 宿主 `this.notifyYieldSettlement`（结算通知唯一入口，猴补生效） */
  notifyYieldSettlement: (sessionId?: string) => Promise<void>;
}

/**
 * 台账 / 结算 / 血缘（C7）。
 *
 * 2026-10-05 纯搬迁自 `tools/AgentTool/AgentTool.ts`（文件规模债拆分 B2，见
 * `.trae/specs/file-size-debt-partition-plan.md` §28.5）——方法体、注释、日志文案、日志
 * module 名逐字保留，仅将宿主**实例依赖**改为经 `AgentLedgerLifecycleDeps` 注入，
 * 并对 `_ledger` 改用模块内 `getAgentRunLedger()` **同一单例**（`_ledger` 字段本体仍留宿主）。
 *
 * 可见性说明：6 成员原为 `private`，外迁后宿主执行主链直调
 * `this.agentLedgerLifecycle.X(...)` ⇒ 改为 `public`（签名与实现逐字不变）。
 */
export class AgentLedgerLifecycle {
  constructor(private readonly deps: AgentLedgerLifecycleDeps) {}

  /**
   * 创建Agent ID
   */
  createAgentId(type: AgentType, name?: string): string {
    const prefix = type === 'general' ? 'a' : 'x';
    const uuid = randomUUID().replace(/-/g, '').substring(0, 8);
    return `${prefix}-${name || 'agent'}-${uuid}`;
  }

  /**
   * 失败结果构造（O5 seam：消除逐字复制的失败字面量）。
   *
   * 字段与原内联实现逐条一致：`status: FAILURE` / `result: null` / `executionTime: 0` /
   * `output: ''` / `progress: []` / `metadata: {}` / `toolName: this.name`；
   * `errorOutput` 缺省等于 `error`（深度守卫例外，显式传入短文案）。
   */
  failureResult(
    error: string,
    executionId = '',
    errorOutput: string = error
  ): ToolResult<unknown> {
    return {
      status: ToolExecutionStatus.FAILURE,
      data: null,
      error,
      executionTime: 0,
      output: '',
      errorOutput,
      metadata: {},
      executionId,
      toolName: this.deps.getName(),
      timestamp: Date.now(),
    };
  }

  /**
   * O9③：摘要**超限时把全文落盘**（`resolveOutputDir()`，规则要求 AI 生成文件走该目录）。
   *
   * 只写文件，不做裁剪 —— 裁剪由 `trimSummaryWithFooter` 负责，二者职责分离。
   * 失败返回 `undefined`：调用方退化为"无指针"的裁剪标记，**不阻断汇总**。
   */
  async spillSummaryToDisk(params: {
    agentId: string;
    taskKey: string;
    text: string;
  }): Promise<string | undefined> {
    try {
      const [{ writeFile, mkdir }, { join }, { resolveOutputDir }] =
        await Promise.all([
          import('fs/promises'),
          import('path'),
          import('@modules/core/paths'),
        ]);
      const dir = resolveOutputDir();
      await mkdir(dir, { recursive: true });
      // 路径安全：任务键可能含 `::` / 斜杠等，统一净化后再拼文件名
      const safeKey = params.taskKey.replace(/[^A-Za-z0-9_.-]/g, '_');
      const file = join(dir, `agent-summary-${safeKey}.md`);
      await writeFile(file, params.text, 'utf8');
      logger.info('子代理摘要全文已落盘', {
        agentId: params.agentId,
        taskKey: params.taskKey,
        file,
        chars: params.text.length,
      });
      return file;
    } catch (err) {
      // @ignore-catch — 落盘失败仅失去指针，摘要仍以头尾裁剪形式进入父上下文
      logger.warn('子代理摘要全文落盘失败（退化为无指针标记）', {
        agentId: params.agentId,
        taskKey: params.taskKey,
        error: String(err),
      });
      return undefined;
    }
  }

  /**
   * 执行生命周期：登记（O5 seam `executeLifecycle` / prologue）。
   *
   * 0b（2026-09-22，M-9）：**台账登记已上移到 `executeGuard` 的 `tryReserve()`**
   *（准入判定与占位同一次同步调用 + RAII 释放义务）⇒ 本方法只保留
   * 启动日志 / 进度发射 / 磁盘落盘的副作用，**不再 register、不再自建 id 与起跑时间**。
   */
  async beginRun(params: {
    agentInput: AgentInput;
    effectiveType: AgentType;
    isFork: boolean;
    isBackground: boolean;
    context?: ToolUseContext;
    onProgress?: ToolCallProgress<AgentToolProgress>;
    /** 0b：`executeGuard.tryReserve()` 已登记（含额度占位）的 run id */
    agentId: string;
    /** 0b：与预留条目**同源**的起跑时间 */
    startTime: number;
  }): Promise<{ agentId: string; startTime: number }> {
    const {
      agentInput,
      effectiveType,
      isFork,
      isBackground,
      context,
      onProgress,
      agentId,
      startTime,
    } = params;

    // 0b（2026-09-22，M-9）：台账登记已由 `executeGuard` 的 `tryReserve()` 完成
    //（**判定与占位同一次同步调用**）⇒ 本方法不再 `register()`、也不再自建 id/起跑时间，
    // 只补**磁盘行 / 事件 / 日志**（保留原有副作用与执行顺序）。
    logger.info('Agent execution started', {
      agentId,
      agentType: effectiveType,
      isBackground,
      isFork,
      promptLength: agentInput.prompt?.length || 0,
    });

    this.deps.emitStart(onProgress, agentId, agentInput.name || agentId);

    // O6（B4）：起跑即落盘（durable completion ≠ durable execution —— 只保证终态/归因可查）
    await getAgentRunStore().startRun({
      toolCallId: agentId,
      agentId,
      sessionId: context?.sessionId,
      name: agentInput.name || agentId,
      // N-43 修复（2026-09-21）：落**真实类型名**（`subagent_type` 原值）。
      // 原落 `effectiveType` 经 `getAgentType()` 归一 —— 该函数只认 6 个内置类型，
      // 其余一律 `default: return 'custom'` ⇒ DB 角色（architect / security …）被记成
      // 无意义的 `custom`，前端「运行态」面板（`CouncilAgentRolesPage` 直接渲染
      // `run.agentType`）无法区分角色。此口径与 swarm 分支一致
      // （`buildSwarmExecutor` 的 `agentType ?? 'general'`，即 O12-2「落盘真实类型」）。
      // 未显式指定 `subagent_type`（fork / 走默认）时才回退归一值。
      agentType: agentInput.subagent_type || effectiveType,
      status: 'running',
      startedAt: startTime,
    });

    return { agentId, startTime };
  }

  /**
   * O19：落盘**描述符来源**（可观测性）。
   *
   * 与 `settleRun` 同约定：落盘失败只记日志，不影响执行（台账是观测面，不是正确性前置）。
   */
  async recordDescriptorSource(agentId: string, source: string): Promise<void> {
    try {
      await getAgentRunStore().setDescriptorSource(agentId, source);
    } catch (err) {
      logger.warn('子代理描述符来源落盘失败（不影响执行）', {
        agentId,
        source,
        error: String(err),
      });
    }
  }

  /**
   * 落终态（O6/B4）：**先**内存台账（同步临界区）**再**持久化（失败不影响已落定的内存终态）。
   *
   * 持久化失败只记日志 —— 台账落盘是"可观测性"而非"正确性前置"，
   * 不得因磁盘问题让一次已完成的委派对外表现为失败。
   *
   * O13：**内存拒绝的写，磁盘不得写** —— 原实现丢弃 `settle()` 的返回值并**无条件**落盘，
   * 使内存侧的终态幂等保护（"已完成、收尾组装抛错"不被反向写失败）在磁盘上原样敞着
   * ⇒ 同一事实两个答案（内存 `completed` / 磁盘 `failed`）。
   * M-5b 口径：落盘取**台账的终态**（`claimTerminalSideEffects().status`）而非调用方请求值
   * ⇒ 内存拒绝的改写同样到不了磁盘，O13 以更小的闸门宽度继续成立。
   *
   * §3.0 实施顺序约束（2026-09-22）：磁盘 `AgentRunStore.settleRun` 同样带终态幂等守卫
   * （`WHERE status NOT IN ('completed','failed')`，命中失败时 `changed=0` 且**无日志**）
   * ⇒ **必须在唯一写入点按真实结果派生终态**，不得"先落 completed、再由补偿写入改 failed"
   * —— 反序时补偿会 100% 静默空转。
   */
  async settleRun(
    agentId: string,
    status: 'completed' | 'failed',
    opts: { error?: string; attribution?: AgentRunAttribution } = {}
  ): Promise<void> {
    // M-5b（2026-09-25）：内存终态 + **副作用闸门**分两步 —— 步骤 1 落定/补读终态。
    // 引擎在 `execute()` 出口已先行 `settle()`（`SubAgentEngine.endRun`）⇒ 此处的
    // `settle()` 对引擎路径必然返回 `false`，**不可**拿它当"是否由本路径落定"的判据
    //（修复前正是如此：本方法提前 return ⇒ 磁盘行永久 `running` + yield 通知永不发出）。
    getAgentRunLedger().settle(agentId, status);
    // 步骤 2：认领副作用（幂等，与 `settle()` 同源但**独立于其返回值**），
    // 并取回**台账的**终态与归属会话 —— 同一次同步调用内完成，无交错窗口。
    const claim = getAgentRunLedger().claimTerminalSideEffects(agentId);
    if (!claim) {
      logger.debug('终态副作用跳过：台账无该终态或已执行过', {
        agentId,
        status,
      });
      return;
    }
    try {
      // opts 透传（`error` 用于把"未通过原因"钉在磁盘行上；store 侧本就支持，无需新增方法）
      // 返回值为 false = 磁盘**守卫未命中**（该行已是终态）⇒ 本次写被静默丢弃。
      // §3.0 顺序约束的**运行时兜底**（2026-09-22）：反过来改错顺序时，日志会当场叫出来，
      // 不必等用例兜（磁盘侧命中失败本无任何日志，故障静默）。
      // O13 口径（改写）：**磁盘按台账的终态落盘** —— 调用方请求的 status 被终态幂等拒绝时
      //（例：引擎已落 `completed`、收尾组装随后抛错试图改写 `failed`），落盘取台账答案，
      // ⇒ "内存拒绝的写"不会在磁盘上造出第二个答案。
      const persisted = await getAgentRunStore().settleRun(
        agentId,
        claim.status,
        opts
      );
      if (!persisted) {
        logger.warn('终态落盘未命中：磁盘行已是终态，本次写被丢弃', {
          agentId,
          status: claim.status,
        });
      }
    } catch (err) {
      logger.warn('子代理运行台账落盘失败（不影响内存终态）', {
        agentId,
        status: claim.status,
        error: String(err),
      });
    }

    // M-5（P0-8）：**结算即通知** —— 通知收敛到本方法这**唯一入口**，
    // 从结构上消除"某条结算路径忘了调 `notifyYieldSettlement`"。
    // 修复前 7 处 `settleRun` 调用点里只有 3 处手工补了通知，**单代理前台结算**与
    // **descriptor fail-closed** 两条路径漏掉 ⇒ 其上的 yield 等待永不收敛
    //（"子代理结算"是该等待唯一的恢复触发源）。
    // 用 `await`：使"结算 → 落盘 → 通知（内含 outbox 落行）"成为**确定序列**，
    // 而非 fire-and-forget 的竞态（P1-7 关注的正是该顺序，见 §2.5）。
    // 归属缺失（无父会话可恢复）⇒ 内部静默跳过。
    await this.deps.notifyYieldSettlement(claim.sessionId);
  }
}
