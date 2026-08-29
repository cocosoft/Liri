// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * 命令系统模块导出
 */

export type {
  Command,
  CommandContext,
  CommandResult,
  CommandLoader,
  CommandType,
  CommandImplementation,
  CommandLoadStatus,
  LoadResult,
  ParsedCommand,
} from './types/index.js';

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
export { commandHistoryManager } from './history/CommandHistoryManager.js';
export { getEnhancedCommandHistory } from './history/EnhancedCommandHistory.js';

export { commandCompletionManager } from './completion/CommandCompletionManager.js';

export { CommandCatalog, commandCatalog } from './framework/index.js';

export { getCommandParser } from './parser/index.js';

export {
  REMOTE_SAFE_COMMANDS,
  BRIDGE_SAFE_COMMANDS,
  COMMAND_TYPES,
  COMMAND_SOURCES,
} from './constants/CommandConstants.js';

// 导出内置命令（不使用 export * 以避免与 export default 冲突）
export { helpCommand } from './builtin/help/index.js';
export { statusCommand } from './builtin/command-registry.js';
export { clearCommand } from './builtin/clear/index.js';
export { exitCommand } from './builtin/exit/index.js';
export { versionCommand } from './builtin/version/index.js';
export { sessionCommand } from './builtin/session/index.js';
export { configCommand } from './builtin/config/index.js';
export { skillCommand } from './builtin/skill/index.js';
export { toolCommand } from './builtin/tool/index.js';
export { compactCommand } from './builtin/compact/index.js';
export { historyCommand } from './builtin/history/index.js';
export { advisorCommand } from './builtin/advisor/index.js';
export { briefCommand } from './builtin/brief/index.js';
export { cacheCommand } from './builtin/cache/index.js';
export { chatCommand } from './builtin/chat/index.js';
export { commitCommand } from './builtin/commit/index.js';
export { completeCommand } from './builtin/complete/index.js';
export { parallelCommand } from './builtin/parallel/index.js';
export { securityCommand } from './builtin/security/index.js';
export { vimCommand } from './builtin/vim/index.js';
export { copyCommand } from './builtin/copy/index.js';
export { voiceCommand } from './builtin/voice/index.js';
export { exportCommand } from './builtin/export/index.js';
export { shareCommand } from './builtin/share/index.js';
export { activityCommand } from './builtin/command-registry.js';
export { costCommand } from './builtin/command-registry.js';
export { usageCommand } from './builtin/command-registry.js';
export { doctorCommand } from './builtin/command-registry.js';
export { fastCommand } from './builtin/command-registry.js';
export { memoryCommand } from './builtin/command-registry.js';
export { hooksCommand } from './builtin/command-registry.js';
export { mcpCommand } from './builtin/command-registry.js';
export { pluginsCommand } from './builtin/command-registry.js';
export { branchCommand } from './builtin/branch/index.js';
export { addDirCommand } from './builtin/command-registry.js';
export { contextCommand } from './builtin/command-registry.js';
export { renameCommand } from './builtin/command-registry.js';
export { rewindCommand } from './builtin/command-registry.js';
export { initCommand } from './builtin/command-registry.js';
export { effortCommand } from './builtin/command-registry.js';
export { keybindingsCommand } from './builtin/command-registry.js';
export { permissionsCommand } from './builtin/command-registry.js';
export { privacySettingsCommand } from './builtin/command-registry.js';
export { outputStyleCommand } from './builtin/command-registry.js';
export { filesCommand } from './builtin/command-registry.js';
export { sandboxToggleCommand } from './builtin/command-registry.js';
export { remoteEnvCommand } from './builtin/command-registry.js';
export { insightsCommand } from './builtin/command-registry.js';
export { planCommand } from './builtin/command-registry.js';
export { upgradeCommand } from './builtin/command-registry.js';
export { passesCommand } from './builtin/command-registry.js';
export { reloadPluginsCommand } from './builtin/command-registry.js';
export { terminalSetupCommand } from './builtin/command-registry.js';
export { feedbackCommand } from './builtin/command-registry.js';
export { extraUsageCommand } from './builtin/command-registry.js';
export { releaseNotesCommand } from './builtin/command-registry.js';
export { thinkbackCommand } from './builtin/command-registry.js';
export { statuslineCommand } from './builtin/command-registry.js';
export { rateLimitOptionsCommand } from './builtin/command-registry.js';
export { chromeCommand } from './builtin/command-registry.js';
export { btwCommand } from './builtin/command-registry.js';
export { tagCommand } from './builtin/command-registry.js';
export { colorCommand } from './builtin/command-registry.js';
export { desktopCommand } from './builtin/command-registry.js';
export { mobileCommand } from './builtin/command-registry.js';
export { loginCommand } from './builtin/command-registry.js';
export { logoutCommand } from './builtin/command-registry.js';
export { installGithubAppCommand } from './builtin/command-registry.js';
export { installSlackAppCommand } from './builtin/command-registry.js';
export { stickersCommand } from './builtin/command-registry.js';
export { heapdumpCommand } from './builtin/command-registry.js';
export { prCommentsCommand } from './builtin/command-registry.js';
export { searchCommand } from './builtin/command-registry.js';
export { restartCommand } from './builtin/command-registry.js';
export { tutorialCommand } from './builtin/command-registry.js';
export { debugCommand } from './builtin/command-registry.js';
export { themeCommand } from './builtin/command-registry.js';
export { keyboardCommand } from './builtin/command-registry.js';
export { workspaceCommand } from './builtin/workspace/index.js';
export { timerCommand } from './builtin/command-registry.js';

// Gateway 通道管理命令
export { gatewayCommand } from './builtin/gateway/index.js';

// Cron 定时作业管理命令
export { cronCommand } from './cron/index.js';

// 2026-08-30 R03-002 收敛：builtin 子路径统一出口
export { getDiff } from './builtin/diff/Diff.js';
export type { DiffResult } from './builtin/diff/Diff.js';
export { reviewCommand } from './builtin/command-registry.js';
