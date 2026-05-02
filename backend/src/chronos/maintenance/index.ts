/**
 * Chronos后台维护模块导出
 */

export {
  startBackgroundHousekeeping,
  stopBackgroundHousekeeping,
  isBackgroundHousekeepingRunning,
  setLastInteractionTime,
  getLastInteractionTime,
  setIsInteractive,
  getIsInteractive,
} from './ChronosBackgroundHousekeeping';

export {
  cleanupOldMessageFilesInBackground,
  cleanupOldVersionsThrottled,
  cleanupNpmCacheForAnthropicPackages,
  cleanupOldVersions,
  cleanupStaleLocks,
  runPeriodicCleanup,
} from './cleanup';
