/**
 * 办公模块前端类型定义
 * 复用项目已有的 ApiResponse（src/types/api.ts）
 */

/** 模块卡片状态 */
export type ModuleCardStatus = "active" | "degraded" | "inactive";

/** 模块信息（OfficePage 入口页使用） */
export interface ModuleStatus {
  id: string;
  name: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  description: string;
  status: ModuleCardStatus;
  statusText: string;
  path: string;
}

/** 文档项（来自 /v1/doc/status） */
export interface DocItem {
  name: string;
  size: number;
  mtime: number;
}

/** /v1/doc/status 响应类型 */
export interface DocStatusResponse {
  status?: string;
  officeCliInfo?: { installed?: boolean; version?: string };
  templateCount?: number;
  templates?: string[];
  documents?: DocItem[];
}

/** OfficeCLI 安装状态（GET /v1/officecli/status 数据源） */
export type OfficeCliInstallState = "idle" | "running" | "completed" | "failed";

/** OfficeCLI 检测结果 */
export interface OfficeCliInfo {
  installed: boolean;
  version?: string;
  path?: string;
  incompatible?: boolean;
}

/** OfficeCLI 版本约束 */
export interface OfficeCliVersionConstraint {
  minVersion: string;
  maxVersion: string;
  lastTested: string;
}

/** GET /v1/officecli/status 响应 */
export interface OfficeCliInstallStatus {
  state: OfficeCliInstallState;
  info: OfficeCliInfo;
  constraint: OfficeCliVersionConstraint;
  startedAt: number | null;
  finishedAt: number | null;
  error?: string;
}

/** 邮件项（来自 /v1/mail/inbox） */
export interface MailItem {
  subject: string;
  from: string;
  date: string;
  uid?: number;
  messageId?: string;
  /** 正文纯文本（后端 EmailReader 解析 IMAP body，无正文时回退主题） */
  snippet?: string;
}

/** 邮件配置提交参数 */
export interface MailConfigPayload {
  provider: string;
  authMethod: string;
  emailAddress: string;
  password?: string;
  smtpHost?: string;
  smtpPort?: number;
  imapHost?: string;
  imapPort?: number;
}

/** 邮件配置响应 */
export interface MailConfigResponse {
  accounts: Array<{
    provider: string;
    user: string;
    authMethod: string;
  }>;
}

/** 日历事件项（来自 /v1/calendar/events） */
export interface CalendarEventItem {
  id: string;
  summary: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  status?: EventStatus;
  priority?: number;
  tags?: string[];
  completedAt?: string;
}

/** 事件来源类型 */
export type EventSource = "manual" | "cron" | "ai";

/** 事件状态类型 */
export type EventStatus =
  "pending" | "in_progress" | "completed" | "cancelled" | "overdue";

/** 统一日历事件（来自 /v1/calendar/merged） */
export interface UnifiedCalendarEvent {
  date: string;
  time?: string;
  summary: string;
  source: EventSource;
  sourceId: string;
  details?: string;
  state?: string;
  draggable: boolean;
  action: {
    type: "edit" | "navigate-cron" | "navigate-chat";
    label: string;
    payload: { id: string };
  };
  /** 事件状态 */
  status?: EventStatus;
  /** 优先级 1-5 */
  priority?: number;
  /** 标签 */
  tags?: string[];
  /** 完成时间 */
  completedAt?: string;
}

/** Cron 日历事件（merged 响应中的 cronEvents） */
export interface CronCalendarEvent {
  jobId: string;
  calendarEventId?: string;
  taskDetailUrl?: string;
  name: string;
  schedule: string;
  cronExpression: string;
  occurrences: Array<{
    date: string;
    time: string;
  }>;
  state: string;
  canRunNow: boolean;
  truncated: boolean;
}

/** AI 日程事件（merged 响应中的 aiSchedules） */
export interface AIScheduleEvent {
  id: string;
  calendarEventId: string;
  date: string;
  time?: string;
  summary: string;
  sessionId?: string;
  conversationSnippet?: string;
  source: "ai";
}

/** 聚合日历响应 */
export interface MergedCalendarResponse {
  data: {
    calendarEvents: CalendarEventItem[];
    cronEvents: CronCalendarEvent[];
    aiSchedules: AIScheduleEvent[];
  };
  errors: Array<{
    source: EventSource;
    code: string;
    message: string;
  }>;
  timestamp: string;
}
