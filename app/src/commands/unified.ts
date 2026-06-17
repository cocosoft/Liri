/**
 * Commands 模块统一出口（架构优化 §6.1: 渐进式分层简化）
 *
 * 将 builtin/ executor/ history/ loader/ manager/ pipeline/ registry/ types/
 * 8个子目录统一到单一 import 入口，使用方无需深入子目录。
 *
 * 用法：import { commandRegistry, CommandExecutor, AdvancedCommandHistory } from '@modules/commands';
 */
export { commandRegistry } from './registry/index.js';
export { CommandExecutor, commandExecutor } from './executor/index.js';
export {
  CommandPipeline,
  commandPipeline,
  PipelineStage,
} from './pipeline/index.js';
export type {
  PipelineContext,
  PipelineHandler,
  PipelineMiddleware,
  PipelineExecutionResult,
  IPipeline,
} from './pipeline/index.js';
export {
  commandLoaderRegistry,
  BuiltinCommandLoader,
  SkillCommandLoader,
  PluginCommandLoader,
  MCPCommandLoader,
  CommandLoaderRegistry,
} from './loader/CommandLoader.js';
export {
  CommandManager,
  getCommandManager,
  initializeCommands,
} from './manager/CommandManager.js';
export {
  AdvancedCommandHistory,
  advancedCommandHistory,
} from './history/index.js';
export type {
  HistoryEntry,
  HistoryQuery,
  CommandStats,
  HistoryTrend,
  IAdvancedCommandHistory,
} from './history/index.js';
