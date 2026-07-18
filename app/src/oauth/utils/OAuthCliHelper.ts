// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * OAuth CLI 交互辅助工具
 *
 * 将 CLI 交互逻辑从 AuthorizationCodeFlow 中分离，保持流程类的纯协议职责。
 */

import type { AuthorizationCodeFlow } from '../flows/AuthorizationCodeFlow';
import type { OAuthAuthResult } from '../types/OAuthTypes';
import type { AuthorizationCodeFlowOptions } from '../flows/AuthorizationCodeFlow';
import { readLineFromStdin } from './OAuthIo';

/**
 * 通过 CLI 交互完成完整授权流程
 *
 * 从 AuthorizationCodeFlow.authorize() 中分离，保持流程类职责单一。
 */
export async function authorizeWithCli(
  flow: AuthorizationCodeFlow,
  options?: AuthorizationCodeFlowOptions
): Promise<OAuthAuthResult> {
  const { authorizeUrl, state, codeVerifier } =
    flow.getAuthorizationUrl(options);

  console.log(`请在浏览器中打开以下 URL 进行授权:\n${authorizeUrl}\n`);
  console.log('授权完成后，请将浏览器地址栏中的完整 URL 粘贴到此处:');

  const callbackUrl = await readLineFromStdin();

  const parsed = flow.parseCallback(callbackUrl);
  flow.verifyState(state, parsed.state);

  return flow.exchangeCode(parsed.code, codeVerifier, options?.redirectUri);
}
