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

import type {
  ReActEvent,
  ToolCallEntry,
  ToolResultEntry,
} from '@modules/query';
import { EXTERNAL_FETCH_TOOLS } from '@modules/query';
import type { ToolCall, ToolResult } from '@modules/session/types/tool.js';
import type { Message } from '@modules/session/types/message.js';
import type { ToolLoopContext } from './ToolLoopRunner.js';
import { extractTodoData } from './services/ChatHelper';
import { enterPhase, exitPhase } from '@modules/diagnostics';
import type { TodoBlockData } from '@modules/runtime/api/todo-types';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('chat:reactToolLoop');

/**
 * 安全序列化（遗漏 3，2026-08-14 复查）：
 * ToolResult.result 类型为 unknown，工具可返回任意结构；循环引用/BigInt 会抛
 * TypeError → ReActLoop.run() 外层 catch 中断整轮剩余工具执行。失败降级为空串。
 */
export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch (err) {
    // 序列化失败（循环引用/BigInt 等异常结构）：降级空串，记录来源便于排查
    logger.warn('reactToolLoop:safeStringify failed', {
      error: String(err),
      valueType: typeof value,
    });
    return '';
  }
}

/** M3-T3.2：并发批次项——isConcurrencySafe 工具执行延迟到 flush（Promise.all） */
export interface ParallelBatchItem {
  tc: ToolCallEntry;
  progressEvents: number[];
  run: () => Promise<ToolResult>;
  remainingToolCalls: Array<{
    id: string;
    name: string;
    arguments: unknown;
  }>;
}

/** 工具结果后处理 / 循环守卫所需的宿主循环状态（最小结构面，避免入参整型 `ReActToolLoopState`） */
export interface ToolResultPostProcessLoopState {
  hasExternalFetchActivity?: boolean;
  toolTurnCount: number;
  loopDetected: { detector: string; message: string } | null;
  completedToolNames: string[];
  totalCompletedToolCount: number;
  completedToolCallIds: string[];
  assistantMessage: Message | null;
  llmCallCount: number;
}

/** `ToolResultPostProcess` 的宿主依赖（全部 getter/闭包：宿主状态在 run 期内可变） */
export interface ToolResultPostProcessDeps {
  getCtx: () => ToolLoopContext;
  getLoopState: () => ToolResultPostProcessLoopState;
  /** B3 模块 `streamingLlm` 读取（工具轮 assistant 消息 id） */
  getActiveToolRoundMessageId: () => string;
  /** 基类 `steeringQueue` 入队（保持 `[STEERING]` 注入语义） */
  pushSteering: (text: string) => void;
  /** 基类 `completedWork` 读取（跨轮"已完成工作"摘要，供熔断收尾呈现） */
  getCompletedWork: () => string[];
  /** todo 登记（宿主 `_recordPendingTodo` 薄壳，转调 B1 模块） */
  recordPendingTodo: (todoData: TodoBlockData) => void;
}

/**
 * 工具结果后处理 / 循环守卫（C3）。
 *
 * 2026-10-05 纯搬迁自 `chat/ReActToolLoop.ts`（文件规模债拆分 B4，见
 * `.trae/specs/file-size-debt-partition-plan.md` §19.3）——方法体、注释、日志文案逐字保留，
 * 仅将宿主状态改为经 `ToolResultPostProcessDeps` 的 getter/闭包读取。
 */
export class ToolResultPostProcess {
  /** P3-6（2026-09-02）：文件产出循环判定阈值——同内容骨架文件 ≥3 个即视为重复产出循环 */
  private static readonly FILE_WRITE_LOOP_THRESHOLD = 3;
  /** P3-6：内容骨架长度（取内容前 N 字符比较，覆盖 HTML/文档模板开头一致性） */
  private static readonly FILE_CONTENT_HEAD_LENGTH = 200;
  /** BUG-05（2026-09-16）：重读收敛阈值——同一资源（文件/搜索 pattern）被非连续重读数次即注入强制收尾 steering */
  private static readonly READ_REEXPLORE_STEER_THRESHOLD = 5;

  /**
   * P3-6（2026-09-02）：文件产出循环检测（根治"换文件名反复写相似文件"死循环）。
   * 记录会话内已写入文件（path + 内容骨架），配合 FILE_WRITE_LOOP_THRESHOLD 判定。
   */
  private readonly writtenFiles: Array<{ path: string; contentHead: string }> =
    [];
  /** 文件产出循环已注入 steering（每会话仅 1 次，避免反复打扰） */
  private fileWriteLoopPrompted = false;
  /** BUG-05（2026-09-16）：重读收敛——被重读/重搜资源 → 累计次数（键 = 工具名:资源） */
  private readReExploreCounts = new Map<string, number>();
  /** BUG-05：是否已注入一次"重读收敛" steering（避免重复刷屏） */
  private readReExploreSteered = false;

  constructor(private readonly deps: ToolResultPostProcessDeps) {}

  /**
   * M2（2026-09-01 P1）：等待工具执行，同时响应 abort signal。
   *
   * 背景：工具循环挂起在 await 工具执行（如 grep 全项目 83s）时，generator.return()
   * 无法中断挂起的 await → 旧流互斥锁无法释放 → 后续同一会话请求 acquire 30s 超时。
   * 方案：Promise.race 让 abort 时立即返回 fallback（工具显示"已中止"），
   * 生成器得以继续/退出 → finally 释放锁。
   */
  async _raceToolAbort<T>(
    run: () => Promise<T>,
    fallback: () => T
  ): Promise<T> {
    const sig = this.deps.getCtx().abortSignal;
    if (!sig) return run();
    if (sig.aborted) return fallback();
    const abortP = new Promise<T>((resolve) => {
      sig.addEventListener('abort', () => resolve(fallback()), { once: true });
    });
    return Promise.race([run(), abortP]);
  }

  /**
   * M3-T3.2（2026-08-31）：flush 并发批次——Promise.all 批量执行并发安全工具，
   * 结果按调用顺序统一后处理（_postProcessToolResult），保证 tool/result 消息、
   * 检查点与进度事件的顺序与串行路径一致。
   */
  async *_flushParallelBatch(
    batch: ParallelBatchItem[],
    results: ToolResultEntry[],
    processedResults: Array<{
      normalizedToolCall: ToolCall;
      result: ToolResult;
    }>
  ): AsyncGenerator<ReActEvent, void> {
    enterPhase('toolround:execute');
    try {
      if (batch.length === 0) return;
      const items = batch.slice(); // 快照——batch.length=0 会清空原数组，items 必须独立引用
      batch.length = 0;
      logger.info('reactToolLoop:parallel_batch_execute', {
        sessionId: this.deps.getCtx().session.id,
        batchCount: items.length,
        tools: items.map((i) => i.tc.name),
      });
      // 2026-09-01 P1：abort 时不再等待长工具（Promise.all 不可中断），
      // 立即以"已中止"错误结果 fallback，释放生成器/互斥锁。
      const toolResults = await this._raceToolAbort(
        () => Promise.all(items.map((i) => i.run())),
        () =>
          items.map((i) => ({
            toolCallId: i.tc.id,
            toolName: i.tc.name,
            error: '工具执行被中止（会话停止，abort signal）',
          }))
      );
      for (let i = 0; i < items.length; i++) {
        const out = yield* this._postProcessToolResult(
          items[i].tc,
          toolResults[i],
          items[i].progressEvents,
          items[i].remainingToolCalls
        );
        if (out) {
          results.push(out.resultEntry);
          if (out.todoData) this.deps.recordPendingTodo(out.todoData);
          processedResults.push(out.processedEntry);
        }
      }
    } finally {
      exitPhase('toolround:execute');
    }
  }

  /**
   * BUG-05（2026-09-16）：重读数收敛。修复"35 分钟空转"——agent 非连续反复
   * 重读/重搜同一批文件或 pattern，每次都"再看一眼"却无新产出，且因交错调用
   * 逃过了 generic_repeat（只判与上一轮**连续**相同）与 ping_pong（只判双工具交替）。
   * 判定：读类工具（read/search/grep/glob 等，排除写/改类）对同一资源累计重访
   * ≥ READ_REEXPLORE_STEER_THRESHOLD → 注入一次 [STEERING] 强制收尾（非硬熔断，
   * 不误伤正常深度探索），由模型自纠收敛。
   * 串行/并行路径共用（在 _postProcessToolResult 中与 _detectFileWriteLoop 并列）。
   */
  private _detectReadReExplore(tc: ToolCallEntry): void {
    const name = tc.name;
    // 写/改/执行类工具排除：避免把"反复编辑同一文件/重复运行"误判为"重读"
    if (
      /(write|edit|create|delete|remove|save|append|apply|run|exec|bash)/i.test(
        name
      )
    )
      return;
    // 只关心读/搜/列目录类工具
    if (!/(read|grep|glob|search|view|list|explore|cat|open)/i.test(name))
      return;

    const inp = (tc.input ?? {}) as Record<string, unknown>;
    // 取"被重读的资源"签名：文件路径或搜索 pattern（读类工具的核心是资源本身）
    const resource =
      (typeof inp.file_path === 'string' ? inp.file_path : undefined) ??
      (typeof inp.path === 'string' ? inp.path : undefined) ??
      (typeof inp.pattern === 'string' ? inp.pattern : undefined) ??
      (typeof inp.query === 'string' ? inp.query : undefined);
    if (!resource) return;

    const key = `${name}:${resource}`;
    const count = (this.readReExploreCounts.get(key) ?? 0) + 1;
    this.readReExploreCounts.set(key, count);
    if (
      count < ToolResultPostProcess.READ_REEXPLORE_STEER_THRESHOLD ||
      this.readReExploreSteered
    ) {
      return;
    }

    this.readReExploreSteered = true;
    this.deps.pushSteering(
      `你已反复读取/搜索同一资源（${name}: ${resource}，累计 ${count} 次）未获得新结论。` +
        '请立即收敛：要么基于当前已掌握的信息直接向用户交付最终结论，' +
        '要么在继续读取前先明确说明你仍在尝试解决的具体未决问题；' +
        '不要重复读取/搜索相同的文件或模式。'
    );
    logger.warn('reactToolLoop:read_reexplore_detected', {
      sessionId: this.deps.getCtx().session.id,
      toolName: name,
      resource,
      count,
      toolTurn: this.deps.getLoopState().toolTurnCount,
    });
  }

  /**
   * P3-6（2026-09-02）：文件产出循环检测——模型反复写"相似内容/不同文件名"文件不收敛。
   *
   * 实测：deepseek-v4-flash 连续 14+ 轮 file_write 生成 AI-Agent 日报 HTML，文件名每次微调
   * （AI-Agent-日报/技术日报/前沿动态日报...）→ P15 的 file_path+contentLength 签名永不重复
   * → no_progress 熔断失效，每轮 40s+5000 tokens 白白消耗。判定：内容骨架相同（HTML/文档
   * 模板开头一致）的文件 ≥3 个 → 视为重复产出循环，注入 [STEERING] 强制收尾（非硬熔断）。
   * 串行路径（非并发安全工具）与并行批处理（_postProcessToolResult）共用本方法。
   */
  _detectFileWriteLoop(tc: ToolCallEntry): void {
    if (
      tc.name !== 'file_write' &&
      tc.name !== 'FileWriteTool' &&
      tc.name !== 'write_file' &&
      tc.name !== 'file_edit' &&
      tc.name !== 'FileEditTool' &&
      tc.name !== 'edit_file'
    ) {
      return;
    }
    const inp = (tc.input ?? {}) as Record<string, unknown>;
    const fp =
      typeof inp.file_path === 'string'
        ? inp.file_path
        : typeof inp.path === 'string'
          ? inp.path
          : '';
    if (!fp) return;
    const content = typeof inp.content === 'string' ? inp.content : '';
    const contentHead = content.slice(
      0,
      ToolResultPostProcess.FILE_CONTENT_HEAD_LENGTH
    );
    const existing = this.writtenFiles.find((w) => w.path === fp);
    if (existing) {
      existing.contentHead = contentHead;
    } else {
      this.writtenFiles.push({ path: fp, contentHead });
    }
    if (
      this.fileWriteLoopPrompted ||
      this.deps.getLoopState().loopDetected ||
      this.writtenFiles.length < ToolResultPostProcess.FILE_WRITE_LOOP_THRESHOLD
    ) {
      return;
    }
    const sameHeadCount = this.writtenFiles.filter(
      (w) => w.contentHead === contentHead
    ).length;
    if (sameHeadCount < ToolResultPostProcess.FILE_WRITE_LOOP_THRESHOLD) return;
    this.fileWriteLoopPrompted = true;
    const paths = this.writtenFiles.map((w) => w.path).join('、');
    this.deps.pushSteering(
      `你已成功写入 ${this.writtenFiles.length} 个文件（${paths}），其中多个文件内容结构相同。` +
        '如果任务已产出所需文件，请立即停止生成新文件，直接用文字向用户交付最终总结' +
        '（说明已生成的文件、核心内容与使用方式）；若需要调整，请用 file_edit 修改已有文件，不要新建文件。'
    );
    logger.warn('reactToolLoop:file_write_loop_detected', {
      sessionId: this.deps.getCtx().session.id,
      writtenFiles: this.writtenFiles.length,
      sameHeadCount,
      paths,
      toolTurn: this.deps.getLoopState().toolTurnCount,
    });
  }

  /**
   * M3-T3.2（2026-08-31）：标准工具执行的统一后处理。
   *
   * 提取自 act 标准执行段（onToolCall end / 进度 / 结果注册 / 落盘 / 检查点），
   * 供串行执行与并发批次共用——保证并发工具的结果落盘与检查点按调用顺序一致。
   * yield tool_progress 事件；return 后处理产物（results/processedResults/todo 项）。
   */
  private async *_postProcessToolResult(
    tc: ToolCallEntry,
    toolResult: ToolResult,
    progressEvents: number[],
    remainingToolCalls: Array<{
      id: string;
      name: string;
      arguments: unknown;
    }>
  ): AsyncGenerator<
    ReActEvent,
    {
      resultEntry: ToolResultEntry;
      processedEntry: { normalizedToolCall: ToolCall; result: ToolResult };
      todoData?: ReturnType<typeof extractTodoData>;
    }
  > {
    // P10（2026-09-01）：标记外部获取/技能探索活动——供无 todo 时的动态轮次扩容。
    if (EXTERNAL_FETCH_TOOLS.has(tc.name)) {
      this.deps.getLoopState().hasExternalFetchActivity = true;
    }
    // P3-6（2026-09-02）：文件产出循环检测（串行/并行路径共用）
    this._detectFileWriteLoop(tc);
    // BUG-05（2026-09-16）：重读/重搜收敛（串行/并行路径共用）
    this._detectReadReExplore(tc);
    // P7（2026-09-01）：跨轮收集"已完成工作"摘要——组合任务熔断（no_progress）时，
    // 已完成子任务（如知识库保存）的结果必须呈现给用户，不能随熔断一起丢失。
    // P12（2026-09-01）：created/skipped 统一为"已保存到知识库"，按 title 去重——
    // 此前 created（"已保存"）与 skipped（"已在知识库中"）文案不同导致同一文档
    // 列两条，且模型微调换 title 产生多条重复，用户看到的汇报混乱。
    if (
      tc.name === 'knowledge_save' &&
      !toolResult.error &&
      toolResult.result
    ) {
      const detail = toolResult.result as {
        title?: string;
        action?: string;
      };
      if (detail.title) {
        const done = `已保存到知识库：《${detail.title}》`;
        const completedWork = this.deps.getCompletedWork();
        if (!completedWork.includes(done)) {
          completedWork.push(done);
        }
      }
    }
    // P15（2026-09-01）：跨轮收集"已生成/更新文件"——模型多轮 file_write 同一文件
    // 被 no_progress 熔断时（增量完善模式，content 前 200 字符相同误判无进展），
    // 已写入的文件必须呈现给用户，不能随熔断一起丢失。
    if (
      (tc.name === 'file_write' ||
        tc.name === 'FileWriteTool' ||
        tc.name === 'write_file' ||
        tc.name === 'file_edit' ||
        tc.name === 'FileEditTool' ||
        tc.name === 'edit_file') &&
      !toolResult.error
    ) {
      const inp = (tc.input ?? {}) as Record<string, unknown>;
      const fp =
        typeof inp.file_path === 'string'
          ? inp.file_path
          : typeof inp.path === 'string'
            ? inp.path
            : '';
      if (fp) {
        const done = `已生成/更新文件：${fp}`;
        const completedWork = this.deps.getCompletedWork();
        if (!completedWork.includes(done)) {
          completedWork.push(done);
        }
      }
    }

    // 工具完成后批量产出 tool_progress 事件（细粒度百分比进度）
    for (const percentage of progressEvents) {
      yield { type: 'tool_progress', callId: tc.id, progress: percentage };
    }

    // 遗漏 2（2026-08-14 复查）：审批等待态判定提前（原 L381 重复计算，现合并）。
    // 审批等待工具不触发 onToolCall('end')——否则 CoreAPIImpl 误发 "✅ Tool completed"、
    // 前端聚合把审批中工具计入 completed++（显示 "2/3 完成"），与 pendingApproval 徽标矛盾。
    const isPendingApproval =
      (toolResult as { result?: { pendingApproval?: boolean } })?.result
        ?.pendingApproval === true;

    const rawResultJson = safeStringify(toolResult.result);
    const resultMessage = toolResult.error
      ? `失败: ${toolResult.error.slice(0, 200)}`
      : `成功: ${rawResultJson.slice(0, 200)}`;
    // 排查锚点：工具执行结果默认可见。失败用 WARN（circuit_breaker 触发时必须能
    // 看到每轮失败原因），成功用 INFO（避免 DEBUG 默认不可见导致排查断链）。
    const toolStatus = toolResult.error ? 'failed' : 'success';
    if (toolResult.error) {
      logger.warn('reactToolLoop:onToolCall end', {
        sessionId: this.deps.getCtx().session.id,
        toolName: tc.name,
        toolCallId: tc.id,
        status: toolStatus,
        detail: resultMessage,
        onToolCallRegistered: !!this.deps.getCtx().onToolCall,
        pendingApproval: isPendingApproval,
      });
    } else {
      logger.info('reactToolLoop:onToolCall end', {
        sessionId: this.deps.getCtx().session.id,
        toolName: tc.name,
        toolCallId: tc.id,
        status: toolStatus,
        detail: resultMessage,
        onToolCallRegistered: !!this.deps.getCtx().onToolCall,
        pendingApproval: isPendingApproval,
      });
    }
    if (!isPendingApproval) {
      this.deps.getCtx().onToolCall?.('end', tc.name, tc.id, {
        ok: !toolResult.error,
        message: resultMessage,
        result: toolResult.result,
      });
    }

    // 工具结果注册表 + 循环检测记录 + 心跳进度数据（5）
    try {
      this.deps
        .getCtx()
        .toolResultRegistry.storeResult(
          this.deps.getCtx().session.id,
          tc.id,
          tc.name,
          tc.input,
          { result: toolResult.result, error: toolResult.error },
          this.deps
            .getCtx()
            .toolResultRegistry.getCurrentRound(this.deps.getCtx().session.id)
        );
      this.deps
        .getCtx()
        .loopDetector.recordToolCallOutcome(
          tc.name,
          tc.input,
          toolResult.result,
          toolResult.error
        );
    } catch {
      // 注册/记录失败不影响执行
    }

    // B. 工具结果消息落盘（对齐旧类 _executeToolRound L673-680）
    // P1-4（2026-08-23）：metadata 携带 parentMessageId（= 归属 assistant 消息 id，G1/N6/A2），
    // convertMessage 的 tool 分支据此生成 tool/result.messageId。
    // T2.3（2026-08-23）：metadata 携带 callSeq（= tool_call 事件 seq，A1③ 闭环）——
    // streamMessageFlow 在写 assistant/tool_call 事件时填充 toolCallSeqMap，
    // convertMessage tool 分支据此直读生成 tool/result.callSeq，不再依赖 _toolCallSeqMap 回填。
    const toolCallSeqMap = this.deps.getCtx().toolCallSeqMap;
    const toolResultMsg = this.deps
      .getCtx()
      .messageService.createToolResultMessage(toolResult, {
        sessionId: this.deps.getCtx().session.id,
        metadata: {
          ...(toolResult.metadata as Record<string, unknown> | undefined),
          parentMessageId:
            this.deps.getLoopState().assistantMessage?.id ??
            this.deps.getActiveToolRoundMessageId(),
          ...(toolCallSeqMap?.has(tc.id)
            ? { callSeq: toolCallSeqMap.get(tc.id) }
            : {}),
        },
      });
    this.deps
      .getCtx()
      .addAndPersistMessage(this.deps.getCtx().session.id, toolResultMsg);

    // G. 流式检查点（对齐旧类 L707-724）：断点续跑依赖此数据
    if (!this.deps.getLoopState().completedToolNames.includes(tc.name)) {
      this.deps.getLoopState().completedToolNames.push(tc.name);
    }
    this.deps.getLoopState().totalCompletedToolCount++;
    if (!isPendingApproval) {
      this.deps.getLoopState().completedToolCallIds.push(tc.id);
    }
    try {
      await this.deps.getCtx().streamingCheckpoint.onToolCompleted({
        newMessagesSinceLastCheckpoint: [
          this.deps.getLoopState().assistantMessage,
          toolResultMsg,
        ],
        messagesSnapshot: this.deps.getCtx().session.messages.slice(),
        currentToolCalls: remainingToolCalls,
        completedToolCallIds: [
          ...this.deps.getLoopState().completedToolCallIds,
        ],
        generatorState: {
          toolTurnCount: this.deps.getLoopState().toolTurnCount,
          llmCallCount: this.deps.getLoopState().llmCallCount,
        },
        metadata: { model: this.deps.getCtx().options?.model },
        sessionState: this.deps.getCtx().session.state,
      });
    } catch {
      // 流式检查点失败不影响执行（@ignore-catch）
    }

    const resultEntry: ToolResultEntry = {
      toolCallId: tc.id,
      name: tc.name,
      status: toolResult.error ? 'error' : 'success',
      // 遗漏 1（2026-08-14 复查）：对象/数组结果（grep/glob/create_project 等经
      // ToolExecutor 返回 result.data 为对象）也下发——否则 tool_end 转换层 result
      // undefined → 前端工具卡片结果区空白。对齐 ToolExecutor.ts 的 JSON.stringify 方案。
      output:
        typeof toolResult.result === 'string'
          ? toolResult.result
          : toolResult.result !== undefined
            ? safeStringify(toolResult.result)
            : undefined,
      error: toolResult.error,
    };
    // todo chunk 数据：工具结果含 _todoData 时收集（对齐旧类 _executeToolRound extractTodoData）
    const todoData = extractTodoData(toolResult);
    const processedEntry = {
      normalizedToolCall: {
        id: tc.id,
        name: tc.name,
        arguments: tc.input,
      },
      result: toolResult,
    };
    return { resultEntry, processedEntry, todoData: todoData ?? undefined };
  }
}
