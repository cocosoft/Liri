/**
 * 受信设备管理
 * 负责受信设备Token的生成、存储和清理
 * 基于CC源码 cc_code/backend/bridge/trustedDevice.ts 实现
 */

import { randomBytes } from 'crypto';

const TRUSTED_DEVICE_TOKEN_KEY = 'PY_APP_TRUSTED_DEVICE_TOKEN';

const tokenStorage = new Map<string, string>();

function getStoredToken(): string | undefined {
  return tokenStorage.get(TRUSTED_DEVICE_TOKEN_KEY);
}

function storeToken(token: string): void {
  tokenStorage.set(TRUSTED_DEVICE_TOKEN_KEY, token);
}

function clearStoredToken(): void {
  tokenStorage.delete(TRUSTED_DEVICE_TOKEN_KEY);
}

export function getTrustedDeviceToken(): string | undefined {
  return process.env.PY_APP_TRUSTED_DEVICE_TOKEN || getStoredToken();
}

export function clearTrustedDeviceToken(): void {
  clearStoredToken();
}

export function setTrustedDeviceToken(token: string): void {
  storeToken(token);
}

function generateDeviceToken(): string {
  return 'td_' + randomBytes(24).toString('hex');
}

export async function enrollTrustedDevice(): Promise<void> {
  if (getTrustedDeviceToken()) {
    return;
  }

  const token = generateDeviceToken();
  storeToken(token);
}
