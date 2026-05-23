/**
 * channels/sms/index.ts - SMS 通道导出
 */

export {
  SmsChannel,
  smsChannel,
  createSmsChannel,
  smsChannelPlugin,
} from './SmsChannel.js';
export type { SmsConfig, SmsMessage } from './SmsChannel.js';
