/**
 * 依赖注入容器类型定义
 */

/** 服务作用域 */
export type ServiceScope = 'singleton' | 'transient' | 'request';

/** 容器配置 */
export interface ContainerConfig {
  defaultScope: ServiceScope;
  autoDispose: boolean;
  detectCycles: boolean;
}

/** 默认容器配置 */
export const DEFAULT_CONTAINER_CONFIG: ContainerConfig = {
  defaultScope: 'singleton',
  autoDispose: true,
  detectCycles: true,
};

/** 服务描述符 */
export interface ServiceDescriptor<T = unknown> {
  id: string;
  factory: () => T;
  scope: ServiceScope;
  dependencies?: string[];
  optionalDependencies?: string[];

  /** 初始化阶段：服务实例创建后立即调用 */
  onInit?: (instance: T) => Promise<void>;

  /** 加载阶段：所有服务注册完成后，按依赖序调用 */
  onLoad?: (instance: T) => Promise<void>;

  /** 就绪阶段：所有依赖已就绪，执行业务初始化 */
  onReady?: (instance: T) => Promise<void>;

  /** 销毁阶段：释放资源，逆序调用 */
  onDispose?: (instance: T) => Promise<void>;
}

/** 循环依赖检测结果 */
export interface CycleDetectionResult {
  hasCycle: boolean;
  cycle?: string[];
}

/**
 * 启动选项
 * 传递给 DIContainer.bootstrap() 的统一启动配置
 */
export interface BootstrapOptions {
  /** 启动模式 */
  mode?: 'cli' | 'repl' | 'mcp' | 'daemon' | 'test' | 'oneshot';
  /** 调试模式 */
  debug?: boolean;
  /** 详细输出 */
  verbose?: boolean;
  /** 命令行参数 */
  args?: string[];
  /** 跳过环境初始化（用于测试） */
  skipEnvInit?: boolean;
}
