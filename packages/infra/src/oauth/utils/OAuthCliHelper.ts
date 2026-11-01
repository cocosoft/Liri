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
import { getLogger, Logger } from '@modules/monitoring';
const logger = getLogger('oauth:utils:cli');

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

  // CLI 用户提示输出到 stdout（非 Logger 日志，用户需要看到）
  process.stdout.write(
    `请在浏览器中打开以下 URL 进行授权:\n${authorizeUrl}\n\n`
  );
  process.stdout.write(
    '授权完成后，请将浏览器地址栏中的完整 URL 粘贴到此处:\n'
  );

  const callbackUrl = await readLineFromStdin();

  const parsed = flow.parseCallback(callbackUrl);
  flow.verifyState(state, parsed.state);

  return flow.exchangeCode(parsed.code, codeVerifier, options?.redirectUri);
}
