/**
 * 工具工具类
 * 包含工具相关的通用函数
 */
import { Tool } from '../types/Tool';
import { ToolParam } from '../types/Tool';
import { ToolResult } from '../types/ToolResult';
import { ToolProgressData } from '../types/ToolProgressData';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { configManager } from '@modules/config';
import { resolveOutputDir } from '@modules/core';
import { handleError } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:utils:ToolUtils');

/**
 * 归一化工具路径，确保跨平台兼容
 *
 * 将路径中的反斜杠统一转换为正斜杠，然后调用 path.resolve 归一化。
 * 正斜杠在 Windows 内核 API 中完全兼容，且不会与 JSON 转义冲突。
 *
 * @param inputPath 原始路径（可能含 \ 或 /）
 * @returns 归一化后的绝对路径
 */
export function normalizeToolPath(inputPath: string): string {
  return path.resolve(inputPath.replace(/\\/g, '/'));
}

/**
 * 解析文件工具路径
 *
 * 将反斜杠归一化后，若为绝对路径则直接 resolve，否则相对 outputDir 解析。
 * 所有文件操作工具（FileReadTool、FileWriteTool、FileEditTool）统一使用此函数。
 *
 * @param filePath 用户传入的原始文件路径
 * @returns 归一化后的绝对路径
 */
export function resolveFilePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  return path.isAbsolute(normalized)
    ? path.resolve(normalized)
    : path.resolve(resolveOutputDir(), normalized);
}

/**
 * 工具工具类
 */
export class ToolUtils {
  /**
   * 验证工具输入
   * @param tool 工具实例
   * @param input 工具输入
   * @returns 验证结果
   */
  static validateInput(
    tool: Tool,
    input: Record<string, unknown>
  ): { valid: boolean; error: string | null } {
    if (!tool.params) {
      return { valid: true, error: null };
    }

    // 检查必填参数
    for (const param of tool.params) {
      if (param.required && !(param.name in input)) {
        return {
          valid: false,
          error: `Missing required parameter: ${param.name}`,
        };
      }

      // 检查参数类型
      if (param.name in input) {
        const value = input[param.name];
        const type = param.type;

        if (!this.isValidType(value, type)) {
          return {
            valid: false,
            error: `Invalid type for parameter ${param.name}: expected ${type}`,
          };
        }
      }
    }

    return { valid: true, error: null };
  }

  /**
   * 检查值是否为有效类型
   * @param value 要检查的值
   * @param type 期望的类型
   * @returns 是否有效
   */
  static isValidType(value: unknown, type: string): boolean {
    switch (type) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && !isNaN(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'object':
        return typeof value === 'object' && value !== null;
      case 'array':
        return Array.isArray(value);
      case 'any':
        return true;
      default:
        return false;
    }
  }

  /**
   * 格式化工具结果
   * @param result 工具执行结果
   * @returns 格式化后的结果
   */
  static formatResult(result: ToolResult<unknown>): string {
    if (typeof result.data === 'string') {
      return result.data;
    } else if (typeof result.data === 'object' && result.data !== null) {
      try {
        return JSON.stringify(result.data, null, 2);
      } catch {
        return String(result.data);
      }
    } else {
      return String(result.data);
    }
  }

  /**
   * 生成执行ID
   * @param toolName 工具名称
   * @returns 执行ID
   */
  static generateExecutionId(toolName: string): string {
    return `${toolName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 计算执行时间
   * @param startTime 开始时间
   * @returns 执行时间（毫秒）
   */
  static calculateExecutionTime(startTime: number): number {
    return Date.now() - startTime;
  }

  /**
   * 合并工具参数默认值
   * @param params 工具参数定义
   * @param input 工具输入
   * @returns 合并后的输入
   */
  static mergeDefaultParams(
    params: ToolParam[],
    input: Record<string, unknown>
  ): Record<string, unknown> {
    const merged = { ...input };

    for (const param of params) {
      if (param.name in merged) {
        continue;
      }

      if (param.default !== undefined) {
        merged[param.name] = param.default;
      }
    }

    return merged;
  }

  /**
   * 检查工具是否支持并发
   * @param tool 工具实例
   * @returns 是否支持并发
   */
  static isConcurrentSafe(tool: Tool): boolean {
    return tool.isConcurrencySafe ? tool.isConcurrencySafe() : false;
  }

  /**
   * 获取工具别名
   * @param tool 工具实例
   * @returns 工具别名数组
   */
  static getToolAliases(tool: Tool): string[] {
    return tool.aliases || [];
  }

  /**
   * 检查工具是否有指定别名
   * @param tool 工具实例
   * @param alias 别名
   * @returns 是否有指定别名
   */
  static hasAlias(tool: Tool, alias: string): boolean {
    return (tool.aliases || []).includes(alias);
  }

  /**
   * 规范化工具输入
   * @param input 工具输入
   * @returns 规范化后的输入
   */
  static normalizeInput(input: unknown): Record<string, unknown> {
    if (typeof input === 'object' && input !== null) {
      return input as Record<string, unknown>;
    }
    return {};
  }

  /**
   * 验证工具参数值
   * @param param 工具参数定义
   * @param value 参数值
   * @returns 验证结果
   */
  static validateParamValue(
    param: ToolParam,
    value: unknown
  ): { valid: boolean; error: string | null } {
    // 检查必填
    if (param.required && value === undefined) {
      return {
        valid: false,
        error: `Missing required parameter: ${param.name}`,
      };
    }

    // 检查类型
    if (value !== undefined && !this.isValidType(value, param.type)) {
      return {
        valid: false,
        error: `Invalid type for parameter ${param.name}: expected ${param.type}`,
      };
    }

    return { valid: true, error: null };
  }

  /**
   * 创建成功结果
   * @param data 结果数据
   * @param options 可选参数
   * @returns 工具结果
   */
  static createSuccessResult<T = unknown>(
    data: T,
    options?: Partial<ToolResult<T>>
  ): ToolResult<T> {
    return {
      data,
      success: true,
      ...options,
    };
  }

  /**
   * 创建失败结果
   * @param error 错误信息
   * @param options 可选参数
   * @returns 工具结果
   */
  static createFailureResult<T = unknown>(
    error: string,
    options?: Partial<ToolResult<T>>
  ): ToolResult<T> {
    return {
      data: undefined as unknown as T,
      success: false,
      error,
      ...options,
    };
  }
}

/**
 * 创建成功结果
 * @param data 结果数据
 * @param options 可选参数
 * @returns 工具结果
 */
export function createSuccessResult<T = unknown>(
  data: T,
  options?: Partial<ToolResult<T>>
): ToolResult<T> {
  return ToolUtils.createSuccessResult(data, options);
}

/**
 * 创建失败结果
 * @param error 错误信息
 * @param options 可选参数
 * @returns 工具结果
 */
export function createFailureResult<T = unknown>(
  error: string,
  options?: Partial<ToolResult<T>>
): ToolResult<T> {
  return ToolUtils.createFailureResult(error, options);
}

/**
 * 工具类型
 */
export const ToolTypes = {
  /** 命令行工具 */
  COMMAND: 'command',
  /** 文件工具 */
  FILE: 'file',
  /** 网络工具 */
  NETWORK: 'network',
  /** 配置工具 */
  CONFIG: 'config',
  /** 任务工具 */
  TASK: 'task',
  /** 搜索工具 */
  SEARCH: 'search',
  /** 其他工具 */
  OTHER: 'other',
};

/**
 * 路径可访问性检查结果
 */
export interface PathAccessResult {
  /** 是否可通过 */
  accessible: boolean;
  /** 规范化的绝对路径 */
  resolvedPath: string;
  /** 不可访问的原因 */
  reason?: string;
  /** 修复建议 */
  suggestions?: string[];
}

/**
 * 检查目标路径是否可访问
 * 在执行文件操作前调用，可避免跨磁盘或路径缺失导致的静默失败
 *
 * @param targetPath 用户传入的原始路径
 * @param label 路径用途描述（如"工作目录"、"搜索目录"），用于错误提示
 * @returns 检查结果
 */
export function checkPathAccessibility(
  targetPath: string,
  label: string = '路径'
): PathAccessResult {
  // 先归一化路径（反斜杠 → 正斜杠），修复可能的 JSON 转义损坏
  const normalized = targetPath.replace(/\\/g, '/');
  const resolved = path.resolve(normalized);

  if (fs.existsSync(resolved)) {
    return { accessible: true, resolvedPath: resolved };
  }

  const suggestions: string[] = [];

  // 检测路径是否被 JSON 反斜杠转义损坏（如 E:\PY\CODESPY_APP 缺少分隔符）
  if (targetPath !== normalized) {
    suggestions.push(
      '路径中包含反斜杠，可能被 JSON 转义损坏。已自动归一化为正斜杠格式'
    );
  }

  const projectDir = configManager.env('LIRI_PROJECT_DIR') || process.cwd();
  const resolvedProject = path.resolve(projectDir);

  if (
    resolvedProject &&
    path.dirname(resolvedProject)[0] !== path.dirname(resolved)[0]
  ) {
    if (
      path.dirname(resolvedProject).toLowerCase().charAt(0) !==
      path.dirname(resolved).toLowerCase().charAt(0)
    ) {
      suggestions.push(
        `目标路径位于 ${path.dirname(resolved).charAt(0).toUpperCase()}: 盘，项目根目录位于 ${path.dirname(resolvedProject).charAt(0).toUpperCase()}: 盘`
      );
      suggestions.push(
        '可尝试通过 --project-dir 或 LIRI_PROJECT_DIR 指定正确路径'
      );
    }
  }

  const parentDir = path.dirname(resolved);
  if (!fs.existsSync(parentDir)) {
    // 尝试诊断：检查父目录的父目录是否存在
    const grandParent = path.dirname(parentDir);
    if (fs.existsSync(grandParent)) {
      // 祖父目录存在但父目录不存在 → 可能是路径中缺少了一层分隔符
      const siblings = fs.readdirSync(grandParent).filter((name) => {
        const parentBase = path.basename(parentDir).toLowerCase();
        return (
          name.toLowerCase().includes(parentBase) ||
          parentBase.includes(name.toLowerCase())
        );
      });
      if (siblings.length > 0) {
        suggestions.push(
          `上级目录 "${parentDir}" 不存在，但 "${grandParent}" 中存在相似目录: ${siblings.join(', ')}`
        );
        suggestions.push('路径可能被 JSON 转义损坏，请检查反斜杠是否正确转义');
      }
    }
    suggestions.push(`上级目录不存在: ${parentDir}`);
    suggestions.push('请确认项目源码已同步到当前磁盘');
  } else {
    suggestions.push('请确认路径拼写正确');
    suggestions.push(
      '如果路径来自 AI 模型输出，请检查反斜杠是否被 JSON 转义（应使用 \\\\ 或 /）'
    );
  }

  return {
    accessible: false,
    resolvedPath: resolved,
    reason: `${label}不存在: ${resolved}`,
    suggestions,
  };
}

/**
 * 异步检查目标路径是否可访问（不阻塞事件循环）
 *
 * 用于批量路径校验等异步场景。与同步版本相比，仅将 fs.existsSync 替换为
 * fsp.access(F_OK)，其余逻辑（盘符检测、友好提示）保持一致。
 *
 * @param targetPath 用户传入的原始路径
 * @param label 路径用途描述
 * @returns 检查结果
 */
export async function checkPathAccessibilityAsync(
  targetPath: string,
  label: string = '路径'
): Promise<PathAccessResult> {
  const resolved = path.resolve(targetPath);

  try {
    await fsp.access(resolved, fs.constants.F_OK);
    return { accessible: true, resolvedPath: resolved };
  } catch (err) {
    handleError(err, {
      module: 'tools:utils',
      action: 'checkPathAccessibility',
    });
  }

  const suggestions: string[] = [];

  const projectDir = configManager.env('LIRI_PROJECT_DIR') || process.cwd();
  const resolvedProject = path.resolve(projectDir);

  if (
    resolvedProject &&
    path.dirname(resolvedProject)[0] !== path.dirname(resolved)[0]
  ) {
    if (
      path.dirname(resolvedProject).toLowerCase().charAt(0) !==
      path.dirname(resolved).toLowerCase().charAt(0)
    ) {
      suggestions.push(
        `目标路径位于 ${path.dirname(resolved).charAt(0).toUpperCase()}: 盘，项目根目录位于 ${path.dirname(resolvedProject).charAt(0).toUpperCase()}: 盘`
      );
      suggestions.push(
        '可尝试通过 --project-dir 或 LIRI_PROJECT_DIR 指定正确路径'
      );
    }
  }

  const parentDir = path.dirname(resolved);
  if (!fs.existsSync(parentDir)) {
    suggestions.push(`上级目录不存在: ${parentDir}`);
    suggestions.push('请确认项目源码已同步到当前磁盘');
  } else {
    suggestions.push('请确认路径拼写正确');
  }

  return {
    accessible: false,
    resolvedPath: resolved,
    reason: `${label}不存在: ${resolved}`,
    suggestions,
  };
}

/**
 * 工具类别
 */
export const ToolCategories = {
  /** 内置工具 */
  BUILTIN: 'builtin',
  /** 自定义工具 */
  CUSTOM: 'custom',
  /** 第三方工具 */
  THIRD_PARTY: 'third_party',
};
