/**
 * 时间型微压缩配置
 * * 当距上次助手消息间隔超过阈值时，触发内容清除型微压缩。
 * 此时服务端提示缓存几乎必然已过期，完整前缀将被重写，
 * 提前清除旧的工具结果可减少重写的数据量。
 */

import { configManager } from '@modules/config';
import { handleError } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'services:compact:timeBasedMCConfig',
  level: LogLevel.INFO,
});

export interface TimeBasedMCConfig {
  enabled: boolean;
  gapThresholdMinutes: number;
  keepRecent: number;
}

const TIME_BASED_MC_CONFIG_DEFAULTS: TimeBasedMCConfig = {
  enabled: true,
  gapThresholdMinutes: 60,
  keepRecent: 5,
};

/**
 * 获取时间型微压缩配置
 * 实际项目中可从配置文件或环境变量读取
 */
export function getTimeBasedMCConfig(): TimeBasedMCConfig {
  try {
    const configStr = configManager.env('TIME_BASED_MC_CONFIG');
    if (configStr) {
      const parsed = JSON.parse(configStr);
      return {
        enabled: parsed.enabled ?? TIME_BASED_MC_CONFIG_DEFAULTS.enabled,
        gapThresholdMinutes:
          parsed.gapThresholdMinutes ??
          TIME_BASED_MC_CONFIG_DEFAULTS.gapThresholdMinutes,
        keepRecent:
          parsed.keepRecent ?? TIME_BASED_MC_CONFIG_DEFAULTS.keepRecent,
      };
    }
  } catch (err) {
    // 解析失败时使用默认值

    handleError(err, {
      module: 'services:compact',
      action: 'parseTimeBasedMCConfig',
    });
  }

  return { ...TIME_BASED_MC_CONFIG_DEFAULTS };
}
