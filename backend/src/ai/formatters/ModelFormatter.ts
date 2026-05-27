/**
 * ModelFormatter 模型消息格式化器抽象基类
 * 对标 AgentScope formatter/ 模块
 *
 * 不同 LLM API 的消息格式存在差异：
 * - OpenAI: system 在 messages[0]，content 可为 string 或 ContentBlock[]
 * - Anthropic: system 在顶层参数，content 为 content blocks
 * - Gemini: contents[] 结构，system_instruction 独立
 * - DeepSeek: 类 OpenAI，但 FIM (Fill-in-the-Middle) 有额外参数
 *
 * ModelFormatter 提供统一的 formatMessages/parseResponse 抽象，
 * 业务代码只需处理标准格式，由注册器按模型名自动路由到对应格式化器。
 */

import type { ChatMessage, ChatResponse, ToolDefinition } from '../models/types';

/**
 * 格式化上下文
 */
export interface FormatContext {
  /** 系统提示词（部分 API 需要独立传递） */
  systemPrompt?: string;
  /** 模型名称 */
  model?: string;
  /** 额外参数透传 */
  extra?: Record<string, unknown>;
}

/**
 * 格式化结果
 * 不同 API 的请求体结构不同，因此返回 unknown 由具体调用方处理
 */
export interface FormatResult {
  /** 格式化后的消息 */
  messages: unknown[];
  /** 顶层参数中单独传递的 system prompt（如 Anthropic） */
  system?: string;
  /** 额外参数 */
  extra?: Record<string, unknown>;
}

/**
 * 模型格式化器抽象基类
 */
export abstract class ModelFormatter {
  /** 适用模型名称前缀列表（为空表示通用） */
  abstract readonly supportedModels: string[];

  /**
   * 将统一格式的消息列表转换为 API 特定格式
   * @param messages 统一格式消息
   * @param context 格式化上下文
   * @returns 格式化结果
   */
  abstract formatMessages(
    messages: ChatMessage[],
    context?: FormatContext
  ): FormatResult;

  /**
   * 将 API 原始响应解析为统一 ChatResponse 格式
   * @param rawResponse API 原始响应的 JSON 对象
   * @returns 统一格式响应
   */
  abstract parseResponse(rawResponse: Record<string, unknown>): ChatResponse;

  /**
   * 将统一工具定义转换为 API 特定格式
   * @param tools 统一工具定义
   * @returns API 特定工具定义数组
   */
  formatTools(tools: ToolDefinition[]): unknown[] {
    return tools.map((t) => ({
      type: 'function',
      function: {
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      },
    }));
  }
}
