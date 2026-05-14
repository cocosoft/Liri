export interface TrajectoryStep {
  stepIndex: number;
  timestamp: number;
  phase: 'user_input' | 'thinking' | 'tool_call' | 'tool_result' | 'response' | 'error';
  input?: string;
  output?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  modelName?: string;
  tokensUsed?: number;
  durationMs?: number;
  error?: string;
}

export interface Trajectory {
  sessionId: string;
  startTime: number;
  endTime?: number;
  steps: TrajectoryStep[];
  totalTokens: number;
  totalDurationMs: number;
  modelName?: string;
  status: 'running' | 'completed' | 'error';
}

export class TrajectoryRecorder {
  private trajectories: Map<string, Trajectory> = new Map();

  startSession(sessionId: string, modelName?: string): Trajectory {
    const trajectory: Trajectory = {
      sessionId,
      startTime: Date.now(),
      steps: [],
      totalTokens: 0,
      totalDurationMs: 0,
      modelName,
      status: 'running',
    };
    this.trajectories.set(sessionId, trajectory);
    return trajectory;
  }

  recordStep(sessionId: string, step: Omit<TrajectoryStep, 'stepIndex' | 'timestamp'>): void {
    const trajectory = this.trajectories.get(sessionId);
    if (!trajectory) return;

    const fullStep: TrajectoryStep = {
      ...step,
      stepIndex: trajectory.steps.length,
      timestamp: Date.now(),
    };

    trajectory.steps.push(fullStep);

    if (step.tokensUsed) {
      trajectory.totalTokens += step.tokensUsed;
    }
    if (step.durationMs) {
      trajectory.totalDurationMs += step.durationMs;
    }

    if (step.phase === 'error') {
      trajectory.status = 'error';
      trajectory.endTime = Date.now();
    }
  }

  completeSession(sessionId: string): void {
    const trajectory = this.trajectories.get(sessionId);
    if (!trajectory) return;
    trajectory.status = 'completed';
    trajectory.endTime = Date.now();
  }

  getTrajectory(sessionId: string): Trajectory | undefined {
    return this.trajectories.get(sessionId);
  }

  getTrajectories(): Trajectory[] {
    return Array.from(this.trajectories.values());
  }

  deleteTrajectory(sessionId: string): boolean {
    return this.trajectories.delete(sessionId);
  }

  replayTrajectory(sessionId: string): string {
    const trajectory = this.trajectories.get(sessionId);
    if (!trajectory) return `No trajectory found: ${sessionId}`;

    const lines: string[] = [
      `Session: ${sessionId}`,
      `Model: ${trajectory.modelName || 'unknown'}`,
      `Status: ${trajectory.status}`,
      `Total tokens: ${trajectory.totalTokens}`,
      `Total duration: ${trajectory.totalDurationMs}ms`,
      '',
    ];

    for (const step of trajectory.steps) {
      const ts = new Date(step.timestamp).toISOString();
      lines.push(`[${step.stepIndex}] ${step.phase} (${ts})`);

      if (step.input) lines.push(`  Input: ${step.input.slice(0, 200)}`);
      if (step.output) lines.push(`  Output: ${step.output.slice(0, 200)}`);
      if (step.toolName) lines.push(`  Tool: ${step.toolName}`);
      if (step.error) lines.push(`  Error: ${step.error}`);
      if (step.durationMs) lines.push(`  Duration: ${step.durationMs}ms`);
      lines.push('');
    }

    return lines.join('\n');
  }

  clear(): void {
    this.trajectories.clear();
  }
}

export const trajectoryRecorder = new TrajectoryRecorder();
