/**
 * CLI模块导出文件
 * 导出远程IO、结构化IO、退出处理器、自动更新器、历史记录、补全和交互式shell
 */

export * from './remoteIO';
export * from './structuredIO';
export * from './exitHandler';
export * from './autoUpdater';
export * from './history';
export * from './completion';
export * from './interactive';
export * from './handlers';

export { RemoteIO } from './remoteIO';
export { StructuredIO } from './structuredIO';
export { ExitHandler } from './exitHandler';
export { AutoUpdater } from './autoUpdater';
export { CommandHistory } from './history';
export { CommandCompleter } from './completion';
export { InteractiveShell } from './interactive';
export { createRemoteIO } from './remoteIO';
export { createStructuredIO } from './structuredIO';
export { createExitHandler } from './exitHandler';
export { createAutoUpdater } from './autoUpdater';
export { createCommandHistory } from './history';
export { createCommandCompleter } from './completion';
export { createInteractiveShell } from './interactive';

// 全局实例
export { commandHistory } from './history';
export { commandCompleter } from './completion';
export { interactiveShell } from './interactive';