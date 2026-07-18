/**
 * Prompt Suggestion配置和启用检查模块
 */

import { getPromptSuggestionDatabase } from './database/PromptSuggestionDatabase';
import type { SuggestionSource } from './types';
import { configManager } from '@modules/config';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('PromptSuggestionConfig');

interface EnvUtils {
  isEnvDefinedFalsy: (value: string | undefined) => boolean;
  isEnvTruthy: (value: string | undefined) => boolean;
}

const envUtils: EnvUtils = {
  isEnvDefinedFalsy: (value) => {
    return (
      value !== undefined &&
      (value === '' || value === '0' || value.toLowerCase() === 'false')
    );
  },
  isEnvTruthy: (value) => {
    return (
      value !== undefined &&
      value !== '' &&
      value !== '0' &&
      value.toLowerCase() !== 'false'
    );
  },
};

interface AnalyticsEvent {
  enabled: boolean;
  source: string;
}

interface Analytics {
  logEvent: (eventName: string, metadata: AnalyticsEvent) => void;
}

let analytics: Analytics | null = null;

function getAnalytics(): Analytics {
  if (!analytics) {
    analytics = {
      logEvent: (eventName: string, metadata: AnalyticsEvent) => {
        if (process.env.DEBUG_PROMPT_SUGGESTION === 'true') {
          logger.debug('分析事件', {
            eventName,
            metadata: JSON.stringify(metadata),
          });
        }
      },
    };
  }
  return analytics;
}

interface AppState {
  promptSuggestionEnabled: boolean;
  pendingWorkerRequest: boolean | undefined;
  pendingSandboxRequest: boolean | undefined;
  elicitation: { queue: unknown[] };
  toolPermissionContext: { mode: string };
}

interface InitialSettings {
  promptSuggestionEnabled?: boolean;
}

interface SettingsManager {
  getInitialSettings: () => InitialSettings | null;
}

let settingsManager: SettingsManager | null = null;

function getSettingsManager(): SettingsManager {
  if (!settingsManager) {
    settingsManager = {
      getInitialSettings: () => {
        return null;
      },
    };
  }
  return settingsManager;
}

interface FeatureValueResult {
  value: boolean;
}

interface FeatureManager {
  getFeatureValue_CACHED_MAY_BE_STALE: (
    key: string,
    defaultValue: boolean
  ) => boolean;
}

let featureManager: FeatureManager | null = null;

function getFeatureManager(): FeatureManager {
  if (!featureManager) {
    featureManager = {
      getFeatureValue_CACHED_MAY_BE_STALE: (
        key: string,
        defaultValue: boolean
      ) => {
        const envKey = `FEATURE_${key.toUpperCase()}`;
        const envValue = process.env[envKey];
        if (envValue !== undefined) {
          return envValue !== 'false';
        }
        return defaultValue;
      },
    };
  }
  return featureManager;
}

interface SessionChecker {
  getIsNonInteractiveSession: () => boolean;
}

let sessionChecker: SessionChecker | null = null;

function getSessionChecker(): SessionChecker {
  if (!sessionChecker) {
    sessionChecker = {
      getIsNonInteractiveSession: () => {
        return process.env.PYAPP_NON_INTERACTIVE === 'true';
      },
    };
  }
  return sessionChecker;
}

interface SwarmChecker {
  isAgentSwarmsEnabled: () => boolean;
  isTeammate: () => boolean;
}

let swarmChecker: SwarmChecker | null = null;

function getSwarmChecker(): SwarmChecker {
  if (!swarmChecker) {
    swarmChecker = {
      isAgentSwarmsEnabled: () => {
        return configManager.env('AGENT_SWARMS_ENABLED') === 'true';
      },
      isTeammate: () => {
        return configManager.env('IS_TEAMMATE') === 'true';
      },
    };
  }
  return swarmChecker;
}

/**
 * 检查是否应该启用Prompt Suggestion功能
 * 优先级：环境变量 > 功能开关 > 非交互模式 > Swarm队友 > 用户设置
 */
export function shouldEnablePromptSuggestion(): boolean {
  const log = getAnalytics().logEvent;
  const envOverride = configManager.env('PYAPP_ENABLE_PROMPT_SUGGESTION');

  if (envUtils.isEnvDefinedFalsy(envOverride)) {
    log('tengu_prompt_suggestion_init', {
      enabled: false,
      source: 'env',
    });
    return false;
  }

  if (envUtils.isEnvTruthy(envOverride)) {
    log('tengu_prompt_suggestion_init', {
      enabled: true,
      source: 'env',
    });
    return true;
  }

  const featureEnabled =
    getFeatureManager().getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_chomp_inflection',
      false
    );

  if (!featureEnabled) {
    log('tengu_prompt_suggestion_init', {
      enabled: false,
      source: 'growthbook',
    });
    return false;
  }

  if (getSessionChecker().getIsNonInteractiveSession()) {
    log('tengu_prompt_suggestion_init', {
      enabled: false,
      source: 'non_interactive',
    });
    return false;
  }

  if (
    getSwarmChecker().isAgentSwarmsEnabled() &&
    getSwarmChecker().isTeammate()
  ) {
    log('tengu_prompt_suggestion_init', {
      enabled: false,
      source: 'swarm_teammate',
    });
    return false;
  }

  const settings = getSettingsManager().getInitialSettings();
  const enabled = settings?.promptSuggestionEnabled !== false;

  log('tengu_prompt_suggestion_init', {
    enabled,
    source: 'setting',
  });

  return enabled;
}

/**
 * 获取建议抑制原因
 * 返回null表示允许生成建议
 */
export function getSuggestionSuppressReason(appState: AppState): string | null {
  if (!appState.promptSuggestionEnabled) {
    return 'disabled';
  }

  if (appState.pendingWorkerRequest || appState.pendingSandboxRequest) {
    return 'pending_permission';
  }

  if (appState.elicitation?.queue?.length > 0) {
    return 'elicitation_active';
  }

  if (appState.toolPermissionContext?.mode === 'plan') {
    return 'plan_mode';
  }

  if (configManager.env('USER_TYPE') === 'external' && !isRateLimitAllowed()) {
    return 'rate_limit';
  }

  return null;
}

/**
 * 检查速率限制是否允许
 */
function isRateLimitAllowed(): boolean {
  return configManager.env('RATE_LIMIT_STATUS') === 'allowed';
}

/**
 * 设置分析器
 */
export function setPromptSuggestionAnalytics(
  analyticsInstance: Analytics
): void {
  analytics = analyticsInstance;
}

/**
 * 设置配置管理器
 */
export function setSettingsManager(manager: SettingsManager): void {
  settingsManager = manager;
}

/**
 * 设置功能开关管理器
 */
export function setFeatureManager(manager: FeatureManager): void {
  featureManager = manager;
}

/**
 * 设置会话检查器
 */
export function setSessionChecker(checker: SessionChecker): void {
  sessionChecker = checker;
}

/**
 * 设置Swarm检查器
 */
export function setSwarmChecker(checker: SwarmChecker): void {
  swarmChecker = checker;
}

/**
 * 获取当前配置状态
 */
export async function getPromptSuggestionConfig(): Promise<{
  enabled: boolean;
  source: string;
}> {
  const envOverride = configManager.env('PYAPP_ENABLE_PROMPT_SUGGESTION');

  if (envUtils.isEnvDefinedFalsy(envOverride)) {
    return { enabled: false, source: 'env' };
  }

  if (envUtils.isEnvTruthy(envOverride)) {
    return { enabled: true, source: 'env' };
  }

  const featureEnabled =
    getFeatureManager().getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_chomp_inflection',
      false
    );

  if (!featureEnabled) {
    return { enabled: false, source: 'growthbook' };
  }

  if (getSessionChecker().getIsNonInteractiveSession()) {
    return { enabled: false, source: 'non_interactive' };
  }

  if (
    getSwarmChecker().isAgentSwarmsEnabled() &&
    getSwarmChecker().isTeammate()
  ) {
    return { enabled: false, source: 'swarm_teammate' };
  }

  return { enabled: true, source: 'setting' };
}
