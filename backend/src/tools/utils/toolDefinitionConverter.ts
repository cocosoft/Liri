/**
 * 工具定义转换器
 * 将工具注册表的 ToolSchema 转换为 LLM 兼容的 ToolDefinition
 */

import type { ToolSchema } from '../types/ToolDef';
import type { ToolDefinition } from '../../ai/models/types';

/**
 * 将单个 ToolSchema 转换为 LLM ToolDefinition
 * @param schema 工具注册表的工具模式
 * @returns LLM 兼容的工具定义
 */
export function convertToToolDefinition(schema: ToolSchema): ToolDefinition {
  return {
    type: 'function',
    function: {
      name: schema.name,
      description: schema.description,
      parameters: {
        type: 'object',
        properties: schema.input_schema.properties,
        required: schema.input_schema.required || [],
      },
    },
  };
}

/**
 * 将多个 ToolSchema 转换为 LLM ToolDefinition 数组
 * @param schemas 工具注册表的工具模式数组
 * @returns LLM 兼容的工具定义数组
 */
export function convertToToolDefinitions(
  schemas: ToolSchema[]
): ToolDefinition[] {
  return schemas.map(convertToToolDefinition);
}

/**
 * 从工具注册表获取转换后的工具定义
 * @param getSchemas 获取工具模式的函数
 * @returns LLM 兼容的工具定义数组
 */
export function getToolDefinitions(
  getSchemas: () => ToolSchema[]
): ToolDefinition[] {
  return convertToToolDefinitions(getSchemas());
}
