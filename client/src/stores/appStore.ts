import { create } from 'zustand';

export type AppPage = 'chat' | 'dashboard' | 'cron' | 'files' | 'knowledge' | 'agent' | 'channels';

interface AppStore {
  activePage: AppPage;
  setActivePage: (page: AppPage) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  activePage: 'chat',
  setActivePage: (page) => set({ activePage: page }),
}));
