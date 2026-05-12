/**
 * 工作密钥处理工具
 * 负责工作密钥的解码和处理
 */

import { WorkSecret } from '../types';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

/**
 * 解码工作密钥
 */
export function decodeWorkSecret(secret: string): WorkSecret {
  try {
    const decoded = Buffer.from(secret, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch (error) {
    throw new AppError('Failed to decode work secret', ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
  }
}

/**
 * 构建SDK URL
 */
export function buildSdkUrl(
  sessionIngressUrl: string,
  sessionId: string
): string {
  return `${sessionIngressUrl}/v1/sessions/${sessionId}`;
}

/**
 * 构建CCR v2 SDK URL
 */
export function buildCCRv2SdkUrl(
  apiBaseUrl: string,
  sessionId: string
): string {
  return `${apiBaseUrl}/v1/code/sessions/${sessionId}`;
}

/**
 * 注册工作器
 */
export async function registerWorker(
  sdkUrl: string,
  sessionToken: string
): Promise<number> {
  const response = await fetch(`${sdkUrl}/register_worker`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    throw new AppError(`Failed to register worker: ${response.status}`, ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
  }

  const data = await response.json();
  return (data as any).epoch;
}

/**
 * 检查会话ID是否相同
 */
export function sameSessionId(id1: string, id2: string): boolean {
  // 提取会话ID的核心部分（去除前缀）
  const coreId1 = id1.replace(/^(session_|cse_)/, '');
  const coreId2 = id2.replace(/^(session_|cse_)/, '');
  return coreId1 === coreId2;
}

/**
 * 生成安全的文件名ID
 */
export function safeFilenameId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, '-');
}
