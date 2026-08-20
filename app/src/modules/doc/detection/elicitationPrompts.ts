/**
 * ElicitationHandler 引导注册
 * 负责 OfficeCLI 安装引导和 OAuth2 邮箱配置引导
 */

import { getLogger } from '@modules/monitoring';
const logger = getLogger('doc:lifecycle');

/**
 * 注册 OfficeCLI 安装引导提示
 * 在侦测到 OfficeCLI 未安装时调用（DocModule.initDegradedMode）
 * G-12：真正注册 officecli 的 elicitation prompt，
 * 引导用户在文档生成时前往「设置 → 办公 → OfficeCLI」一键安装。
 */
export function registerOfficeCLIInstallPrompt(): void {
  void (async () => {
    try {
      const { registerElicitationPrompts } =
        await import('@modules/services/mcp/elicitationHandler');
      registerElicitationPrompts('officecli', [
        {
          type: 'confirm',
          key: 'installOfficeCli',
          label: '安装 OfficeCli',
          description:
            '文档创建/编辑功能依赖 OfficeCli 命令行工具。请前往 设置 → 办公 → OfficeCLI，点击「一键安装」后重试。',
          required: true,
          defaultValue: 'yes',
        },
      ]);
      logger.info(
        'OfficeCLI 安装引导已注册（G-12 落地：officecli elicitation prompt）'
      );
    } catch (err) {
      logger.warn('OfficeCLI 安装引导注册失败', { error: String(err) });
    }
  })();
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
