/**
 * Chat Message Slice — streamMessage 内 processChunk 实现
 *
 * 从 chat-message.slice.ts 拆出（R04-001 文件行数限制治理）。
 * processChunk 是 streamMessage 流式主循环中对单个 chunk 的处理函数，
 * 原为闭包函数，现通过 ProcessChunkContext 显式传递依赖。
 */
import type { Message } from "@/types";
import { useContextWatermarkStore } from "@/stores/contextWatermarkStore";
import { playWarningSound } from "@/services/SoundService";
import { stripStructuralTags } from "./chat-toolcall.slice";
import { friendlyErrorSummary } from "@/utils/friendlyError";
import { switchState } from "./chat-message-shared";
import { createLogger } from "@/utils/logger";
import type { ChronologicalBlockBuilder } from "./chat-toolcall.slice";
import type { SaveQueue } from "./chat-history.slice";
import type { StreamChunk } from "@/services/chatService";
import type { MessageSet, MessageGet } from "./chat-message.types";

const logger = createLogger("stores:chat:message");

/** 批量更新状态（J4 版本号机制，防止过期 rAF 覆盖最终状态） */
export interface StreamBatchState {
  version: number;
  pending: boolean;
  latestMessages: Message[] | null;
}

/** processChunk 运行时上下文（替代原闭包捕获的局部变量） */
export interface ProcessChunkContext {
  sid: string;
  sessionId?: string;
  assistantId: string;
  controller: AbortController;
  blockBuilder: ChronologicalBlockBuilder;
  saveQueue: SaveQueue;
  lastChunkTimeRef: { current: number };
  batch: StreamBatchState;
  flushSet: (currentVersion: number) => void;
  set: MessageSet;
  get: MessageGet;
}

/**
 * 处理单个流式 chunk：按类型更新 blockBuilder / store / 落盘队列。
 * 原为 streamMessage 内部闭包函数，拆出后通过 ctx 显式访问依赖。
 */
export async function processChunk(
  ctx: ProcessChunkContext,
  chunk: StreamChunk,
): Promise<void> {
  const {
    sid,
    sessionId,
    assistantId,
    blockBuilder,
    saveQueue,
    lastChunkTimeRef,
    batch,
    flushSet,
    set,
    get,
  } = ctx;

  // P1-5: 每次收到 chunk 时更新时间戳
  lastChunkTimeRef.current = Date.now();
  // AB-5 修复：以 batch.latestMessages 为累积基准（同帧内多个 chunk 连续累加），
  // 而非每次从 store 取旧快照——否则同帧多 chunk 基于同一快照互相覆盖，
  // msg.content 丢字（复制/自动重命名内容不完整）。
  const current = batch.latestMessages ?? get().messages;
  const msgIdx = current.findIndex((m) => m.id === assistantId);

  if (msgIdx === -1) {
    logger.warn(
      "processChunk: 未找到对应的 assistant 消息（assistantId=%s），跳过 chunk",
      assistantId,
    );
    return;
  }

  const msg = current[msgIdx];
  let updatedMsg: Message;

  if (chunk.type === "thinking") {
    blockBuilder.addThinking(chunk.content, true);
    updatedMsg = { ...msg, blocks: blockBuilder.getBlocks() };
  } else if (chunk.type === "text") {
    blockBuilder.freezeThinking();
    // 先剥离结构化标签再进 blocks/content，确保任何泄漏的 <response>/<think>/<invoke>
    // 片段都不会显示给用户（blocks 渲染与 msg.content 保持一致）
    const cleanContent = stripStructuralTags(chunk.content);
    blockBuilder.addText(cleanContent, true);
    updatedMsg = {
      ...msg,
      content: msg.content + cleanContent,
      blocks: blockBuilder.getBlocks(),
    };
  } else if (chunk.type === "status") {
    blockBuilder.addStatus(chunk.content, chunk.statusType);
    set({ streamingStatus: chunk.content });
    updatedMsg = { ...msg, blocks: blockBuilder.getBlocks() };
  } else if (chunk.type === "reconnect_status") {
    // P2-2: 重连状态提示
    blockBuilder.addStatus(`🔄 ${chunk.content}`);
    set({ streamingStatus: chunk.content });
    updatedMsg = { ...msg, blocks: blockBuilder.getBlocks() };
  } else if (chunk.type === "context_state") {
    // 上下文状态事件：水位监控信息只更新进度条，不渲染进消息内容
    // （修复：原实现把每 1.5s 的高频水位也 addStatus，导致"上下文水位: xx%"污染消息块）
    const watermarkStore = useContextWatermarkStore.getState();
    // 1) 结构化水位（后端首选通道）→ 更新进度条
    if (chunk.watermarkState) {
      watermarkStore.updateWatermark(chunk.watermarkState);
      if (chunk.watermarkState.severity !== "normal") {
        // 异常水位渲染为一次性提示块
        blockBuilder.addStatus(chunk.content);
        set({ streamingStatus: chunk.content });
        updatedMsg = { ...msg, blocks: blockBuilder.getBlocks() };
      } else {
        // normal 水位每 1.5s 高频，仅更新进度条，消息内容不变
        updatedMsg = msg;
      }
    } else {
      // 2) 兼容旧格式: "上下文水位: 85% (170K/200K) | severity:compact | ratio:0.852 | tokens:170000/200000"
      const structured = chunk.content.match(
        /上下文水位:\s*(\d+)%\s*\(?(\d+K?)\/(\d+K?)\)?\s*\|\s*severity:(compact|warn)\s*\|\s*ratio:([\d.]+)\s*\|\s*tokens:(\d+)\/(\d+)/,
      );
      if (structured) {
        watermarkStore.updateWatermark({
          currentTokens: parseInt(structured[6], 10),
          contextLimit: parseInt(structured[7], 10),
          ratio: parseFloat(structured[5]),
          severity: structured[4] as "compact" | "warn",
        });
        updatedMsg = msg;
      } else {
        // 兼容旧格式: "上下文水位: 85%"
        const legacy = chunk.content.match(/上下文水位:\s*(\d+)%/);
        if (legacy) {
          const pct = parseInt(legacy[1], 10);
          const isCompact =
            chunk.content.includes("压缩") || chunk.content.includes("临界");
          watermarkStore.updateWatermark({
            currentTokens: 0,
            contextLimit: 0,
            ratio: pct / 100,
            severity: isCompact ? "compact" : "warn",
          });
          updatedMsg = msg;
        } else {
          // 3) 非水位提示（上下文压缩/召回/降级事件）→ status 块
          blockBuilder.addStatus(chunk.content);
          set({ streamingStatus: chunk.content });
          updatedMsg = { ...msg, blocks: blockBuilder.getBlocks() };
        }
      }
    }
  } else if (chunk.type === "tool_completed") {
    // 工具完成事件：携带结构化 result data 更新对应 toolCall.result
    const tcId = chunk.tool_call_id;
    const resultData = chunk.result_data;
    logger.debug("tool_completed chunk", {
      tcId,
      hasResultData: !!resultData,
      resultDataKeys: resultData ? Object.keys(resultData) : "N/A",
    });
    if (tcId && resultData) {
      blockBuilder.updateToolCallResult(tcId, resultData);
      logger.debug("after updateToolCallResult", {
        blocks: blockBuilder
          .getBlocks()
          .filter((b) => b.type === "tool_call")
          .map((b) => ({
            id: b.toolCall?.id,
            name: b.toolCall?.name,
            hasResult: !!b.toolCall?.result,
          })),
      });
    }
    updatedMsg = { ...msg, blocks: blockBuilder.getBlocks() };
  } else if (chunk.type === "execution_phase" && chunk.executionPhase) {
    // 执行阶段推送：更新 executionPhase 状态 + 生成进度块
    const ep = chunk.executionPhase;
    const progressData: import("../../types").ProgressData = {
      phase:
        (ep.phase as import("../../types").ProgressData["phase"]) ||
        "analyzing",
      progress: ep.progress || 0,
      description: ep.description || "",
      steps: (ep.steps as import("../../types").ProgressData["steps"]) || [],
      totalSteps: ep.totalSteps,
      truncated: ep.truncated,
      currentStep: ep.currentStep || "",
    };
    // 心跳接收日志：截断时 info（默认可见）记录真实计数与保留条数，
    // 与后端 heartbeat:steps 截断 日志对应，排查边界情况
    const receivedSteps = progressData.steps.length;
    if (ep.truncated) {
      logger.info("execution_phase 收到（steps 已截断）", {
        phase: progressData.phase,
        totalSteps: ep.totalSteps ?? receivedSteps,
        keptSteps: receivedSteps,
        droppedSteps: (ep.totalSteps ?? receivedSteps) - receivedSteps,
        progress: ep.progress,
        currentStep: ep.currentStep ?? "",
      });
    } else {
      logger.debug("execution_phase 收到", {
        phase: progressData.phase,
        totalSteps: ep.totalSteps ?? receivedSteps,
        steps: receivedSteps,
        progress: ep.progress,
        currentStep: ep.currentStep ?? "",
      });
    }
    set({
      executionPhase: {
        phase: progressData.phase,
        progress: progressData.progress,
        description: progressData.description,
      },
    });
    blockBuilder.addProgress(progressData);
    updatedMsg = { ...msg, blocks: blockBuilder.getBlocks() };
  } else if (chunk.type === "error") {
    // P1 修复（AB-3）：错误去重——后端 catch 会先发带真实消息的 error chunk，
    // 随后 done 块 finish_reason:'error' 会再解析出一个 fallback error chunk
    // （"流式响应出错"）。已有错误状态时仅补充 errorCode，不重复追加状态块/覆盖错误文本。
    if (get().error) {
      set({ errorCode: chunk.errorCode || "UNKNOWN" });
      updatedMsg = msg;
    } else {
      // 将错误信息显示在聊天界面中
      // P1 修复（1.5）：错误信息可读化——状态块显示映射后的可读提示
      // （如 SSL 证书失败/连接失败/模型不存在 → 中文操作指引），
      // msg.content 仍保留原始错误文本供排查
      blockBuilder.addStatus(`❌ ${friendlyErrorSummary(chunk.content)}`);
      updatedMsg = {
        ...msg,
        content: msg.content + stripStructuralTags(chunk.content),
        blocks: blockBuilder.getBlocks(),
      };
      set({
        error: chunk.content,
        errorCode: chunk.errorCode || "UNKNOWN",
      });
    }
  } else if (chunk.type === "tool_call" && chunk.toolCall) {
    // 实时转换：todo_write 的 tool_call 直接转 todo block，不等流结束
    let skipDefault = false;
    if (chunk.toolCall.name === "todo_write") {
      const args = chunk.toolCall.arguments as
        Record<string, unknown> | undefined;
      if (args?.action === "write" && args?.todos) {
        const todos = Array.isArray(args.todos)
          ? (args.todos as Array<Record<string, unknown>>)
          : [];
        const tasks = todos.map((t, idx) => ({
          id: String(t.id || idx + 1),
          name: String(t.name || t.content || `步骤 ${idx + 1}`),
          status:
            (t.status as import("../../types").TaskCardTask["status"]) ||
            "pending",
          dependsOn: (t.dependsOn as string[]) || [],
        }));
        const title = String(
          args?.title ||
            (typeof args?.description === "string" ? args.description : "") ||
            `任务 (${todos.length} 步)`,
        );
        blockBuilder.addTodo({ title, tasks, status: "planning" });
        skipDefault = true;
      } else if (args?.action === "update") {
        // 实时更新单个任务状态：从 tool_call 参数中提取变更并应用到 todo block
        // T1 修复：工具 schema（TodoWriteTool.params）定义的是 todo_id，
        // 原实现读 todoId 取到空串 → updateTodoTask("") 静默 no-op，任务卡永远停在"等待中"
        const taskId = String(args.todo_id ?? args.todoId ?? args.id ?? "");
        if (taskId) {
          const updates: Partial<{
            status: import("../../types").TaskCardTask["status"];
            result: string;
            durationMs: number;
          }> = {};
          if (args.status)
            updates.status =
              args.status as import("../../types").TaskCardTask["status"];
          if (args.result) updates.result = args.result as string;
          if (args.durationMs) updates.durationMs = args.durationMs as number;
          blockBuilder.updateTodoTask(taskId, updates);
        }
        skipDefault = true;
      }
    }
    // ask_user_question 的 tool_call：跳过默认 tool_call 渲染块，
    // 稍后将由 question 类型 chunk 渲染 QuestionBlock
    if (chunk.toolCall.name === "ask_user_question") {
      skipDefault = true;
    }
    if (!skipDefault) {
      blockBuilder.addToolCall(chunk.toolCall);
    }

    // 文件路径收集已移至流结束后的 addFilePathsFromBlocks 统一处理
    // 避免流式传输中同步 setState 导致无限重渲染

    updatedMsg = { ...msg, blocks: blockBuilder.getBlocks() };

    // 关键节点即时落盘：tool_call 完成时立即持久化 blocks
    // 防止切换会话时该 tool_call 结果丢失（方案 C）
    if (
      chunk.toolCall.status === "completed" ||
      chunk.toolCall.status === "failed"
    ) {
      if (sessionId) {
        // 排查写前持久化：tool_call 终态即时落盘，确认 blocks 不丢失
        logger.info("processChunk: tool_call 终态即时落盘", {
          sessionId,
          toolName: chunk.toolCall.name,
          toolCallId: chunk.toolCall.id,
          status: chunk.toolCall.status,
          blockCount: blockBuilder.getBlocks().length,
        });
        saveQueue.enqueue(
          sessionId,
          assistantId,
          blockBuilder.getBlocks(),
          true,
        );
      }
    }

    // _meta 导航建议：create_project 完成后触发前端提示
    if (chunk._meta?.action === "suggest_navigate") {
      window.dispatchEvent(
        new CustomEvent("pyapp:navigate-suggest", {
          detail: chunk._meta,
        }),
      );
    }
  } else if (chunk.type === "question" && chunk.questionData) {
    logger.debug("收到 question chunk", {
      questionId: chunk.questionData.questionId,
      q: chunk.questionData.question?.slice(0, 40),
      optCnt: chunk.questionData.options?.length,
      blocksBefore: blockBuilder.getBlocks().length,
    });
    blockBuilder.addQuestion(chunk.questionData);
    const newBlocks = blockBuilder.getBlocks();
    logger.debug("addQuestion 后 block count: " + newBlocks.length, {
      questionBlocks: newBlocks.filter((b) => b.type === "question").length,
    });
    updatedMsg = { ...msg, blocks: newBlocks };
    // P2-3: 按会话记录 pending question，多会话并行互不覆盖
    if (!get().hasPendingQuestion[sid]) {
      set({
        hasPendingQuestion: {
          ...get().hasPendingQuestion,
          [sid]: true,
        },
      });
    }
    // 需要用户关注时播放警示音
    playWarningSound();
  } else if (chunk.type === "todo" && chunk.todoData) {
    blockBuilder.addTodo(chunk.todoData);
    updatedMsg = { ...msg, blocks: blockBuilder.getBlocks() };
  } else if (chunk.type === "usage") {
    // L5: 检测截断信号 finishReason='length'（修复 BUG #10）
    if (chunk.finishReason === "length") {
      const truncatedSuffix =
        "\n\n> ⚠️ **AI 输出已被截断**（max_tokens 限制），请考虑分步提问或增大 max_tokens 设置。";
      blockBuilder.addText(truncatedSuffix, false);
      // 关键节点即时落盘：截断时立即持久化，确保截断前的 blocks 不丢失（方案 C）
      if (sessionId) {
        saveQueue.enqueue(
          sessionId,
          assistantId,
          blockBuilder.getBlocks(),
          true,
        );
      }
    }
    // 仅当 chunk.usage 非空时更新 usage，避免 standalone finish_reason 覆盖已有数据（BUG #10 L2）
    const usageUpdate = chunk.usage ? { usage: chunk.usage } : {};
    updatedMsg = {
      ...msg,
      ...usageUpdate,
      blocks: blockBuilder.getBlocks(),
    };

    // P0 增强：自动建项目后触发前端导航提示（_meta 在 usage 块中）
    if (chunk._meta?.action === "suggest_navigate") {
      window.dispatchEvent(
        new CustomEvent("pyapp:navigate-suggest", {
          detail: chunk._meta,
        }),
      );
    }
  } else {
    updatedMsg = msg;
  }

  const newMessages = [...current];
  newMessages[msgIdx] = updatedMsg;
  batch.latestMessages = newMessages;

  // J4：批量更新——仅在无挂起 flush 时调度微任务
  if (!batch.pending) {
    batch.pending = true;
    Promise.resolve()
      .then(() => requestAnimationFrame(() => flushSet(++batch.version)))
      .catch(() => {
        /* flushSet 异常不阻塞后续更新 */
      });
  }

  // J3：流式传输中实时防抖保存 blocks，使用闭包内局部变量避免竞态
  if (sessionId && updatedMsg.blocks && updatedMsg.blocks.length > 0) {
    // 会话切换锁：setMessages 期间暂存流式 chunk，避免覆盖
    if (switchState.lock) {
      switchState.pending.push({
        sessionId,
        assistantId,
        blocks: updatedMsg.blocks,
      });
    } else {
      saveQueue.enqueue(sessionId, assistantId, updatedMsg.blocks);
    }
  }
}
