/**
 * 已发送邮件记录器
 * 持久化到 ~/.pyapp/office/sent.json，保留最近 500 条
 */

import * as fs from 'fs';
import * as path from 'path';
import { resolvePyappHome } from '@modules/core';

const MAX_ENTRIES = 500;

/** 已发送邮件条目 */
export interface SentMailEntry {
  messageId: string;
  to: string;
  subject: string;
  sentAt: string;
}

/**
 * 获取已发送记录文件路径
 */
function getSentPath(): string {
  const dir = path.join(resolvePyappHome(), 'office');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'sent.json');
}

/**
 * 记录一封已发送邮件
 */
export function recordSentMail(entry: {
  to: string;
  subject: string;
  messageId?: string;
}): void {
  const filePath = getSentPath();
  const sentList: SentMailEntry[] = [];

  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as SentMailEntry[];
      sentList.push(...parsed);
    } catch {
      // 文件损坏则从空开始
    }
  }

  sentList.unshift({
    messageId: entry.messageId || `sent-${Date.now()}`,
    to: entry.to,
    subject: entry.subject,
    sentAt: new Date().toISOString(),
  });

  // 保留最近 N 条
  if (sentList.length > MAX_ENTRIES) {
    sentList.length = MAX_ENTRIES;
  }

  fs.writeFileSync(filePath, JSON.stringify(sentList, null, 2), 'utf-8');
}

/**
 * 获取已发送邮件列表
 */
export function getSentMails(): SentMailEntry[] {
  const filePath = getSentPath();
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SentMailEntry[];
  } catch {
    return [];
  }
}
