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
  initialize?: () => Promise<void>;
  destroy?: () => Promise<void>;
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
