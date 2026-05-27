//
/**
 * 登录后流程
 * 协调登录完成后的各项初始化工作
 * 基于CC源码 cc_code/backend/commands/login/login.tsx 实现
 */

import type { OAuthTokens } from './oauth-types.js';
import { getAuthManager } from './AuthManager.js';
import {
  clearTrustedDeviceToken,
  enrollTrustedDevice,
} from './trusted-device.js';

export interface PostLoginOptions {
  onAuthChanged?: () => void;
  onRefreshSettings?: () => void;
  onRefreshPolicies?: () => void;
}

/**
 * 执行登录后流程
 * 包括：设置Token、刷新设置、注册受信设备等
 */
export async function executePostLogin(
  tokens: OAuthTokens,
  options: PostLoginOptions = {}
): Promise<void> {
  const authManager = getAuthManager();

  authManager.setOAuthTokens({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    tokenType: 'Bearer',
  });

  if (options.onAuthChanged) {
    options.onAuthChanged();
  }

  if (options.onRefreshSettings) {
    options.onRefreshSettings();
  }

  if (options.onRefreshPolicies) {
    options.onRefreshPolicies();
  }

  clearTrustedDeviceToken();
  void enrollTrustedDevice();
}
