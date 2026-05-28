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
} from './types/index.js';

export { commandRegistry } from './registry/index.js';
export {
  EnhancedCommandRegistry,
  enhancedCommandRegistry,
  CommandCategory,
} from './registry/index.js';
export type {
  CommandPermission,
  CommandDependency,
  CommandMetadata,
  DependencyGraph,
  IEnhancedCommandRegistry,
} from './registry/index.js';

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

// 导出内置命令（不使用 export * 以避免与 export default 冲突）
export { helpCommand } from './builtin/help/index.js';
export { statusCommand } from './builtin/status/index.js';
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
export { activityCommand } from './builtin/activity/index.js';
export { costCommand } from './builtin/cost/index.js';
export { usageCommand } from './builtin/usage/index.js';
export { doctorCommand } from './builtin/doctor/index.js';
export { fastCommand } from './builtin/fast/index.js';
export { memoryCommand } from './builtin/memory/index.js';
export { hooksCommand } from './builtin/hooks/index.js';
export { mcpCommand } from './builtin/mcp/index.js';
export { pluginsCommand } from './builtin/plugins/index.js';
export { branchCommand } from './builtin/branch/index.js';
export { addDirCommand } from './builtin/add-dir/index.js';
export { contextCommand } from './builtin/context/index.js';
export { renameCommand } from './builtin/rename/index.js';
export { rewindCommand } from './builtin/rewind/index.js';
export { initCommand } from './builtin/init/index.js';
export { effortCommand } from './builtin/effort/index.js';
export { keybindingsCommand } from './builtin/keybindings/index.js';
export { permissionsCommand } from './builtin/permissions/index.js';
export { privacySettingsCommand } from './builtin/privacy-settings/index.js';
export { outputStyleCommand } from './builtin/output-style/index.js';
export { filesCommand } from './builtin/files/index.js';
export { sandboxToggleCommand } from './builtin/sandbox-toggle/index.js';
export { remoteEnvCommand } from './builtin/remote-env/index.js';
export { insightsCommand } from './builtin/insights/index.js';
export { planCommand } from './builtin/plan/index.js';
export { upgradeCommand } from './builtin/upgrade/index.js';
export { passesCommand } from './builtin/passes/index.js';
export { reloadPluginsCommand } from './builtin/reload-plugins/index.js';
export { terminalSetupCommand } from './builtin/terminalSetup/index.js';
export { feedbackCommand } from './builtin/feedback/index.js';
export { extraUsageCommand } from './builtin/extra-usage/index.js';
export { releaseNotesCommand } from './builtin/release-notes/index.js';
export { thinkbackCommand } from './builtin/thinkback/index.js';
export { statuslineCommand } from './builtin/statusline/index.js';
export { rateLimitOptionsCommand } from './builtin/rate-limit-options/index.js';
export { chromeCommand } from './builtin/chrome/index.js';
export { btwCommand } from './builtin/btw/index.js';
export { tagCommand } from './builtin/tag/index.js';
export { colorCommand } from './builtin/color/index.js';
export { desktopCommand } from './builtin/desktop/index.js';
export { mobileCommand } from './builtin/mobile/index.js';
export { loginCommand } from './builtin/login/index.js';
export { logoutCommand } from './builtin/logout/index.js';
export { installGithubAppCommand } from './builtin/install-github-app/index.js';
export { installSlackAppCommand } from './builtin/install-slack-app/index.js';
export { stickersCommand } from './builtin/stickers/index.js';
export { heapdumpCommand } from './builtin/heapdump/index.js';
export { prCommentsCommand } from './builtin/pr-comments/index.js';
export { searchCommand } from './builtin/search/index.js';
export { restartCommand } from './builtin/restart/index.js';
export { tutorialCommand } from './builtin/tutorial/index.js';
export { debugCommand } from './builtin/debug/index.js';
export { themeCommand } from './builtin/theme/index.js';
export { keyboardCommand } from './builtin/keyboard/index.js';
export { workspaceCommand } from './builtin/workspace/index.js';
export { timerCommand } from './builtin/timer/index.js';

// Gateway 通道管理命令
export { gatewayCommand } from './builtin/gateway/index.js';
