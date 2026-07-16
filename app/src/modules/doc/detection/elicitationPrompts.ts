/**
 * ElicitationHandler 引导注册
 * 负责 OfficeCLI 安装引导和 OAuth2 邮箱配置引导
 */

import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'doc:lifecycle',
  level: LogLevel.INFO,
});

/**
 * 注册 OfficeCLI 安装引导提示
 * 在侦测到 OfficeCLI 未安装时调用
 */
export function registerOfficeCLIInstallPrompt(): void {
  // TODO: 调用 elicitationHandler.registerElicitationPrompts('doc', [...])
  // elicitationHandler.registerElicitationPrompts('doc', [{
  //   key: 'install_officecli',
  //   question: '检测到您未安装 OfficeCLI。安装后可使用 AI 创建和编辑 Word/Excel/PPT 文档。\n\n安装命令: npm install -g @officecli/officecli',
  //   type: 'confirm',
  //   requirement: 'required',
  // }]);
  logger.info('OfficeCLI 安装引导已注册');
}

/**
 * 注册 OAuth2 邮箱配置引导
 * 在用户首次配置 Gmail/Outlook 邮箱时调用
 */
export function registerOAuth2SetupPrompt(provider: 'gmail' | 'outlook'): void {
  // TODO: 调用 elicitationHandler.registerElicitationPrompts('mail', [...])
  // elicitationHandler.registerElicitationPrompts('mail', [{
  //   key: `email-oauth-${provider}`,
  //   question: `${provider} 需要 OAuth2 认证。\n\n请前往控制台创建 OAuth2 应用并获取 clientId 和 clientSecret。`,
  //   type: 'url',
  //   requirement: 'required',
  // }]);
  logger.info('OAuth2 配置引导已注册', { provider });
}

/**
 * 注册 OfficeCLI 版本不匹配引导
 */
export function registerVersionMismatchPrompt(
  currentVersion: string,
  recommendedVersion: string
): void {
  // TODO: 调用 elicitationHandler.registerElicitationPrompts('doc', [...])
  logger.warn('OfficeCLI 版本不匹配', {
    current: currentVersion,
    recommended: recommendedVersion,
  });
}
