export type TaskState = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';

export interface Task {
  id: string;
  name: string;
  state: TaskState;
  createdAt: number;
  updatedAt: number;
  result?: unknown;
  error?: string;
}
