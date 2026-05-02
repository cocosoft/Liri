/**
 * Hook管理核心
 * 负责Hook的注册、管理和执行
 */

import {
  IndividualHookConfig,
  HookEvent,
  HookExecutionResult,
  HookExecutionContext,
} from '../types';
import { HookConfigManager } from './HookConfigManager';
import { HookExecutor } from '../executors/HookExecutor';
import { SessionHookManager, sessionHookManager } from './SessionHookManager';
import { environmentManager } from '../utils/EnvironmentManager';

/**
 * Hook管理器
 */
export class HookManager {
  private static instance: HookManager;
  private hookConfigManager: HookConfigManager;
  private hookExecutor: HookExecutor;
  private registeredHooks: Map<string, IndividualHookConfig[]> = new Map();
  private sessionHookManager: SessionHookManager;

  private constructor() {
    this.hookConfigManager = HookConfigManager.getInstance();
    this.hookExecutor = new HookExecutor();
    this.sessionHookManager = sessionHookManager;
  }

  /**
   * 获取单例实例
   */
  public static getInstance(): HookManager {
    if (!HookManager.instance) {
      HookManager.instance = new HookManager();
    }
    return HookManager.instance;
  }

  /**
   * 注册Hook
   * @param hook Hook配置
   */
  public registerHook(hook: IndividualHookConfig): void {
    const eventKey = hook.event;
    if (!this.registeredHooks.has(eventKey)) {
      this.registeredHooks.set(eventKey, []);
    }
    this.registeredHooks.get(eventKey)?.push(hook);
  }

  /**
   * 注册多个Hook
   * @param hooks Hook配置列表
   */
  public registerHooks(hooks: IndividualHookConfig[]): void {
    hooks.forEach((hook) => this.registerHook(hook));
  }

  /**
   * 执行指定事件的Hook
   * @param event 事件类型
   * @param data 事件数据
   * @param toolNames 工具名称列表
   * @param sessionId 会话ID
   * @returns Hook执行结果列表
   */
  public async executeHooks(
    event: HookEvent,
    data: any,
    toolNames: string[] = [],
    sessionId?: string
  ): Promise<HookExecutionResult[]> {
    // 获取配置的Hook
    const configHooks = this.hookConfigManager.getHooksByEvent(event);
    // 获取注册的Hook
    const registeredHooks = this.registeredHooks.get(event) || [];
    // 合并所有Hook
    const allHooks = [...configHooks, ...registeredHooks];

    // 按优先级排序
    allHooks.sort(
      (a, b) => (b.config.priority || 0) - (a.config.priority || 0)
    );

    const results: HookExecutionResult[] = [];

    // 执行每个Hook
    for (const hook of allHooks) {
      // 检查匹配器
      if (hook.matcher && !this.matchesMatcher(hook.matcher, data)) {
        continue;
      }

      // 执行Hook
      const context: HookExecutionContext = {
        event,
        matcher: hook.matcher,
        data,
        toolNames,
        sessionId,
      };

      const result = await this.hookExecutor.execute(hook, context);
      results.push(result);

      // 检查是否需要停止执行
      if (this.shouldStopExecution(result, hook)) {
        break;
      }
    }

    // 执行会话级Hook
    if (sessionId) {
      const sessionResults = await this.sessionHookManager.executeSessionHooks(
        sessionId, event, data, toolNames
      );
      results.push(...sessionResults);
    }

    return results;
  }

  /**
   * 检查是否匹配匹配器
   * @param matcher 匹配器值
   * @param data 事件数据
   * @returns 是否匹配
   */
  private matchesMatcher(matcher: string, data: any): boolean {
    // 根据事件类型和数据结构检查匹配器
    // 这里实现简单的匹配逻辑，实际应用中可能需要更复杂的匹配
    if (data.tool_name) {
      return data.tool_name === matcher;
    }
    if (data.notification_type) {
      return data.notification_type === matcher;
    }
    if (data.source) {
      return data.source === matcher;
    }
    if (data.reason) {
      return data.reason === matcher;
    }
    if (data.error) {
      return data.error === matcher;
    }
    if (data.matcher) {
      // 对于FileChanged事件，使用文件名匹配
      if (data.file_path) {
        const pattern = new RegExp(
          matcher.replace(/\./g, '\\.').replace(/\*/g, '.*')
        );
        return pattern.test(data.file_path);
      }
    }
    return true;
  }

  /**
   * 检查是否需要停止执行
   * @param result Hook执行结果
   * @param hook Hook配置
   * @returns 是否停止执行
   */
  private shouldStopExecution(
    result: HookExecutionResult,
    hook: IndividualHookConfig
  ): boolean {
    // 根据Hook类型和执行结果决定是否停止执行
    // 例如，对于命令类型Hook，退出代码为2时可能需要停止执行
    if (hook.config.type === 'command' && result.exitCode === 2) {
      return true;
    }
    return false;
  }

  /**
   * 获取所有Hook
   * @returns Hook配置列表
   */
  public getAllHooks(): IndividualHookConfig[] {
    const configHooks = this.hookConfigManager.getAllHooks();
    const registeredHooks = Array.from(this.registeredHooks.values()).flat();
    return [...configHooks, ...registeredHooks];
  }

  /**
   * 根据事件类型获取Hook
   * @param event 事件类型
   * @returns Hook配置列表
   */
  public getHooksByEvent(event: HookEvent): IndividualHookConfig[] {
    const configHooks = this.hookConfigManager.getHooksByEvent(event);
    const registeredHooks = this.registeredHooks.get(event) || [];
    return [...configHooks, ...registeredHooks];
  }

  /**
   * 加载配置
   * @param config 配置对象
   */
  public loadConfig(config: any): void {
    this.hookConfigManager.loadConfig(config);
  }

  /**
   * 添加会话Hook
   */
  public addSessionHook(
    sessionId: string,
    event: HookEvent,
    matcher: string,
    hook: any,
    onHookSuccess?: (hook: any, result: any) => void,
    skillRoot?: string
  ): void {
    this.sessionHookManager.addSessionHook(sessionId, event, matcher, hook, onHookSuccess, skillRoot);
  }

  /**
   * 添加函数Hook
   */
  public addFunctionHook(
    sessionId: string,
    event: HookEvent,
    matcher: string,
    callback: (messages: any[], signal?: AbortSignal) => boolean | Promise<boolean>,
    errorMessage: string,
    options?: {
      timeout?: number;
      id?: string;
    }
  ): string {
    return this.sessionHookManager.addFunctionHook(sessionId, event, matcher, callback, errorMessage, options);
  }

  /**
   * 移除函数Hook
   */
  public removeFunctionHook(
    sessionId: string,
    event: HookEvent,
    hookId: string
  ): void {
    this.sessionHookManager.removeFunctionHook(sessionId, event, hookId);
  }

  /**
   * 清除会话Hook
   */
  public clearSessionHooks(sessionId: string): void {
    this.sessionHookManager.clearSessionHooks(sessionId);
  }

  /**
   * 检查异步Hook响应
   */
  public async checkAsyncHookResponses(): Promise<any[]> {
    return await this.hookExecutor.checkAsyncHookResponses();
  }

  /**
   * 取消Hook执行
   */
  public async cancelHook(processId: string): Promise<void> {
    await this.hookExecutor.cancelHook(processId);
  }

  /**
   * 获取待处理的异步Hook
   */
  public getPendingAsyncHooks(): any[] {
    return this.hookExecutor.getPendingAsyncHooks();
  }

  /**
   * 获取环境变量管理器
   */
  public getEnvironmentManager() {
    return environmentManager;
  }

  /**
   * 重置管理器
   */
  public reset(): void {
    this.registeredHooks.clear();
    this.hookConfigManager.reset();
    this.hookExecutor.reset();
    this.sessionHookManager.reset();
  }

  /**
   * 并行执行多个Hook
   */
  public async executeParallel(
    event: HookEvent,
    data: any,
    toolNames: string[] = [],
    sessionId?: string
  ): Promise<HookExecutionResult[]> {
    // 获取配置的Hook
    const configHooks = this.hookConfigManager.getHooksByEvent(event);
    // 获取注册的Hook
    const registeredHooks = this.registeredHooks.get(event) || [];
    // 合并所有Hook
    const allHooks = [...configHooks, ...registeredHooks];

    // 按优先级排序
    allHooks.sort(
      (a, b) => (b.config.priority || 0) - (a.config.priority || 0)
    );

    // 过滤匹配的Hook
    const matchingHooks = allHooks.filter(hook => {
      return !hook.matcher || this.matchesMatcher(hook.matcher, data);
    });

    // 执行上下文
    const context: HookExecutionContext = {
      event,
      data,
      toolNames,
      sessionId,
    };

    // 并行执行
    const results = await this.hookExecutor.executeParallel(matchingHooks, context);

    // 执行会话级Hook
    if (sessionId) {
      const sessionResults = await this.sessionHookManager.executeSessionHooks(
        sessionId, event, data, toolNames
      );
      results.push(...sessionResults);
    }

    return results;
  }

  /**
   * 批量执行多个Hook
   */
  public async executeBatch(
    event: HookEvent,
    data: any,
    toolNames: string[] = [],
    sessionId?: string,
    batchSize: number = 10
  ): Promise<HookExecutionResult[]> {
    // 获取配置的Hook
    const configHooks = this.hookConfigManager.getHooksByEvent(event);
    // 获取注册的Hook
    const registeredHooks = this.registeredHooks.get(event) || [];
    // 合并所有Hook
    const allHooks = [...configHooks, ...registeredHooks];

    // 按优先级排序
    allHooks.sort(
      (a, b) => (b.config.priority || 0) - (a.config.priority || 0)
    );

    // 过滤匹配的Hook
    const matchingHooks = allHooks.filter(hook => {
      return !hook.matcher || this.matchesMatcher(hook.matcher, data);
    });

    // 执行上下文
    const context: HookExecutionContext = {
      event,
      data,
      toolNames,
      sessionId,
    };

    // 批量执行
    const results = await this.hookExecutor.executeBatch(matchingHooks, context, batchSize);

    // 执行会话级Hook
    if (sessionId) {
      const sessionResults = await this.sessionHookManager.executeSessionHooks(
        sessionId, event, data, toolNames
      );
      results.push(...sessionResults);
    }

    return results;
  }

  /**
   * 获取性能指标
   */
  public getPerformanceMetrics() {
    return this.hookExecutor.getPerformanceMetrics();
  }

  /**
   * 获取安全管理器
   */
  public getSecurityManager() {
    return this.hookExecutor.getSecurityManager();
  }

  /**
   * 获取诊断管理器
   */
  public getDiagnosticManager() {
    return require('../utils/DiagnosticManager').diagnosticManager;
  }
}
