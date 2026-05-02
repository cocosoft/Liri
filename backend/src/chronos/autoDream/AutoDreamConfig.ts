/**
 * AutoDream配置模块
 * 基于CC源码 cc_code/backend/services/autoDream/config.ts 实现
 * 用于检查自动内存整合是否启用
 */

interface AutoDreamConfig {
  enabled: boolean;
  minHours: number;
  minSessions: number;
}

const DEFAULT_CONFIG: AutoDreamConfig = {
  enabled: true,
  minHours: 24,
  minSessions: 5,
};

let cachedConfig: AutoDreamConfig | null = null;

export function getAutoDreamConfig(): AutoDreamConfig {
  if (cachedConfig !== null) {
    return cachedConfig;
  }

  const envEnabled = process.env.AUTO_DREAM_ENABLED;
  const enabled =
    envEnabled !== undefined ? envEnabled === 'true' : DEFAULT_CONFIG.enabled;

  const envMinHours = process.env.AUTO_DREAM_MIN_HOURS;
  const minHours = envMinHours
    ? parseInt(envMinHours, 10)
    : DEFAULT_CONFIG.minHours;

  const envMinSessions = process.env.AUTO_DREAM_MIN_SESSIONS;
  const minSessions = envMinSessions
    ? parseInt(envMinSessions, 10)
    : DEFAULT_CONFIG.minSessions;

  cachedConfig = {
    enabled,
    minHours:
      Number.isFinite(minHours) && minHours > 0
        ? minHours
        : DEFAULT_CONFIG.minHours,
    minSessions:
      Number.isFinite(minSessions) && minSessions > 0
        ? minSessions
        : DEFAULT_CONFIG.minSessions,
  };

  return cachedConfig;
}

export function isAutoDreamEnabled(): boolean {
  return getAutoDreamConfig().enabled;
}

export function resetAutoDreamConfigCache(): void {
  cachedConfig = null;
}
