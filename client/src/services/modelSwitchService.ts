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

  /**
   * N-46（2026-09-20）：取任务分工配置**及其来源标记**。
   *
   * `sources[task] === "user"` ⇒ 该任务在 chat 类 route 上**显式生效**（优先于智能路由档位）；
   * `"seed"` ⇒ 系统播种值，实际模型由档位决定。用于任务分工页展示"是否已显式生效"，
   * 避免"UI 显示 A、运行时用 B"的数出同源缺口。
   *
   * N-47（2026-09-20）：同时透出 `modelNames`（UUID → 显示名）。任务分工页用它把
   * "已配置但不在下拉选项中"的值（模型被禁用/删除）显示为真实名称 —— 否则受控 `select`
   * 会静默回退显示首项"未设置"，用户看不到 DB 里的真实配置。
   *
   * 注：`sources` / `modelNames` 为后端新增字段，缺失时按空对象处理（旧后端仍可渲染，只是不显示标记/真实名）。
   */
  async getTasksWithSources(): Promise<{
    tasks: TaskModelConfig;
    sources: Record<string, "user" | "seed">;
    modelNames: Record<string, string>;
  }> {
    const res = await http.get<{
      tasks: TaskModelConfig;
      sources?: Record<string, "user" | "seed">;
      modelNames?: Record<string, string>;
    }>("/v1/models/tasks");
    return {
      tasks: res.tasks ?? {},
      sources: res.sources ?? {},
      modelNames: res.modelNames ?? {},
    };
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

  /** S3: 获取阶段→TaskType 自定义映射 */
  async getPhaseMapping(): Promise<Record<string, string>> {
    return http.get<Record<string, string>>("/v1/models/phase-mapping");
  },

  /** S3: 保存阶段→TaskType 自定义映射 */
  async savePhaseMapping(mapping: Record<string, string>): Promise<void> {
    await http.put("/v1/models/phase-mapping", mapping);
  },
};
