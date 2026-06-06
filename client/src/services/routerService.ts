/**
 * 智能路由 API 服务层
 * 提供 SmartRouter 配置的读取与运行时更新
 */

import { http } from "./httpClient";

export interface RouterConfig {
  enabled: boolean;
  defaultTier: string;
  sessionSticky: boolean;
}

export interface LastRouteDecision {
  tier: string;
  model: string;
  provider: string;
  sessionId?: string;
  timestamp: string;
}

export interface RouterStatus {
  enabled: boolean;
  config: RouterConfig | null;
  lastDecision: LastRouteDecision | null;
  active: boolean;
}

export const routerService = {
  /**
   * 获取 SmartRouter 当前配置与状态
   */
  async getConfig(): Promise<RouterStatus> {
    return http.get<RouterStatus>("/v1/router/config");
  },

  /**
   * 更新 SmartRouter 运行时配置（动态切换，不等待重启）
   * @param config - 需要更新的配置项（支持部分更新）
   */
  async updateConfig(config: Partial<RouterConfig>): Promise<void> {
    await http.put("/v1/router/config", { config });
  },
};
