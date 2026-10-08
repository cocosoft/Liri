// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * ChatRequestPrep —— 请求构建 / 快照 / 压缩（ChatManager 拆分批 A1）
 *
 * **来源**：提取自 `ChatManager.ts` 的 C14 簇（D-01/D-03 文件规模债拆分）；
 * 方案与依赖验证见 `.trae/specs/file-size-debt-partition-plan.md` §9.3。
 *
 * **职责（单一）**：
 *   ① 模型输入快照（`context/model-input`）落盘入口 + 工具清单快照（TR-12-B）
 *   ② `ToolSchema[]` → OpenAI 兼容 `ToolDefinition[]`（含 wire 安全名转换）
 *   ③ 用户消息中的绝对文件路径提取（仅保留用户数据目录内）
 *   ④ API 消息 sanitize / 上下文截断 / 工具历史压缩（委托 `MessageContextPipeline`）
 *   ⑤ 消息数组 token 近似估算（逐字段 O(1)，不构造完整 JSON 字符串）
 *
 * **日志 module 名保持不变**：拆分不改变日志口径（行为等价）。
 *
 * **注入依赖**（`ChatRequestPrepDeps`，全 getter ⇒ 无字段初始化顺序陷阱）：
 * 跨簇共享状态（事件日志访问器 / 会话投影 / 压缩统计器 / 工具轮次）仍归宿主
 * `ChatManager` 所有，经 getter 访问 ⇒ 无反向依赖、无环。
 */

import fs from 'fs';
import path from 'path';
import type { EventLogStorage } from '@modules/session';
import type { ChatSession } from '@modules/session/types/session.js';
import { ContextTracker } from '@modules/query';
import { resolveProjectRoot, resolvePyappHome } from '@modules/core/paths';
import type { ToolSchema } from '@modules/tools';
import { buildToolDefinitions as buildToolDefinitionsFromSchemas } from '@modules/tools';
import type { ToolDefinition } from '@modules/ai';
import {
  RequestSnapshotService,
  type ModelInputSnapshot,
} from '../services/RequestSnapshotService';
import {
  sanitizeApiMessages,
  compressToolHistory,
  truncateApiMessages,
} from '../services/MessageContextPipeline';

/** 本模块所需的注入依赖（跨簇共享状态仍归宿主 `ChatManager` 所有，经 getter 访问） */
export interface ChatRequestPrepDeps {
  /** 宿主的事件日志访问器（快照服务必须复用同一 per-session 实例，禁止自建） */
  getOrCreateEventLog: (sessionId: string) => EventLogStorage;
  /** 宿主会话投影（`truncateApiMessages` 需要） */
  getChatSessions: () => Map<string, ChatSession>;
  /** 压缩统计记录器（宿主持有） */
  getContextTracker: () => ContextTracker;
  /** 当前工具轮次（压缩统计用） */
  getToolRound: (sessionId: string) => number;
}

export class ChatRequestPrep {
  /**
   * TR-12-B（2026-09-22）：模型输入快照服务（惰性单例，绑定宿主的 per-session 事件日志）。
   *
   * 复用宿主的事件日志访问器（**禁止自建**，避免 tailSeq 分裂）。
   */
  private _requestSnapshot?: RequestSnapshotService;

  constructor(private readonly deps: ChatRequestPrepDeps) {}

  private get requestSnapshot(): RequestSnapshotService {
    this._requestSnapshot ??= new RequestSnapshotService((sid) =>
      this.deps.getOrCreateEventLog(sid)
    );
    return this._requestSnapshot;
  }

  /**
   * TR-12-B：落一条模型输入快照（工具清单 / 系统提示词分段，引用式去重）。
   *
   * 失败不阻断主路径（服务内仅 warn）；调用方按需 await。
   */
  recordModelInputSnapshot(
    sessionId: string,
    input: ModelInputSnapshot
  ): Promise<void> {
    return this.requestSnapshot.record(sessionId, input);
  }

  /** TR-12-B：工具清单快照（3 个装配点的统一出口） */
  recordToolsSnapshot(sessionId: string, schemas: ToolSchema[]): void {
    void this.recordModelInputSnapshot(sessionId, { tools: schemas });
  }

  /**
   * 从用户消息文本中提取绝对文件路径
   * 支持 Markdown 链接格式 [文件名](绝对路径) 和行内绝对路径
   * 仅返回存在于磁盘上且属于用户数据目录（attachments/output/downloads）的路径
   */
  extractFilePathsFromText(text: string): string[] {
    const paths: string[] = [];
    if (!text || typeof text !== 'string') return paths;

    // 匹配 Markdown 链接: [name](path)
    const mdLinkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
    let match: RegExpExecArray | null;
    while ((match = mdLinkRegex.exec(text)) !== null) {
      const rawPath = match[2];
      if (path.isAbsolute(rawPath) && fs.existsSync(rawPath)) {
        paths.push(rawPath);
      }
    }

    // 匹配行内的绝对 Windows 路径（E:\... 或 C:\...）
    const absPathRegex = /([A-Za-z]:\\[^\s)\]]+)/g;
    while ((match = absPathRegex.exec(text)) !== null) {
      const rawPath = match[1];
      if (fs.existsSync(rawPath) && !paths.includes(rawPath)) {
        paths.push(rawPath);
      }
    }

    // 仅保留用户数据目录下的路径，避免注册系统路径
    const pyappHome = resolvePyappHome();
    const projectRoot = resolveProjectRoot();
    return paths.filter(
      (p) => p.startsWith(pyappHome) || p.startsWith(projectRoot)
    );
  }

  /**
   * 清理 API 消息列表中的孤立 tool_calls 和 tool 消息。
   *
   * DeepSeek API 要求：每个 assistant 含 tool_calls 之后，
   * 紧随其后的 tool 消息必须响应其所有 tool_call_id，
   * 中间不能插入非 tool 消息。
   *
   * 此方法从后往前遍历所有 assistant 含 tool_calls，
   * 逐条检查紧随其后的 tool 消息是否全部响应。
   */
  sanitizeApiMessages(apiMessages: Record<string, unknown>[]): void {
    sanitizeApiMessages(apiMessages);
  }

  /**
   * 将 ToolSchema[] 转换为 OpenAI 兼容的 ToolDefinition[]
   *
   * 2026-10-08：实现**外移**到 `tools/toolNameCodec.ts`（单一事实源）—— 原实现只在本类内，
   * LRTO 步骤路径无法复用 ⇒ 步骤拿不到工具定义（"步骤 0 工具调用"缺陷的成因之一）。
   * 本方法保留为薄委托，行为不变。
   */
  buildToolDefinitions(schemas: ToolSchema[]): ToolDefinition[] {
    return buildToolDefinitionsFromSchemas(schemas);
  }

  /**
   * 上下文长度保护（委托给 MessageContextPipeline）
   * 压缩失败或压缩不足时退化为截断旧消息（保留 system prompt + 最近 N 条消息）。
   * 截断后重新 sanitize 以修复 tool/tool_calls 配对完整性。
   *
   * @param apiMessages - 待发送的消息列表（会被原地修改）
   * @param maxContextTokens - 模型上下文窗口上限（如 1_000_000），
   *       如果传入 0 或负数，则跳过滤检
   */
  async truncateApiMessages(
    apiMessages: Record<string, unknown>[],
    maxContextTokens: number,
    sessionId?: string,
    outputBudgetTokens?: number
  ): Promise<void> {
    await truncateApiMessages(
      apiMessages,
      maxContextTokens,
      this.deps.getChatSessions(),
      sessionId,
      outputBudgetTokens
    );
  }

  /**
   * 压缩工具循环历史消息（委托给 MessageContextPipeline）
   */
  async compressToolHistory(
    currentRoundMessages: Record<string, unknown>[],
    sessionId: string,
    assistantMsg: Record<string, unknown>,
    toolResults: Record<string, unknown>[]
  ): Promise<Record<string, unknown>[]> {
    const beforeTokens = await this.estimateArrayTokens(currentRoundMessages);

    const result = compressToolHistory(
      currentRoundMessages,
      sessionId,
      assistantMsg,
      toolResults
    );

    const afterTokens = await this.estimateArrayTokens(result);

    this.deps.getContextTracker().record({
      timestamp: Date.now(),
      turnCount: this.deps.getToolRound(sessionId),
      engineName: 'default',
      beforeTokens,
      afterTokens,
      compressionRatio: beforeTokens > 0 ? afterTokens / beforeTokens : 1,
      messageCountBefore: currentRoundMessages.length,
      messageCountAfter: result.length,
      hasFocusTopic: false,
    });

    return result;
  }

  /**
   * 估算消息数组的 token 数（流式近似估算）
   *
   * 2026-08-24 优化：原实现 JSON.stringify(messages).length / 4 会对超大消息数组
   * 做同步全量序列化——字符串拼接 + 转义开销大，压缩边界单次可达数百 ms~秒级，
   * 阻塞事件循环（心跳/SSE 全停，触发"流式响应超时"）。
   * 现改为逐字段近似累加：
   *   1. 不构造完整 JSON 字符串，峰值内存从 O(总量) 降为 O(1)
   *   2. 每 1000 条让出一次事件循环（setImmediate），长数组不阻塞
   * 近似模型与 JSON 序列化长度线性相关（键名 + 固定开销 + 值长度），/4 取 token，
   * 压缩触发阈值行为与之前一致。
   */
  async estimateArrayTokens(
    messages: Record<string, unknown>[]
  ): Promise<number> {
    let totalChars = 0;
    let processed = 0;
    for (const msg of messages) {
      // 每 1000 条让出事件循环，避免长数组同步遍历阻塞（心跳/SSE 停更）
      if (++processed % 1000 === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      totalChars += this.approxJsonLength(msg);
    }
    return Math.max(1, Math.ceil(totalChars / 4));
  }

  /**
   * 近似 JSON 序列化长度（不构造字符串，逐字段 O(1) 累加）
   */
  private approxJsonLength(value: unknown): number {
    if (value === null || value === undefined) return 4; // null / undefined
    switch (typeof value) {
      case 'string':
        return value.length + 2; // 引号
      case 'number':
        return String(value).length;
      case 'boolean':
        return value ? 4 : 5; // true / false
      case 'object': {
        if (Array.isArray(value)) {
          let len = 2; // []
          for (const item of value) len += this.approxJsonLength(item) + 1; // 逗号
          return len;
        }
        let len = 2; // {}
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          len += k.length + 4 + this.approxJsonLength(v); // 键 + 引号/冒号/逗号
        }
        return len;
      }
      default:
        return 4; // function/symbol 等（JSON.stringify 会省略）
    }
  }
}
