/**
 * 工具调用解析器抽象基类
 * 对标 Hermes environments/tool_call_parsers/__init__.py（ToolCallParser ABC）
 *
 * 用途: 当模型 API 返回的响应中不包含结构化 tool_calls 时（如 VLLM 等自部署模型
 * 返回纯文本但文本中包含工具调用标记），由解析器从原始文本中提取工具调用。
 *
 * 每个子类处理一种特定模型族的工具调用文本格式。
 */
import type { ParsedResult } from './types';

export abstract class BaseParser {
  /** 解析器唯一名称（用于注册和查找） */
  abstract readonly name: string;

  /** 匹配的模型名称模式列表（支持前缀匹配） */
  abstract readonly modelPatterns: string[];

  /**
   * 从模型原始输出文本中解析工具调用
   *
   * @param text 模型完成的原始解码文本
   * @returns 解析结果：去除标记后的纯文本 + 工具调用列表
   */
  abstract parse(text: string): ParsedResult;

  /**
   * 快速判断文本是否可能包含工具调用（无需完整解析）
   * 用于优化：先预检再决定是否需要完整解析
   *
   * @param text 待检查的文本
   * @returns 是否可能包含工具调用标记
   */
  mayContainToolCalls(text: string): boolean {
    return false;
  }
}
