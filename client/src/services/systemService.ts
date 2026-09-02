import { http as apiHttp } from "./httpClient";
import type { ApiResponse } from "../types/system";

/** 全局急停状态（后端 /v1/system/estop 响应体） */
export interface EstopStateDto {
  reason?: string;
  engagedAt?: string;
}

export interface EstopStatusDto {
  engaged: boolean;
  state: EstopStateDto | null;
}

export const systemService = {
  /**
   * 休眠恢复决策：true 补跑积压的定时任务；false 跳过积压任务
   */
  resolveSleep(runMissed: boolean) {
    return apiHttp.post<{ ok: boolean; runMissed: boolean }>(
      "/v1/system/sleep/resolve",
      { runMissed },
    );
  },

  /** 查询全局急停（ESTOP）状态 */
  getEstopStatus(): Promise<ApiResponse<EstopStatusDto>> {
    return apiHttp.get<EstopStatusDto>("/v1/system/estop");
  },

  /** 启用全局急停（暂停新工作，不杀进行中的） */
  engageEstop(reason?: string): Promise<ApiResponse<EstopStatusDto>> {
    return apiHttp.post<EstopStatusDto>("/v1/system/estop", { reason });
  },

  /** 解除全局急停 */
  disengageEstop(): Promise<ApiResponse<EstopStatusDto>> {
    return apiHttp.delete<EstopStatusDto>("/v1/system/estop");
  },
};
