/**
 * statsService.ts — 仪表盘统计数据服务
 *
 * 聚合后端各服务的概览数据，含精细化错误处理
 */

import { chatService } from "./chatService";
import { toolService } from "./toolService";
import { sessionService } from "./sessionService";
import { knowledgeService } from "./knowledgeService";
import { cronService } from "./cronService";
import { channelService } from "./channelService";
import { buddyService } from "./buddyService";
import { agentService } from "./agentService";
import { modelService } from "./modelService";
import { createLogger } from "@/utils/logger";

const logger = createLogger("statsService");

export interface DashboardStats {
  backend: {
    running: boolean;
    port: number | null;
    pid?: number | null;
  };
  models: number;
  tools: number;
  sessions: number;
  knowledge: number;
  cronTasks: number;
  channels: number;
  agentTasks: number;
  buddy: {
    name: string;
    species: string;
    rarity: string;
    xp: number;
    level: number;
  } | null;
}

export const statsService = {
  async getDashboardStats(): Promise<DashboardStats> {
    const results = await Promise.allSettled([
      chatService.getBackendStatus(),
      modelService.list(),
      toolService.list(),
      sessionService.list(),
      knowledgeService.list(),
      cronService.list(),
      channelService.list(),
      agentService.listTasks(),
      buddyService.getBuddy(),
    ]);

    // 提取结果，记录每个失败的详细原因
    const backendStatus =
      results[0].status === "fulfilled"
        ? results[0].value
        : (results[0].status === "rejected" &&
            logger.warn("后端状态加载失败:", results[0].reason),
          { running: false, port: null });

    const models =
      results[1].status === "fulfilled"
        ? results[1].value
        : (results[1].status === "rejected" &&
            logger.warn("模型列表加载失败:", results[1].reason),
          []);

    const tools =
      results[2].status === "fulfilled"
        ? results[2].value
        : (results[2].status === "rejected" &&
            logger.warn("工具列表加载失败:", results[2].reason),
          []);

    const sessions =
      results[3].status === "fulfilled"
        ? results[3].value
        : (results[3].status === "rejected" &&
            logger.warn("会话列表加载失败:", results[3].reason),
          []);

    const knowledge =
      results[4].status === "fulfilled"
        ? results[4].value
        : (results[4].status === "rejected" &&
            logger.warn("知识库列表加载失败:", results[4].reason),
          []);

    const cronTasks =
      results[5].status === "fulfilled"
        ? results[5].value
        : (results[5].status === "rejected" &&
            logger.warn("定时任务列表加载失败:", results[5].reason),
          []);

    const channels =
      results[6].status === "fulfilled"
        ? results[6].value
        : (results[6].status === "rejected" &&
            logger.warn("渠道列表加载失败:", results[6].reason),
          []);

    const agentTasks =
      results[7].status === "fulfilled"
        ? results[7].value
        : (results[7].status === "rejected" &&
            logger.warn("Agent 任务列表加载失败:", results[7].reason),
          []);

    const buddy =
      results[8].status === "fulfilled"
        ? results[8].value
        : (results[8].status === "rejected" &&
            logger.warn("Buddy 信息加载失败:", results[8].reason),
          null);

    return {
      backend: backendStatus,
      models: Array.isArray(models) ? models.length : 0,
      tools: Array.isArray(tools) ? tools.length : 0,
      sessions: Array.isArray(sessions) ? sessions.length : 0,
      knowledge: Array.isArray(knowledge) ? knowledge.length : 0,
      cronTasks: Array.isArray(cronTasks) ? cronTasks.length : 0,
      channels: Array.isArray(channels) ? channels.length : 0,
      agentTasks: Array.isArray(agentTasks) ? agentTasks.length : 0,
      buddy: buddy
        ? {
            name: buddy.name,
            species: buddy.species,
            rarity: buddy.rarity,
            xp: buddy.experience || 0,
            level: buddy.level || 1,
          }
        : null,
    };
  },
};
