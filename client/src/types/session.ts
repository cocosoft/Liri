export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  roundCount: number;
  agentId?: string;
  source?: string;
  tokenUsage?: {
    totalInput: number;
    totalOutput: number;
  };
}