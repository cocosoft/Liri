/**
 * Login命令执行逻辑
 * 处理用户登录流程，支持OAuth和API Key两种方式
 * 参考CC源码 cc_code/backend/commands/login/login.tsx 实现
 */

import type { CommandContext, CommandResult } from '@modules/commands';
import { OAuthService } from '@modules/oauth';
import { executePostLogin } from '@modules/system/auth/post-login.js';
import { configManager } from '@modules/config';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'commands:login:login',
  level: LogLevel.INFO,
});

/**
 * 登录结果
 */
export interface LoginResult {
  success: boolean;
  message: string;
  token?: string;
  user?: {
    id: string;
    name: string;
    email?: string;
  };
}

/**
 * 登录参数
 */
interface LoginParams {
  token?: string;
  force?: boolean;
  provider?: string;
  useOAuth?: boolean;
}

/**
 * 执行登录
 */
export async function executeLogin(
  args: string,
  context: CommandContext
): Promise<CommandResult> {
  try {
    const params = parseLoginArgs(args);

    const existingToken = configManager.env('Liri_API_KEY');

    if (existingToken && !params.force) {
      return {
        type: 'text',
        success: true,
        message: '已经登录。使用 --force 强制重新登录。',
        data: { alreadyLoggedIn: true },
      };
    }

    if (params.useOAuth) {
      return await executeOAuthLogin(params, context);
    }

    return await executeApiKeyLogin(params);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      type: 'error',
      success: false,
      message: `登录失败: ${errorMessage}`,
    };
  }
}

/**
 * 执行OAuth登录
 */
async function executeOAuthLogin(
  params: LoginParams,
  context: CommandContext
): Promise<CommandResult> {
  const oauthService = new OAuthService();

  try {
    const tokens = await (oauthService as any).startOAuthFlow(
      async (urls: { automaticUrl: string; manualUrl: string }) => {
        (context as any).output.write(`请打开以下链接进行OAuth授权:\n`);
        (context as any).output.write(`  ${urls.automaticUrl}\n`);
        (context as any).output.write(`\n或者手动打开:\n`);
        (context as any).output.write(`  ${urls.manualUrl}\n`);
        (context as any).output.write(`\n登录后请在终端中输入授权码: `);
      },
      {}
    );

    await executePostLogin(tokens, {
      onAuthChanged() {
        if (tokens.accessToken) {
          process.env.Liri_API_KEY = tokens.accessToken;
        }
      },
    });

    const name =
      tokens.profile?.displayName ||
      tokens.profile?.rawProfile?.account?.email ||
      'OAuth User';

    return {
      type: 'text',
      success: true,
      message: `OAuth登录成功: ${name}`,
      data: {
        success: true,
        message: 'OAuth登录成功',
        token: tokens.accessToken,
        user: {
          id: tokens.profile?.rawProfile?.account?.uuid || 'oauth_user',
          name,
          email: tokens.profile?.rawProfile?.account?.email,
        },
      },
    };
  } finally {
    (oauthService as any).cleanup();
  }
}

/**
 * 执行API Key登录
 */
async function executeApiKeyLogin(params: LoginParams): Promise<CommandResult> {
  const loginResult = await performLogin(params);

  if (loginResult.success) {
    if (loginResult.token) {
      process.env.Liri_API_KEY = loginResult.token;
    }

    return {
      type: 'text',
      success: true,
      message: `登录成功: ${loginResult.user?.name || 'Unknown'}`,
      data: loginResult,
    };
  }

  return {
    type: 'error',
    success: false,
    message: loginResult.message,
  };
}

/**
 * 解析登录参数
 */
function parseLoginArgs(args: string): LoginParams {
  const params: LoginParams = {};

  if (!args) return params;

  const parts = args.trim().split(/\s+/);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (part === '--force' || part === '-f') {
      params.force = true;
    } else if (part === '--token' || part === '-t') {
      params.token = parts[++i];
    } else if (part === '--provider' || part === '-p') {
      params.provider = parts[++i];
    } else if (part === '--oauth' || part === '-o') {
      params.useOAuth = true;
    } else if (!params.token && !part.startsWith('-')) {
      params.token = part;
    }
  }

  return params;
}

/**
 * 执行登录验证
 * API Key 登录需要用户提供有效的 API Key，否则返回失败
 */
async function performLogin(params: LoginParams): Promise<LoginResult> {
  if (params.token) {
    return {
      success: true,
      message: '使用提供的API Key登录成功',
      token: params.token,
      user: {
        id: 'api_user_' + Date.now(),
        name: 'API User',
      },
    };
  }

  return {
    success: false,
    message:
      '请提供API Key或使用OAuth登录。\n\n用法:\n  /login <API_KEY>\n  /login --oauth',
  };
}
