/**
 * 环境变量工具函数
 */

import { resolvePyappHome } from '@modules/config/paths';

/**
 * 检查环境变量是否为真值
 */
export function isEnvTruthy(envVar: string | undefined): boolean {
  if (!envVar) return false;
  const value = envVar.toLowerCase();
  return value === 'true' || value === '1' || value === 'yes' || value === 'y';
}

/**
 * 获取环境变量，如果不存在则返回默认值
 */
export function getEnv(name: string, defaultValue?: string): string {
  return process.env[name] || defaultValue || '';
}

/**
 * 检查是否在开发模式
 */
export function isDevMode(): boolean {
  return (
    isEnvTruthy(process.env.NODE_ENV) &&
    process.env.NODE_ENV?.toLowerCase() === 'development'
  );
}

/**
 * 检查是否在生产模式
 */
export function isProdMode(): boolean {
  return !isDevMode();
}

/**
 * 获取配置文件的主目录
 * 委托给 paths.ts 的统一路径管理
 */
export function getConfigHomeDir(): string {
  return resolvePyappHome();
}
