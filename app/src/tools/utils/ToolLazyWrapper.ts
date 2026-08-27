/**
 * ToolLazyWrapper — 工具懒加载包装器
 *
 * 存储工具元信息，工具实例在首次 execute() 时才加载。
 * getInfo() 直接返回元信息，不触发加载。
 */

import { LazyModuleLoader } from '../../core/utils/LazyModuleLoader';
import type { Tool, ToolInfo, ToolParam } from '../types/Tool';
import type { ToolUseContext } from '../types/ToolUseContext';
import type { ToolResult } from '../types/ToolResult';
import type { PermissionResult } from '../types/PermissionResult';
import type { ValidationResult } from '../types/Tool';
import type { ToolCallProgress } from '../types/Tool';

export class ToolLazyWrapper implements Tool {
  readonly name: string;
  readonly description: string;
  readonly params: ToolParam[];
  readonly aliases?: string[];
  readonly searchHint?: string;
  readonly searchTips?: string[];
  readonly shouldDefer?: boolean;
  readonly alwaysLoad?: boolean;
  readonly maxResultSizeChars?: number;

  private loader: LazyModuleLoader<Tool>;
  private metadata: ToolInfo;
  private _requiresUserInteraction: boolean;

  constructor(
    metadata: ToolInfo,
    loader: LazyModuleLoader<Tool>,
    requiresUserInteraction?: boolean
  ) {
    this.metadata = metadata;
    this.loader = loader;
    this._requiresUserInteraction = requiresUserInteraction ?? false;

    this.name = metadata.name;
    this.description = metadata.description;
    this.params = metadata.params;
    this.aliases = metadata.aliases;
    this.searchHint = metadata.searchHint;
    this.searchTips = metadata.searchTips;
    this.shouldDefer = metadata.deferred;
    this.alwaysLoad = metadata.alwaysLoad;
    this.maxResultSizeChars = metadata.maxResultSizeChars;
  }

  requiresUserInteraction?(): boolean {
    return this._requiresUserInteraction;
  }

  getInfo(): ToolInfo {
    return this.metadata;
  }

  isEnabled(): boolean {
    return this.metadata.enabled;
  }

  isReadOnly(input?: Record<string, unknown>): boolean {
    return this.metadata.readOnly;
  }

  isDestructive(input?: Record<string, unknown>): boolean {
    return this.metadata.destructive;
  }

  isConcurrencySafe(input?: Record<string, unknown>): boolean {
    return this.metadata.concurrencySafe;
  }

  interruptBehavior(): 'cancel' | 'block' {
    return this.metadata.interruptBehavior || 'block';
  }

  async execute(
    input: any,
    context: ToolUseContext,
    onProgress?: ToolCallProgress
  ): Promise<ToolResult<any>> {
    const realTool = await this.loader.get();
    return realTool.execute(input, context, onProgress);
  }

  async call?(
    args: any,
    context: ToolUseContext,
    onProgress?: ToolCallProgress
  ): Promise<ToolResult<any>> {
    const realTool = await this.loader.get();
    if (typeof realTool.call === 'function') {
      return realTool.call(args, context, onProgress);
    }
    return realTool.execute(args, context, onProgress);
  }

  async checkPermissions?(
    input: any,
    context: ToolUseContext
  ): Promise<PermissionResult> {
    const realTool = await this.loader.get();
    if (typeof realTool.checkPermissions === 'function') {
      return realTool.checkPermissions(input, context);
    }
    return { behavior: 'allow' };
  }

  validateInput?(input: any): ValidationResult {
    // BUG 4 修复（2026-08-27）：已加载工具委托真实校验，不再恒放行——
    // 原实现使权限/调度前置拦截层永远拿到"通过"（AgentTool 的必填校验被绕过）。
    // 懒加载未加载时仍由 execute 内部校验兜底（保持懒加载语义）。
    if (this.loader.isLoaded()) {
      try {
        const realTool = this.loader.getSync();
        if (typeof realTool.validateInput === 'function') {
          return realTool.validateInput(input);
        }
      } catch {
        // 忽略：加载异常按放行处理
      }
    }
    return { result: true };
  }

  async validateInputWithContext?(
    input: any,
    context: ToolUseContext
  ): Promise<ValidationResult> {
    const realTool = await this.loader.get();
    if (typeof realTool.validateInputWithContext === 'function') {
      return realTool.validateInputWithContext(input, context);
    }
    return { result: true };
  }

  getPath?(input: Record<string, unknown>): string {
    return '';
  }

  isLoaded(): boolean {
    return this.loader.isLoaded();
  }

  reset(): void {
    this.loader.reset();
  }
}
