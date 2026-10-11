/**
 * 工具工厂（G18，2026-10-11：**注册表驱动**）
 *
 * 重构说明：原名 ~80 个 `createXxxTool()` 方法（约 700 行）收敛为
 * **`factories/builtinToolRegistry` 的 `BUILTIN_TOOL_FACTORIES` 一张表**（构造唯一来源）。
 * 本类只保留两个入口：
 * - `create(key)`：按注册表键构造（loader 以 `ToolFactory.prototype.create` 形态引用）；
 * - `createTool(def)`：通用"按定义构造"，历史 API，保留。
 *
 * 键为编译期字面量联合（`BuiltinToolFactoryKey`）⇒ 拼错键即 `typecheck` 失败。
 */
import { Tool, ToolTag } from './types/Tool';
import { createToolResult } from './types/ToolResult';
import {
  BUILTIN_TOOL_FACTORIES,
  type BuiltinToolFactoryKey,
} from './factories/builtinToolRegistry';

interface ToolDefinitionInput {
  name: string;
  description: string;
  inputSchema?: {
    properties?: Record<
      string,
      {
        type?: string;
        description?: string;
        default?: unknown;
      }
    >;
    required?: string[];
  };
  aliases?: string[];
  searchTips?: string[];
  tags?: ToolTag[];
}

/**
 * 工具工厂类
 */
export class ToolFactory {
  /**
   * 按**注册表键**构造内置工具（构造唯一来源：`factories/builtinToolRegistry`）。
   *
   * @param key 注册表键（如 `'createBashTool'`）—— 字面量联合，拼错即编译失败
   * @returns 工具实例（`null` 表示该工具未启用/构造返回空，语义随注册表条目）
   */
  create(key: BuiltinToolFactoryKey): Tool | null {
    return BUILTIN_TOOL_FACTORIES[key]();
  }

  /**
   * 创建工具
   * @param def 工具定义
   * @returns 工具实例
   */
  createTool(def: ToolDefinitionInput): Tool {
    // 构建基础工具对象，包含名称、描述及参数解析
    const tool = {
      name: def.name || '',
      description: def.description || '',
      // 将输入 schema 的属性转换为标准化的参数列表
      params: def.inputSchema?.properties
        ? Object.entries(def.inputSchema.properties).map(
            ([name, prop]: [string, Record<string, unknown>]) => ({
              name,
              type: (prop.type as string) || 'string',
              description: (prop.description as string) || '',
              required: def.inputSchema?.required?.includes(name) || false,
              default: prop.default,
            })
          )
        : [],
      aliases: def.aliases,
      searchHint: def.searchTips?.[0],
      maxResultSizeChars: 10000,
      isEnabled: () => true,
      isReadOnly: () => false,
      isConcurrencySafe: () => true,
      // 默认执行逻辑，返回空结果
      execute: async (
        input: unknown,
        context: unknown,
        onProgress?: unknown
      ) => {
        return createToolResult(null, {
          newMessages: [],
        });
      },
      // 获取工具完整信息的方法
      getInfo: function () {
        return {
          name: tool.name,
          description: tool.description,
          params: tool.params,
          aliases: tool.aliases,
          searchTips: tool.searchHint ? [tool.searchHint] : [],
          enabled: true,
          readOnly: false,
          destructive: false,
          concurrencySafe: true,
          deferred: false,
          alwaysLoad: false,
          interruptBehavior: 'block' as const,
          maxResultSizeChars: tool.maxResultSizeChars,
          tags: def.tags,
        };
      },
    };
    return tool;
  }
}
