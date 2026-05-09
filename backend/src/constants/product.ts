/**
 * 产品配置常量
 * 基于CC源码 cc_code/backend/constants/product.ts 实现
 * 去除Anthropic/CLAUDE特定内容，适配PY_APP
 */

/**
 * 产品主页URL
 */
export const PRODUCT_URL = 'https://pyapp.dev';

/**
 * 远程会话基础URL
 */
export const APP_BASE_URL = 'https://app.pyapp.dev';
export const APP_STAGING_BASE_URL = 'https://app-staging.pyapp.dev';
export const APP_LOCAL_BASE_URL = 'http://localhost:4000';

/**
 * 判断是否为预发布环境的远程会话
 * 通过会话ID格式和入口URL判断
 */
export function isRemoteSessionStaging(
  sessionId?: string,
  ingressUrl?: string
): boolean {
  return (
    sessionId?.includes('_staging_') === true ||
    ingressUrl?.includes('staging') === true
  );
}

/**
 * 判断是否为本地开发环境的远程会话
 * 通过会话ID格式（如 session_local_...）和入口URL判断
 */
export function isRemoteSessionLocal(
  sessionId?: string,
  ingressUrl?: string
): boolean {
  return (
    sessionId?.includes('_local_') === true ||
    ingressUrl?.includes('localhost') === true
  );
}

/**
 * 根据环境获取应用基础URL
 */
export function getAppBaseUrl(sessionId?: string, ingressUrl?: string): string {
  if (isRemoteSessionLocal(sessionId, ingressUrl)) {
    return APP_LOCAL_BASE_URL;
  }
  if (isRemoteSessionStaging(sessionId, ingressUrl)) {
    return APP_STAGING_BASE_URL;
  }
  return APP_BASE_URL;
}

/**
 * 获取远程会话的完整URL
 * 根据会话ID和入口URL确定环境，拼接完整会话地址
 */
export function getRemoteSessionUrl(
  sessionId: string,
  ingressUrl?: string
): string {
  const baseUrl = getAppBaseUrl(sessionId, ingressUrl);
  return `${baseUrl}/code/${sessionId}`;
}
