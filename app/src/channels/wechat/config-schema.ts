/**
 * 个人微信 Bot 通道配置模式定义
 * 通过 weixin-cli HTTP Bridge 通信
 */

export interface WechatConfig {
  botHttpUrl: string;
}

export function getDefaultWechatConfig(): WechatConfig {
  return {
    botHttpUrl: 'http://localhost:7600',
  };
}

export function validateWechatConfig(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (!raw['botHttpUrl'] || typeof raw['botHttpUrl'] !== 'string') {
    errors.push('botHttpUrl: weixin-cli HTTP 服务地址');
  }

  return errors;
}
