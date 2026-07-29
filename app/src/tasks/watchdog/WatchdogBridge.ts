/**
 * WatchdogBridge — CG3 模块与进程看门狗的桥接层
 *
 * P2-8: 封装 ProcessWatchdog，让 AlwaysOnRuntime/SelfWake 监控
 * 子进程 stdout/stderr 输出，检测预定义异常模式并触发告警。
 *
 * 对标 hermes-agent process_registry 看门狗：
 *   - watch_patterns 正则匹配
 *   - 速率限制（同一模式最小通知间隔）
 *   - 全局断路器（连续告警超阈值后自动静默）
 *
 * 自身不导入 @modules/core 或 @modules/monitoring。
 */
import { cg3Log } from '../cg3Env';

export interface WatchPattern {
  name: string;
  pattern: RegExp;
  severity: 'info' | 'warn' | 'error';
  rateLimitMs?: number;
  description: string;
}

export interface WatchdogStats {
  totalMatches: number;
  activeAlerts: number;
  circuitOpen: boolean;
  patternHits: Record<string, number>;
}

export class WatchdogBridge {
  /**
   * 喂入一行输出，检测预定义异常模式
   * @returns 匹配到的模式列表
   */
  async feed(
    line: string
  ): Promise<Array<{ pattern: string; severity: string }>> {
    try {
      const { ProcessWatchdog } = await import('../../daemon/ProcessWatchdog');
      const { getGlobalWatchdog } = await import('./globalWatchdog');
      const wd = getGlobalWatchdog(ProcessWatchdog);
      return wd.feed(line);
    } catch (err) {
      cg3Log(
        'tasks:watchdog:bridge',
        'error',
        'feedFailed',
        { error: String(err) }
      );
      return [];
    }
  }

  /** 获取统计 */
  async getStats(): Promise<WatchdogStats> {
    try {
      const { ProcessWatchdog } = await import('../../daemon/ProcessWatchdog');
      const { getGlobalWatchdog } = await import('./globalWatchdog');
      return getGlobalWatchdog(ProcessWatchdog).getStats();
    } catch {
      return {
        totalMatches: 0,
        activeAlerts: 0,
        circuitOpen: false,
        patternHits: {},
      };
    }
  }

  /** 重置统计 */
  async reset(): Promise<void> {
    try {
      const { ProcessWatchdog } = await import('../../daemon/ProcessWatchdog');
      const { getGlobalWatchdog } = await import('./globalWatchdog');
      getGlobalWatchdog(ProcessWatchdog).reset();
    } catch {
      // best-effort
    }
  }
}

/** 全局单例 */
let _wdBridge: WatchdogBridge | null = null;

export function getWatchdogBridge(): WatchdogBridge {
  if (!_wdBridge) _wdBridge = new WatchdogBridge();
  return _wdBridge;
}
