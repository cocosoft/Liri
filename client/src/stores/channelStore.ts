import { create } from 'zustand';
import type { Channel } from '../types';
import { channelService } from '../services/channelService';

interface ChannelStore {
  channels: Channel[];
  isLoading: boolean;
  error: string | null;

  loadChannels: () => Promise<void>;
  toggleChannel: (id: string, enabled: boolean) => Promise<void>;
  deleteChannel: (id: string) => Promise<void>;
}

export const useChannelStore = create<ChannelStore>((set, get) => ({
  channels: [],
  isLoading: false,
  error: null,

  loadChannels: async () => {
    set({ isLoading: true, error: null });
    try {
      const channels = await channelService.list();
      set({ channels, isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  toggleChannel: async (id, enabled) => {
    try {
      const updated = await channelService.toggle(id, enabled);
      set({
        channels: get().channels.map((c) => (c.id === id ? updated : c)),
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  deleteChannel: async (id) => {
    try {
      await channelService.delete(id);
      set({ channels: get().channels.filter((c) => c.id !== id) });
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));
