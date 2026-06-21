/**
 * 瓶颈感知（Bottleneck Perception）
 *
 * 增强进度卡片，展示关键路径信息：
 * - 当前卡在哪一步
 * - 在等什么资源/人
 * - 下一步是什么
 * - 阻塞原因
 */

/** 瓶颈类型 */
export type BottleneckType =
  | 'waiting_human_review' // 等待人审核
  | 'waiting_ai_execution' // 等待 AI 执行
  | 'waiting_resource' // 等待资源（Agent/模型/配额）
  | 'waiting_dependency' // 等待前置步骤完成
  | 'rule_check_failed' // 规则检查失败
  | 'test_failed' // 测试失败
  | 'none'; // 无瓶颈

/** 瓶颈信息 */
export interface BottleneckInfo {
  /** 瓶颈类型 */
  type: BottleneckType;
  /** 当前步骤名称 */
  currentStep: string;
  /** 阻塞描述 */
  description: string;
  /** 在等谁（人或 Agent 名） */
  waitingFor: string;
  /** 下一步是什么 */
  nextStep: string;
  /** 预计解决时间（ms） */
  estimatedResolveMs: number | null;
  /** 建议操作 */
  suggestion: string;
  /** 是否可自动解决 */
  autoResolvable: boolean;
}

/** 关键路径步骤 */
export interface CriticalPathStep {
  name: string;
  status: 'pending' | 'in_progress' | 'blocked' | 'done' | 'failed';
  dependsOn: string[];
  estimatedDurationMs: number;
  assignee: string;
}

/** 瓶颈感知摘要 */
export interface BottleneckSummary {
  /** 整体进度 0-100 */
  overallProgress: number;
  /** 当前瓶颈（无则为 null） */
  currentBottleneck: BottleneckInfo | null;
  /** 关键路径步骤列表 */
  criticalPath: CriticalPathStep[];
  /** 已完成的步骤数 */
  completedSteps: number;
  /** 总步骤数 */
  totalSteps: number;
  /** 预计剩余时间（ms） */
  estimatedRemainingMs: number | null;
}

/**
 * 瓶颈分析器
 */
export class BottleneckAnalyzer {
  /**
   * 分析关键路径，识别当前瓶颈
   * @param steps 关键路径步骤
   * @returns 瓶颈摘要
   */
  analyze(steps: CriticalPathStep[]): BottleneckSummary {
    const completedSteps = steps.filter((s) => s.status === 'done').length;
    const totalSteps = steps.length;
    const overallProgress =
      totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

    // 找到当前瓶颈
    const bottleneck = this.identifyBottleneck(steps);

    // 估算剩余时间
    const remainingSteps = steps.filter(
      (s) =>
        s.status === 'pending' ||
        s.status === 'in_progress' ||
        s.status === 'blocked'
    );
    const estimatedRemainingMs = remainingSteps.reduce(
      (sum, s) => sum + s.estimatedDurationMs,
      0
    );

    return {
      overallProgress,
      currentBottleneck: bottleneck,
      criticalPath: steps,
      completedSteps,
      totalSteps,
      estimatedRemainingMs:
        estimatedRemainingMs > 0 ? estimatedRemainingMs : null,
    };
  }

  /**
   * 识别当前瓶颈
   */
  private identifyBottleneck(steps: CriticalPathStep[]): BottleneckInfo | null {
    // 查找被阻塞的步骤
    const blockedStep = steps.find((s) => s.status === 'blocked');
    if (blockedStep) {
      return this.buildBottleneckInfo(blockedStep, steps);
    }

    // 查找进行中的步骤（可能卡住）
    const inProgressStep = steps.find((s) => s.status === 'in_progress');
    if (inProgressStep) {
      return this.buildBottleneckInfo(inProgressStep, steps);
    }

    // 查找失败的步骤
    const failedStep = steps.find((s) => s.status === 'failed');
    if (failedStep) {
      return this.buildBottleneckInfo(failedStep, steps);
    }

    return null;
  }

  /**
   * 构建瓶颈信息
   */
  private buildBottleneckInfo(
    step: CriticalPathStep,
    allSteps: CriticalPathStep[]
  ): BottleneckInfo {
    let type: BottleneckType = 'none';
    let description = '';
    let waitingFor = '';
    let autoResolvable = false;

    switch (step.status) {
      case 'blocked':
        type = 'waiting_dependency';
        const blockingSteps = allSteps.filter(
          (s) => step.dependsOn.includes(s.name) && s.status !== 'done'
        );
        description = `步骤 "${step.name}" 被阻塞，等待前置步骤完成`;
        waitingFor = blockingSteps.map((s) => s.name).join('、');
        autoResolvable = false;
        break;

      case 'in_progress':
        if (
          step.assignee.toLowerCase().includes('human') ||
          step.assignee === '用户'
        ) {
          type = 'waiting_human_review';
          description = `等待 ${step.assignee} 完成审核`;
          waitingFor = step.assignee;
          autoResolvable = false;
        } else if (
          step.assignee.toLowerCase().includes('agent') ||
          step.assignee.toLowerCase().includes('ai')
        ) {
          type = 'waiting_ai_execution';
          description = `AI 正在执行 "${step.name}"`;
          waitingFor = step.assignee;
          autoResolvable = true;
        } else {
          type = 'waiting_resource';
          description = `等待资源 "${step.assignee}" 可用`;
          waitingFor = step.assignee;
          autoResolvable = true;
        }
        break;

      case 'failed':
        type = 'rule_check_failed';
        description = `步骤 "${step.name}" 执行失败`;
        waitingFor = '系统';
        autoResolvable = true;
        break;
    }

    // 找到下一步
    const nextStep =
      allSteps.find((s) => s.status === 'pending')?.name || '完成';

    // 生成建议
    const suggestion = this.generateSuggestion(type, step, waitingFor);

    return {
      type,
      currentStep: step.name,
      description,
      waitingFor,
      nextStep,
      estimatedResolveMs: step.estimatedDurationMs,
      suggestion,
      autoResolvable,
    };
  }

  /**
   * 生成建议操作
   */
  private generateSuggestion(
    type: BottleneckType,
    step: CriticalPathStep,
    waitingFor: string
  ): string {
    switch (type) {
      case 'waiting_human_review':
        return `请 ${waitingFor} 审核步骤 "${step.name}" 的结果`;
      case 'waiting_ai_execution':
        return `AI 正在处理中，预计还需 ${this.formatDuration(step.estimatedDurationMs)}`;
      case 'waiting_resource':
        return `资源 "${waitingFor}" 暂时不可用，可以等待或手动分配`;
      case 'waiting_dependency':
        return `需要先完成 "${waitingFor}"，建议优先推进`;
      case 'rule_check_failed':
        return `规则检查失败，AI 将自动重试；连续失败 3 次将升级给用户`;
      case 'test_failed':
        return `测试未通过，AI 将自动修复；建议检查测试用例是否正确`;
      default:
        return '等待中...';
    }
  }

  /** 格式化时长 */
  private formatDuration(ms: number): string {
    if (ms < 60 * 1000) return `${Math.round(ms / 1000)} 秒`;
    if (ms < 60 * 60 * 1000) return `${Math.round(ms / 60000)} 分钟`;
    return `${Math.round(ms / 3600000)} 小时`;
  }
}

/** 全局瓶颈分析器实例 */
export const bottleneckAnalyzer = new BottleneckAnalyzer();
