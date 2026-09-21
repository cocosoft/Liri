/**
 * Settings Panel Store — Zustand
 *
 * A3：Settings 侧边面板（高频快捷抽屉）UI 态管理。
 * 纯 UI 状态，不持久化：打开/关闭/当前 tab。
 */

import { create } from "zustand";

export type SettingsPanelTab =
  | "config"
  | "router"
  | "memory"
  | "notifications";

interface SettingsPanelState {
  panelOpen: boolean;
  activeTab: SettingsPanelTab;
  /** 打开面板（保留上次 activeTab） */
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  setActiveTab: (tab: SettingsPanelTab) => void;
}

export const useSettingsPanelStore = create<SettingsPanelState>()((set) => ({
  panelOpen: false,
  activeTab: "config",
  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setActiveTab: (tab) => set({ activeTab: tab }),
}));
