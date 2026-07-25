/**
 * 办公模块 Zustand Store（v6）
 * 管理跨三栏共享的办公数据、预览状态、AI对话、面板状态
 */

import { create } from "zustand";
import type {
  DocItem,
  MergedCalendarResponse,
  EventSource,
  EventStatus,
} from "../types/office";
import { officeApi } from "../services/officeApi";

/** 预览缓存条目 */
interface CacheEntry {
  html: string;
  timestamp: number;
}

/** 文件信息（扩展自 DocItem，增加 id 等） */
export interface FileInfo extends DocItem {
  /** 唯一标识 = 文件名 */
  id: string;
}

/** 聊天消息 */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface OfficeState {
  // --- 文件列表 ---
  fileList: FileInfo[];
  selectedFile: FileInfo | null;
  searchQuery: string;
  filterType: "all" | "docx" | "xlsx" | "pptx";

  // --- 预览状态 ---
  previewState: "idle" | "loading" | "success" | "error";
  previewError: string | null;
  previewCache: Record<string, CacheEntry>;
  previewZoom: number;
  generationStatus: {
    active: boolean;
    fileName?: string;
    progress?: string;
  };

  // --- AI 请求队列 ---
  pendingMessage: string | null;

  // --- 未保存更改 ---
  chatDirty: boolean;

  // --- 面板状态 ---
  userCollapsed: boolean;
  responsiveMode: "normal" | "drawer" | "hidden";
  theme: "light" | "dark" | "auto";

  // --- 聊天消息 ---
  chatMessages: ChatMessage[];

  // --- 邮件/日历 ---
  docStatus: string | null;
  docTemplates: string[];
  mailConfigured: boolean;
  mailList: import("../types/office").MailItem[];
  mailSentList: import("../types/office").MailItem[];
  calendarEvents: import("../types/office").CalendarEventItem[];

  // --- 日历三源聚合 ---
  mergedCalendar: MergedCalendarResponse | null;
  mergedErrors: Array<{ source: EventSource; code: string; message: string }>;
  /** 筛选状态：哪些事件来源可见 */
  visibleSources: Record<EventSource, boolean>;
  calendarLoading: boolean;

  /** 状态筛选 */
  statusFilter: EventStatus | "all";

  // --- Actions ---
  selectFile: (file: FileInfo | null) => void;
  setSearchQuery: (q: string) => void;
  setFilterType: (type: string) => void;
  setPreviewState: (state: OfficeState["previewState"], error?: string) => void;
  setPreviewZoom: (zoom: number) => void;
  setGenerationStatus: (status: OfficeState["generationStatus"]) => void;
  setPendingMessage: (msg: string | null) => void;
  setChatDirty: (dirty: boolean) => void;
  toggleRightPanel: () => void;
  setResponsiveMode: (mode: "normal" | "drawer" | "hidden") => void;
  setTheme: (t: "light" | "dark" | "auto") => void;
  refreshFileList: () => Promise<void>;

  /** 将渲染结果加入预览缓存（含 LRU 淘汰，上限 20 条） */
  addToCache: (fileId: string, html: string) => void;

  // --- 聊天操作 ---
  addChatMessage: (msg: ChatMessage) => void;
  clearChatMessages: () => void;
  restoreChatMessages: (msgs: ChatMessage[]) => void;

  // --- 邮件/日历（保留兼容） ---
  setDocStatus: (
    s: string | null,
    templates?: string[],
    docs?: DocItem[],
  ) => void;
  setMailConfigured: (v: boolean) => void;
  setMailList: (m: import("../types/office").MailItem[]) => void;
  setMailSentList: (m: import("../types/office").MailItem[]) => void;
  setCalendarEvents: (e: import("../types/office").CalendarEventItem[]) => void;

  // --- 日历三源 Actions ---
  setMergedCalendar: (data: MergedCalendarResponse | null) => void;
  setCalendarLoading: (loading: boolean) => void;
  toggleVisibleSource: (source: EventSource) => void;
  setStatusFilter: (filter: EventStatus | "all") => void;
}

/** LRU 缓存条目上限 */
const MAX_CACHE = 20;

export const useOfficeStore = create<OfficeState>((set, get) => ({
  fileList: [],
  selectedFile: null,
  searchQuery: "",
  filterType: "all",

  previewState: "idle",
  previewError: null,
  previewCache: {},
  previewZoom: 100,
  generationStatus: { active: false },

  pendingMessage: null,
  chatDirty: false,

  userCollapsed: false,
  responsiveMode: "normal",
  theme: "auto",

  chatMessages: [],

  docStatus: null,
  docTemplates: [],
  mailConfigured: false,
  mailList: [],
  mailSentList: [],
  calendarEvents: [],

  // --- 日历三源聚合 ---
  mergedCalendar: null,
  mergedErrors: [],
  visibleSources: { manual: true, cron: true, ai: true },
  calendarLoading: false,
  statusFilter: "all",

  selectFile: (file) => set({ selectedFile: file }),

  setSearchQuery: (q) => set({ searchQuery: q }),

  setFilterType: (type) =>
    set({ filterType: type as OfficeState["filterType"] }),

  setPreviewState: (state, error) =>
    set({ previewState: state, previewError: error ?? null }),

  setPreviewZoom: (zoom) =>
    set({ previewZoom: Math.max(25, Math.min(200, zoom)) }),

  setGenerationStatus: (status) => set({ generationStatus: status }),

  setPendingMessage: (msg) => set({ pendingMessage: msg }),

  setChatDirty: (dirty) => set({ chatDirty: dirty }),

  toggleRightPanel: () => set((s) => ({ userCollapsed: !s.userCollapsed })),

  setResponsiveMode: (mode) => set({ responsiveMode: mode }),

  setTheme: (t) => set({ theme: t }),

  /**
   * 刷新文件列表（从后端 /v1/doc/status 获取）
   */
  refreshFileList: async () => {
    try {
      const files = await officeApi.listFiles();
      const fileInfos: FileInfo[] = files.map((f: DocItem) => ({
        ...f,
        id: f.name,
      }));
      set({ fileList: fileInfos });
    } catch {
      // 静默失败，保持旧列表
    }
  },

  /**
   * 将渲染结果加入缓存，含 LRU 淘汰策略。
   * 上限 20 条，超出时淘汰最旧的条目。
   */
  addToCache: (fileId, html) => {
    const cache = { ...get().previewCache };
    const entries = Object.entries(cache);

    // 若已达上限，按 timestamp 排序并淘汰最旧的
    if (entries.length >= MAX_CACHE) {
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toRemove = entries.slice(0, entries.length - MAX_CACHE + 1);
      for (const [key] of toRemove) {
        delete cache[key];
      }
    }

    cache[fileId] = { html, timestamp: Date.now() };
    set({ previewCache: cache });
  },

  addChatMessage: (msg) =>
    set((s) => ({ chatMessages: [...s.chatMessages, msg] })),

  clearChatMessages: () => set({ chatMessages: [] }),

  restoreChatMessages: (msgs) => set({ chatMessages: msgs }),

  setDocStatus: (s, templates = [], docs = []) =>
    set({
      docStatus: s,
      docTemplates: templates,
      fileList: docs.map((d) => ({ ...d, id: d.name })),
    }),

  setMailConfigured: (v) => set({ mailConfigured: v }),

  setMailList: (m) => set({ mailList: m }),

  setMailSentList: (m) => set({ mailSentList: m }),

  setCalendarEvents: (e) => set({ calendarEvents: e }),

  // --- 日历三源 Actions ---
  setMergedCalendar: (data) =>
    set({
      mergedCalendar: data,
      mergedErrors: data?.errors ?? [],
      calendarLoading: false,
    }),

  setCalendarLoading: (loading) => set({ calendarLoading: loading }),

  toggleVisibleSource: (source) =>
    set((s) => ({
      visibleSources: {
        ...s.visibleSources,
        [source]: !s.visibleSources[source],
      },
    })),

  setStatusFilter: (filter) => set({ statusFilter: filter }),
}));
