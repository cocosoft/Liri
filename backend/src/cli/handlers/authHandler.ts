/**
 * 认证处理器
 * 处理CLI中的认证相关命令，集成 OAuth 系统
 */

import chalk from 'chalk';
import * as readline from 'readline';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { ErrorCodes } from '@modules/error/ErrorCodes';
import { oauthService } from '@modules/oauth/services/OAuthService';
import { createGitHubOAuthProvider } from '@modules/oauth/providers/GitHubOAuthProvider';
import { createGoogleOAuthProvider } from '@modules/oauth/providers/GoogleOAuthProvider';
import { AuthorizationCodeFlow } from '@modules/oauth/flows/AuthorizationCodeFlow';
import type { OAuthConfig } from '@modules/oauth/types';

const logger = new Logger({ level: LogLevel.INFO });

export interface AuthHandlerOptions {
  verbose?: boolean;
}

export class AuthHandler {
  private options: AuthHandlerOptions;

  constructor(options?: AuthHandlerOptions) {
    this.options = { verbose: false, ...options };
    this.registerBuiltinProviders();
  }

  /**
   * 注册内置 OAuth Provider
   */
  private registerBuiltinProviders(): void {
    // Provider 注册需要 clientId/clientSecret，运行时从环境变量动态读取
    const githubClientId = process.env.OAUTH_GITHUB_CLIENT_ID || '';
    const githubClientSecret = process.env.OAUTH_GITHUB_CLIENT_SECRET || '';
    const googleClientId = process.env.OAUTH_GOOGLE_CLIENT_ID || '';
    const googleClientSecret = process.env.OAUTH_GOOGLE_CLIENT_SECRET || '';

    if (githubClientId && githubClientSecret) {
      const redirectUri =
        process.env.OAUTH_GITHUB_REDIRECT_URI ||
        'http://localhost:3000/callback';
      const provider = createGitHubOAuthProvider(
        githubClientId,
        githubClientSecret,
        redirectUri
      );
      oauthService.registerProvider('github', provider);
      logger.debug('GitHub OAuth provider registered');
    }

    if (googleClientId && googleClientSecret) {
      const redirectUri =
        process.env.OAUTH_GOOGLE_REDIRECT_URI ||
        'http://localhost:3000/callback';
      const provider = createGoogleOAuthProvider(
        googleClientId,
        googleClientSecret,
        redirectUri
      );
      oauthService.registerProvider('google', provider);
      logger.debug('Google OAuth provider registered');
    }
  }

  /**
   * 处理登录命令
   * auth login <provider>
   */
  async handleLogin(args: string[]): Promise<void> {
    const provider = args[0] || (await this.promptForProvider());

    if (this.options.verbose) {
      logger.info('Starting OAuth login', { provider });
    }

    try {
      const providers = oauthService.listProviders();
      if (providers.length === 0) {
        console.log(chalk.yellow('⚠ 未配置任何 OAuth Provider'));
        console.log(chalk.gray('  请设置 OAUTH_GITHUB_CLIENT_ID 等环境变量'));
        return;
      }

      if (!providers.includes(provider)) {
        console.log(chalk.red('✕'), `未知的 Provider: ${provider}`);
        console.log(chalk.gray(`  可用 Provider: ${providers.join(', ')}`));
        return;
      }

      const oauthConfig: OAuthConfig = {
        authorizeUrl: '',
        tokenUrl: '',
        profileUrl: '',
        clientId: '',
        scopes: [],
        redirectUri: 'http://localhost:3000/callback',
      };

      if (provider === 'github') {
        oauthConfig.authorizeUrl = 'https://github.com/login/oauth/authorize';
        oauthConfig.tokenUrl = 'https://github.com/login/oauth/access_token';
        oauthConfig.profileUrl = 'https://api.github.com/user';
        oauthConfig.clientId = process.env.OAUTH_GITHUB_CLIENT_ID || '';
        oauthConfig.scopes = ['read:user', 'user:email'];
      } else if (provider === 'google') {
        oauthConfig.authorizeUrl =
          'https://accounts.google.com/o/oauth2/v2/auth';
        oauthConfig.tokenUrl = 'https://oauth2.googleapis.com/token';
        oauthConfig.profileUrl =
          'https://www.googleapis.com/oauth2/v3/userinfo';
        oauthConfig.clientId = process.env.OAUTH_GOOGLE_CLIENT_ID || '';
        oauthConfig.scopes = ['openid', 'email', 'profile'];
      }

      const flow = new AuthorizationCodeFlow(oauthConfig);
      const { authorizeUrl, state, codeVerifier } = flow.getAuthorizationUrl({
        redirectUri: oauthConfig.redirectUri,
        scopes: oauthConfig.scopes,
      });

      console.log(`\n${chalk.cyan('?')} 请访问以下 URL 进行授权:`);
      console.log(`  ${chalk.blue(authorizeUrl)}\n`);
      console.log(`${chalk.gray('授权完成后，将完整的回调 URL 粘贴到此处:')}`);

      const callbackUrl = await this.promptForInput('回调 URL');

      const parsed = flow.parseCallback(callbackUrl);
      flow.verifyState(state, parsed.state);

      const result = await flow.exchangeCode(
        parsed.code,
        codeVerifier,
        oauthConfig.redirectUri
      );

      await oauthService.authorize(provider, {
        code: parsed.code,
        codeVerifier,
        redirectUri: oauthConfig.redirectUri,
      });

      console.log(chalk.green('✓'), `${provider} 登录成功`);
      if (this.options.verbose) {
        console.log(
          chalk.gray(
            `  Token 过期时间: ${new Date(result.expiresAt).toLocaleString()}`
          )
        );
      }

      logger.info('OAuth login successful', { provider });
    } catch (error) {
      logger.error('OAuth login failed', { error, provider });
      const message = error instanceof Error ? error.message : '未知错误';
      console.log(chalk.red('✕'), `登录失败: ${message}`);
      throw AppError.fromCode(ErrorCodes.EXECUTION_FAILED, {
        category: ErrorCategory.EXECUTION,
        cause: error instanceof Error ? error : undefined,
        context: { provider },
      });
    }
  }

  /**
   * 处理登出命令
   */
  async handleLogout(args: string[]): Promise<void> {
    const provider = args[0];

    if (this.options.verbose) {
      logger.info('Logging out', { provider });
    }

    try {
      if (provider) {
        await oauthService.revokeToken(provider);
        console.log(chalk.green('✓'), `${provider} 登出成功`);
      } else {
        const statuses = oauthService.listProviders();
        if (statuses.length === 0) {
          console.log(chalk.yellow('⚠ 没有已登录的账号'));
          return;
        }
        await oauthService.revokeAll();
        console.log(chalk.green('✓'), '所有账号已登出');
      }

      logger.info('Logout successful', { provider });
    } catch (error) {
      logger.error('Logout failed', { error });
      console.log(chalk.red('✕'), '登出失败');
      throw AppError.fromCode(ErrorCodes.EXECUTION_FAILED, {
        category: ErrorCategory.EXECUTION,
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * 处理状态检查命令
   */
  async handleStatus(): Promise<void> {
    const providers = oauthService.listProviders();

    if (providers.length === 0) {
      console.log(chalk.yellow('⚠ 未配置任何 OAuth Provider'));
      return;
    }

    console.log(chalk.bold('\nOAuth Provider 状态:\n'));

    for (const provider of providers) {
      const status = oauthService.getTokenStatus(provider);

      if (status.exists && !status.expired) {
        const expiresIn = status.expiresIn
          ? Math.floor(status.expiresIn / 1000 / 60)
          : 0;
        console.log(`  ${chalk.green('✓')} ${provider} - 已授权`);
        console.log(
          chalk.gray(
            `    过期时间: ${status.expiresAt ? new Date(status.expiresAt).toLocaleString() : '未知'}`
          )
        );
        console.log(chalk.gray(`    剩余: ${expiresIn} 分钟`));
        if (status.refreshInProgress) {
          console.log(chalk.gray(`    状态: 正在刷新 Token...`));
        }
      } else if (status.exists && status.expired) {
        console.log(`  ${chalk.yellow('⚠')} ${provider} - Token 已过期`);
        console.log(chalk.gray(`    使用 "auth login ${provider}" 重新授权`));
      } else {
        console.log(`  ${chalk.red('✕')} ${provider} - 未授权`);
        console.log(chalk.gray(`    使用 "auth login ${provider}" 授权`));
      }
      console.log('');
    }
  }

  /**
   * 处理 Provider 列表命令
   */
  async handleList(): Promise<void> {
    const providers = oauthService.listProviders();

    if (providers.length === 0) {
      console.log(chalk.yellow('⚠ 未配置任何 OAuth Provider'));
      console.log(chalk.gray('  请设置以下环境变量:'));
      console.log(chalk.gray('    OAUTH_GITHUB_CLIENT_ID'));
      console.log(chalk.gray('    OAUTH_GITHUB_CLIENT_SECRET'));
      console.log(chalk.gray('    OAUTH_GOOGLE_CLIENT_ID'));
      console.log(chalk.gray('    OAUTH_GOOGLE_CLIENT_SECRET'));
      return;
    }

    console.log(chalk.bold('\n已配置的 OAuth Provider:\n'));
    for (const provider of providers) {
      const status = oauthService.getTokenStatus(provider);
      const statusIcon =
        status.exists && !status.expired
          ? chalk.green('✓ 已授权')
          : status.exists
            ? chalk.yellow('⚠ 已过期')
            : chalk.red('✕ 未授权');
      console.log(`  ${statusIcon} ${provider}`);
    }
    console.log('');
  }

  /**
   * 处理刷新 Token 命令
   */
  async handleRefresh(): Promise<void> {
    const providers = oauthService.listProviders();

    if (providers.length === 0) {
      console.log(chalk.yellow('⚠ 未配置任何 OAuth Provider'));
      return;
    }

    console.log(chalk.bold('\n正在刷新 OAuth Token...\n'));
    let successCount = 0;
    let failCount = 0;

    for (const provider of providers) {
      const status = oauthService.getTokenStatus(provider);
      if (!status.exists) {
        console.log(`  ${chalk.yellow('⚠')} ${provider} - 未授权，跳过`);
        continue;
      }

      try {
        await oauthService.refreshToken(provider);
        console.log(`  ${chalk.green('✓')} ${provider} - Token 刷新成功`);
        successCount++;
      } catch (error) {
        console.log(`  ${chalk.red('✕')} ${provider} - Token 刷新失败`);
        logger.error('Token refresh failed', { provider, error });
        failCount++;
      }
    }

    console.log('');
    console.log(chalk.bold(`刷新完成: ${successCount} 成功, ${failCount} 失败`));
  }

  /**
   * 提示选择 Provider
   */
  private async promptForProvider(): Promise<string> {
    const providers = oauthService.listProviders();
    if (providers.length === 0) {
      return '';
    }
    if (providers.length === 1) {
      return providers[0];
    }

    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      console.log('可用的 Provider:');
      providers.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
      rl.question('请选择 Provider: ', (answer: string) => {
        rl.close();
        const idx = parseInt(answer, 10) - 1;
        if (idx >= 0 && idx < providers.length) {
          resolve(providers[idx]);
        } else if (providers.includes(answer)) {
          resolve(answer);
        } else {
          resolve(providers[0]);
        }
      });
    });
  }

  /**
   * 提示输入
   */
  private async promptForInput(message: string): Promise<string> {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question(`${message}: `, (answer: string) => {
        rl.close();
        resolve(answer);
      });
    });
  }
}

/**
 * 创建认证处理器
 */
export function createAuthHandler(options?: AuthHandlerOptions): AuthHandler {
  return new AuthHandler(options);
}
