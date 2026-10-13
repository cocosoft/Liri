/**
 * 个人微信 Bot 通道配置模式定义
 * 通过 weixin-cli HTTP Bridge 通信
 */

import { DEFAULT_WECHAT_BOT_ENDPOINT } from '@modules/core';

export interface WechatConfig {
  botHttpUrl: string;
}

export function getDefaultWechatConfig(): WechatConfig {
  return {
    botHttpUrl: DEFAULT_WECHAT_BOT_ENDPOINT,
  };
}

export function validateWechatConfig(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (!raw['botHttpUrl'] || typeof raw['botHttpUrl'] !== 'string') {
    errors.push('botHttpUrl: weixin-cli HTTP 服务地址');
  }

  return errors;
}
