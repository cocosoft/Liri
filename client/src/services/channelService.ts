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
import { ENDPOINTS } from "./endpoints";

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
    return http.get<Channel[]>(ENDPOINTS.channels.base);
  },

  get: async (id: string): Promise<Channel> => {
    return http.get<Channel>(ENDPOINTS.channels.byId(id));
  },

  /** 更新渠道配置 */
  update: async (id: string, data: UpdateChannelRequest): Promise<Channel> => {
    return http.put<Channel>(ENDPOINTS.channels.byId(id), data);
  },

  toggle: async (
    id: string,
    enabled: boolean,
  ): Promise<ChannelToggleResponse> => {
    return http.post<ChannelToggleResponse>(ENDPOINTS.channels.toggle(id), {
      enabled,
    });
  },

  delete: async (id: string): Promise<ChannelDeleteResponse> => {
    return http.delete<ChannelDeleteResponse>(ENDPOINTS.channels.byId(id));
  },

  /** 健康检查 */
  health: async (id: string): Promise<ChannelHealth> => {
    return http.get<ChannelHealth>(ENDPOINTS.channels.health(id));
  },

  /** 获取所有通道健康聚合（P2-6 / 4.12） */
  getHealth: async (): Promise<ChannelHealthAggregate> => {
    return http.get<ChannelHealthAggregate>(ENDPOINTS.channels.healthAll);
  },

  /** 获取渠道可观测性指标（消息收发计数/拒绝原因/处理耗时/发送耗时） */
  getMetrics: async (): Promise<ChannelMetricsResponse> => {
    return http.get<ChannelMetricsResponse>(ENDPOINTS.channels.metrics);
  },

  /** 获取全部渠道实时监控快照（五态机/探测/重连计数/错误快照） */
  getMonitorStatus: async (): Promise<ChannelMonitorStatusResponse> => {
    return http.get<ChannelMonitorStatusResponse>(
      ENDPOINTS.channels.monitorStatus,
    );
  },

  /** 强制重连兜底（断开 → 释放 → 重连 → 探测验证） */
  forceReconnect: async (
    channelId: string,
  ): Promise<ChannelForceReconnectResponse> => {
    return http.post<ChannelForceReconnectResponse>(
      ENDPOINTS.channels.monitorForceReconnect,
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
      `${ENDPOINTS.channels.messagesTrace}?${params.toString()}`,
    );
  },

  /** 获取渠道字段渲染 schema（4.1：后端单一来源，前端表单渲染依据） */
  getSchema: async (): Promise<ChannelSchema> => {
    return http.get<ChannelSchema>(ENDPOINTS.channels.schema);
  },

  /** 应用配置（触发 Gateway 重载） */
  applyConfig: async (): Promise<{ success: boolean }> => {
    return http.post<{ success: boolean }>(ENDPOINTS.channels.configApply);
  },

  /** 获取已安装的渠道插件列表 */
  listPlugins: async (): Promise<ChannelPluginInfo[]> => {
    return http.get<ChannelPluginInfo[]>(ENDPOINTS.channels.plugins);
  },

  /** 安装渠道插件 */
  installPlugin: async (
    packageName: string,
  ): Promise<{ success: boolean; name: string; version: string }> => {
    return http.post<{ success: boolean; name: string; version: string }>(
      ENDPOINTS.channels.pluginsInstall,
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
    return http.get(ENDPOINTS.wechat.cliStatus);
  },
};
