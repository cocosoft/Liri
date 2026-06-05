/**
 * 模型切换 API 服务层
 * 提供当前模型状态查询、模型切换、任务分工策略管理
 */

import { http } from "./httpClient";
import type { CurrentModelInfo, TaskModelConfig } from "../types";

export const modelSwitchService = {
  async getCurrent(): Promise<CurrentModelInfo> {
    return http.get<CurrentModelInfo>("/v1/models/current");
  },

  async switch(modelId: string): Promise<void> {
    await http.post("/v1/models/switch", { modelId });
  },

  async getTasks(): Promise<TaskModelConfig> {
    return http.get<TaskModelConfig>("/v1/models/tasks");
  },

  async saveTasks(tasks: TaskModelConfig): Promise<void> {
    await http.put("/v1/models/tasks", tasks);
  },

  async setDefaultModel(providerId: string, modelId: string): Promise<void> {
    await http.put("/v1/models/default", { providerId, modelId });
  },
};
