/**
 * 余额查询 API 服务层
 * 对接后端 /v1/balance 和 /v1/balances 端点
 */

import { httpLegacy as http } from "./httpClient";
import type { BalanceResult, BalanceRecord } from "../types";

export const balanceService = {
  /** 查询单个供应商余额 */
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

  /** 批量查询所有活跃供应商余额（缓存版本） */
  async batchCheck(): Promise<BalanceRecord[]> {
    const resp = await http.get<{ data: BalanceRecord[] }>("/v1/balances");
    return resp.data;
  },
};
