// @ts-nocheck
/**
 * LSP与Tool系统集成模块
 * 实现LSP工具与核心Tool系统的深度集成
 */

import { LSPToolImpl } from './LSPToolImpl';
import { Position, Location, CompletionItem, Diagnostic } from './types';
import type { Tool, ToolResult } from '@modules/tools';
import { validatePosition, validateLocation, validateCompletionItem, validateDiagnostic } from '@modules/lsp';

/**
 * LSP工具集成类
 */
export class LSPToolIntegration {
  private lspTool: LSPToolImpl;
  private toolRegistry: Map<string, (...args: any[]) => Promise<ToolResult>>;

  /**
   * 构造函数
   */
  constructor(language: string = 'typescript') {
    this.lspTool = new LSPToolImpl(language);
    this.toolRegistry = new Map();
    this.registerLSPTools();
  }

  /**
   * 注册LSP工具到Tool系统
   */
  private registerLSPTools(): void {
    // 注册代码补全工具
    this.toolRegistry.set('lsp_get_completions', async (document: string, position: Position) => {
      if (!validatePosition(position)) {
        return { success: false, error: 'Invalid position' };
      }
      const result = await this.lspTool.getCompletions(document, position);
      return { success: true, data: result };
    });

    // 注册定义查找工具
    this.toolRegistry.set('lsp_get_definition', async (document: string, position: Position) => {
      if (!validatePosition(position)) {
        return { success: false, error: 'Invalid position' };
      }
      const result = await this.lspTool.getDefinition(document, position);
      const validLocations = result.filter(loc => validateLocation(loc));
      return { success: true, data: validLocations };
    });

    // 注册引用查找工具
    this.toolRegistry.set('lsp_get_references', async (document: string, position: Position) => {
      if (!validatePosition(position)) {
        return { success: false, error: 'Invalid position' };
      }
      const result = await this.lspTool.getReferences(document, position);
      const validLocations = result.filter(loc => validateLocation(loc));
      return { success: true, data: validLocations };
    });

    // 注册诊断获取工具
    this.toolRegistry.set('lsp_get_diagnostics', async (document: string) => {
      const result = await this.lspTool.getDiagnostics(document);
      const validDiagnostics = result.filter(diag => validateDiagnostic(diag));
      return { success: true, data: validDiagnostics };
    });

    // 注册代码格式化工具
    this.toolRegistry.set('lsp_format_document', async (document: string) => {
      const result = await this.lspTool.formatDocument(document);
      return { success: true, data: result };
    });

    // 注册悬停信息工具
    this.toolRegistry.set('lsp_get_hover', async (document: string, position: Position) => {
      if (!validatePosition(position)) {
        return { success: false, error: 'Invalid position' };
      }
      const result = await this.lspTool.getHover(document, position);
      return { success: true, data: result };
    });

    // 注册符号重命名工具
    this.toolRegistry.set('lsp_rename_symbol', async (document: string, position: Position, newName: string) => {
      if (!validatePosition(position)) {
        return { success: false, error: 'Invalid position' };
      }
      if (!newName || newName.trim().length === 0) {
        return { success: false, error: 'Invalid new name' };
      }
      const result = await this.lspTool.renameSymbol(document, position, newName);
      const validLocations = result.filter(loc => validateLocation(loc));
      return { success: true, data: validLocations };
    });

    // 注册代码操作工具
    this.toolRegistry.set('lsp_get_code_actions', async (document: string, position: Position) => {
      if (!validatePosition(position)) {
        return { success: false, error: 'Invalid position' };
      }
      const result = await this.lspTool.getCodeActions(document, position);
      return { success: true, data: result };
    });
  }

  /**
   * 启动LSP服务器
   */
  async startServer(): Promise<void> {
    await this.lspTool.startServer();
  }

  /**
   * 停止LSP服务器
   */
  async stopServer(): Promise<void> {
    await this.lspTool.stopServer();
  }

  /**
   * 执行LSP工具操作
   */
  async executeTool(toolName: string, ...args: any[]): Promise<ToolResult> {
    const tool = this.toolRegistry.get(toolName);
    if (!tool) {
      return { success: false, error: `Tool ${toolName} not found` };
    }

    try {
      return await tool(...args);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 获取所有注册的工具名称
   */
  getRegisteredTools(): string[] {
    return Array.from(this.toolRegistry.keys());
  }

  /**
   * 检查工具是否已注册
   */
  hasTool(toolName: string): boolean {
    return this.toolRegistry.has(toolName);
  }

  /**
   * 获取服务器状态
   */
  getServerStatus() {
    return this.lspTool.getServerStatus();
  }

  /**
   * 重启服务器
   */
  async restartServer(): Promise<void> {
    await this.lspTool.restartServer();
  }
}

/**
 * 创建LSP工具集成实例
 */
export function createLSPToolIntegration(language: string = 'typescript'): LSPToolIntegration {
  return new LSPToolIntegration(language);
}

/**
 * 获取代码补全
 */
export async function getCompletions(
  document: string,
  position: Position,
  lspTool: LSPToolIntegration
): Promise<CompletionItem[]> {
  const result = await lspTool.executeTool('lsp_get_completions', document, position);
  if (!result.success) {
    throw new Error(result.error || 'Failed to get completions');
  }
  return result.data as CompletionItem[];
}

/**
 * 获取代码定义
 */
export async function getDefinition(
  document: string,
  position: Position,
  lspTool: LSPToolIntegration
): Promise<Location[]> {
  const result = await lspTool.executeTool('lsp_get_definition', document, position);
  if (!result.success) {
    throw new Error(result.error || 'Failed to get definition');
  }
  return result.data as Location[];
}

/**
 * 获取代码引用
 */
export async function getReferences(
  document: string,
  position: Position,
  lspTool: LSPToolIntegration
): Promise<Location[]> {
  const result = await lspTool.executeTool('lsp_get_references', document, position);
  if (!result.success) {
    throw new Error(result.error || 'Failed to get references');
  }
  return result.data as Location[];
}

/**
 * 获取代码诊断
 */
export async function getDiagnostics(
  document: string,
  lspTool: LSPToolIntegration
): Promise<Diagnostic[]> {
  const result = await lspTool.executeTool('lsp_get_diagnostics', document);
  if (!result.success) {
    throw new Error(result.error || 'Failed to get diagnostics');
  }
  return result.data as Diagnostic[];
}

/**
 * 格式化文档
 */
export async function formatDocument(
  document: string,
  lspTool: LSPToolIntegration
): Promise<string> {
  const result = await lspTool.executeTool('lsp_format_document', document);
  if (!result.success) {
    throw new Error(result.error || 'Failed to format document');
  }
  return result.data as string;
}