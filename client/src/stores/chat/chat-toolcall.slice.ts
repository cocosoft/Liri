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
  private activeTextBlock: MessageBlock | null = null;
  private activeThinkingBlock: MessageBlock | null = null;
  private hasToolCallSinceLastText = false;
  private currentToolCallId: string | null = null;
  private currentGroupId: string = generateGroupId();
  /** tool_completed 事件可能先于 tool_call 块到达，暂存结果数据等待块创建后应用 */
  private pendingResults = new Map<string, Record<string, unknown>>();

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
      this.activeThinkingBlock = newBlock;
    } else {
      this.activeThinkingBlock.content += content;
      this.activeThinkingBlock.isStreaming = isStreaming;
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
   *  1. "🔧 Running tool: xxx" 中间态 → 丢弃
   *  2. "✅ Tool xxx completed" / "❌ Tool xxx failed" 冗余完成/失败态 → 丢弃（tool_call 块已展示状态）
   *  3. "AI is thinking..." / "🎨 AI is generating..." 等瞬态加载态 → 丢弃
   *  4. 连续重复内容跳过
   */
  addStatus(status: string): void {
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
      existing.toolCall = {
        ...toolCall,
        arguments: mergedArgs,
        status: toolCall.status || ("completed" as const),
        result: toolCall.result || existingResult,
      };
      existing.isStreaming = toolCall.status === "running";
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
        ? { ...toolCall, result: { success: true, data: pendingResult } }
        : toolCall;
      this.blocks.push({
        id: generateBlockId(),
        type: "tool_call",
        content: "",
        toolCall: toolCallWithResult,
        isStreaming: true,
        toolCallId: toolCall.id,
        groupId: this.currentGroupId,
      });
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
    const block = this.blocks.find(
      (b) => b.type === "tool_call" && b.toolCall?.id === toolCallId,
    );
    if (block && block.toolCall) {
      block.toolCall.status = status;
      block.isStreaming = status === "running";
    }
  }

  /** 更新工具调用结果（用于 tool_completed 事件，携带结构化 result data） */
  updateToolCallResult(
    toolCallId: string,
    resultData: Record<string, unknown>,
  ): void {
    const block = this.blocks.find(
      (b) => b.type === "tool_call" && b.toolCall?.id === toolCallId,
    );
    if (block && block.toolCall) {
      block.toolCall.result = { success: true, data: resultData };
      block.isStreaming = false;
    } else {
      // tool_completed 先于 tool_call 块到达，暂存结果等待块创建后应用
      this.pendingResults.set(toolCallId, resultData);
    }
  }

  /** 添加问题块 */
  addQuestion(questionData: QuestionData): void {
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
    // 标题不匹配时，回退到第一个 todo 块（流式更新时标题可能不同）
    if (idx === -1) {
      idx = this.blocks.findIndex((b) => b.type === "todo");
    }
    if (idx !== -1) {
      this.blocks[idx].taskCard = normalized;
      return;
    }
    this.blocks.push({
      id: generateBlockId(),
      type: "todo",
      content: todoData.title,
      taskCard: normalized,
      isStreaming: false,
      groupId: this.currentGroupId,
    });
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
    const idx = this.blocks.findIndex((b) => b.type === "todo" && b.taskCard);
    if (idx !== -1 && this.blocks[idx].taskCard) {
      const tasks = this.blocks[idx].taskCard!.tasks.map((t) =>
        String(t.id) === String(taskId) ? { ...t, ...updates } : t,
      );
      this.blocks[idx].taskCard = { ...this.blocks[idx].taskCard!, tasks };
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
      this.blocks[idx].progressData = progressData;
      this.blocks[idx].content = progressData.description;
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
  }

  /** 冻结所有块（流式结束或中断时调用） */
  freezeAll(): void {
    for (const block of this.blocks) {
      block.isStreaming = false;
      // R1: 对 todo 块最终化其整体状态（修复 BUG #11）
      if (block.type === "todo" && block.taskCard) {
        block.taskCard.status = "done";
      }
    }
    this.activeTextBlock = null;
    this.activeThinkingBlock = null;
  }

  /** 获取构建好的 blocks */
  getBlocks(): MessageBlock[] {
    return [...this.blocks];
  }

  /** 重置构建器 */
  reset(): void {
    this.blocks = [];
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
 */
export function createThinkExtractor() {
  let thinkBuffer = "";
  let responseBuffer = "";
  let inThink = false;
  let inResponse = false;

  return {
    extract: function* (
      chunk: StreamChunk,
    ): Generator<StreamChunk, void, unknown> {
      if (chunk.type !== "text" || !chunk.content) {
        yield chunk;
        return;
      }

      const content = chunk.content;
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
          if (
            thinkStart !== -1 &&
            (thinkStart < responseStart || responseStart === -1)
          ) {
            output += remaining.slice(0, thinkStart);
            // 跳过 <think> 或 <thinking>（7 或 9 字符）
            const tagLen = remaining
              .slice(thinkStart, thinkStart + 9)
              .toLowerCase()
              .startsWith("<thinking")
              ? 10
              : 7;
            remaining = remaining.slice(thinkStart + tagLen);
            inThink = true;
            thinkBuffer = "";
          } else {
            output += remaining.slice(0, responseStart);
            remaining = remaining.slice(responseStart + 10); // "<response>" = 10 chars
            inResponse = true;
            responseBuffer = "";
          }
          continue;
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
      // 未闭合的 think 标签 → 作为 thinking 输出
      if (inThink && thinkBuffer) {
        yield { type: "thinking" as const, content: thinkBuffer };
        inThink = false;
        thinkBuffer = "";
      }
      // 未闭合的 response 标签 → 作为 text 输出
      if (inResponse && responseBuffer) {
        yield { type: "text" as const, content: responseBuffer };
        inResponse = false;
        responseBuffer = "";
      }
    },
  };
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
  if (msg.blocks && msg.blocks.length > 0) {
    return msg.blocks.map((b: MessageBlock) => ({ ...b, isStreaming: false }));
  }

  const newBlocks: MessageBlock[] = [];
  const rawToolCalls = msg.tool_calls || [];
  // 统一规范化 tool_calls 格式
  const toolCalls = rawToolCalls.map(normalizeToolCall);
  const fullText = typeof msg.content === "string" ? msg.content : "";
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
  const thinkMatch = remainingText.match(/<think>([\s\S]*?)<\/think>/);
  if (thinkMatch) {
    newBlocks.push({
      id: generateBlockId(),
      type: "thinking",
      content: thinkMatch[1].trim(),
      isStreaming: false,
      groupId: generateGroupId(),
    });
    // 移除已提取的 <think> 内容，剩余部分继续处理
    remainingText = remainingText.replace(thinkMatch[0], "").trim();
  }

  if (toolCalls.length === 0) {
    if (remainingText) {
      newBlocks.push({
        id: generateBlockId(),
        type: "text",
        content: fullText,
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
        name,
      ];
      for (const c of candidates) {
        const pos = fullText.indexOf(c);
        if (pos !== -1) return { idx: -1, pos, len: c.length };
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
