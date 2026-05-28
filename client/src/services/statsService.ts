import { chatService } from './chatService';
import { toolService } from './toolService';
import { sessionService } from './sessionService';
import { knowledgeService } from './knowledgeService';
import { cronService } from './cronService';
import { channelService } from './channelService';
import { buddyService } from './buddyService';
import { agentService } from './agentService';

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
    const [backendStatus, tools, sessions, knowledge, cronTasks, channels, agentTasks, buddy] =
      await Promise.all([
        chatService.getBackendStatus(),
        toolService.list().catch(() => []),
        sessionService.list().catch(() => []),
        knowledgeService.list().catch(() => []),
        cronService.list().catch(() => []),
        channelService.list().catch(() => []),
        agentService.listTasks().catch(() => []),
        buddyService.getBuddy().catch(() => null),
      ]);

    return {
      backend: backendStatus,
      models: backendStatus.running ? 1 : 0,
      tools: tools.length,
      sessions: sessions.length,
      knowledge: knowledge.length,
      cronTasks: cronTasks.length,
      channels: channels.length,
      agentTasks: agentTasks.length,
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
