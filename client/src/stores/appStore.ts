import { create } from 'zustand';

export type AppPage = 'chat' | 'dashboard' | 'cron' | 'files' | 'knowledge' | 'agent' | 'channels' | 'settings' | 'buddy';

type NavigateFn = (path: string) => void;

interface AppStore {
  activePage: AppPage;
  setActivePage: (page: AppPage) => void;
  _navigate: NavigateFn | null;
  _setNavigate: (fn: NavigateFn) => void;
}

export const useAppStore = create<AppStore>((set, get) => ({
  activePage: 'chat',
  _navigate: null,

  setActivePage: (page) => {
    set({ activePage: page });
    const nav = get()._navigate;
    if (nav) {
      nav(page === 'chat' ? '/' : `/${page}`);
    }
  },

  _setNavigate: (fn) => set({ _navigate: fn }),
}));
