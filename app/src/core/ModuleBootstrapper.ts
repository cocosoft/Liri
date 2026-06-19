/**
 * ModuleBootstrapper — 模块引导接口
 *
 * 定义模块系统的统一引导契约，替代 AppCore 中的模块管理职责。
 * DIContainer 通过实现/委托此接口成为唯一的模块引导入口。
 *
 * 生命周期阶段：
 *   1. REGISTER — 注册所有模块定义
 *   2. LOAD     — 调用各模块 onLoad（依赖注入就绪）
 *   3. READY    — 调用各模块 onReady（业务逻辑就绪）
 *   4. DESTROY  — 逆序调用 onDestroy（优雅关闭）
 */

import type { BootstrapOptions } from './di/types';

/** 引导阶段枚举 */
export enum BootstrapPhase {
  /** 未启动 */
  IDLE = 'idle',
  /** 注册阶段 */
  REGISTER = 'register',
  /** 加载阶段 */
  LOAD = 'load',
  /** 就绪阶段 */
  READY = 'ready',
  /** 已启动完成 */
  BOOTED = 'booted',
  /** 销毁中 */
  DESTROYING = 'destroying',
  /** 已销毁 */
  DESTROYED = 'destroyed',
}

/** 模块生命周期钩子 */
export interface ModuleLifecycle {
  /** 加载阶段：依赖注入完成，服务已注册但未初始化 */
  onLoad?(): Promise<void>;

  /** 就绪阶段：所有依赖模块已就绪，执行业务初始化 */
  onReady?(): Promise<void>;

  /** 销毁阶段：释放资源，逆序调用 */
  onDestroy?(): Promise<void>;
}

/** 模块引导描述符（含生命周期钩子的模块定义） */
export interface BootstrapperModule extends ModuleLifecycle {
  /** 模块唯一标识 */
  id: string;

  /** 模块名称 */
  name: string;

  /** 版本号 */
  version: string;

  /** 显示名称 */
  displayName?: string;

  /** 模块描述 */
  description?: string;

  /** 依赖模块 ID 列表 */
  dependencies?: string[];

  /** 可选依赖 */
  optionalDependencies?: string[];
}

/** 模块启动优先级 */
export enum BootstrapPriority {
  /** 必需模块：启动时立即初始化 */
  CRITICAL = 0,
  /** 默认模块：按依赖顺序初始化 */
  NORMAL = 1,
  /** 延迟模块：在后台异步加载 */
  DEFERRED = 2,
  /** 按需模块：首次访问时加载 */
  ON_DEMAND = 3,
}

/** 引导进度报告 */
export interface BootstrapProgress {
  phase: BootstrapPhase;
  currentModule?: string;
  completedModules: number;
  totalModules: number;
  elapsed: number;
}

/**
 * ModuleBootstrapper — 模块引导接口
 *
 * 实现类应：
 * - 管理模块的注册、加载、就绪和销毁生命周期
 * - 支持 CRITICAL → NORMAL → DEFERRED 优先级调度
 * - 提供进度报告和错误处理
 * - 兼容 --use-legacy-module-system 回退标志
 */
export interface ModuleBootstrapper {
  /** 当前引导阶段 */
  readonly phase: BootstrapPhase;

  /** 已注册模块数量 */
  readonly moduleCount: number;

  /** 注册模块 */
  register(module: BootstrapperModule, priority?: BootstrapPriority): void;

  /** 批量注册模块 */
  registerAll(modules: BootstrapperModule[], defaultPriority?: BootstrapPriority): void;

  /** 执行完整启动流程：REGISTER → LOAD → READY */
  bootstrap(options?: BootstrapOptions): Promise<void>;

  /** 仅执行 LOAD 阶段（用于测试） */
  loadOnly(): Promise<void>;

  /** 仅执行 READY 阶段（用于测试） */
  readyOnly(): Promise<void>;

  /** 优雅关闭所有模块（逆序调用 onDestroy） */
  shutdown(): Promise<void>;

  /** 获取指定模块 */
  getModule(id: string): BootstrapperModule | undefined;

  /** 获取当前进度 */
  getProgress(): BootstrapProgress;
}
