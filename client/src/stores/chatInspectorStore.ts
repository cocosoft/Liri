/**
 * ChatInspector Store — 右侧对话信息面板的 UI 交互状态
 *
 * 仅管理 UI 状态（展开/收起、Tab 切换、面板宽度、跳转定位），
 * 不管理对话数据（Token 用量、工具调用等数据从 chatStore/messages 只读获取）。
 */

import { create } from "zustand";

// ─── 类型 ─────────────────────────────────────────

export type InspectorTab = "context" | "tools" | "files" | "settings";

export interface ChatInspectorState {
  /** 面板是否展开 */
  isOpen: boolean;
  /** 当前激活的 Tab */
  activeTab: InspectorTab;
  /** 面板宽度（px） */
  panelWidth: number;
  /** 消息摘要点击跳转的目标轮次 ID */
  highlightedRoundId: string | null;
  /** 工具调用进行中数量（用于收起态角标） */
  activeToolCount: number;
  /** 新文件标记数量（用于收起态角标） */
  newFileCount: number;
  /** Token 警告标记（超过 80% 上下文窗口时触发） */
  tokenWarning: boolean;

  setOpen: (open: boolean) => void;
  setActiveTab: (tab: InspectorTab) => void;
  setPanelWidth: (width: number) => void;
  setHighlightedRoundId: (id: string | null) => void;
  setActiveToolCount: (count: number) => void;
  setNewFileCount: (count: number) => void;
  setTokenWarning: (warning: boolean) => void;
}

// ─── 常量 ─────────────────────────────────────────

const STORAGE_VERSION = "v1";
const DEFAULT_PANEL_WIDTH = 360;
const MIN_PANEL_WIDTH = 280;
/** 面板最大宽度 = 屏幕宽度的 50%（用户反馈固定 480px 太小；50% 便于阅读长内容） */
const MAX_PANEL_WIDTH_RATIO = 0.5;

/** 计算当前屏幕下的面板最大宽度（px）；小屏时以 MIN 兜底，保证 max >= min */
export function getMaxPanelWidth(): number {
  if (typeof window === "undefined") return MIN_PANEL_WIDTH;
  return Math.max(
    MIN_PANEL_WIDTH,
    Math.floor(window.innerWidth * MAX_PANEL_WIDTH_RATIO),
  );
}

function storageKey(key: string): string {
  return `liri-chat-inspector:${STORAGE_VERSION}:${key}`;
}

function loadStored<T>(key: string, defaultValue: T): T {
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (raw === null) return defaultValue;
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

function persistSetting(key: string, value: unknown): void {
  try {
    localStorage.setItem(storageKey(key), JSON.stringify(value));
  } catch {
    // localStorage 不可用时静默忽略
  }
}

// ─── Store 实现 ──────────────────────────────────

export const useChatInspectorStore = create<ChatInspectorState>((set) => ({
  isOpen: loadStored<boolean>("isOpen", false),
  activeTab: loadStored<InspectorTab>("activeTab", "context"),
  panelWidth: (() => {
    // 加载时 clamp：旧存储值（如 480）可能超出当前屏幕 50% 上限
    const stored = loadStored<number>("panelWidth", DEFAULT_PANEL_WIDTH);
    return Math.max(MIN_PANEL_WIDTH, Math.min(getMaxPanelWidth(), stored));
  })(),
  highlightedRoundId: null,
  activeToolCount: 0,
  newFileCount: 0,
  tokenWarning: false,

  setOpen: (open) => {
    set({ isOpen: open });
    persistSetting("isOpen", open);
  },

  setActiveTab: (tab) => {
    set({ activeTab: tab });
    persistSetting("activeTab", tab);
  },

  setPanelWidth: (width) => {
    const clamped = Math.max(
      MIN_PANEL_WIDTH,
      Math.min(getMaxPanelWidth(), width),
    );
    set({ panelWidth: clamped });
    persistSetting("panelWidth", clamped);
  },

  setHighlightedRoundId: (id) => set({ highlightedRoundId: id }),

  setActiveToolCount: (count) => set({ activeToolCount: count }),

  setNewFileCount: (count) => set({ newFileCount: count }),

  setTokenWarning: (warning) => set({ tokenWarning: warning }),
}));

// ─── 导出常量 ────────────────────────────────────

export { DEFAULT_PANEL_WIDTH, MIN_PANEL_WIDTH };
