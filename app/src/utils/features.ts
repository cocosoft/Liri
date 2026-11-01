/**
 * 工具函数集
 *
 * 注意：基础功能标志请使用 @modules/core/featureFlags.ts
 */

import { isEnvTruthy } from './envUtils.js';
import { readUtilEnv } from './envAccess';

/**
 * 检查是否为 ANT 用户类型
 */
export function isAntUser(): boolean {
  return readUtilEnv('USER_TYPE') === 'ant';
}

/**
 * 检查是否为简单模式
 */
export function isSimpleMode(): boolean {
  return isEnvTruthy(readUtilEnv('PYAPP_SIMPLE_MODE'));
}
