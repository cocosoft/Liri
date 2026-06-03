/**
 * 余额查询 API 服务层
 * 对接后端 /v1/balance 端点
 */

import { http } from "./httpClient";
import type { BalanceResult } from "../types";

export const balanceService = {
  /** 查询供应商余额 */
  async check(params: {
    providerId?: string;
    baseUrl?: string;
    apiKey?: string;
  }): Promise<BalanceResult> {
    const resp = await http.post<{ data: BalanceResult }>(
      "/v1/balance",
      params,
    );
    return resp.data;
  },
};
