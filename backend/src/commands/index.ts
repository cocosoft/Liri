/**
 * 命令系统模块导出
 */

export type {
  Command,
  CommandContext,
  CommandResult,
  CommandLoader,
} from './types/index.js';

export { commandRegistry } from './registry/index.js';
export { EnhancedCommandRegistry, enhancedCommandRegistry, CommandCategory } from './registry/index.js';
export type { CommandPermission, CommandDependency, CommandMetadata, DependencyGraph, IEnhancedCommandRegistry } from './registry/index.js';

export { CommandExecutor, commandExecutor } from './executor/index.js';

export { CommandPipeline, commandPipeline, PipelineStage } from './pipeline/index.js';
export type { PipelineContext, PipelineHandler, PipelineMiddleware, PipelineExecutionResult, IPipeline } from './pipeline/index.js';

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

export { AdvancedCommandHistory, advancedCommandHistory } from './history/index.js';
export type { HistoryEntry, HistoryQuery, CommandStats, HistoryTrend, IAdvancedCommandHistory } from './history/index.js';

export * from './builtin/index.js';
export * from './types/index.js';
