/**
 * BootPipeline — 统一启动管道
 *
 * 提供单一启动入口，将初始化过程划分为 8 个有序阶段。
 *
 * 入口点:
 * - main.ts → launch() → bootPipeline.execute()
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
