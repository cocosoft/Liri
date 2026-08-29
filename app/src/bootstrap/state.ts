/**
 * 应用启动状态管理
 * 负责管理应用启动过程中的状态和初始化
 * * 会话ID相关类型和函数已移至 core/state/types.ts，
 * 此处保留导出以保持向后兼容
 */

import { profileCheckpoint } from '../performance/StartupProfiler.js';
import { generateSystemSessionId } from '@modules/system/state/index.js';
import type { SessionId } from '@modules/system/state/index.js';
import { configManager } from '@modules/config';
export type { SessionId };
export { generateSystemSessionId };

/**
 * 慢操作记录
 */
export interface SlowOperation {
  description: string;
  duration: number;
  timestamp: number;
}

/**
 * 应用启动状态
 */
export interface AppStartupState {
  configInitialized: boolean;
  analyticsInitialized: boolean;
  authInitialized: boolean;
  pluginsInitialized: boolean;
  skillsInitialized: boolean;
  startTime: number;
  phase: 'initializing' | 'initialized' | 'running' | 'error';
  error?: string;

  originalCwd: string;
  projectRoot: string;
  cwd: string;
  sessionId: SessionId;
  parentSessionId: SessionId | undefined;
  isInteractive: boolean;
  clientType: string;
  sessionSource: string | undefined;
  flagSettingsPath: string | undefined;
  flagSettingsInline: Record<string, unknown> | null;
  allowedSettingSources: string[];
  totalCostUSD: number;
  totalAPIDuration: number;
  totalToolDuration: number;
  lastInteractionTime: number;
  sessionTrustAccepted: boolean;
  sessionPersistenceDisabled: boolean;
  isRemoteMode: boolean;
  mainThreadAgentType: string | undefined;
}

let slowOperations: SlowOperation[] = [];

let startupState: AppStartupState = {
  configInitialized: false,
  analyticsInitialized: false,
  authInitialized: false,
  pluginsInitialized: false,
  skillsInitialized: false,
  startTime: Date.now(),
  phase: 'initializing',

  originalCwd: configManager.env('LIRI_PROJECT_DIR') || process.cwd(),
  projectRoot: configManager.env('LIRI_PROJECT_DIR') || process.cwd(),
  cwd: configManager.env('LIRI_PROJECT_DIR') || process.cwd(),
  sessionId: generateSystemSessionId(),
  parentSessionId: undefined,
  isInteractive: true,
  clientType: 'cli',
  sessionSource: undefined,
  flagSettingsPath: undefined,
  flagSettingsInline: null,
  allowedSettingSources: ['userSettings', 'projectSettings', 'localSettings'],
  totalCostUSD: 0,
  totalAPIDuration: 0,
  totalToolDuration: 0,
  lastInteractionTime: Date.now(),
  sessionTrustAccepted: false,
  sessionPersistenceDisabled: false,
  isRemoteMode: false,
  mainThreadAgentType: undefined,
};

/**
 * 获取启动状态
 */
export function getStartupState(): AppStartupState {
  return { ...startupState };
}

/**
 * 更新启动状态
 */
export function updateStartupState(updates: Partial<AppStartupState>): void {
  startupState = { ...startupState, ...updates };
  profileCheckpoint(`startup_state_${startupState.phase}`);
}

/**
 * 获取原始工作目录
 */
export function getOriginalCwd(): string {
  return startupState.originalCwd;
}

/**
 * 获取项目根目录
 */
export function getProjectRoot(): string {
  return startupState.projectRoot;
}

/**
 * 设置项目根目录
 */
export function setProjectRoot(root: string): void {
  updateStartupState({ projectRoot: root });
}

/**
 * 获取当前工作目录
 */
export function getCwd(): string {
  return startupState.cwd;
}

/**
 * 设置当前工作目录
 */
export function setCwd(cwd: string): void {
  updateStartupState({ cwd });
}

/**
 * 获取会话ID
 */
export function getSessionId(): SessionId {
  return startupState.sessionId;
}

/**
 * 获取父会话ID
 */
export function getParentSessionId(): SessionId | undefined {
  return startupState.parentSessionId;
}

/**
 * 设置父会话ID
 */
export function setParentSessionId(parentId: SessionId | undefined): void {
  updateStartupState({ parentSessionId: parentId });
}

/**
 * 获取标志设置路径
 */
export function getFlagSettingsPath(): string | undefined {
  return startupState.flagSettingsPath;
}

/**
 * 获取标志设置内联内容
 */
export function getFlagSettingsInline(): Record<string, unknown> | null {
  return startupState.flagSettingsInline;
}

/**
 * 获取允许的设置源
 */
export function getAllowedSettingSources(): string[] {
  return startupState.allowedSettingSources;
}

/**
 * 检查是否使用Cowork插件
 */
export function getUseCoworkPlugins(): boolean {
  return startupState.clientType === 'cowork';
}

/**
 * 增加API成本
 */
export function addCostUSD(cost: number): void {
  startupState.totalCostUSD += cost;
  startupState.lastInteractionTime = Date.now();
}

/**
 * 增加API持续时间
 */
export function addAPIDuration(duration: number): void {
  startupState.totalAPIDuration += duration;
}

/**
 * 增加工具持续时间
 */
export function addToolDuration(duration: number): void {
  startupState.totalToolDuration += duration;
}

/**
 * 标记配置已初始化
 */
export function markConfigInitialized(): void {
  updateStartupState({ configInitialized: true });
  profileCheckpoint('config_initialized');
}

/**
 * 标记分析系统已初始化
 */
export function markAnalyticsInitialized(): void {
  updateStartupState({ analyticsInitialized: true });
  profileCheckpoint('analytics_initialized');
}

/**
 * 标记认证已初始化
 */
export function markAuthInitialized(): void {
  updateStartupState({ authInitialized: true });
  profileCheckpoint('auth_initialized');
}

/**
 * 标记插件系统已初始化
 */
export function markPluginsInitialized(): void {
  updateStartupState({ pluginsInitialized: true });
  profileCheckpoint('plugins_initialized');
}

/**
 * 标记技能系统已初始化
 */
export function markSkillsInitialized(): void {
  updateStartupState({ skillsInitialized: true });
  profileCheckpoint('skills_initialized');
}

/**
 * 标记启动完成
 */
export function markStartupComplete(): void {
  updateStartupState({ phase: 'initialized' });
  profileCheckpoint('startup_complete');
}

/**
 * 标记应用运行中
 */
export function markAppRunning(): void {
  updateStartupState({ phase: 'running' });
  profileCheckpoint('app_running');
}

/**
 * 标记启动错误
 */
export function markStartupError(error: string): void {
  updateStartupState({ phase: 'error', error });
  profileCheckpoint('startup_error');
}

/**
 * 重置启动状态
 */
export function resetStartupState(): void {
  startupState = {
    configInitialized: false,
    analyticsInitialized: false,
    authInitialized: false,
    pluginsInitialized: false,
    skillsInitialized: false,
    startTime: Date.now(),
    phase: 'initializing',
    originalCwd: configManager.env('LIRI_PROJECT_DIR') || process.cwd(),
    projectRoot: configManager.env('LIRI_PROJECT_DIR') || process.cwd(),
    cwd: configManager.env('LIRI_PROJECT_DIR') || process.cwd(),
    sessionId: generateSystemSessionId(),
    parentSessionId: undefined,
    isInteractive: true,
    clientType: 'cli',
    sessionSource: undefined,
    flagSettingsPath: undefined,
    flagSettingsInline: null,
    allowedSettingSources: ['userSettings', 'projectSettings', 'localSettings'],
    totalCostUSD: 0,
    totalAPIDuration: 0,
    totalToolDuration: 0,
    lastInteractionTime: Date.now(),
    sessionTrustAccepted: false,
    sessionPersistenceDisabled: false,
    isRemoteMode: false,
    mainThreadAgentType: undefined,
  };
  profileCheckpoint('startup_state_reset');
}

/**
 * 添加慢操作记录
 */
export function addSlowOperation(description: string, duration: number): void {
  slowOperations.push({
    description,
    duration,
    timestamp: Date.now(),
  });

  if (slowOperations.length > 1000) {
    slowOperations = slowOperations.slice(-1000);
  }
}

/**
 * 获取慢操作记录
 */
export function getSlowOperations(): SlowOperation[] {
  return [...slowOperations];
}

/**
 * 清除慢操作记录
 */
export function clearSlowOperations(): void {
  slowOperations = [];
}
