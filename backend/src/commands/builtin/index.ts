/**
 * 内置命令导出
 * 注意：不能使用 export * from 因为很多模块有 export default
 */

// 基础命令
export { helpCommand } from './help/index.js';
export { statusCommand } from './status/index.js';
export { clearCommand } from './clear/index.js';
export { exitCommand } from './exit/index.js';
export { versionCommand } from './version/index.js';
export { sessionCommand } from './session/index.js';
export { configCommand } from './config/index.js';
export { skillCommand } from './skill/index.js';
export { toolCommand } from './tool/index.js';
export { compactCommand } from './compact/index.js';
export { historyCommand } from './history/index.js';
export { advisorCommand } from './advisor/index.js';
export { briefCommand } from './brief/index.js';
export { cacheCommand } from './cache/index.js';
export { chatCommand } from './chat/index.js';
export { commitCommand } from './commit/index.js';
export { completeCommand } from './complete/index.js';
export { gitCommand } from './git/index.js';
export { parallelCommand } from './parallel/index.js';
export { securityCommand } from './security/index.js';
export { vimCommand } from './vim/index.js';
export { copyCommand } from './copy/index.js';
export { voiceCommand } from './voice/index.js';
export { exportCommand } from './export/index.js';
export { shareCommand } from './share/index.js';
export { statsCommand } from './stats/index.js';
export { costCommand } from './cost/index.js';
export { usageCommand } from './usage/index.js';
export { doctorCommand } from './doctor/index.js';
export { fastCommand } from './fast/index.js';
export { memoryCommand } from './memory/index.js';
export { hooksCommand } from './hooks/index.js';
export { mcpCommand } from './mcp/index.js';
export { pluginsCommand } from './plugins/index.js';
export { branchCommand } from './branch/index.js';

// 新增高优先级命令
export { addDirCommand } from './add-dir/index.js';
export { contextCommand } from './context/index.js';
export { renameCommand } from './rename/index.js';
export { rewindCommand } from './rewind/index.js';
export { initCommand } from './init/index.js';

// 新增中优先级命令
export { effortCommand } from './effort/index.js';
export { keybindingsCommand } from './keybindings/index.js';
export { permissionsCommand } from './permissions/index.js';
export { privacySettingsCommand } from './privacy-settings/index.js';
export { outputStyleCommand } from './output-style/index.js';
export { filesCommand } from './files/index.js';
export { sandboxToggleCommand } from './sandbox-toggle/index.js';
export { remoteEnvCommand } from './remote-env/index.js';
export { insightsCommand } from './insights/index.js';
export { planCommand } from './plan/index.js';
export { upgradeCommand } from './upgrade/index.js';
export { passesCommand } from './passes/index.js';
export { reloadPluginsCommand } from './reload-plugins/index.js';

// 新增额外命令
export { terminalSetupCommand } from './terminalSetup/index.js';
export { feedbackCommand } from './feedback/index.js';
export { extraUsageCommand } from './extra-usage/index.js';
export { releaseNotesCommand } from './release-notes/index.js';
export { thinkbackCommand } from './thinkback/index.js';
export { statuslineCommand } from './statusline/index.js';
export { rateLimitOptionsCommand } from './rate-limit-options/index.js';
export { chromeCommand } from './chrome/index.js';
export { btwCommand } from './btw/index.js';
export { tagCommand } from './tag/index.js';

// 新增进一步提升的命令
export { colorCommand } from './color/index.js';
export { desktopCommand } from './desktop/index.js';
export { mobileCommand } from './mobile/index.js';
export { loginCommand } from './login/index.js';
export { logoutCommand } from './logout/index.js';
export { installGithubAppCommand } from './install-github-app/index.js';
export { installSlackAppCommand } from './install-slack-app/index.js';
export { stickersCommand } from './stickers/index.js';
export { heapdumpCommand } from './heapdump/index.js';
export { prCommentsCommand } from './pr-comments/index.js';
export { searchCommand } from './search/index.js';
export { restartCommand } from './restart/index.js';
export { tutorialCommand } from './tutorial/index.js';
export { debugCommand } from './debug/index.js';
export { themeCommand } from './theme/index.js';
export { keyboardCommand } from './keyboard/index.js';
export { workspaceCommand } from './workspace/index.js';
export { timerCommand } from './timer/index.js';
