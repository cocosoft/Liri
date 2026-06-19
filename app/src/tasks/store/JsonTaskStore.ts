import { promises as fs } from 'fs';
import { join } from 'path';
import { Logger, LogLevel } from '@modules/monitoring';
import type { ITaskStore } from './ITaskStore';
import type { TaskState } from '../types';

const logger = new Logger({ level: LogLevel.INFO });

export class JsonTaskStore implements ITaskStore {
  private readonly filePath: string;
  private readonly dirPath: string;

  constructor(persistDir: string) {
    this.dirPath = persistDir;
    this.filePath = join(persistDir, 'tasks.json');
  }

  async loadTaskStates(): Promise<TaskState[]> {
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      return JSON.parse(content) as TaskState[];
    } catch {
      return [];
    }
  }

  async saveTaskStates(states: TaskState[]): Promise<void> {
    try {
      await fs.mkdir(this.dirPath, { recursive: true });
      await fs.writeFile(
        this.filePath,
        JSON.stringify(states, null, 2),
        'utf-8'
      );
    } catch (error) {
      logger.error(
        '[JsonTaskStore] 保存任务状态失败',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  async saveTaskState(state: TaskState): Promise<void> {
    const states = await this.loadTaskStates();
    const idx = states.findIndex((s) => s.id === state.id);
    if (idx >= 0) {
      states[idx] = state;
    } else {
      states.push(state);
    }
    await this.saveTaskStates(states);
  }

  async deleteTaskState(taskId: string): Promise<void> {
    const states = await this.loadTaskStates();
    const filtered = states.filter((s) => s.id !== taskId);
    await this.saveTaskStates(filtered);
  }

  async getTaskState(taskId: string): Promise<TaskState | null> {
    const states = await this.loadTaskStates();
    return states.find((s) => s.id === taskId) ?? null;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await fs
        .access(this.dirPath)
        .catch(() => fs.mkdir(this.dirPath, { recursive: true }));
      return true;
    } catch {
      return false;
    }
  }
}
