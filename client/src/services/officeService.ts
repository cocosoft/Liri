/**
 * 办公模块 API Service 层
 * 委托项目已有的 httpClient（自动处理 X-API-Key、超时、错误解析）
 */

import { http } from "./httpClient";
import type {
  DocStatusResponse,
  MailConfigPayload,
  MailItem,
  CalendarEventItem,
  MergedCalendarResponse,
} from "../types/office";

/** 后端统一响应信封（{ code, message, data }） */
type ApiEnvelope<T> = { code: number; message: string; data: T };

export const officeService = {
  // ==================== 文档 ====================

  getDocStatus: () =>
    http.get<ApiEnvelope<DocStatusResponse>>("/v1/doc/status"),

  // ==================== 邮件 ====================

  getMailStatus: () =>
    http.get<ApiEnvelope<{ status: string; accountCount: number }>>(
      "/v1/mail/status"
    ),

  getMailConfig: () =>
    http.get<ApiEnvelope<{ accounts: Array<{ provider: string; user: string; authMethod: string }> }>>(
      "/v1/mail/config"
    ),

  saveMailConfig: (p: MailConfigPayload) =>
    http.post<ApiEnvelope<{ accountCount: number }>>("/v1/mail/config", p),

  deleteMailConfig: () => http.delete<ApiEnvelope<unknown>>("/v1/mail/config"),

  sendMail: (p: { to: string; subject: string; body: string }) =>
    http.post<ApiEnvelope<{ messageId: string }>>("/v1/mail/send", p),

  getMailInbox: (limit = 20) =>
    http.get<ApiEnvelope<{ mails: MailItem[] }>>(
      `/v1/mail/inbox?limit=${limit}`
    ),

  getMailSent: (limit = 20) =>
    http.get<ApiEnvelope<{ mails: MailItem[] }>>(
      `/v1/mail/sent?limit=${limit}`
    ),

  searchMail: (q: string, limit = 20) =>
    http.get<ApiEnvelope<{ mails: MailItem[] }>>(
      `/v1/mail/search?q=${encodeURIComponent(q)}&limit=${limit}`
    ),

  deleteMail: (id: string) =>
    http.delete<ApiEnvelope<{ id: string }>>(`/v1/mail/${id}`),

  patchMailRead: (id: string, read: boolean) =>
    http.patch<ApiEnvelope<{ id: string }>>(`/v1/mail/${id}/read`, { read }),

  // ==================== 日历 ====================

  getCalendarStatus: () =>
    http.get<ApiEnvelope<{ status: string }>>("/v1/calendar/status"),

  getCalendarEvents: () =>
    http.get<ApiEnvelope<{ events: CalendarEventItem[] }>>(
      "/v1/calendar/events"
    ),

  addCalendarEvent: (e: Record<string, unknown>) =>
    http.post<ApiEnvelope<{ event: CalendarEventItem }>>("/v1/calendar/events", e),

  updateCalendarEvent: (id: string, u: Record<string, unknown>) =>
    http.put<ApiEnvelope<{ id: string }>>(`/v1/calendar/events/${id}`, u),

  deleteCalendarEvent: (id: string) =>
    http.delete<ApiEnvelope<{ id: string }>>(`/v1/calendar/events/${id}`),

  /** 导出 .ics 文件 URL（直接用于 <a download>） */
  exportCalendarEventUrl: (id: string) => `/v1/calendar/export/${id}`,

  /** 获取聚合日历数据（三源：手动+Cron+AI） */
  getCalendarMerged: (start: string, end: string, timezone?: string) => {
    const tz = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    return http.get<ApiEnvelope<MergedCalendarResponse>>(
      `/v1/calendar/merged?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&timezone=${encodeURIComponent(tz)}`
    );
  },
};
