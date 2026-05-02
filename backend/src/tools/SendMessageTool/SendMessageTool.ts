/**
 * 多代理消息工具 SendMessageTool
 */
import { randomUUID } from 'crypto';

export interface SendMessageInput {
  to: string;
  message: string;
  priority?: 'normal' | 'high' | 'low';
}

export interface SendMessageResult {
  messageId: string;
  to: string;
  delivered: boolean;
  timestamp: number;
}

const messageHistory: SendMessageResult[] = [];

export function sendMessage(input: SendMessageInput): SendMessageResult {
  const result: SendMessageResult = {
    messageId: `msg_${randomUUID().substring(0, 8)}`,
    to: input.to,
    delivered: true,
    timestamp: Date.now(),
  };
  messageHistory.push(result);
  return result;
}

export function getMessageHistory(toFilter?: string): SendMessageResult[] {
  if (toFilter) {
    return messageHistory.filter(m => m.to === toFilter);
  }
  return [...messageHistory];
}
