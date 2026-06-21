/**
 * 执行阶段追踪器
 *
 * 轻量阶段记录器，与 SessionStateMachine 的 RUNNING 状态共存。
 * 职责：记录当前执行阶段、进度、产出物，通过回调函数向前端推送状态变更。
 *
 * 设计原则：
 * 1. 不是状态机，不控制流程流转——仅做记录和通知
 * 2. 由 TAORLoop / OrchEngine 在任务编排过程中驱动阶段切换
 * 3. 不持有阻塞/等待逻辑
 * 4. Plan/Do 模式由调用方决策，ExecutionPhaseTracker 仅记录切换事件中的 mode 字段
 *    - Plan 模式下：阶段在 analyzing/designing 间切换（不写文件）
 *    - Do 模式下：阶段在 implementing/verifying 间切换（写文件变更）
 */

// ─── 类型定义 ────────────────────────────────────────────────────────────────

/** 执行阶段 */
export type ExecutionPhase =
  | 'analyzing'
  | 'designing'
  | 'implementing'
  | 'verifying'
  | 'presenting';

/** 工作模式 */
export type WorkMode = 'plan' | 'do';

/** 产出物 */
export interface Artifact {
  type: 'analysis' | 'design' | 'code' | 'diff' | 'report';
  summary: string;
  detail?: string;
  files?: string[];
}

/** 阶段记录 */
export interface PhaseRecord {
  phase: ExecutionPhase;
  enteredAt: number;
  description: string;
  progress: number; // 0-100
  artifacts: Artifact[];
}

/** 阶段事件（用于前端推送） */
export interface PhaseEvent {
  sessionId: string;
  mode: WorkMode;
  phase: ExecutionPhase;
  progress: number;
  description: string;
  timestamp: number;
  steps?: {
    name: string;
    status: 'pending' | 'in_progress' | 'done' | 'failed';
  }[];
  currentStep?: string;
}

/** 进度数据（映射到前端 ProgressData） */
export interface ProgressData {
  steps: {
    name: string;
    status: 'pending' | 'in_progress' | 'done' | 'failed';
  }[];
  currentStep: string;
}

/** 交付物数据（映射到前端 DeliverableData） */
export interface DeliverableData {
  files: {
    path: string;
    change: 'added' | 'modified' | 'deleted';
    status: 'pending' | 'verified' | 'failed';
  }[];
  summary: string;
}

/** 更新回调签名 */
export type PhaseUpdateCallback = (event: PhaseEvent) => void;

// ─── 追踪器实现 ──────────────────────────────────────────────────────────────

export class ExecutionPhaseTracker {
  private sessionId: string;
  private mode: WorkMode = 'plan';
  private currentPhase: ExecutionPhase | null = null;
  private history: PhaseRecord[] = [];
  private currentSteps: ProgressData['steps'] = [];
  private currentStep: string = '';
  private onUpdate: PhaseUpdateCallback;

  constructor(sessionId: string, onUpdate: PhaseUpdateCallback) {
    this.sessionId = sessionId;
    this.onUpdate = onUpdate;
  }

  /** 设置工作模式（Plan/Do） */
  setMode(mode: WorkMode): void {
    this.mode = mode;
  }

  /** 获取当前工作模式 */
  getMode(): WorkMode {
    return this.mode;
  }

  /** 进入新阶段 */
  enter(phase: ExecutionPhase, description: string): void {
    this.currentPhase = phase;

    const record: PhaseRecord = {
      phase,
      enteredAt: Date.now(),
      description,
      progress: 0,
      artifacts: [],
    };

    this.history.push(record);
    this.emitUpdate();
  }

  /** 更新当前阶段进度 */
  updateProgress(percent: number, detail: string): void {
    if (!this.currentPhase) return;

    const currentRecord = this.history[this.history.length - 1];
    if (currentRecord) {
      currentRecord.progress = Math.max(0, Math.min(100, percent));
      if (detail) {
        currentRecord.description = detail;
      }
    }

    this.emitUpdate();
  }

  /** 更新步骤列表 */
  updateSteps(steps: ProgressData['steps'], currentStep: string): void {
    this.currentSteps = steps;
    this.currentStep = currentStep;
    this.emitUpdate();
  }

  /** 记录产出物 */
  addArtifact(artifact: Artifact): void {
    if (!this.currentPhase) return;

    const currentRecord = this.history[this.history.length - 1];
    if (currentRecord) {
      currentRecord.artifacts.push(artifact);
    }

    this.emitUpdate();
  }

  /** 获取完整历史 */
  getHistory(): PhaseRecord[] {
    return [...this.history];
  }

  /** 获取当前阶段 */
  getCurrentPhase(): ExecutionPhase | null {
    return this.currentPhase;
  }

  /** 获取当前进度 */
  getCurrentProgress(): number {
    if (this.history.length === 0) return 0;
    return this.history[this.history.length - 1].progress;
  }

  /** 构建交付物数据（从当前阶段的产出物） */
  buildDeliverableData(): DeliverableData | null {
    const currentRecord = this.history[this.history.length - 1];
    if (!currentRecord || currentRecord.artifacts.length === 0) return null;

    const files: DeliverableData['files'] = [];
    const summaryParts: string[] = [];

    for (const artifact of currentRecord.artifacts) {
      if (artifact.files) {
        for (const filePath of artifact.files) {
          files.push({
            path: filePath,
            change: 'modified',
            status: 'pending',
          });
        }
      }
      summaryParts.push(artifact.summary);
    }

    return {
      files,
      summary: summaryParts.join('; '),
    };
  }

  /** 构建进度数据 */
  buildProgressData(): ProgressData {
    return {
      steps: this.currentSteps,
      currentStep: this.currentStep,
    };
  }

  /** 重置（退出执行态时） */
  reset(): void {
    this.currentPhase = null;
    this.history = [];
    this.currentSteps = [];
    this.currentStep = '';
  }

  /** 序列化用于前端推送 */
  toPhaseEvent(): PhaseEvent {
    const currentRecord =
      this.history.length > 0 ? this.history[this.history.length - 1] : null;

    return {
      sessionId: this.sessionId,
      mode: this.mode,
      phase: this.currentPhase || 'analyzing',
      progress: currentRecord?.progress || 0,
      description: currentRecord?.description || '',
      timestamp: Date.now(),
      steps: this.currentSteps.length > 0 ? this.currentSteps : undefined,
      currentStep: this.currentStep || undefined,
    };
  }

  /** 触发回调通知 */
  private emitUpdate(): void {
    this.onUpdate(this.toPhaseEvent());
  }
}
