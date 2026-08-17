/**
 * ElicitationHandler 引导注册
 * 负责 OfficeCLI 安装引导和 OAuth2 邮箱配置引导
 */

import { getLogger } from '@modules/monitoring';
const logger = getLogger('doc:lifecycle');

/**
 * 注册 OfficeCLI 安装引导提示
 * 在侦测到 OfficeCLI 未安装时调用
 * G-12：未实现——原静默 INFO 造成"已注册"假象，改为明确告警
 */
export function registerOfficeCLIInstallPrompt(): void {
  logger.warn('OfficeCLI 安装引导未注册：elicitationHandler 尚未注入（G-12）');
}

/**
 * 注册 OAuth2 邮箱配置引导
 * 在用户首次配置 Gmail/Outlook 邮箱时调用
 * G-12：未实现——明确告警而非静默跳过
 */
export function registerOAuth2SetupPrompt(provider: 'gmail' | 'outlook'): void {
  logger.warn('OAuth2 配置引导未注册：elicitationHandler 尚未注入（G-12）', {
    provider,
  });
}

/**
 * 注册 OfficeCLI 版本不匹配引导
 * G-12：未实现——保留版本警告（真实信息），引导注册部分明确告警
 */
export function registerVersionMismatchPrompt(
  currentVersion: string,
  recommendedVersion: string
): void {
  logger.warn('OfficeCLI 版本不匹配（版本引导未注册，G-12）', {
    current: currentVersion,
    recommended: recommendedVersion,
  });
}
