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
  onInit?: (instance: T) => Promise<void>;
  onDispose?: (instance: T) => Promise<void>;
}

/** 循环依赖检测结果 */
export interface CycleDetectionResult {
  hasCycle: boolean;
  cycle?: string[];
}
