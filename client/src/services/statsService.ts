import { chatService } from './chatService';
import { toolService } from './toolService';
import { sessionService } from './sessionService';

export interface DashboardStats {
  backend: {
    running: boolean;
    port: number | null;
    pid?: number | null;
  };
  models: number;
  tools: number;
  sessions: number;
}

export const statsService = {
  async getDashboardStats(): Promise<DashboardStats> {
    const [backendStatus, tools, sessions] = await Promise.all([
      chatService.getBackendStatus(),
      toolService.list().catch(() => []),
      sessionService.list().catch(() => []),
    ]);

    return {
      backend: backendStatus,
      models: backendStatus.running ? 1 : 0,
      tools: tools.length,
      sessions: sessions.length,
    };
  },
};
