/**
 * SdkPluginAdapter — SDK Plugin → plugins 体系适配层（报告 4.0 方案 A）
 *
 * 职责：
 * 1. 生命周期映射：SDK `initialize/activate/deactivate/destroy` ↔ plugins 体系生命周期
 * 2. 声明式服务注入（inject）：动态校验已注册服务目录 + 自动 grantAccess，
 *    服务实例以参数形式跨过 SDK 隔离边界挂载到 context.services
 *
 * SDK 隔离边界：本文件位于 plugins 核心侧，可以引用 KernelServiceRegistry；
 * plugin-sdk 侧仅通过 createPluginContext 接收 services 参数，不引用核心模块。
 */

import { getLogger } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import {
  createPluginContext,
  getInjectedServiceIds,
} from '../../plugin-sdk/core';
import type {
  Plugin as SdkPlugin,
  PluginContext,
  ToolRegistration,
} from '../../plugin-sdk/types';
import {
  KernelServiceRegistry,
  KernelServiceId,
} from '../api/KernelServiceRegistry';
import { getServiceProviderPluginId } from '../utils/dependencyResolver';
import { buildTool } from '@modules/tools/types/Tool';
import type { ToolParam } from '@modules/tools/types/Tool';
import { createToolResult } from '@modules/tools/types/ToolResult';
import { getToolRegistry } from '../../tools/ToolRegistry';

const logger = getLogger('plugins:core:sdkPluginAdapter');

/** 注入解析结果 */
export interface InjectedServicesResult {
  /** 成功解析并注入的服务（serviceId → 实例） */
  services: Record<string, unknown>;
  /** 缺失的必需服务（inject 声明但未注册） */
  missingRequired: string[];
  /** 缺失的可选服务（injectOptional 声明但未注册） */
  missingOptional: string[];
}

/** 上下文可选部分（log/config/events/utils），由宿主按需提供 */
export type ContextExtras = Pick<
  PluginContext,
  'log' | 'config' | 'events' | 'utils'
>;

/**
 * SDK 插件适配器
 * 将 plugin-sdk 程序化注册的插件接入 plugins 体系，并执行声明式服务注入。
 */
export class SdkPluginAdapter {
  /** 插件级可逆副作用（4.3）：pluginId → 逆操作列表，卸载时 LIFO 执行 */
  private _disposers = new Map<string, Array<() => void | Promise<void>>>();

  constructor(private readonly registry: KernelServiceRegistry) {}

  /**
   * 解析并注入声明式服务（动态校验：已注册服务目录）
   * P0 阶段：缺失必需服务即标记 missingRequired，由调用方按 fail-fast 拒绝；
   * P1 升级为挂起等待（响应式加载）。
   * @param plugin SDK 插件
   */
  resolveInject(plugin: SdkPlugin): InjectedServicesResult {
    const { required, optional } = getInjectedServiceIds(plugin);
    const services: Record<string, unknown> = {};
    const missingRequired: string[] = [];
    const missingOptional: string[] = [];

    for (const serviceId of required) {
      const instance = this.registry.resolveInternal(
        serviceId as KernelServiceId
      );
      if (instance !== undefined) {
        services[serviceId] = instance;
      } else {
        missingRequired.push(serviceId);
      }
    }

    for (const serviceId of optional) {
      const instance = this.registry.resolveInternal(
        serviceId as KernelServiceId
      );
      if (instance !== undefined) {
        services[serviceId] = instance;
      } else {
        missingOptional.push(serviceId);
      }
    }

    if (missingRequired.length > 0 || missingOptional.length > 0) {
      logger.warn(`SDK plugin ${plugin.id} missing injected services`, {
        missingRequired,
        missingOptional,
      });
    }

    return { services, missingRequired, missingOptional };
  }

  /**
   * 为插件自动授予 inject 声明服务的访问权限（4.1 授权串联）
   * @param pluginId 插件 ID
   * @param plugin SDK 插件
   */
  grantInjectedAccess(pluginId: string, plugin: SdkPlugin): void {
    const { required, optional } = getInjectedServiceIds(plugin);
    const all = [...required, ...optional];
    if (all.length === 0) return;
    this.registry.grantAccess(pluginId, all as KernelServiceId[]);
    logger.debug(`Granted inject access for ${pluginId}`, {
      services: all,
    });
  }

  /**
   * 构造插件上下文（services 以参数形式跨过隔离边界注入）
   * 同时注入 onDispose（4.3 可逆副作用）：插件注册的逆操作在注销时按 LIFO 执行。
   * @param plugin SDK 插件
   * @param services 已解析的服务实例映射
   * @param extras 可选上下文（log/config/events/utils）
   */
  createContext(
    plugin: SdkPlugin,
    services: Record<string, unknown>,
    extras?: Partial<ContextExtras>
  ): PluginContext {
    const context = createPluginContext({
      pluginId: plugin.id,
      pluginName: plugin.name,
      version: plugin.version,
      services,
      ...extras,
    });

    // 4.3：可逆副作用桥接——登记逆操作，注销时 LIFO 释放
    context.onDispose = (disposer: () => void | Promise<void>): void => {
      const list = this._disposers.get(plugin.id) ?? [];
      list.push(disposer);
      this._disposers.set(plugin.id, list);
    };

    return context;
  }

  /**
   * 释放插件的可逆副作用（4.3）：按 LIFO 顺序执行全部逆操作
   * @param pluginId 插件 ID
   */
  async releaseDisposers(pluginId: string): Promise<void> {
    const list = this._disposers.get(pluginId);
    if (!list || list.length === 0) return;

    // LIFO：后注册的逆操作先执行（对齐 Cordis ctx.effect 逆序撤销）
    const reversed = [...list].reverse();
    this._disposers.delete(pluginId);

    for (const disposer of reversed) {
      try {
        await disposer();
      } catch (error) {
        logger.warn(`SDK plugin ${pluginId} disposer failed`, { error });
      }
    }
  }

  /**
   * 清空插件的可逆副作用（失败回滚时调用）
   * @param pluginId 插件 ID
   */
  clearDisposers(pluginId: string): void {
    this._disposers.delete(pluginId);
  }

  /**
   * 静态校验层（4.4）：inject 第三方服务的提供者插件必须在 dependencies 中声明
   * 命名约定：非 `kernel.*` 服务名首段即提供者插件名（如 "myPlugin.search" → 提供者 myPlugin）。
   * 系统服务（kernel.*）由内核提供，跳过校验。
   * @param plugin SDK 插件
   * @returns 缺少提供者声明的服务列表（非阻断，宿主按 warning 处理）
   */
  validateProviderDependencies(plugin: SdkPlugin): string[] {
    const { required } = getInjectedServiceIds(plugin);
    const declared = new Set<string>([
      ...(plugin.dependencies ?? []),
      ...(plugin.optionalDependencies ?? []),
    ]);
    const missing: string[] = [];

    for (const serviceId of required) {
      // 评审修订 v4（P1-4）：改用内核单一函数，消除 split 启发式重复
      const providerName = getServiceProviderPluginId(serviceId);
      if (providerName && !declared.has(providerName)) {
        missing.push(serviceId);
      }
    }

    if (missing.length > 0) {
      logger.warn(
        `SDK plugin ${plugin.id} 注入的第三方服务未声明提供者插件（静态校验）`,
        { services: missing }
      );
    }

    return missing;
  }

  /**
   * 将 SDK 插件声明的工具注册进全局单例 ToolRegistry（PY-0）
   * ToolRegistration → Tool 适配：
   * - parameters（JSON Schema properties 风格）→ ToolParam[]
   * - execute 返回值包成 ToolResult
   * 冲突语义：onConflict='error'，与已注册工具撞名时报错而非静默覆盖（P0-3）。
   * @param plugin SDK 插件
   */
  registerTools(plugin: SdkPlugin): void {
    const registrations: ToolRegistration[] = plugin.tools ?? [];
    if (registrations.length === 0) return;

    const registry = getToolRegistry();
    for (const registration of registrations) {
      registry.registerTool(toRegisteredTool(registration), {
        onConflict: 'error',
      });
    }
    logger.info(
      `SDK plugin ${plugin.id} registered ${registrations.length} tools`,
      {
        names: registrations.map((t) => t.name),
      }
    );
  }

  /**
   * 注销 SDK 插件的全部工具（全局单例 ToolRegistry 中该插件注册的）
   * @param plugin SDK 插件
   */
  unregisterTools(plugin: SdkPlugin): void {
    const registrations: ToolRegistration[] = plugin.tools ?? [];
    if (registrations.length === 0) return;

    const registry = getToolRegistry();
    for (const registration of registrations) {
      registry.unregisterTool(registration.name);
    }
    logger.info(
      `SDK plugin ${plugin.id} unregistered ${registrations.length} tools`
    );
  }

  /**
   * 执行 SDK 生命周期钩子
   * 映射：initialize↔initialize / activate↔start / deactivate↔stop / destroy↔unload
   * @param phase 生命周期阶段
   * @param plugin SDK 插件
   * @param context 插件上下文
   */
  async runLifecycle(
    phase: 'initialize' | 'activate' | 'deactivate' | 'destroy',
    plugin: SdkPlugin,
    context: PluginContext
  ): Promise<void> {
    const hook = plugin[phase];
    if (typeof hook !== 'function') return;

    try {
      await hook(context);
      logger.debug(`SDK plugin ${plugin.id} ${phase} completed`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new AppError(
        `SDK plugin ${plugin.id} ${phase} failed: ${message}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'SDK_PLUGIN_LIFECYCLE_FAILED'
      );
    }
  }
}

/** JSON Schema properties 条目 → ToolParam 适配 */
function toToolParam(name: string, schema: unknown): ToolParam {
  const s = (schema ?? {}) as Record<string, unknown>;
  return {
    name,
    type: typeof s.type === 'string' ? s.type : 'string',
    description: typeof s.description === 'string' ? s.description : '',
    required: s.required === true,
    default: s.default,
    enum: Array.isArray(s.enum) ? (s.enum as string[]) : undefined,
  };
}

/** ToolRegistration → Tool（buildTool 填充默认方法） */
function toRegisteredTool(registration: ToolRegistration) {
  const schema = (registration.parameters ?? {}) as Record<string, unknown>;
  const params = Object.entries(schema).map(([name, prop]) =>
    toToolParam(name, prop)
  );

  return buildTool({
    name: registration.name,
    description: registration.description,
    params,
    isEnabled: () => true,
    isConcurrencySafe: () => true,
    execute: async (input: Record<string, unknown>) => {
      const result = await registration.execute(input);
      return createToolResult(result);
    },
  });
}
