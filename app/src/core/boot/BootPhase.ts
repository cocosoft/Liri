/**
 * BootPhase — 启动阶段枚举
 *
 * 定义 BootPipeline 的 8 个启动阶段，涵盖从环境检测到启动完成的完整链路。
 * 各模块通过 register() 将自己的初始化逻辑注册到对应阶段。
 */

/**
 * 启动阶段枚举
 */
export enum BootPhase {
  /** Phase 1: 环境检测 — Node/Bun 运行时检测、系统兼容性检查 */
  ENV_DETECT = 'env_detect',

  /** Phase 2: 配置加载 — ConfigLoader → ConfigManager */
  CONFIG_LOAD = 'config_load',

  /** Phase 3: 核心基础设施初始化 — Logger, Error, State, EventBus */
  CORE_INFRA = 'core_infra',

  /** Phase 4: DIContainer 启动 — 服务注册 → 依赖解析 → 自动装配 */
  DI_STARTUP = 'di_startup',

  /** Phase 5: 领域模块初始化 — Agent, Chat, Session, Memory 等 */
  DOMAIN_INIT = 'domain_init',

  /** Phase 6: 基础设施启动 — Cache, Channels, Security, Monitoring */
  INFRA_STARTUP = 'infra_startup',

  /** Phase 7: 接口层启动 — CLI, API, WebSocket 等 */
  INTERFACE_START = 'interface_start',

  /** Phase 8: 启动完成回调 */
  BOOT_COMPLETE = 'boot_complete',
}

/**
 * 阶段元数据
 */
export interface BootPhaseMeta {
  /** 阶段枚举值 */
  phase: BootPhase;

  /** 阶段显示名称 */
  label: string;

  /** 执行顺序（从 1 开始递增） */
  order: number;

  /** 阶段描述 */
  description: string;
}

/**
 * 所有阶段的元数据列表（按执行顺序排列）
 */
export const BOOT_PHASES: BootPhaseMeta[] = [
  {
    phase: BootPhase.ENV_DETECT,
    label: '环境检测',
    order: 1,
    description: 'Node/Bun 运行时检测、系统兼容性检查',
  },
  {
    phase: BootPhase.CONFIG_LOAD,
    label: '配置加载',
    order: 2,
    description: 'ConfigLoader → ConfigManager',
  },
  {
    phase: BootPhase.CORE_INFRA,
    label: '核心基础设施',
    order: 3,
    description: 'Logger, Error, State, EventBus 初始化',
  },
  {
    phase: BootPhase.DI_STARTUP,
    label: 'DI 容器启动',
    order: 4,
    description: 'DIContainer 启动 — 服务注册 → 依赖解析 → 自动装配',
  },
  {
    phase: BootPhase.DOMAIN_INIT,
    label: '领域模块初始化',
    order: 5,
    description: 'Agent, Chat, Session, Memory 等业务模块',
  },
  {
    phase: BootPhase.INFRA_STARTUP,
    label: '基础设施启动',
    order: 6,
    description: 'Cache, Channels, Security, Monitoring',
  },
  {
    phase: BootPhase.INTERFACE_START,
    label: '接口层启动',
    order: 7,
    description: 'CLI, API, WebSocket 等外部接口',
  },
  {
    phase: BootPhase.BOOT_COMPLETE,
    label: '启动完成',
    order: 8,
    description: '启动完成回调',
  },
];

/**
 * 根据阶段枚举获取元数据
 */
export function getBootPhaseMeta(phase: BootPhase): BootPhaseMeta {
  const meta = BOOT_PHASES.find((p) => p.phase === phase);
  if (!meta) {
    throw new Error(`Unknown boot phase: ${phase}`);
  }
  return meta;
}
