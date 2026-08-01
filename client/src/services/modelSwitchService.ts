/**
 * 模型切换 API 服务层
 * 提供当前模型状态查询、模型切换、任务分工策略管理
 */

import { httpLegacy as http } from "./httpClient";
import type {
  CurrentModelInfo,
  TaskModelConfig,
  TaskDefinition,
} from "../types";

export const modelSwitchService = {
  async getCurrent(): Promise<CurrentModelInfo> {
    return http.get<CurrentModelInfo>("/v1/models/current");
  },

  async switch(
    modelId: string,
  ): Promise<{ modelId: string; modelName: string }> {
    const res = await http.post<{
      data: { modelId: string; modelName: string };
    }>("/v1/models/switch", { modelId });
    return res.data;
  },

  async getTasks(): Promise<TaskModelConfig> {
    const res = await http.get<{
      tasks: TaskModelConfig;
      modelNames: Record<string, string>;
    }>("/v1/models/tasks");
    return res.tasks;
  },

  async saveTasks(tasks: TaskModelConfig): Promise<void> {
    const res = await http.put<{ success: boolean }>("/v1/models/tasks", tasks);
    if (!res.success) {
      throw new Error("保存任务分工失败：后端返回异常");
    }
  },

  async setDefaultModel(providerId: string, modelId: string): Promise<void> {
    await http.put("/v1/models/default", { providerId, modelId });
  },

  /** 获取任务定义列表（同源，后端为唯一事实来源） */
  async getTaskDefinitions(): Promise<TaskDefinition[]> {
    return http.get<TaskDefinition[]>("/v1/models/tasks/definitions");
  },
};
