/**
 * Chat ToolCall Slice — 工具调用工具函数与 ChronologicalBlockBuilder
 *
 * 无 Zustand 状态字段，仅提供工具函数和类导出。
 * 被 chat-message.slice 和 chat-file.slice 引用。
 */
import {
  MessageBlock,
  ToolCall,
  TaskCardData,
  TaskCardTask,
  ProgressData,
} from "../../types";
import type { Message } from "../../types";
import type {
  StreamChunk,
  QuestionData,
  QuestionOption,
} from "../../services/chatService";
import { handleClientError } from "@/utils/handleError";
import { createLogger } from "@/utils/logger";

const logger = createLogger("stores:chat:toolcall");

/**
 * 生成 block ID（8 位短 UUID）
 */
export function generateBlockId(): string {
  return "blk_" + crypto.randomUUID().slice(0, 8);
}

/**
 * 生成分组 ID（8 位短 UUID）
 */
export function generateGroupId(): string {
  return "grp_" + crypto.randomUUID().slice(0, 8);
}

/**
 * 时序块构建器
 * 按流顺序构建 MessageBlock[]，确保工具调用前后的文本正确分段。
 * 对标 Cline 的 assistantMessageContent[] 顺序管理。
 *
 * 设计原理：
 *   1. text/thinking chunk → 写入当前活跃块
 *   2. tool_call chunk → 冻结当前文本块，新建 tool_call 块
 *   3. status chunk → 追加，标记工具调用的开始/结束
 *   4. 工具调用后，新 text chunk → 新建 text 块
 */
export class ChronologicalBlockBuilder {
  private blocks: MessageBlock[] = [];
  /** P2-3 增量快照缓存：仅数组结构变化（push）时重建，内容原地修改不触发拷贝 */
  private blocksCache: MessageBlock[] = [];
  private blocksDirty = true;
  private activeTextBlock: MessageBlock | null = null;
  private activeThinkingBlock: MessageBlock | null = null;
  private hasToolCallSinceLastText = false;
  private currentToolCallId: string | null = null;
  private currentGroupId: string = generateGroupId();
  /** tool_completed 事件可能先于 tool_call 块到达，暂存结果数据等待块创建后应用 */
  private pendingResults = new Map<string, Record<string, unknown>>();

  /** blocks 数组结构变化（push/reset）时置脏，使 getBlocks 重新拷贝 */
  private markBlocksDirty(): void {
    this.blocksDirty = true;
  }

  /**
   * AB-6 修复：原地修改块后替换为新对象并置脏。
   * 若不替换对象引用，getBlocks() 返回同一缓存数组且元素引用不变，
   * ChatMessage memo 比较器（prevBlocks===nextBlocks）会跳过重渲染，
   * 导致 thinking/todo/progress 块流式期间内容不刷新。
   */
  private replaceBlockAt(idx: number, updated: MessageBlock): void {
    this.blocks[idx] = updated;
    this.markBlocksDirty();
  }

  /** 追加文本块，工具调用后自动新建（同时分配新 groupId） */
  addText(content: string, isStreaming: boolean): void {
    if (this.hasToolCallSinceLastText || !this.activeTextBlock) {
      this.currentGroupId = generateGroupId();
      const newBlock: MessageBlock = {
        id: generateBlockId(),
        type: "text",
        content,
        isStreaming,
        groupId: this.currentGroupId,
      };
      this.blocks.push(newBlock);
      this.markBlocksDirty();
      this.activeTextBlock = newBlock;
      this.hasToolCallSinceLastText = false;
    } else {
      this.activeTextBlock.content += content;
      this.activeTextBlock.isStreaming = isStreaming;
    }
  }

  /** 追加 thinking 块 */
  addThinking(content: string, isStreaming: boolean): void {
    if (!this.activeThinkingBlock) {
      const newBlock: MessageBlock = {
        id: generateBlockId(),
        type: "thinking",
        content,
        isStreaming,
        groupId: this.currentGroupId,
      };
      this.blocks.push(newBlock);
      this.markBlocksDirty();
      this.activeThinkingBlock = newBlock;
    } else {
      // AB-6 修复：追加内容时替换为新块对象（含 dirty），使 memo 比较器感知变化并重渲染
      const updated: MessageBlock = {
        ...this.activeThinkingBlock,
        content: this.activeThinkingBlock.content + content,
        isStreaming,
      };
      const idx = this.blocks.indexOf(this.activeThinkingBlock);
      if (idx !== -1) this.replaceBlockAt(idx, updated);
      this.activeThinkingBlock = updated;
    }
  }

  /** 冻结 thinking 块（text 到来时调用） */
  freezeThinking(): void {
    if (this.activeThinkingBlock) {
      this.activeThinkingBlock.isStreaming = false;
      this.activeThinkingBlock = null;
    }
  }

  /** 添加状态块，自动过滤冗余/瞬态状态：
   *  利用 SSE 协议的 statusType 字段进行结构化过滤（CS02），
   *  仅当 statusType 缺失时才回退到字符串匹配（兼容旧后端）。
   */
  addStatus(status: string, statusType?: string, phase?: string): void {
    // 结构化过滤 (CS02) — 新 SSE 协议路径
    if (statusType) {
      // 瞬态/冗余状态类型 → 丢弃
      if (
        statusType === "ai_thinking" ||
        statusType === "tool_started" ||
        statusType === "tool_completed"
      ) {
        return;
      }
      // 可渲染的状态类型 → 正常添加
      const lastBlock = this.blocks[this.blocks.length - 1];
      if (lastBlock?.type === "status" && lastBlock.content === status) {
        return; // 去重
      }
      this.blocks.push({
        id: generateBlockId(),
        type: "status",
        content: status,
        status: statusType, // CS02：结构化标记持久化，渲染层按 block.status 判断状态类型（如 watermark）
        phase: (phase as "compacting" | "done") ?? undefined, // 压缩状态阶段（compacting/done）
        isStreaming: true,
        toolCallId: this.currentToolCallId ?? undefined,
        groupId: this.currentGroupId,
      });
      this.markBlocksDirty();
      return;
    }

    // 回退：字符串匹配（兼容旧后端，statusType 缺失时使用）
    // 丢弃中间态 "🔧 Running tool: xxx"
    if (status.includes("🔧") && status.includes("Running tool")) {
      return;
    }

    // 丢弃冗余完成/失败态 — tool_call 块头部已展示工具名和状态图标
    if (status.startsWith("✅ Tool") || status.startsWith("❌ Tool")) {
      return;
    }

    // 丢弃后端内部处理状态 — 这些是 SSE 协议消息，不是用户可见内容
    const internalPatterns = [
      "AI is thinking",
      "AI is analyzing",
      "AI is preparing",
      "AI is waiting",
      "🔍 AI is analyzing the image",
      "🎨 AI is generating",
    ];
    if (internalPatterns.some((p) => status.startsWith(p))) {
      return;
    }

    const lastBlock = this.blocks[this.blocks.length - 1];

    // 连续重复跳过
    if (lastBlock?.type === "status" && lastBlock.content === status) {
      return;
    }

    this.blocks.push({
      id: generateBlockId(),
      type: "status",
      content: status,
      isStreaming: true,
      toolCallId: this.currentToolCallId ?? undefined,
      groupId: this.currentGroupId,
    });
    this.markBlocksDirty();
  }

  /** 添加工具调用块，冻结当前文本 */
  addToolCall(toolCall: ToolCall): void {
    this.currentToolCallId = toolCall.id;

    if (this.activeTextBlock) {
      this.activeTextBlock.isStreaming = false;
    }
    if (this.activeThinkingBlock) {
      this.activeThinkingBlock.isStreaming = false;
      this.activeThinkingBlock = null;
    }

    const existingIdx = this.blocks.findIndex(
      (b) => b.type === "tool_call" && b.toolCall?.id === toolCall.id,
    );

    // 检查是否有待处理的结果数据（tool_completed 可能先于 tool_call 到达）
    const pendingResult = this.pendingResults.get(toolCall.id);

    if (existingIdx !== -1) {
      const existing = this.blocks[existingIdx];
      // 保留已存在的参数（'start' 阶段的完整参数），避免被 'end' 阶段的空参数覆盖
      const mergedArgs =
        toolCall.arguments &&
        Object.keys(toolCall.arguments as Record<string, unknown>).length > 0
          ? toolCall.arguments
          : existing.toolCall?.arguments || toolCall.arguments;
      // 保留已存在的 result（由 tool_completed 事件设置），避免被 tool_call completion chunk 覆盖
      // 同时检查 pendingResults 中的待处理结果
      const existingResult =
        existing.toolCall?.result ||
        (pendingResult ? { success: true, data: pendingResult } : undefined);
      // J-2.2: 替换块对象（新引用）使 ChatMessage memo 比较器可感知 pendingApproval 等变化
      this.blocks[existingIdx] = {
        ...existing,
        toolCall: {
          ...toolCall,
          arguments: mergedArgs,
          status: toolCall.status || ("completed" as const),
          result: toolCall.result || existingResult,
          // 失败原因保留：tool_end 失败块携带 error，避免被后续 chunk 覆盖丢失
          error: toolCall.error || existing.toolCall?.error,
          // P2-2: 审批等待信号可能先于 tool_call 块到达（tool_completed → pendingResults）
          pendingApproval:
            existing.toolCall?.pendingApproval ||
            toolCall.pendingApproval ||
            pendingResult?.pendingApproval === true,
        },
        isStreaming: toolCall.status === "running",
      };
      this.markBlocksDirty();
      if (toolCall.status !== "running") {
        for (const b of this.blocks) {
          if (b.type === "status" && b.toolCallId === toolCall.id) {
            b.isStreaming = false;
          }
        }
      }
      // 消费已应用的待处理结果
      if (pendingResult) {
        this.pendingResults.delete(toolCall.id);
      }
    } else {
      // 若存在待处理结果，直接注入到新创建的 toolCall 中
      const toolCallWithResult = pendingResult
        ? {
            ...toolCall,
            result: { success: true, data: pendingResult },
            pendingApproval: pendingResult.pendingApproval === true,
          }
        : toolCall;
      this.blocks.push({
        id: generateBlockId(),
        type: "tool_call",
        content: "",
        toolCall: toolCallWithResult,
        // J-2.2: isStreaming 必须尊重 chunk 状态（completed/failed 不应标记为流式）
        isStreaming: toolCall.status === "running",
        toolCallId: toolCall.id,
        groupId: this.currentGroupId,
      });
      this.markBlocksDirty();
      this.hasToolCallSinceLastText = true;
      // 消费已应用的待处理结果
      if (pendingResult) {
        this.pendingResults.delete(toolCall.id);
      }
    }
  }

  /** 更新已有工具调用的状态 */
  updateToolCallStatus(
    toolCallId: string,
    status: "running" | "completed" | "failed",
  ): void {
    const idx = this.blocks.findIndex(
      (b) => b.type === "tool_call" && b.toolCall?.id === toolCallId,
    );
    if (idx !== -1 && this.blocks[idx].toolCall) {
      // J-2.2: 替换块对象使 memo 可感知状态变化（同 updateToolCallResult）
      this.blocks[idx] = {
        ...this.blocks[idx],
        toolCall: { ...this.blocks[idx].toolCall!, status },
        isStreaming: status === "running",
      };
      this.markBlocksDirty();
    }
  }

  /** 更新工具调用结果（用于 tool_completed 事件，携带结构化 result data） */
  updateToolCallResult(
    toolCallId: string,
    resultData: Record<string, unknown>,
  ): void {
    const idx = this.blocks.findIndex(
      (b) => b.type === "tool_call" && b.toolCall?.id === toolCallId,
    );
    if (idx !== -1) {
      const block = this.blocks[idx];
      const toolCall = block.toolCall;
      if (!toolCall) return;
      // J-2.2: 替换块对象（新引用）触发缓存重建，使 ChatMessage memo 比较器能感知
      // 原地修改（pendingApproval/result）——P2-3 缓存数组引用不变会让 memo 跳过重渲染
      this.blocks[idx] = {
        ...block,
        toolCall: {
          ...toolCall,
          result: { success: true, data: resultData },
          // P0-3（2026-08-14）：tool_completed 到达即视为完成，状态置 completed。
          // 修复分组头永远显示"⏳ 执行中"（原实现只写 result/isStreaming，不更新 status）。
          // 审批等待态保持原状态（由 pendingApproval 标记驱动，非字符串匹配 CS02）。
          status:
            resultData.pendingApproval === true ? toolCall.status : "completed",
          // P2-2: 结构化审批等待信号 → 置 pendingApproval 标记（CS02：状态判断用持久化标记，非字符串匹配）
          pendingApproval:
            resultData.pendingApproval === true
              ? true
              : toolCall.pendingApproval,
        },
        isStreaming: false,
      };
      this.markBlocksDirty();
    } else {
      // tool_completed 先于 tool_call 块到达，暂存结果等待块创建后应用
      this.pendingResults.set(toolCallId, resultData);
    }
  }

  /** 添加问题块（按 questionId 去重，避免重连/重试导致重复渲染） */
  addQuestion(questionData: QuestionData): void {
    // 去重：相同的 questionId 不重复添加
    const exists = this.blocks.some(
      (b) =>
        b.type === "question" &&
        b.questionData?.questionId === questionData.questionId,
    );
    if (exists) return;

    this.blocks.push({
      id: generateBlockId(),
      type: "question",
      content: "",
      questionData: {
        questionId: questionData.questionId,
        question: questionData.question,
        header: questionData.header,
        options: questionData.options.map((opt: QuestionOption) => ({
          label: opt.label,
          description: opt.description,
        })),
        multiSelect: questionData.multiSelect,
      },
      groupId: this.currentGroupId,
    });
    this.markBlocksDirty();
    // 标记自上次文本后有新 block，使后续文本创建新 text block（排在 question 之后）
    this.hasToolCallSinceLastText = true;
  }

  /** 添加或更新 todo 块 */
  addTodo(todoData: TaskCardData): void {
    // 归一化：后端可能发送 phase 而非 status（修复 BUG #11 R2）
    const raw = todoData as unknown as { phase?: string };
    const normalized: TaskCardData = {
      ...todoData,
      status: (raw.phase || todoData.status || "planning") as
        "done" | "planning" | "executing",
    };

    // 先按标题精确匹配
    let idx = this.blocks.findIndex(
      (b) => b.type === "todo" && b.content === todoData.title,
    );
    // 标题不匹配时优先按 task id 交集匹配（T7 修复）：
    // update 动作的全量快照默认 title='任务计划'，write 传自定义 name 时标题对不上，
    // 原实现直接回退更新**最后一个** todo 块 → 多轮任务时覆盖错块、旧块停在初始状态。
    // 快照与块共享任务 id（update 的 todo_id 来自 write 的 id），交集可精确命中目标块。
    if (idx === -1) {
      const newIds = new Set((normalized.tasks ?? []).map((t) => String(t.id)));
      if (newIds.size > 0) {
        let bestIdx = -1;
        let bestOverlap = 0;
        for (let i = 0; i < this.blocks.length; i++) {
          const b = this.blocks[i];
          if (b.type !== "todo" || !b.taskCard) continue;
          const overlap = (b.taskCard.tasks ?? []).filter((t) =>
            newIds.has(String(t.id)),
          ).length;
          if (overlap > bestOverlap) {
            bestOverlap = overlap;
            bestIdx = i;
          }
        }
        if (bestOverlap > 0) idx = bestIdx;
      }
      // 仍不匹配（新任务列表）时回退到**最后一个** todo 块（"最近写入"语义）
      // R2 强化：仅当最后一个 todo 块**未完成**（planning/executing）时才兜底更新——
      // 已完成（done）的旧任务列表被新数据覆盖是错误场景，改为新建块。
      if (idx === -1) {
        for (let i = this.blocks.length - 1; i >= 0; i--) {
          const b = this.blocks[i];
          if (b.type !== "todo" || !b.taskCard) continue;
          if (b.taskCard.status === "done") break; // 最后一个 todo 已完成，不兜底
          idx = i;
          break;
        }
        if (idx !== -1) {
          logger.info("addTodo: 标题未命中，回退更新最后一个 todo 块", {
            title: todoData.title,
            targetIdx: idx,
            targetTitle: this.blocks[idx].content,
            taskCount: normalized.tasks?.length ?? 0,
          });
        }
      }
    }
    if (idx !== -1) {
      // AB-6 修复：替换为新块对象（含 dirty），流式任务状态实时刷新
      logger.info("addTodo: 更新已有 todo 块", {
        title: todoData.title,
        idx,
        taskCount: normalized.tasks?.length ?? 0,
        status: normalized.status,
      });
      this.replaceBlockAt(idx, { ...this.blocks[idx], taskCard: normalized });
      return;
    }
    logger.info("addTodo: 新建 todo 块", {
      title: todoData.title,
      taskCount: normalized.tasks?.length ?? 0,
    });
    this.blocks.push({
      id: generateBlockId(),
      type: "todo",
      content: todoData.title,
      taskCard: normalized,
      isStreaming: false,
      groupId: this.currentGroupId,
    });
    this.markBlocksDirty();
  }

  /**
   * 更新 todo 块中单个任务的状态
   * 用于流式传输中实时反映任务进度变化
   */
  updateTodoTask(
    taskId: string,
    updates: Partial<{
      status: TaskCardTask["status"];
      result: string;
      durationMs: number;
    }>,
  ): void {
    // 修复：按 taskId 在所有 todo 块中查找——原实现永远命中第一个 todo 块，
    // 同一消息多次 todo_write（多轮任务）时第 2 轮起的更新全部落到第 1 轮上，
    // taskId 不在第一个块中则静默 no-op。
    const idx = this.blocks.findIndex(
      (b) =>
        b.type === "todo" &&
        b.taskCard?.tasks?.some((t) => String(t.id) === String(taskId)),
    );
    if (idx !== -1 && this.blocks[idx].taskCard) {
      const tasks = this.blocks[idx].taskCard!.tasks.map((t) =>
        String(t.id) === String(taskId) ? { ...t, ...updates } : t,
      );
      // AB-6 修复：替换为新块对象（含 dirty），单任务状态实时刷新
      logger.info("updateTodoTask: 更新任务状态", {
        taskId,
        idx,
        updates,
      });
      this.replaceBlockAt(idx, {
        ...this.blocks[idx],
        taskCard: { ...this.blocks[idx].taskCard!, tasks },
      });
    } else {
      // 排查静默 no-op：taskId 在所有 todo 块中都找不到（多轮任务串块根因之一）
      logger.warn("updateTodoTask: 未找到 taskId 所属 todo 块，更新被丢弃", {
        taskId,
        updates,
        todoBlockCount: this.blocks.filter((b) => b.type === "todo").length,
      });
    }
  }

  /**
   * 添加或更新进度块
   * 流式传输中，同一次执行的进度块会被更新而非重复追加
   */
  addProgress(progressData: ProgressData): void {
    // 按 phase 查找已有的进度块（同一次执行中同一 phase 不会重复出现）
    const idx = this.blocks.findIndex(
      (b) =>
        b.type === "progress" && b.progressData?.phase === progressData.phase,
    );
    if (idx !== -1) {
      // AB-6 修复：替换为新块对象（含 dirty），进度条实时刷新
      this.replaceBlockAt(idx, {
        ...this.blocks[idx],
        progressData,
        content: progressData.description,
      });
      return;
    }
    this.blocks.push({
      id: generateBlockId(),
      type: "progress",
      content: progressData.description,
      progressData,
      isStreaming: true,
      groupId: this.currentGroupId,
    });
    this.markBlocksDirty();
  }

  /**
   * 冻结所有块（流式结束或中断时调用）
   * @param completed 是否正常完成（用户取消/异常中断时传 false）——
   *   修复：原实现无条件把 todo 卡标 done，中止/失败也算"全部完成"；
   *   仅正常完成时 finalize todo 为 done，中断时保持 executing，
   *   由调用方 P3-1 完整性检查（未完成 tool_call → ⚠️ 任务中断）补充标记。
   */
  freezeAll(completed = true): void {
    const todoBlocks: string[] = [];
    // 流结束：progress 块是执行中的临时状态（阶段/步骤/进度条），
    // 不应保留为正文——用户反馈"正在执行工具"等状态文字出现在聊天记录里。
    // 执行中通过 StatusFloatBar（executionPhase）与流式进度卡展示，结束后即移除。
    const keptBlocks = this.blocks.filter((b) => b.type !== "progress");
    if (keptBlocks.length !== this.blocks.length) {
      logger.info("freezeAll: 移除执行中 progress 块（不保留为正文）", {
        removed: this.blocks.length - keptBlocks.length,
      });
      this.blocks = keptBlocks;
      this.markBlocksDirty();
    }
    for (const block of this.blocks) {
      block.isStreaming = false;
      // R1: 对 todo 块最终化其整体状态（修复 BUG #11）；仅正常完成时置 done
      // T4 修复：仅当全部任务已终态（completed/failed）时卡片置 done——
      // 原实现一刀切 done，任务级状态保留 pending/in_progress 时
      // 卡片显示"已结束"而底下任务仍"等待中"，状态自相矛盾
      if (completed && block.type === "todo" && block.taskCard) {
        const tasks = block.taskCard.tasks ?? [];
        const allFinal =
          tasks.length > 0 &&
          tasks.every((t) => t.status === "completed" || t.status === "failed");
        block.taskCard.status = allFinal ? "done" : "executing";
        todoBlocks.push(block.content);
      }
    }
    logger.info("freezeAll: 冻结所有块", {
      completed,
      blockCount: this.blocks.length,
      finalizedTodoTitles: todoBlocks,
    });
    // W13 修复：无条件置脏——原地改 block.isStreaming 后 blocksDirty 仍为 false 时
    // getBlocks() 返回旧缓存引用，ChatMessage memo 浅比较跳过重渲染（流结束状态不刷新）。
    // 原实现仅在移除 progress 块时置脏，无 progress 场景漏置。
    this.markBlocksDirty();
    this.activeTextBlock = null;
    this.activeThinkingBlock = null;
  }

  /** 获取构建好的 blocks（P2-3：结构未变时复用缓存数组，避免每 chunk O(n) 拷贝） */
  getBlocks(): MessageBlock[] {
    if (this.blocksDirty) {
      this.blocksCache = [...this.blocks];
      this.blocksDirty = false;
    }
    return this.blocksCache;
  }

  /** 重置构建器 */
  reset(): void {
    this.blocks = [];
    this.markBlocksDirty();
    this.activeTextBlock = null;
    this.activeThinkingBlock = null;
    this.hasToolCallSinceLastText = false;
    this.currentToolCallId = null;
    this.currentGroupId = generateGroupId();
  }
}

/**
 * think 标签提取器：从 text 块中解析 <think>...</think> <response>...</response> 标签内容
 * 当后端未通过 __pyapp_type: 'thinking' 发送推理内容时作兜底。
 * 支持跨多个文本块的 think/response 标签（流式传输场景）。
 *
 * 标签规范：
 *   <think>...</think>         → 内部推理，转为 thinking 块（用户可见但折叠）
 *   <thinking>...</thinking>   → <think> 的别名变体
 *   <response>...</response>   → 用户可见的最终回复内容，转为 text 块
 *   标签外内容                  → 作为普通 text 块
 *
 * P1 修复（2026-08-04）：消除正文标签误判风险。
 *   开标签后要求闭合标签在近距内出现（同chunk 或下一chunk 前 300 字符），
 *   否则作为普通文本输出。防止文档/代码示例中的标签被误解析。
 */
export function createThinkExtractor() {
  let thinkBuffer = "";
  let responseBuffer = "";
  let inThink = false;
  let inResponse = false;

  // P1 修复：标签验证状态
  /** 等待闭合标签验证的缓冲内容（含开标签） */
  let pendingBuffer = "";
  /** 放弃验证的字符上限 */
  const MAX_PENDING_CHARS = 300;

  // ─── 调试日志（仅开发环境） ──────────────────────
  const dbg = (msg: string, detail?: Record<string, unknown>) => {
    if (
      typeof process !== "undefined" &&
      process.env?.NODE_ENV === "production"
    )
      return;
    const extra = detail ? ` ${JSON.stringify(detail)}` : "";
    // eslint-disable-next-line no-console
    console.debug(`[think-extractor] ${msg}${extra}`);
  };

  return {
    extract: function* (
      chunk: StreamChunk,
    ): Generator<StreamChunk, void, unknown> {
      if (chunk.type !== "text" || !chunk.content) {
        yield chunk;
        return;
      }

      // P1：合并待验证缓冲
      const hadPending = pendingBuffer.length > 0;
      let content = pendingBuffer + chunk.content;
      if (hadPending) {
        dbg("RESOLVE pending", {
          bufferedLen: pendingBuffer.length,
          chunkLen: chunk.content.length,
        });
      }
      pendingBuffer = "";

      let remaining = content;
      let output = "";

      while (remaining.length > 0) {
        if (!inThink && !inResponse) {
          // 检测 <think> 或 <thinking> 开始标签
          const thinkMatch = remaining.match(/<(think|thinking)>/i);
          // 检测 <response> 开始标签
          const responseMatch = remaining.match(/<response>/i);

          const thinkStart = thinkMatch?.index ?? -1;
          const responseStart = responseMatch?.index ?? -1;

          // 两者都没找到 → 全部作为普通文本
          if (thinkStart === -1 && responseStart === -1) {
            output += remaining;
            break;
          }

          // 找到更靠前的标签
          const isThink =
            thinkStart !== -1 &&
            (thinkStart < responseStart || responseStart === -1);
          const tagStart = isThink ? thinkStart : responseStart;
          const tagType = isThink ? "think" : "response";
          const tagLen = isThink
            ? remaining
                .slice(thinkStart, thinkStart + 10)
                .toLowerCase()
                .startsWith("<thinking")
              ? 10
              : 7
            : 10; // "<response>" = 10 chars

          // 标签前的文本原样输出
          output += remaining.slice(0, tagStart);
          const afterTag = remaining.slice(tagStart + tagLen);

          // P1 修复：搜索闭合标签是否在近距内
          const closePattern =
            tagType === "think" ? /<\/(think|thinking)>/i : /<\/response>/i;
          const closeMatch = afterTag.match(closePattern);

          if (closeMatch) {
            dbg("ENTER", {
              tagType,
              contentLen: afterTag.slice(0, closeMatch.index!).length,
            });
            // 闭合标签在同 chunk 内 → 真实标签，进入对应模式
            const tagContent = afterTag.slice(0, closeMatch.index!);
            const closeLen =
              tagType === "think"
                ? afterTag
                    .slice(closeMatch.index!, closeMatch.index! + 12)
                    .toLowerCase()
                    .startsWith("</thinking")
                  ? 12
                  : 8
                : 11; // "</response>" = 11 chars

            if (tagType === "think") {
              if (tagContent) {
                yield { type: "thinking" as const, content: tagContent };
              }
              remaining = afterTag.slice(closeMatch.index! + closeLen);
            } else {
              if (tagContent) {
                yield { type: "text" as const, content: tagContent };
              }
              remaining = afterTag.slice(closeMatch.index! + closeLen);
            }
            continue;
          }

          // 闭合标签不在当前 chunk → 检查就近文本是否像真实块
          if (afterTag.trimStart().length > MAX_PENDING_CHARS) {
            dbg("REJECT too-far", {
              tagType,
              afterLen: afterTag.trimStart().length,
              max: MAX_PENDING_CHARS,
            });
            // 丢弃原始标签本身，内容作为普通文本继续输出，
            // 防止 <response>/<think> 等协议标签以原始形式泄漏到用户界面
            remaining = afterTag;
            continue;
          }

          // 缓冲待验证：下一 chunk 验证
          pendingBuffer = remaining.slice(tagStart);
          dbg("PENDING", {
            tagType,
            bufferedLen: pendingBuffer.length,
            remaining: afterTag.trimStart().slice(0, 30),
          });
          if (output) {
            yield { type: "text" as const, content: output };
          }
          return; // 等待下一个 chunk
        }

        if (inThink) {
          // 查找 </think> 或 </thinking> 结束标签
          const endMatch = remaining.match(/<\/(think|thinking)>/i);
          if (!endMatch) {
            // 标签未闭合，缓冲剩余内容
            thinkBuffer += remaining;
            break;
          }
          thinkBuffer += remaining.slice(0, endMatch.index!);
          if (thinkBuffer) {
            dbg("EXIT think", { contentLen: thinkBuffer.length });
            yield { type: "thinking" as const, content: thinkBuffer };
          }
          thinkBuffer = "";
          inThink = false;
          const tagLen = remaining
            .slice(endMatch.index!, endMatch.index! + 12)
            .toLowerCase()
            .startsWith("</thinking")
            ? 12
            : 8;
          remaining = remaining.slice(endMatch.index! + tagLen);
          continue;
        }

        if (inResponse) {
          // 查找 </response> 结束标签
          const endIdx = remaining.indexOf("</response>");
          if (endIdx === -1) {
            // 标签未闭合，缓冲剩余内容
            responseBuffer += remaining;
            break;
          }
          responseBuffer += remaining.slice(0, endIdx);
          if (responseBuffer) {
            dbg("EXIT response", { contentLen: responseBuffer.length });
            yield { type: "text" as const, content: responseBuffer };
          }
          responseBuffer = "";
          inResponse = false;
          remaining = remaining.slice(endIdx + 11); // "</response>" = 11 chars
          continue;
        }
      }

      if (output) {
        yield { type: "text" as const, content: output };
      }
    },
    flush: function* (): Generator<StreamChunk, void, unknown> {
      // P1：flush 时释放所有待验证缓冲为普通文本
      if (pendingBuffer) {
        dbg("FLUSH pending → text", { len: pendingBuffer.length });
        yield { type: "text" as const, content: pendingBuffer };
        pendingBuffer = "";
      }
      // 未闭合的 think 标签 → 作为 thinking 输出
      if (inThink && thinkBuffer) {
        dbg("FLUSH unclosed think", { len: thinkBuffer.length });
        yield { type: "thinking" as const, content: thinkBuffer };
        inThink = false;
        thinkBuffer = "";
      }
      // 未闭合的 response 标签 → 作为 text 输出
      if (inResponse && responseBuffer) {
        dbg("FLUSH unclosed response", { len: responseBuffer.length });
        yield { type: "text" as const, content: responseBuffer };
        inResponse = false;
        responseBuffer = "";
      }
    },
  };
}

/**
 * 兜底过滤：去除内容中残留的结构化标签
 * <response>、<think>、<thinking> 及其闭合标签不应显示给用户；
 * 工具调用包装标签（<invoke>/<tool_call>/<tool_calls>/<parameter>）也不应暴露，
 * 流被中断时可能残留半截 XML 片段（如 </parameter>）。
 */
export function stripStructuralTags(text: string): string {
  return text
    .replace(/<\/?response>/gi, "")
    .replace(/<\/?think(?:ing)?>/gi, "")
    .replace(/<\/?(?:invoke|tool_call|tool_calls|parameter)\b[^>]*>/gi, "");
}

/**
 * 查找消息中最后一个 tool_call 的 id
 */
export function findLastToolCallId(
  msg: Message & { tool_calls?: ToolCall[]; blocks?: MessageBlock[] },
): string | undefined {
  if (msg.tool_calls && msg.tool_calls.length > 0) {
    return msg.tool_calls[msg.tool_calls.length - 1].id;
  }
  if (msg.blocks) {
    for (let i = msg.blocks.length - 1; i >= 0; i--) {
      const b = msg.blocks[i];
      if (b.toolCallId) return b.toolCallId;
      if (b.toolCall?.id) return b.toolCall.id;
    }
  }
  return undefined;
}

/**
 * 规范化 tool_call 格式：将 OpenAI 格式 {id, type: 'function', function: {name, arguments: string}}
 * 转换为前端 ToolCall 格式 {id, name, arguments: Record}
 */
export function normalizeToolCall(tc: unknown): ToolCall {
  const obj = tc as Record<string, unknown>;
  if (
    obj &&
    obj.type === "function" &&
    obj.function &&
    typeof obj.function === "object"
  ) {
    const fn = obj.function as Record<string, unknown>;
    const rawArgs = fn.arguments;
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs =
        typeof rawArgs === "string"
          ? JSON.parse(rawArgs || "{}")
          : (rawArgs as Record<string, unknown>) || {};
    } catch (err) {
      handleClientError(
        err,
        { module: "stores:chat:toolcall", action: "normalizeToolCall" },
        "warn",
      );
      parsedArgs = { raw: rawArgs };
    }
    return {
      id: (obj.id as string) || "",
      name: (fn.name as string) || "",
      arguments: parsedArgs,
      status: (obj.status as "running" | "completed" | "failed") || undefined,
    };
  }
  return tc as ToolCall;
}

/**
 * 智能重建 blocks：基于 content + tool_calls 还原时序
 * 对标流式 ChronologicalBlockBuilder 的输出结构，分配 groupId 确保分组正确
 */
export function rebuildBlocksFromContent(
  msg: Message & { tool_calls?: ToolCall[] },
): MessageBlock[] {
  // 守卫：如果消息已有 blocks，直接返回，不再重建
  if (Array.isArray(msg.blocks) && msg.blocks.length > 0) {
    return msg.blocks.map((b: MessageBlock) => ({ ...b, isStreaming: false }));
  }

  const newBlocks: MessageBlock[] = [];
  const rawToolCalls = msg.tool_calls || [];
  // 统一规范化 tool_calls 格式
  const toolCalls = rawToolCalls.map(normalizeToolCall);
  // W12 修复：先基于原始 content 提取 <think> 段——stripStructuralTags 会删除
  // <think> 标签（:846-851），原实现先 strip 再 match 导致 thinkMatch 恒为 null，
  // 旧消息思考内容被当正文展示、无法折叠（死代码分支）。
  const rawContent = typeof msg.content === "string" ? msg.content : "";
  const thinkMatch = rawContent.match(/<think>([\s\S]*?)<\/think>/);
  const fullText = stripStructuralTags(rawContent);
  let remainingText = fullText;

  // 超长内容保护：content 超过 50000 字符时不做文本解析重建，直接包装为 text block
  // 避免无 blocks 的旧数据在大会话中触发 O(n²) 字符串扫描导致浏览器无响应
  if (fullText.length > 50000) {
    const gid = generateGroupId();
    newBlocks.push({
      id: generateBlockId(),
      type: "text",
      content: fullText,
      isStreaming: false,
      groupId: gid,
    });
    for (const tc of toolCalls) {
      newBlocks.push({
        id: generateBlockId(),
        type: "tool_call",
        content: tc.name || "Tool Call",
        toolCall: { ...tc, status: "completed" as const },
        isStreaming: false,
        groupId: gid,
      });
    }
    return newBlocks;
  }

  // 从 content 中提取 <think> 标签内容作为 thinking 块（切换会话后还原流式思考过程）
  if (thinkMatch) {
    newBlocks.push({
      id: generateBlockId(),
      type: "thinking",
      content: thinkMatch[1].trim(),
      isStreaming: false,
      groupId: generateGroupId(),
    });
    // W12 修复：stripStructuralTags 只删标签不删内容，需手动把 think 内容
    // 从 remainingText 移除，避免正文里残留思考文本。
    const thinkContent = thinkMatch[1].trim();
    const thinkIdx = remainingText.indexOf(thinkContent);
    if (thinkIdx !== -1) {
      remainingText = (
        remainingText.slice(0, thinkIdx) +
        remainingText.slice(thinkIdx + thinkContent.length)
      ).trim();
    }
  }

  if (toolCalls.length === 0) {
    if (remainingText) {
      newBlocks.push({
        id: generateBlockId(),
        type: "text",
        // W12 修复：用 remainingText（已剔除 think 内容），原实现用 fullText
        // 会把思考文本重复留在正文里。
        content: remainingText,
        isStreaming: false,
        groupId: generateGroupId(),
      });
    }
    return newBlocks;
  }

  const boundaries: Array<{ idx: number; pos: number; len: number } | null> =
    toolCalls.map((tc: ToolCall) => {
      const name = tc.name;
      if (!name) return null;
      const candidates = [
        `\`${name}\``,
        `「${name}」`,
        `${name} 工具`,
        `${name}工具`,
      ];
      for (const c of candidates) {
        const pos = fullText.indexOf(c);
        if (pos !== -1) return { idx: -1, pos, len: c.length };
      }
      // 裸名匹配加词边界约束，避免 "read" 误匹配 "already" 中的 "read"
      const wordBoundaryPattern = new RegExp(
        `(?<![\\w])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`,
      );
      const wbMatch = fullText.match(wordBoundaryPattern);
      if (wbMatch && wbMatch.index !== undefined) {
        return { idx: -1, pos: wbMatch.index, len: wbMatch[0].length };
      }
      return null;
    });

  // 填充 tool_call index
  let boundaryIdx = 0;
  for (const b of boundaries) {
    if (b) b.idx = boundaryIdx;
    boundaryIdx++;
  }

  const allUnknown = boundaries.every((b) => b === null);
  if (allUnknown) {
    // 当无法在文本中定位工具名边界时，放弃等分猜测（必然产生错乱块）。
    // 将所有文本作为一个 text block，tool_call 依次追加在后面。
    // 虽无法精确还原 text/tool_call 的交错顺序，但至少不会数据错乱。
    const gid = generateGroupId();
    if (fullText && fullText.trim()) {
      newBlocks.push({
        id: generateBlockId(),
        type: "text",
        content: fullText,
        isStreaming: false,
        groupId: gid,
      });
    }
    for (let i = 0; i < toolCalls.length; i++) {
      newBlocks.push({
        id: generateBlockId(),
        type: "tool_call",
        content: "",
        toolCall: toolCalls[i],
        isStreaming: false,
        toolCallId: toolCalls[i].id,
        groupId: gid,
      });
    }
    return newBlocks;
  }

  const indexedBoundaries = boundaries
    .filter((x): x is NonNullable<typeof x> => x !== null && x.pos !== -1)
    .sort((a, b) => a.pos - b.pos);

  let cursor = 0;
  for (const { pos, idx, len } of indexedBoundaries) {
    const gid = generateGroupId();
    const before = fullText.slice(cursor, pos);

    if (before && before.trim()) {
      newBlocks.push({
        id: generateBlockId(),
        type: "text",
        content: before,
        isStreaming: false,
        groupId: gid,
      });
    }
    newBlocks.push({
      id: generateBlockId(),
      type: "tool_call",
      content: "",
      toolCall: toolCalls[idx],
      isStreaming: false,
      toolCallId: toolCalls[idx].id,
      groupId: gid,
    });
    cursor = pos + len;
  }

  const tail = fullText.slice(cursor);
  if (tail && tail.trim()) {
    newBlocks.push({
      id: generateBlockId(),
      type: "text",
      content: tail,
      isStreaming: false,
      groupId: generateGroupId(),
    });
  }

  // 处理未能定位到边界的 tool_calls
  // 连续多个无法定位的 tool_call 使用相同 groupId 以便 ToolExecutionGroup 统一折叠
  let orphanGroupId = "";
  for (let i = 0; i < toolCalls.length; i++) {
    if (boundaries[i] === null) {
      // 每遇到一个新的 orphan 段，生成新 groupId
      if (!orphanGroupId) {
        orphanGroupId = generateGroupId();
      }
      newBlocks.push({
        id: generateBlockId(),
        type: "tool_call",
        content: "",
        toolCall: toolCalls[i],
        isStreaming: false,
        toolCallId: toolCalls[i].id,
        groupId: orphanGroupId,
      });
    } else {
      // 遇到有边界的 tool_call，重置 orphanGroupId（下一个 orphan 从新组开始）
      orphanGroupId = "";
    }
  }

  // 将 todo_write 的 tool_call 块替换为 todo 块（历史兼容）
  for (let i = 0; i < newBlocks.length; i++) {
    const block = newBlocks[i];
    if (block.type === "tool_call" && block.toolCall?.name === "todo_write") {
      const args = block.toolCall.arguments as
        Record<string, unknown> | undefined;
      if (args?.action === "write" && args?.todos) {
        const todos = args.todos as Array<{
          id?: string;
          name?: string;
          status?: string;
          dependsOn?: string[];
          activeForm?: string;
          metadata?: Record<string, unknown>;
        }>;
        if (Array.isArray(todos) && todos.length > 0) {
          // 兼容 content 字段（TodoWriteTool 内部字段名）和 name 字段
          const taskName = (
            t: { name?: string; content?: string },
            idx: number,
          ) => t.name || t.content || `步骤 ${idx + 1}`;
          const tasks = todos.map((t, idx) => ({
            id: t.id || String(idx + 1),
            name: taskName(t, idx),
            status:
              (t.status as "pending" | "in_progress" | "completed") ||
              "pending",
            dependsOn: t.dependsOn || [],
          }));
          const title =
            (args?.title as string) ||
            (typeof args?.description === "string" ? args.description : "") ||
            `任务 (${todos.length} 步)`;
          newBlocks[i] = {
            ...block,
            type: "todo",
            content: title,
            taskCard: { title, tasks, status: "planning" as const },
          };
        }
      }
    }
  }

  return newBlocks;
}

/* ===================================================================
 *  裸探索段分离（P0 修复：探索文本与正文分离）
 *  与后端 MessageContextPipeline.stripBareExploration 同语义。
 *  模型把工具执行过程叙述（"先规划…改用 glob…继续定位…直接出报告"）
 *  未走 thinking 通道、直接泄漏进正文 —— 收尾时抽离为 thinking 块。
 * =================================================================== */

/** 裸探索句信号正则（真实会话导出 chat-export-*.md 实证） */
const EXPLORATION_SENTENCE_PATTERNS = [
  /(?:^|[。！？；：])\s*(?:让我(?:先|再|看看|读读|查查|深入)?|我现在|接下来|下一步|继续(?:读|看|挖|深挖|定位|确认|搜索|探索|排查|把|补)|再(?:读|看|挖|深入|确认)|先(?:定位|规划|看看|系统|把|批量)|换个方式|改用|换成|逐一|逐个|批量)/,
  /(?:被拦|被拦截|改用|重试|路径解析|输出被截断|读完了|看完了|确认了|发现了|找到了|拿到了|定位到|列出来了|搜一下|命令被|证据收集完毕|更新任务状态|出(?:正式)?报告|输出报告|链路基本成型|拼图|补上|补齐|汇总新增|这轮|本轮|盲区|还没(?:读|看|碰|覆盖)|找不到|没找到|不在)/,
  /(?:真相大白|看起来|这说明|这表明|出现了|参考目录)/,
];

/** Markdown 结构行（标题/列表/引用/代码/图片）——正文标志，不作探索句处理 */
const MARKDOWN_STRUCTURE_RE =
  /^\s*(?:#{1,6}\s|\*\s|-\s|>\s|\d+\.\s|```|`|\[\[|!\[)/;

/** 按句子拆分 content，fenced code block 整体占位保护，保留换行结构 */
function splitSentencesPreservingFences(content: string): string[] {
  const FENCE_RE = /```[\s\S]*?```/g;
  const placeholders: string[] = [];
  const masked = content.replace(FENCE_RE, (m) => {
    placeholders.push(m);
    return `\u0000FENCE${placeholders.length - 1}\u0000`;
  });
  const parts = masked.split(/(?<=[。！？；?!])|(?=\n)/);
  return parts.map((p) =>
    p.replace(/\u0000FENCE(\d+)\u0000/g, (_m, idx: string) => {
      return placeholders[Number(idx)] ?? "";
    }),
  );
}

/** 判定单个句子是否为"裸探索句" */
function isBareExplorationSentence(sentence: string): boolean {
  if (!sentence?.trim()) return false;
  if (MARKDOWN_STRUCTURE_RE.test(sentence)) return false;
  return EXPLORATION_SENTENCE_PATTERNS.some((re) => re.test(sentence));
}

/**
 * 从正文中分离"裸探索段"：探索句 → thinking，正文句 → text。
 * 保护规则：正文为空 → 全部保留为正文（宁可漏过不可错杀，防止误吞整段）。
 */
export function splitBareExploration(content: string): {
  thinking: string;
  text: string;
} {
  if (!content?.trim()) return { thinking: "", text: content ?? "" };

  const sentences = splitSentencesPreservingFences(content);
  const thinkingParts: string[] = [];
  const textParts: string[] = [];
  for (const sentence of sentences) {
    if (isBareExplorationSentence(sentence)) {
      thinkingParts.push(sentence);
    } else {
      textParts.push(sentence);
    }
  }

  const thinking = thinkingParts.join("").trim();
  const text = textParts.join("").trim();
  // 保护规则：正文为空时保留原文（不分离，避免把整段正文误判为思考）
  if (text.length === 0) return { thinking: "", text: content };
  return { thinking, text };
}

/**
 * 流结束收尾：把 text 块中的裸探索段抽离为 thinking 块（插入原 text 块之前）。
 * 使 UI 呈现"思考折叠 + 干净正文"，且落盘 blocks 与后端剥离后的 content 一致。
 */
export function reorderExplorationBlocks(
  blocks: MessageBlock[],
): MessageBlock[] {
  const result: MessageBlock[] = [];
  for (const block of blocks) {
    if (
      block.type === "text" &&
      typeof block.content === "string" &&
      block.content.length > 0
    ) {
      const { thinking, text } = splitBareExploration(block.content);
      if (thinking.length > 0 && text.length > 0) {
        result.push({
          id: generateBlockId(),
          type: "thinking" as const,
          content: thinking,
          isStreaming: false,
          groupId: block.groupId,
        });
        result.push({ ...block, content: text });
        continue;
      }
    }
    result.push(block);
  }
  return result;
}
