import type {
  Channel,
  UpdateChannelRequest,
  ChannelHealth,
  ChannelHealthAggregate,
  ChannelMetricsResponse,
  ChannelSchema,
  ChannelPluginInfo,
  ChannelMonitorStatusResponse,
  ChannelForceReconnectResponse,
  MessageTracesResponse,
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

  /** 获取所有通道健康聚合（P2-6 / 4.12） */
  getHealth: async (): Promise<ChannelHealthAggregate> => {
    return http.get<ChannelHealthAggregate>("/v1/channels/health");
  },

  /** 获取渠道可观测性指标（消息收发计数/拒绝原因/处理耗时/发送耗时） */
  getMetrics: async (): Promise<ChannelMetricsResponse> => {
    return http.get<ChannelMetricsResponse>("/v1/channels/metrics");
  },

  /** 获取全部渠道实时监控快照（五态机/探测/重连计数/错误快照） */
  getMonitorStatus: async (): Promise<ChannelMonitorStatusResponse> => {
    return http.get<ChannelMonitorStatusResponse>(
      "/v1/channels/monitor/status",
    );
  },

  /** 强制重连兜底（断开 → 释放 → 重连 → 探测验证） */
  forceReconnect: async (
    channelId: string,
  ): Promise<ChannelForceReconnectResponse> => {
    return http.post<ChannelForceReconnectResponse>(
      "/v1/channels/monitor/force-reconnect",
      { channelId },
    );
  },

  /** 获取最近消息全链路（方案 A：入站→验证→去重→LLM→出站阶段耗时与状态） */
  getMessageTraces: async (
    limit = 50,
    channel?: string,
  ): Promise<MessageTracesResponse> => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (channel) params.set("channel", channel);
    return http.get<MessageTracesResponse>(
      `/v1/channels/messages/trace?${params.toString()}`,
    );
  },

  /** 获取渠道字段渲染 schema（4.1：后端单一来源，前端表单渲染依据） */
  getSchema: async (): Promise<ChannelSchema> => {
    return http.get<ChannelSchema>("/v1/channels/schema");
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

  /** 获取 weixin-cli 状态（含二维码扫码信息） */
  getWechatCliStatus: async (): Promise<{
    success: boolean;
    data: {
      state: string;
      installed: boolean;
      running: boolean;
      qrBase64: string | null;
      qrRaw: string | null;
      lastError: string | null;
      pid: number | null;
      uptimeSec: number | null;
    };
  }> => {
    return http.get("/v1/wechat/cli-status");
  },
};
