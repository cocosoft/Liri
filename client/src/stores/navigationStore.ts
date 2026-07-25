/**
 * Navigation Store — 全局导航状态
 *
 * Phase 3: 从 appStore 拆分出导航切片。
 * 管理当前活跃页面（activePage）和路由导航函数。
 */

import { create } from "zustand";

// ─── 类型 ─────────────────────────────────────────

export type AppPage =
  | "home"
  | "chat"
  | "dashboard"
  | "logs"
  | "memory"
  | "skills"
  | "cron"
  | "files"
  | "knowledge"
  | "agent"
  | "channels"
  | "settings"
  | "buddy"
  | "liri"
  | "plans"
  | "tts"
  | "semantic"
  | "workspace"
  | "tasks";

type NavigateFn = (path: string) => void;

// ─── 接口 ─────────────────────────────────────────

export interface NavigationStore {
  activePage: AppPage;
  _navigate: NavigateFn | null;

  setActivePage: (page: AppPage) => void;
  _setNavigate: (fn: NavigateFn) => void;
}

// ─── Store 实现 ──────────────────────────────────

export const useNavigationStore = create<NavigationStore>((set, get) => ({
  activePage: "home",
  _navigate: null,

  /** 设置当前活跃页面并触发路由导航 */
  setActivePage: (page) => {
    set({ activePage: page });
    const nav = get()._navigate;
    if (nav) {
      nav(page === "home" ? "/" : `/${page}`);
    }
  },

  /** 注入路由导航函数（由 App.tsx 在 useEffect 中调用） */
  _setNavigate: (fn) => set({ _navigate: fn }),
}));
