/**
 * mail 模块类型定义
 */

/** 邮箱账号配置 */
export interface EmailAccount {
  id: string;
  provider: 'gmail' | 'outlook' | 'custom';
  authMethod: 'password' | 'oauth2';

  // 密码模式
  smtpHost?: string;
  smtpPort?: number;
  user?: string;
  pass?: string;

  // OAuth2 模式
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  accessToken?: string;
  tokenExpiry?: number;

  imapHost?: string;
  imapPort?: number;
}

/** 邮箱配置 */
export interface EmailConfig {
  accounts: EmailAccount[];
}

/** 邮件发送参数 */
export interface EmailSendArgs {
  to: string | string[];
  subject: string;
  body: string;
  attachments?: {
    path: string;
    filename?: string;
  }[];
}

/** 邮件发送结果 */
export interface EmailSendResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
}

/** 邮件搜索参数 */
export interface EmailSearchArgs {
  folder?: string;
  query?: string;
  limit?: number;
}

/** 邮件状态枚举 */
export enum MailModuleStatus {
  UNINITIALIZED = 'uninitialized',
  READY = 'ready',
  DEGRADED = 'degraded',
  SHUTDOWN = 'shutdown',
}
