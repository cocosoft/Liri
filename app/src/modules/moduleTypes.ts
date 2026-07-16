/**
 * 模块系统共享类型和 DI 工具
 * 从 ModuleRegistry.ts 提取，打破 ModuleRegistry ↔ ModuleInitializer ↔ ModuleDefinitions 循环依赖
 */

/**
 * 模块类别枚举
 */
export enum ModuleCategory {
  CORE = 'core',
  INFRASTRUCTURE = 'infrastructure',
  AI = 'ai',
  AGENT = 'agent',
  BRIDGE = 'bridge',
  UI = 'ui',
  CLI = 'cli',
  TOOLS = 'tools',
  COMMANDS = 'commands',
  MEMORY = 'memory',
  CACHE = 'cache',
  SECURITY = 'security',
  PERFORMANCE = 'performance',
  MONITORING = 'monitoring',
  OTHER = 'other',
  OFFICE = 'office',
}

/**
 * 模块定义接口
 */
export interface ModuleDefinition {
  id: string;
  name: string;
  displayName: string;
  version: string;
  category: ModuleCategory;
  description: string;
  tier?: string;
  dependencies: string[];
  optionalDependencies: string[];
  configSchema?: object;

  /** @deprecated 由 onLoad 替代，保留向后兼容 */
  initialize?: () => Promise<void>;

  /** @deprecated 由 onDestroy 替代，保留向后兼容 */
  destroy?: () => Promise<void>;

  /** 加载阶段：依赖注入完成，服务已注册但未初始化 */
  onLoad?: () => Promise<void>;

  /** 就绪阶段：所有依赖模块已就绪，执行业务初始化 */
  onReady?: () => Promise<void>;

  /** 销毁阶段：释放资源，逆序调用 */
  onDestroy?: () => Promise<void>;

  instance?: any;
}

/**
 * 模块注册表最小接口（DI 用，避免循环依赖）
 */
export interface _ModuleRegistry {
  register(module: ModuleDefinition): void;
  initialize(moduleId: string): Promise<void>;
  destroy(moduleId: string): Promise<void>;
  find(id: string): ModuleDefinition | undefined;
  getStatistics(): {
    total: number;
    initialized: number;
    byCategory: Record<ModuleCategory, number>;
  };
}

let _registry: _ModuleRegistry | null = null;

export function initRegistry(registry: _ModuleRegistry): void {
  _registry = registry;
}

export function getRegistry(): _ModuleRegistry {
  if (!_registry) {
    throw new Error(
      'ModuleRegistry not initialized. Call initRegistry() first.'
    );
  }
  return _registry;
}
