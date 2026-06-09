/**
 * 事件元数据
 *
 * 提供事件元数据的收集和格式化功能。
 * 参考 CC源码 cc_code/backend/services/analytics/metadata.ts
 */

import { configManager } from '@modules/config';

export interface EventMetadata {
  sessionId?: string;
  model?: string;
  provider?: string;
  platform?: string;
  version?: string;
  timestamp: string;
  [key: string]: boolean | number | string | undefined;
}

export function getDefaultMetadata(
  extra?: Record<string, string | number | boolean | undefined>
): EventMetadata {
  return {
    timestamp: new Date().toISOString(),
    platform: process.platform,
    version: configManager.env('Liri_VERSION') || '1.0.0',
    ...extra,
  };
}
