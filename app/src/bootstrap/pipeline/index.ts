/**
 * BootPipeline — 统一启动管道
 *
 * 提供单一启动入口，将初始化过程划分为 8 个有序阶段。
 *
 * 宿主（2026-09-30 实测更正）: 当前**唯一消费方是启动基准脚本** `app/scripts/benchmark-startup.ts`
 * （经 `executePipeline()`）；`main.ts → launch()` **尚未接线到本管道**。本条原写
 * "入口点: main.ts → launch() → bootPipeline.execute()" 与代码不符，已按实测更正；
 * "是否接线 / 是否删" 属产品决策，另立评估（不在本轮搬迁范围内）。
 *
 * 归属（2026-09-30，台账 D-82）：本目录由 `core/boot/` 迁至 **entry 层**的 `bootstrap/pipeline/`
 * —— 启动装配 / 进程入口职责；留在 core 层会构成 11 对 `core → 上层` 倒挂。
 *
 * @see BootPhase — 8 阶段枚举
 * @see BootPipeline — 管道实现
 */

export { BootPhase, BOOT_PHASES, getBootPhaseMeta } from './BootPhase';
export type { BootPhaseMeta } from './BootPhase';

export { BootPipeline, bootPipeline } from './BootPipeline';
export type {
  BootContext,
  BootHandler,
  BootHandlerDescriptor,
  BootEvent,
  BootEventType,
  BootEventListener,
  PhaseResult,
  BootResult,
} from './BootPipeline';

export {
  registerStandardHandlers,
  executePipeline,
} from './BootPipelineIntegrator';
