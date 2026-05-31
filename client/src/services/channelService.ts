import type { Channel } from '../types';
import { http } from './httpClient';

interface ChannelToggleResponse {
  success: boolean;
  id: string;
  enabled: boolean;
}

interface ChannelDeleteResponse {
  success: boolean;
}

export const channelService = {
  list: async (): Promise<Channel[]> => {
    return http.get<Channel[]>('/v1/channels');
  },

  get: async (id: string): Promise<Channel> => {
    return http.get<Channel>(`/v1/channels/${id}`);
  },

  toggle: async (id: string, enabled: boolean): Promise<ChannelToggleResponse> => {
    return http.post<ChannelToggleResponse>(`/v1/channels/${id}/toggle`, { enabled });
  },

  delete: async (id: string): Promise<ChannelDeleteResponse> => {
    return http.delete<ChannelDeleteResponse>(`/v1/channels/${id}`);
  },
};
