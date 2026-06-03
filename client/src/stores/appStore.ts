import { create } from "zustand";

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
  | "buddy";

type NavigateFn = (path: string) => void;

interface AppStore {
  activePage: AppPage;
  setActivePage: (page: AppPage) => void;
  _navigate: NavigateFn | null;
  _setNavigate: (fn: NavigateFn) => void;
}

export const useAppStore = create<AppStore>((set, get) => ({
  activePage: "home",
  _navigate: null,

  setActivePage: (page) => {
    set({ activePage: page });
    const nav = get()._navigate;
    if (nav) {
      nav(page === "home" ? "/" : `/${page}`);
    }
  },

  _setNavigate: (fn) => set({ _navigate: fn }),
}));
