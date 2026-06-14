import type {
  Channel,
  UpdateChannelRequest,
  ChannelHealth,
  ChannelPluginInfo,
} from "../types";
import { httpLegacy as http } from "./httpClient";

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
    return http.get<Channel[]>("/v1/channels");
  },

  get: async (id: string): Promise<Channel> => {
    return http.get<Channel>(`/v1/channels/${id}`);
  },

  /** 更新渠道配置 */
  update: async (id: string, data: UpdateChannelRequest): Promise<Channel> => {
    return http.put<Channel>(`/v1/channels/${id}`, data);
  },

  toggle: async (
    id: string,
    enabled: boolean,
  ): Promise<ChannelToggleResponse> => {
    return http.post<ChannelToggleResponse>(`/v1/channels/${id}/toggle`, {
      enabled,
    });
  },

  delete: async (id: string): Promise<ChannelDeleteResponse> => {
    return http.delete<ChannelDeleteResponse>(`/v1/channels/${id}`);
  },

  /** 健康检查 */
  health: async (id: string): Promise<ChannelHealth> => {
    return http.get<ChannelHealth>(`/v1/channels/${id}/health`);
  },

  /** 应用配置（触发 Gateway 重载） */
  applyConfig: async (): Promise<{ success: boolean }> => {
    return http.post<{ success: boolean }>("/v1/channels/config/apply");
  },

  /** 获取已安装的渠道插件列表 */
  listPlugins: async (): Promise<ChannelPluginInfo[]> => {
    return http.get<ChannelPluginInfo[]>("/v1/channels/plugins");
  },

  /** 安装渠道插件 */
  installPlugin: async (
    packageName: string,
  ): Promise<{ success: boolean; name: string; version: string }> => {
    return http.post<{ success: boolean; name: string; version: string }>(
      "/v1/channels/plugins/install",
      { package: packageName },
    );
  },
};
