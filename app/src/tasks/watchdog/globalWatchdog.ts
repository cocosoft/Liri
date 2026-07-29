/**
 * 全局 Watchdog 单例 — 避免每个 bridge 调用创建新实例
 */
import type { ProcessWatchdog } from '../../daemon/ProcessWatchdog';

let _globalWatchdog: ProcessWatchdog | null = null;

export function getGlobalWatchdog(
  ProcessWatchdogClass: typeof ProcessWatchdog
): ProcessWatchdog {
  if (!_globalWatchdog) {
    _globalWatchdog = new ProcessWatchdogClass();
  }
  return _globalWatchdog;
}
