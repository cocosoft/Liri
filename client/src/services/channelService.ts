import type { Channel } from '../types';
import { http } from './httpClient';

export const channelService = {
  list: async (): Promise<Channel[]> => {
    return http.get<Channel[]>('/v1/channels');
  },

  get: async (id: string): Promise<Channel> => {
    return http.get<Channel>(`/v1/channels/${id}`);
  },

  toggle: async (id: string, enabled: boolean): Promise<Channel> => {
    return http.put<Channel>(`/v1/channels/${id}`, { enabled });
  },

  delete: async (id: string): Promise<void> => {
    return http.delete<void>(`/v1/channels/${id}`);
  },
};
