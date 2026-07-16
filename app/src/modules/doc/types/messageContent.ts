/**
 * 结构化消息类型定义
 * 办公模块工具返回 MessageContent 而非纯字符串
 * 前端注册对应组件渲染交互卡片
 */

/**
 * 消息内容类型
 * 与 AgentMessage 的 message_component 类型对齐
 */
export type MessageContentType = 'message_component' | 'execution_command';

/** 文档预览组件数据 */
export interface DocumentPreviewData {
  path: string;
  filename: string;
  preview: string;
  format: 'docx' | 'xlsx' | 'pptx';
  size: string;
  createdAt: string;
  actions: ('open' | 'download' | 'send-email' | 'share')[];
}

/** 邮件确认组件数据 */
export interface EmailConfirmationData {
  subject: string;
  recipients: number;
  messageId: string;
  sentAt: string;
  hasAttachments: boolean;
}

/** 日历卡片组件数据 */
export interface CalendarCardData {
  summary: string;
  start: string;
  end: string;
  location?: string;
  reminderSet: boolean;
}

/**
 * 构建文档预览消息
 */
export function buildDocumentPreview(data: DocumentPreviewData) {
  return {
    type: 'message_component' as MessageContentType,
    component: 'document-preview',
    data,
  };
}

/**
 * 构建邮件确认消息
 */
export function buildEmailConfirmation(data: EmailConfirmationData) {
  return {
    type: 'execution_command' as MessageContentType,
    component: 'email-confirmation',
    data,
  };
}

/**
 * 构建日历卡片消息
 */
export function buildCalendarCard(data: CalendarCardData) {
  return {
    type: 'message_component' as MessageContentType,
    component: 'calendar-card',
    data,
  };
}
