/**
 * 模块延迟加载策略管理器
 *
 * 将 40+ 模块按优先级分为两类：
 * - CRITICAL：启动时必需加载的核心模块
 * - DEFERRED：可在启动完成后延迟加载的模块
 *
 * DEFERRED 模块进一步分为两种模式：
 * - BATCH：后台批次加载（当前行为），在 T3 阶段按批次后台初始化
 * - ON_DEMAND：首次按需加载，仅在功能被首次请求时通过动态 import() 加载
 *
 * 重型模块（tools、featureflags、memory 等）使用 ON_DEMAND 模式，
 * 避免其重型依赖（GrowthBook SDK、cheerio、jsonwebtoken 等）在启动时被解析。
 */

import { startupTracer } from '../performance/StartupTracer';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 模块加载优先级
 */
export enum ModuleLoadPriority {
  /** 启动时必需加载 */
  CRITICAL = 'critical',
  /** 启动完成后延迟加载 */
  DEFERRED = 'deferred',
}

/**
 * 动态加载模式
 * BATCH：后台批次加载（当前行为），DEFERRED 模块在 T3 阶段按 3 个一批后台初始化
 * ON_DEMAND：首次按需加载，仅在功能被首次请求时才通过动态 import() 加载模块代码
 */
export enum DynamicLoadMode {
  /** 后台批次加载 */
  BATCH = 'batch',
  /** 首次按需加载 */
  ON_DEMAND = 'on_demand',
}

/**
 * 延迟加载策略配置
 */
interface LazyModuleConfig {
  priority: ModuleLoadPriority;
  /** 延迟加载触发条件描述 */
  trigger: string;
  /** 动态加载模式（仅 DEFERRED 模块有效），默认为 BATCH */
  loadMode?: DynamicLoadMode;
}

/**
 * 模块延迟加载策略映射
 *
 * 定义每个模块的加载优先级和延迟条件。
 * CRITICAL 模块在启动时同步加载，DEFERRED 模块在 T2 分发后异步加载。
 * DEFERRED + ON_DEMAND 模块仅在首次被请求时通过动态 import() 加载。
 */
const LAZY_MODULE_STRATEGY: Record<string, LazyModuleConfig> = {
  // ========== 第一阶段：核心基础设施 ==========
  'plugin-sdk': { priority: ModuleLoadPriority.CRITICAL, trigger: '启动必需' },
  core: { priority: ModuleLoadPriority.CRITICAL, trigger: '启动必需' },
  infrastructure: {
    priority: ModuleLoadPriority.CRITICAL,
    trigger: '启动必需',
  },

  // ========== 第二阶段：基础功能模块 ==========
  ai: { priority: ModuleLoadPriority.CRITICAL, trigger: '核心 AI 功能' },
  config: { priority: ModuleLoadPriority.CRITICAL, trigger: '配置管理' },
  context: { priority: ModuleLoadPriority.CRITICAL, trigger: '上下文管理' },
  error: { priority: ModuleLoadPriority.CRITICAL, trigger: '错误处理基础设施' },
  featureflags: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '功能开关首次查询时加载',
    loadMode: DynamicLoadMode.ON_DEMAND,
  },

  // ========== 第三阶段：数据存储模块 ==========
  memory: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '记忆首次读写时加载',
    loadMode: DynamicLoadMode.ON_DEMAND,
  },
  cache: { priority: ModuleLoadPriority.CRITICAL, trigger: '缓存系统' },

  // ========== 第四阶段：功能模块 ==========
  agent: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '代理操作触发时按需加载',
  },
  bridge: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '远程控制触发时按需加载',
  },
  chat: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '聊天会话启用时按需加载',
  },
  chronos: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '定时任务首次调度时加载',
    loadMode: DynamicLoadMode.ON_DEMAND,
  },
  cost: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '成本查询触发时加载',
  },
  hooks: { priority: ModuleLoadPriority.CRITICAL, trigger: '事件系统' },
  lsp: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: 'LSP 功能首次使用时加载',
    loadMode: DynamicLoadMode.ON_DEMAND,
  },
  mcp: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: 'MCP 协议首次请求时加载',
    loadMode: DynamicLoadMode.ON_DEMAND,
  },
  plugins: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '插件首次加载时按需加载',
  },
  query: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '查询操作触发时加载',
  },

  // ========== 第五阶段：界面模块 ==========
  ink: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: 'UI 渲染首次触发时加载',
    loadMode: DynamicLoadMode.ON_DEMAND,
  },
  ui: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '用户界面首次渲染时加载',
    loadMode: DynamicLoadMode.ON_DEMAND,
  },
  cli: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: 'CLI 交互首次触发时加载',
  },

  // ========== 第六阶段：工具模块 ==========
  tools: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '工具首次执行时加载',
    loadMode: DynamicLoadMode.ON_DEMAND,
  },
  commands: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '命令首次执行时加载',
  },

  // ========== 第七阶段：系统模块 ==========
  security: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '安全检查首次触发时加载',
    loadMode: DynamicLoadMode.ON_DEMAND,
  },
  oauth: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: 'OAuth 流程首次触发时加载',
  },
  permission: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '权限校验首次触发时加载',
  },
  sandbox: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '沙箱执行首次触发时加载',
    loadMode: DynamicLoadMode.ON_DEMAND,
  },
  performance: {
    priority: ModuleLoadPriority.CRITICAL,
    trigger: '性能追踪系统',
  },
  monitoring: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '监控首次触发时加载',
  },
  daemon: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '守护进程模式启用时加载',
  },

  // ========== 第八阶段：其他模块 ==========
  analytics: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '分析功能首次触发时加载',
  },
  buddy: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '伙伴功能首次触发时加载',
  },
  docs: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '文档查询首次触发时加载',
  },
  remote: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '远程连接首次请求时加载',
    loadMode: DynamicLoadMode.ON_DEMAND,
  },
  services: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '服务首次调用时加载',
  },
  streaming: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '流式处理首次触发时加载',
  },
  utils: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '工具函数首次调用时加载',
  },
  keybindings: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '快捷键首次触发时加载',
  },
  voice: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '语音功能首次触发时加载',
    loadMode: DynamicLoadMode.ON_DEMAND,
  },
};

/**
 * 重型模块动态导入路径映射
 * 对于 ON_DEMAND 模式的模块，定义其动态 import() 路径。
 * 仅在首次请求时才加载模块代码，启动阶段完全不解析其依赖。
 */
const DYNAMIC_IMPORT_PATHS: Record<string, string> = {
  tools: '../tools/index.js',
  featureflags: '../featureflags/index.js',
  memory: '../memory/index.js',
  chronos: '../chronos/index.js',
  lsp: '../lsp/index.js',
  mcp: '../mcp/index.js',
  ink: '../ink/index.js',
  ui: '../ui/index.js',
  security: '../security/index.js',
  sandbox: '../sandbox/index.js',
  remote: '../remote/index.js',
  voice: '../voice/index.js',
};

/**
 * 获取模块的动态加载模式
 */
export function getModuleLoadMode(moduleId: string): DynamicLoadMode {
  const config = LAZY_MODULE_STRATEGY[moduleId];
  return config?.loadMode ?? DynamicLoadMode.BATCH;
}

/**
 * 检查模块是否为 ON_DEMAND 加载模式
 */
export function isModuleOnDemand(moduleId: string): boolean {
  return getModuleLoadMode(moduleId) === DynamicLoadMode.ON_DEMAND;
}

/**
 * 获取启动时必需加载的模块 ID 列表
 * 保持 MODULE_INITIALIZATION_ORDER 中的相对顺序
 */
export function getEssentialModuleIds(allOrderedModules: string[]): string[] {
  return allOrderedModules.filter((id) => {
    const config = LAZY_MODULE_STRATEGY[id];
    return config && config.priority === ModuleLoadPriority.CRITICAL;
  });
}

/**
 * 获取可延迟加载的模块 ID 列表（BATCH 模式）
 * 排除 ON_DEMAND 模块，这些模块不会被后台批次加载
 */
export function getDeferredModuleIds(allOrderedModules: string[]): string[] {
  return allOrderedModules.filter((id) => {
    const config = LAZY_MODULE_STRATEGY[id];
    return (
      config &&
      config.priority === ModuleLoadPriority.DEFERRED &&
      config.loadMode !== DynamicLoadMode.ON_DEMAND
    );
  });
}

/**
 * 获取按需加载的模块 ID 列表（ON_DEMAND 模式）
 * 这些模块不会被后台批次加载，仅在首次请求时通过动态 import() 加载
 */
export function getOnDemandModuleIds(allOrderedModules: string[]): string[] {
  return allOrderedModules.filter((id) => {
    const config = LAZY_MODULE_STRATEGY[id];
    return (
      config &&
      config.priority === ModuleLoadPriority.DEFERRED &&
      config.loadMode === DynamicLoadMode.ON_DEMAND
    );
  });
}

/**
 * 获取模块的加载优先级
 */
export function getModulePriority(moduleId: string): ModuleLoadPriority {
  const config = LAZY_MODULE_STRATEGY[moduleId];
  return config ? config.priority : ModuleLoadPriority.CRITICAL;
}

/**
 * 检查模块是否可以延迟加载（包含 BATCH 和 ON_DEMAND）
 */
export function isModuleDeferred(moduleId: string): boolean {
  return getModulePriority(moduleId) === ModuleLoadPriority.DEFERRED;
}

/**
 * 内存缓存，避免重复动态加载
 */
const dynamicModuleCache = new Map<string, any>();
const dynamicModuleLoading = new Map<string, Promise<any>>();

/**
 * 按需加载模块（仅 ON_DEMAND 模式使用）
 * 通过动态 import() 加载模块代码，确保重型依赖只在首次请求时解析。
 * 并发请求只会触发一次加载，其余等待同一结果。
 *
 * @param moduleId - 模块 ID
 * @returns 模块导出对象
 */
export async function requestModule(moduleId: string): Promise<any> {
  const cached = dynamicModuleCache.get(moduleId);
  if (cached) return cached;

  const inFlight = dynamicModuleLoading.get(moduleId);
  if (inFlight) return inFlight;

  const importPath = DYNAMIC_IMPORT_PATHS[moduleId];
  if (!importPath) {
    throw new Error(`模块 ${moduleId} 未配置动态导入路径`);
  }

  const loadPromise = (async () => {
    const tracePhase = `on_demand:${moduleId}`;
    startupTracer.traceStart(tracePhase);

    try {
      logger.info(`按需动态加载模块: ${moduleId} (${importPath})`);
      const mod = await import(importPath);
      dynamicModuleCache.set(moduleId, mod);
      logger.info(`按需动态加载完成: ${moduleId}`);
      return mod;
    } finally {
      dynamicModuleLoading.delete(moduleId);
      startupTracer.traceEnd(tracePhase);
    }
  })();

  dynamicModuleLoading.set(moduleId, loadPromise);
  return loadPromise;
}

/**
 * 获取 ON_DEMAND 模块的动态导入路径
 */
export function getDynamicImportPath(moduleId: string): string | undefined {
  return DYNAMIC_IMPORT_PATHS[moduleId];
}

/**
 * 检查模块是否有动态导入路径配置
 */
export function hasDynamicImport(moduleId: string): boolean {
  return moduleId in DYNAMIC_IMPORT_PATHS;
}

/**
 * 延迟加载状态追踪
 */
export interface DeferredLoadState {
  moduleId: string;
  status: 'pending' | 'loading' | 'loaded' | 'error';
  error?: Error;
  startTime?: number;
  endTime?: number;
}

/**
 * 延迟加载调度器
 *
 * 在 T2 分发完成后，按优先级批次加载 DEFERRED 模块。
 * 使用 setImmediate 实现非阻塞调度，不影响主线程响应。
 */
export class DeferredLoader {
  private states: Map<string, DeferredLoadState> = new Map();
  private loadedCount = 0;
  private errorCount = 0;
  private scheduled = false;

  /**
   * 获取所有延迟加载模块的状态
   */
  getStates(): DeferredLoadState[] {
    return Array.from(this.states.values());
  }

  /**
   * 获取已加载的模块数量
   */
  getLoadedCount(): number {
    return this.loadedCount;
  }

  /**
   * 获取加载失败的模块数量
   */
  getErrorCount(): number {
    return this.errorCount;
  }

  /**
   * 获取待加载的模块数量
   */
  getPendingCount(): number {
    return this.getStates().filter((s) => s.status === 'pending').length;
  }

  /**
   * 是否所有延迟模块已加载完成
   */
  isAllLoaded(): boolean {
    return this.getPendingCount() === 0 && this.scheduled;
  }

  /**
   * 注册并调度延迟加载
   *
   * @param deferredIds - 可延迟加载的模块 ID 列表
   * @param initializeFn - 模块初始化函数（接收模块 ID）
   * @param batchSize - 每批次并发加载数量，默认 3
   */
  schedule(
    deferredIds: string[],
    initializeFn: (moduleId: string) => Promise<void>,
    batchSize = 3
  ): void {
    if (this.scheduled) return;
    this.scheduled = true;

    for (const moduleId of deferredIds) {
      this.states.set(moduleId, { moduleId, status: 'pending' });
    }

    const totalBatches = Math.ceil(deferredIds.length / batchSize);
    logger.info(
      `延迟加载调度: ${deferredIds.length} 个模块, ${totalBatches} 批次, 每批 ${batchSize} 个`
    );

    this.scheduleNextBatch(deferredIds, initializeFn, batchSize, 0);
  }

  /**
   * 调度下一批延迟加载
   */
  private scheduleNextBatch(
    deferredIds: string[],
    initializeFn: (moduleId: string) => Promise<void>,
    batchSize: number,
    startIndex: number
  ): void {
    if (startIndex >= deferredIds.length) {
      logger.info(
        `延迟加载完成: ${this.loadedCount} 成功, ${this.errorCount} 失败`
      );
      return;
    }

    const batch = deferredIds.slice(startIndex, startIndex + batchSize);
    const batchNum = Math.floor(startIndex / batchSize) + 1;

    setImmediate(async () => {
      logger.info(`延迟加载批次 ${batchNum}: [${batch.join(', ')}]`);

      await Promise.all(
        batch.map((moduleId) => this.loadModule(moduleId, initializeFn))
      );

      this.scheduleNextBatch(
        deferredIds,
        initializeFn,
        batchSize,
        startIndex + batchSize
      );
    });
  }

  /**
   * 加载单个延迟模块
   */
  private async loadModule(
    moduleId: string,
    initializeFn: (moduleId: string) => Promise<void>
  ): Promise<void> {
    const state = this.states.get(moduleId);
    if (!state || state.status !== 'pending') return;

    state.status = 'loading';
    state.startTime = Date.now();

    const tracePhase = `deferred:${moduleId}`;
    startupTracer.traceStart(tracePhase);

    try {
      await initializeFn(moduleId);

      state.status = 'loaded';
      state.endTime = Date.now();
      this.loadedCount++;

      startupTracer.traceEnd(tracePhase);
      const duration = state.endTime - state.startTime;
      logger.info(`延迟模块加载完成: ${moduleId} (${duration}ms)`);
    } catch (error) {
      state.status = 'error';
      state.error = error as Error;
      state.endTime = Date.now();
      this.errorCount++;

      logger.error(`延迟模块加载失败: ${moduleId}`, error as Error);
    }
  }
}

/** 全局延迟加载调度器实例 */
export const deferredLoader = new DeferredLoader();
