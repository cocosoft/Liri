/**
 * 本地工作流任务
 * 基于CC源码 cc_code/backend/tasks/LocalWorkflowTask.ts 实现
 */

import { BaseTask } from './BaseTask';
import { TaskType, TaskStatus } from './types';

export interface WorkflowStep {
  id: string;
  description: string;
  taskType: TaskType;
  input?: Record<string, unknown>;
  dependsOn?: string[];
}

export interface WorkflowOutput {
  stepId: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

export class LocalWorkflowTask extends BaseTask {
  readonly type = TaskType.WORKFLOW;
  private steps: WorkflowStep[];
  private currentStepIndex: number = 0;
  private stepResults: Map<string, WorkflowOutput> = new Map();

  constructor(
    id: string,
    description: string,
    outputFile: string,
    steps: WorkflowStep[]
  ) {
    super(id, description, outputFile, TaskType.WORKFLOW);
    this.steps = steps;
  }

  async spawn(): Promise<void> {
    this.setStatus(TaskStatus.RUNNING);

    try {
      for (let i = 0; i < this.steps.length; i++) {
        if (this.abortController.signal.aborted) {
          this.setStatus(TaskStatus.KILLED);
          return;
        }

        const step = this.steps[i];
        this.currentStepIndex = i;

        await this.executeStep(step);
      }

      this.setStatus(TaskStatus.COMPLETED);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus(TaskStatus.FAILED, message);
      throw error;
    }
  }

  async kill(): Promise<void> {
    this.abortController.abort();
    this.setStatus(TaskStatus.KILLED);
  }

  private async executeStep(step: WorkflowStep): Promise<void> {
    this.emit('output', {
      type: 'step_start',
      stepId: step.id,
      description: step.description,
    });

    this.updateProgress(this.currentStepIndex + 1, 0, 0);

    try {
      await this.executeStepLogic(step);

      this.stepResults.set(step.id, {
        stepId: step.id,
        success: true,
      });

      this.emit('output', {
        type: 'step_complete',
        stepId: step.id,
        description: step.description,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.stepResults.set(step.id, {
        stepId: step.id,
        success: false,
        error: message,
      });

      this.emit('output', {
        type: 'step_failed',
        stepId: step.id,
        description: step.description,
        error: message,
      });

      throw error;
    }
  }

  private async executeStepLogic(step: WorkflowStep): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  getCurrentStep(): WorkflowStep | undefined {
    return this.steps[this.currentStepIndex];
  }

  getStepResults(): Map<string, WorkflowOutput> {
    return new Map(this.stepResults);
  }

  getSteps(): WorkflowStep[] {
    return [...this.steps];
  }

  getProgressPercent(): number {
    if (this.steps.length === 0) return 0;
    return Math.round((this.currentStepIndex / this.steps.length) * 100);
  }
}
