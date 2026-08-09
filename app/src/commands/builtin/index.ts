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
 * 内置命令导出
 * 注意：不能使用 export * from 因为很多模块有 export default
 */

// 基础命令
export { helpCommand } from './help/index.js';
export { statusCommand } from './command-registry.js';
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
export { activityCommand } from './command-registry.js';
export { costCommand } from './command-registry.js';
export { tokensCommand } from './command-registry.js';
export { usageCommand } from './command-registry.js';
export { doctorCommand } from './command-registry.js';
export { envCommand } from './command-registry.js';
export { fastCommand } from './command-registry.js';
export { memoryCommand } from './command-registry.js';
export { hooksCommand } from './command-registry.js';
export { mcpCommand } from './command-registry.js';
export { pluginsCommand } from './command-registry.js';
export { branchCommand } from './branch/index.js';

// 新增高优先级命令
export { addDirCommand } from './command-registry.js';
export { contextCommand } from './command-registry.js';
export { renameCommand } from './command-registry.js';
export { rewindCommand } from './command-registry.js';
export { initCommand } from './command-registry.js';

// 新增中优先级命令
export { effortCommand } from './command-registry.js';
export { keybindingsCommand } from './command-registry.js';
export { permissionsCommand } from './command-registry.js';
export { privacySettingsCommand } from './command-registry.js';
export { outputStyleCommand } from './command-registry.js';
export { filesCommand } from './command-registry.js';
export { sandboxToggleCommand } from './command-registry.js';
export { remoteEnvCommand } from './command-registry.js';
export { insightsCommand } from './command-registry.js';
export { planCommand } from './command-registry.js';
export { upgradeCommand } from './command-registry.js';
export { passesCommand } from './command-registry.js';
export { reloadPluginsCommand } from './command-registry.js';

// 新增额外命令
export { terminalSetupCommand } from './command-registry.js';
export { feedbackCommand } from './command-registry.js';
export { extraUsageCommand } from './command-registry.js';
export { releaseNotesCommand } from './command-registry.js';
export { thinkbackCommand } from './command-registry.js';
export { statuslineCommand } from './command-registry.js';
export { rateLimitOptionsCommand } from './command-registry.js';
export { chromeCommand } from './command-registry.js';
export { btwCommand } from './command-registry.js';
export { tagCommand } from './command-registry.js';

// 新增进一步提升的命令
export { colorCommand } from './command-registry.js';
export { desktopCommand } from './command-registry.js';
export { mobileCommand } from './command-registry.js';
export { loginCommand } from './command-registry.js';
export { logoutCommand } from './command-registry.js';
export { installGithubAppCommand } from './command-registry.js';
export { installSlackAppCommand } from './command-registry.js';
export { stickersCommand } from './command-registry.js';
export { heapdumpCommand } from './command-registry.js';
export { prCommentsCommand } from './command-registry.js';
export { searchCommand } from './command-registry.js';
export { restartCommand } from './command-registry.js';
export { tutorialCommand } from './command-registry.js';
export { debugCommand } from './command-registry.js';
export { themeCommand } from './command-registry.js';
export { keyboardCommand } from './command-registry.js';
export { workspaceCommand } from './workspace/index.js';
export { timerCommand } from './command-registry.js';

// 遗漏命令补充
export { diffCommand } from './diff/index.js';
export { reviewCommand } from './command-registry.js';
export { resumeCommand } from './resume/index.js';

// AI Trace 录制模块命令
export { traceRecordingCommand } from './trace-recording/index.js';

// CC 对标补充命令
export { commitPushPrCommand } from './commit-push-pr/index.js';
export { thinkbackPlayCommand } from './command-registry.js';
export { securityReviewCommand } from './security-review/index.js';

// Gateway 通道管理命令
export { gatewayCommand } from './gateway/index.js';

// 文档与卸载命令
export { docsCommand } from './command-registry.js';
export { uninstallCommand } from './command-registry.js';

// 入手指引、健康检查与任务管理
export { onboardCommand } from './command-registry.js';
export { healthCommand } from './command-registry.js';
export { tasksCommand } from './command-registry.js';

// 对话演示（离线模式预览）
export { demoCommand } from './command-registry.js';

// 模型命令（来自 commands/model）
export { modelCommand } from '../model/index.js';

// 供应商管理命令（来自 commands/provider）
export { providerCommand } from '../provider/index.js';

// 余额查询命令（来自 commands/balance）
export { balanceCommand } from '../balance/index.js';

// 使用量统计命令（来自 commands/usagestats）
export { usagestatsCommand } from '../usagestats/index.js';

// 通道命令（来自 commands/channel）
export { channelCmd } from '../channel/index.js';
