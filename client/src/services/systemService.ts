import { http as apiHttp } from "./httpClient";

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
};
