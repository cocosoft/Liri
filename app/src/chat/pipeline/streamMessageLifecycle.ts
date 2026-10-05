// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * ChatStreamMessageLifecycle —— 流式请求的**消息构建**（ChatManager 拆分批 A5a）
 *
 * **来源**：提取自 `ChatManager.ts`（D-01/D-03 文件规模债拆分）；
 * 方案见 `.trae/specs/file-size-debt-partition-plan.md` §9.3 / §15。
 *
 * **职责（单一：把会话消息组装成"发给 LLM 的请求消息"）**：
 *   ① `buildApiMessagesForStream`：`session.messages` → API 格式消息（含 map 前置预算切窗、
 *      工具结果截断、tool_call_id 补全、跨轮 `tool_calls` 清理、取回提示注入）
 *   ② `buildToolRoundMessages`：工具轮次的下一轮请求消息（含产出型写入收敛提示）
 *   ③ `dedupeToolResultForStub`：同会话同工具同参数的大结果去重 stub（缓解上下文膨胀）
 *
 * **⚠️ 批次说明（2026-10-05）**：A5 原含 4 成员（消息构建 + 会话准备 + 管道创建 + 终态收口）。
 * 经依赖取证，后三者为**重度宿主耦合**（`_prepareStreamSession` 触及 securityService /
 * sessionLifecycle / mutex / checkpoint / hookChainManager；`_finalizeStreamMessage` 触及
 * PDCA / ImplicitEngineHook / memoryManager 等 15+ 依赖）⇒ 按「降低 blast radius」拆为
 * **A5a（本模块 = 消息构建）** 与 **A5b（其余三成员，后续批次）**；
 * 另按 §11 约定，A2 移交的 `_buildToolRoundMessages` / `_dedupeToolResultForStub` **并入本批**。
 *
 * **日志 module 名保持不变**：仍为 `chat:manager`（行为等价）。
 *
 * **注入依赖**（`ChatStreamMessageLifecycleDeps`，全 getter/setter ⇒ 无初始化顺序陷阱）：
 * 切窗标记与当前会话 ID 仍归宿主所有（被 `streamMessageFlow` / 事件日志 store 读取）。
 */

import { getLogger, getMemoryPressureMonitor } from '@modules/monitoring';
import { yieldToEventLoop } from '@modules/ai';
import type { ParsedToolCall } from '@modules/ai';
import { memProfile } from '../../monitoring/memProfile.js';
import type { Message } from '@modules/session/types/message.js';
import type { ToolCall, ToolResult } from '@modules/session/types/tool.js';
import {
  computePaginationPoint,
  contextLayeringEnabled,
  isCodeContextMessage,
  LAYERING_HINT,
  LAYERING_HINT_CODE,
} from '../services/MessageContextPipeline';
import {
  isEmptyAssistantWithoutToolCalls,
  toToolResultRawText,
  TOOL_RESULT_MAX_LENGTH,
  truncateToolResult,
} from '../services/ChatHelper';

const logger = getLogger('chat:manager');

// R1（2026-09-06，走查 W1/W9）：产出型写入工具集合（成功即视为"已交付文件产物"）
const _WRITE_PRODUCTIVE_TOOLS = new Set([
  'file_write',
  'write_file',
  'FileWriteTool',
  'file_edit',
  'edit_file',
  'FileEditTool',
]);

// R1：产出后的收敛引导（system 注入，防"写完继续埋头思考不总结"）
const _WRITE_CONCLUDE_HINT =
  '[交付收敛] 本轮已完成文件产出（见上方工具结果），这是本次实际交付物。' +
  '请直接在回复中给出简短交付说明（文件位置、用途、如何运行/验证）并结束本轮；' +
  '不要在没有新需求的情况下继续内部扩展或重写。如需进一步完善，请先说明下一步再继续。';

/** 本模块所需的注入依赖（跨簇共享状态仍归宿主 `ChatManager` 所有，经 getter/setter 访问） */
export interface ChatStreamMessageLifecycleDeps {
  /** 宿主"最近一次流式构建是否发生切窗"标记（`streamMessageFlow` 读取） */
  setLastStreamBuildWindowed: (value: boolean) => void;
  /** 宿主"是否代码/长文档上下文"标记（事件日志 store 读取） */
  setLastStreamBuildCodeContext: (value: boolean) => void;
  /** 读取上一标记（本模块内决定取回提示的强弱） */
  getLastStreamBuildCodeContext: () => boolean;
  /** 当前会话 ID（stub 去重 key 须按会话隔离） */
  getCurrentSessionId: () => string | null;
}

export class ChatStreamMessageLifecycle {
  /** P0-2：工具结果去重 stub 缓存——key: sessionId:toolName:参数归一化 → {hash, stubCount} */
  private readonly _toolResultStubCache = new Map<
    string,
    { hash: number; stubCount: number }
  >();

  constructor(private readonly deps: ChatStreamMessageLifecycleDeps) {}

  /**
   * P2-3.5: 将 session.messages 转换为 API 格式消息列表
   *
   * 提取自 streamMessage，处理工具结果截断、tool_call_id 补全、
   * 跨轮 tool_calls 清理等纯数据转换逻辑。
   */
  async buildApiMessagesForStream(
    messages: Message[],
    maxContextTokens?: number,
    outputBudgetTokens?: number
  ): Promise<Array<Record<string, unknown>>> {
    // 内存画像（MEM_PROFILE=1）：上下文构建前采样——定位构建期瞬时大分配
    //（排查 agentic 运行期 RSS 2-4.4GB 尖峰与 GC STW，证据见监控 memProfile:*）
    memProfile('stream-build:pre', { totalMessages: messages.length });
    // 内存水位 tick（请求边界驱动；正常路径零日志，仅级别变化时动作）
    getMemoryPressureMonitor().tick();
    // C-2（2026-09-02，v4 §7.2）：map 前置预算切窗——超窗大会话先丢头部旧轮次，
    // 使下方 filter/map/stringify 只处理幸存窗口，构建期内存 O(全量)→O(窗口)。
    // 语义不变：预算/尾保护区与 truncateApiMessages 同口径；最终输入仍由
    // compactContext/truncate 决定（对本窗口大概率早退）。仅当构建方传入预算时启用。
    let windowed = messages;
    let cutIndex = 0;
    if (maxContextTokens && maxContextTokens > 0 && messages.length > 2) {
      const point = await computePaginationPoint(
        messages as Array<{ role: string; content: unknown }>,
        maxContextTokens,
        outputBudgetTokens
      );
      cutIndex = point.cutIndex;
      if (cutIndex > 0) {
        windowed = messages.slice(cutIndex);
        // C 阶段（P1）：标记本次构建发生切窗，供 streamMessageFlow 注入 session_lookup
        this.deps.setLastStreamBuildWindowed(true);
        // D5②（2026-09-02）：代码/长文档任务 + 切窗 → 取回增强（更强提示 + session_lookup 加大页）
        this.deps.setLastStreamBuildCodeContext(isCodeContextMessage(messages));
        logger.info('stream:build 分页切点生效（C 阶段）', {
          totalMessages: messages.length,
          cutIndex,
          keptMessages: windowed.length,
          codeContext: this.deps.getLastStreamBuildCodeContext(),
        });
      } else {
        this.deps.setLastStreamBuildWindowed(false);
        this.deps.setLastStreamBuildCodeContext(false);
      }
    } else {
      this.deps.setLastStreamBuildWindowed(false);
      this.deps.setLastStreamBuildCodeContext(false);
    }
    // §5.3: 排除 isTaskMessage 消息（任务摘要仅用户可见，不进入 LLM 上下文，避免污染）
    // 2026-08-19 根因①修复：filter/map 改为分批 for 循环 + 让出事件循环，
    // 避免大会话（数百条/大 JSON 序列化）同步构建阻塞事件循环数秒
    const apiMessages: Array<Record<string, unknown>> = [];
    let builtCount = 0;
    for (const msg of windowed) {
      if (msg.metadata?.isTaskMessage === true) continue;
      // 空正文且无 tool_calls 的 assistant 消息跳过（工具循环中间空消息，避免污染上下文）
      if (isEmptyAssistantWithoutToolCalls(msg)) continue;

      let content =
        typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content);

      if (
        msg.role === 'tool' &&
        typeof content === 'string' &&
        content.length > TOOL_RESULT_MAX_LENGTH
      ) {
        content = truncateToolResult(content);
      }

      const chatMessage: Record<string, unknown> = {
        role: msg.role,
        content,
      };

      if (msg.role === 'tool') {
        const tcId =
          msg.toolCallId ||
          (msg.metadata?.toolCallId as string) ||
          (msg.metadata?.tool_call_id as string);
        if (tcId) {
          chatMessage.tool_call_id = tcId;
        }
      }

      if (msg.role === 'assistant' && msg.metadata?.tool_calls) {
        const toolCalls = msg.metadata.tool_calls as Record<string, unknown>[];
        chatMessage.tool_calls = toolCalls.map(
          (tc: Record<string, unknown>) => {
            if (tc.type && tc.function) {
              return tc;
            }
            return {
              id: tc.id,
              type: 'function',
              function: {
                name: tc.name,
                arguments:
                  typeof tc.arguments === 'string'
                    ? tc.arguments
                    : JSON.stringify(tc.arguments || {}),
              },
            };
          }
        );
      }

      apiMessages.push(chatMessage);
      builtCount++;
      if (builtCount % 25 === 0) {
        await yieldToEventLoop();
      }
    }

    // 防止跨轮 tool_calls 污染
    let lastUserMsgIdx = -1;
    for (let i = apiMessages.length - 1; i >= 0; i--) {
      if (apiMessages[i].role === 'user') {
        lastUserMsgIdx = i;
        break;
      }
    }
    // 日志刷屏修复（2026-08-14 排查）：与 sendMessageFlow 同款——循环内逐条 info
    // 改为计数后单条 debug 汇总（历史 100+ 条时每轮刷屏 100+ 行）
    let cleanedToolCallCount = 0;
    for (let i = 0; i < lastUserMsgIdx; i++) {
      const msg = apiMessages[i];
      if (msg.role === 'assistant' && msg.tool_calls) {
        delete msg.tool_calls;
        cleanedToolCallCount++;
      }
    }
    if (cleanedToolCallCount > 0) {
      logger.debug('清除旧轮次 assistant tool_calls，防止跨轮污染', {
        cleanedCount: cleanedToolCallCount,
      });
    }

    // P2-a（2026-09-02，C 详设 §5.2）：切窗生效 → 保留段首条 user 注入"可取回"提示
    if (cutIndex > 0 && contextLayeringEnabled()) {
      const firstUser = apiMessages.find(
        (m) => m.role === 'user' && typeof m.content === 'string'
      );
      if (firstUser) {
        // D5②（2026-09-02）：代码/长文档会话用更强取回提示（代码原文可按区间原样取回）
        const hint = this.deps.getLastStreamBuildCodeContext()
          ? LAYERING_HINT_CODE
          : LAYERING_HINT;
        firstUser.content = `${hint}\n${firstUser.content}`;
      }
    }

    // 内存画像（MEM_PROFILE=1）：构建完成采样（apiMessages 峰值驻留）
    memProfile('stream-build:post', { apiMessagesCount: apiMessages.length });
    return apiMessages;
  }

  /**
   * P1-2: 构建工具轮次的 LLM 请求消息（纯数据，无 yield，无 this 副作用）
   * 从 streamMessage 工具循环提取，降低巨型方法复杂度
   */
  buildToolRoundMessages(
    currentMessages: Record<string, unknown>[],
    currentAssistantMsg: Message,
    currentToolCalls: ParsedToolCall[],
    processedResults: Array<{
      normalizedToolCall: ToolCall;
      result: ToolResult;
    }>
  ): Record<string, unknown>[] {
    // P2-3（2026-09-02）：诊断日志——确认工具结果是否真正拼入下一轮请求
    logger.info('reactToolLoop:_buildToolRoundMessages', {
      currentMessages: currentMessages.length,
      toolCalls: currentToolCalls.length,
      processedResults: processedResults.length,
      assistantMsgContentLength:
        typeof currentAssistantMsg.content === 'string'
          ? currentAssistantMsg.content.length
          : -1,
      resultChars: processedResults.map((pr) => {
        // 空值判定收敛到 ChatHelper.toToolResultRawText（原 truthiness 会把 ''/0/false 误判为无载荷）
        const raw = toToolResultRawText(pr.result.result, pr.result.error);
        return { id: pr.normalizedToolCall.id, chars: raw.length };
      }),
    });
    const built: Record<string, unknown>[] = [
      ...currentMessages,
      {
        role: 'assistant',
        content:
          typeof currentAssistantMsg.content === 'string'
            ? currentAssistantMsg.content
            : null,
        tool_calls: currentToolCalls.map((tc: ParsedToolCall) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments:
              typeof tc.arguments === 'string'
                ? tc.arguments
                : JSON.stringify(tc.arguments || {}),
          },
        })),
      },
      ...processedResults.map((pr) => {
        // 空值判定收敛到 ChatHelper.toToolResultRawText（与上方诊断日志共用同一实现）
        const raw = toToolResultRawText(pr.result.result, pr.result.error);
        // P0-2（2026-09-02，对标 hermes observe_call 结果 stub）：同会话同工具同参数
        // 的大结果（≥1024 字符）重复时替换为引用 stub——缓解上下文膨胀（实测工具循环
        // 输入 token 44 万，大量为重复的 web_fetch/grep 全文）。落盘消息保留完整内容，
        // 仅发送给 LLM 的请求消息被 stub（持久化/轨迹不受影响）。
        const stub = this.dedupeToolResultForStub(
          pr.normalizedToolCall.name,
          pr.normalizedToolCall.arguments,
          raw
        );
        return {
          role: 'tool' as const,
          content: stub ?? raw,
          tool_call_id: pr.normalizedToolCall.id,
        };
      }),
    ];
    // R1（2026-09-06，走查 W1/W9）：本轮含【产出型写入工具】成功（无 error）→ 注入
    // 收敛提示，防"文件已写完却继续埋头思考、迟迟不交付确认"（超级玛丽走查实证：HTML
    // 早落盘，模型 20+ 分钟不总结，用户三次催"挂了吗/请继续"）。
    const hasSuccessfulWrite = processedResults.some(
      (pr) =>
        _WRITE_PRODUCTIVE_TOOLS.has(pr.normalizedToolCall.name) &&
        !pr.result.error
    );
    if (hasSuccessfulWrite) {
      logger.info('reactToolLoop:write_done_should_conclude', {
        tools: processedResults
          .filter((pr) =>
            _WRITE_PRODUCTIVE_TOOLS.has(pr.normalizedToolCall.name)
          )
          .map((pr) => pr.normalizedToolCall.name),
      });
      built.push({
        role: 'system' as const,
        content: _WRITE_CONCLUDE_HINT,
      });
    }
    return built;
  }

  /**
   * P0-2（2026-09-02）P2-修复（2026-09-02）：大工具结果去重 stub。
   * 首次/内容变化返回 null（正常全文）；同会话同工具同参数内容未变化 → 返回引用 stub。
   * 仅对 ≥1024 字符的大结果生效（小结果省不了多少 token，避免误 stub 语义）。
   *
   * P2-修复（死循环根因，实测 session_mtjihry4f5u2nzyb8k）：
   * 原 stub 文案"若无法引用（如结果已被压缩），请重新调用该工具获取完整结果"直接
   * 驱动工具死循环：模型（deepseek-v4-flash）按指引重调同一工具 → 又命中同一 stub →
   * 循环守卫 3 轮熔断 → "工具循环无实质进展，任务已结束"。修复：
   * 1. stub 文案不再引导重调：明确结果已在上文上下文、直接使用、不要重复调用；
   *    如确需分段查看，改用 offset/limit 读取不同行段（结果不同、不触发去重）。
   * 2. 同一内容连续出现只 stub 一次：第 3 次起返回全文（模型可能因压缩/窗口丢失
   *    上文，必须给真实内容才能打破循环；循环守卫仍兜底 3 轮熔断，防 token 膨胀）。
   * 3. `_currentSessionId` 为空时禁用 stub：避免 key 退化为全局（:tool:args）
   *    导致跨会话首次读取同一文件即被误 stub。
   */
  private dedupeToolResultForStub(
    toolName: string,
    args: unknown,
    content: string
  ): string | null {
    if (content.length < 1024) return null;
    // P2：会话 id 缺失时禁用 stub（防 key 退化为全局、跨会话污染）
    const currentSessionId = this.deps.getCurrentSessionId();
    if (!currentSessionId) return null;
    let argsKey: string;
    try {
      const j = JSON.stringify(args ?? {});
      argsKey = j.length > 500 ? j.slice(0, 500) : j;
    } catch {
      argsKey = '';
    }
    const key = `${currentSessionId}:${toolName}:${argsKey}`;
    let h = 5381;
    for (let i = 0; i < content.length; i++) {
      h = ((h << 5) + h + content.charCodeAt(i)) | 0;
    }
    const hash = h >>> 0;
    const prev = this._toolResultStubCache.get(key);
    if (!prev || prev.hash !== hash) {
      // 首次出现 / 内容变化：重置计数，返回全文
      this._toolResultStubCache.set(key, { hash, stubCount: 1 });
      return null;
    }
    prev.stubCount++;
    if (prev.stubCount >= 3) {
      // P2：连续第 3 次相同 → 返回全文（模型可能无法引用上文，需真实内容打破循环）
      return null;
    }
    return `[工具结果与上一轮调用完全相同（${content.length} 字符，此处省略以节省上下文）。该结果已在上文上下文中，请直接基于已有内容继续分析，不要重复调用同一工具；如需按段查看内容，请改用 file_read 的 offset/limit 参数读取不同行段。]`;
  }
}
