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

/** 三种作用域**共有**的字段 */
export interface ServiceDescriptorBase<T = unknown> {
  id: string;
  factory: () => T;
  dependencies?: string[];
  optionalDependencies?: string[];

  /**
   * 预先实例化：`loadAll()` 前强制 resolve 一次，使 `onLoad`/`onReady` 不再依赖
   * 「谁先被 resolve」这一隐式条件（评审 #8）。
   */
  eager?: boolean;

  /** 初始化阶段：服务实例创建后立即调用 */
  onInit?: (instance: T) => Promise<void>;

  /** 加载阶段：所有服务注册完成后，按依赖序调用 */
  onLoad?: (instance: T) => Promise<void>;

  /** 就绪阶段：所有依赖已就绪，执行业务初始化 */
  onReady?: (instance: T) => Promise<void>;
}

/** singleton：**唯一**支持 `onDispose` 的作用域（实例由容器持有，关闭时可逆序释放） */
export interface SingletonDescriptor<T = unknown>
  extends ServiceDescriptorBase<T> {
  scope: 'singleton';
  /** 销毁阶段（逆序调用） */
  onDispose?: (instance: T) => Promise<void>;
}

/**
 * transient / request：**不允许** `onDispose`。
 *
 * 这两类实例不由容器持有（transient 每次新建、request 随请求结束失效）⇒ 没有可靠的销毁时机。
 * 用 `onDispose?: never` 把它变成**编译错误**（2026-10-24 评审：契约由类型表达），
 * 运行时仍保留 `DI_ONDISPOSE_REQUIRES_SINGLETON` 作为纵深防御。
 */
export interface NonSingletonDescriptor<T = unknown>
  extends ServiceDescriptorBase<T> {
  scope: 'transient' | 'request';
  onDispose?: never;
}

/**
 * 服务描述符（判别联合，按 `scope` 收窄）。
 *
 * 为什么不是单一 interface：三作用域对 `onDispose` 的能力完全不同；
 * 单一 interface 只能靠运行时抛错兜住"声明了却永不执行"的死契约。
 */
export type ServiceDescriptor<T = unknown> =
  | SingletonDescriptor<T>
  | NonSingletonDescriptor<T>;

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
  mode?:
    | 'cli'
    | 'repl'
    | 'mcp'
    | 'daemon'
    | 'test'
    | 'oneshot'
    // L-12.1（2026-10-09）：发布流水线干净环境冒烟入口（引导完成后打印并退出）
    | 'healthcheck';
  /** 调试模式 */
  debug?: boolean;
  /** 详细输出 */
  verbose?: boolean;
  /** 命令行参数 */
  args?: string[];
  /**
   * 环境初始化回调（**由入口注入**）—— 2026-09-30 台账 D-127（`R00-003` ⑤）
   *
   * ⚠️ 本接口与 `modules/ModuleRegistry.ts` 的同名 `BootstrapOptions` 是**历史双声明**，
   * 结构须保持一致（已在台账 D-127 附注登记为待归一化项）。
   */
  initializeEnvironment?: () => Promise<void>;
  /**
   * SPI 实现装配回调（**由入口注入**）—— 2026-09-30 台账 D-128（`R00-003` ② 改造）
   *
   * **推送模型**：实现体在 entry 侧装配模块构建后**主动注册**进 core 端口，
   * 消除 `core/spi/*` 反向动态导入 `ai`/`services`/`channels` 产生的跨层对。
   * 调用时机 = 原逐块注册点 ⇒ **注册顺序与时机不变**。
   * ⚠️ 与 `modules/ModuleRegistry.ts` 的同名接口**结构须保持一致**（历史双声明）。
   */
  registerSpis?: (container: {
    registerDescriptor: <T>(desc: {
      id: string;
      factory: () => T;
      scope: 'singleton' | 'transient' | 'request';
    }) => void;
  }) => Promise<void>;
  /** 跳过环境初始化（用于测试） */
  skipEnvInit?: boolean;
}
