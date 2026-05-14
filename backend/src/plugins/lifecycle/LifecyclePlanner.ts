/**
 * LifecyclePlanner 生命周期规划器
 * 对标 OpenClaw 的 planner/，规划插件的生命周期步骤和执行顺序
 */

/**
 * 规划步骤
 */
export interface PlanStep {
  id: string;
  name: string;
  type: 'load' | 'activate' | 'deactivate' | 'unload' | 'configure' | 'validate';
  priority: number;
  dependsOn: string[];
  timeout: number;
  retryable: boolean;
}

/**
 * 执行计划
 */
export interface LifecyclePlan {
  pluginName: string;
  steps: PlanStep[];
  totalSteps: number;
  estimatedDurationMs: number;
  createdAt: number;
}

/**
 * 执行状态
 */
export interface PlanExecution {
  planId: string;
  pluginName: string;
  currentStep: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt?: number;
  completedAt?: number;
  error?: string;
  stepResults: Map<string, { success: boolean; durationMs: number; error?: string }>;
}

/**
 * 生命周期规划器
 */
export class LifecyclePlanner {
  /**
   * 生成加载计划
   */
  planLoad(pluginName: string): LifecyclePlan {
    const steps: PlanStep[] = [
      {
        id: `${pluginName}:validate`,
        name: '验证插件',
        type: 'validate',
        priority: 10,
        dependsOn: [],
        timeout: 5000,
        retryable: true,
      },
      {
        id: `${pluginName}:load`,
        name: '加载插件',
        type: 'load',
        priority: 20,
        dependsOn: [`${pluginName}:validate`],
        timeout: 30000,
        retryable: true,
      },
      {
        id: `${pluginName}:configure`,
        name: '配置插件',
        type: 'configure',
        priority: 30,
        dependsOn: [`${pluginName}:load`],
        timeout: 10000,
        retryable: true,
      },
      {
        id: `${pluginName}:activate`,
        name: '激活插件',
        type: 'activate',
        priority: 40,
        dependsOn: [`${pluginName}:configure`],
        timeout: 30000,
        retryable: false,
      },
    ];

    return {
      pluginName,
      steps,
      totalSteps: steps.length,
      estimatedDurationMs: steps.reduce((sum, s) => sum + s.timeout, 0),
      createdAt: Date.now(),
    };
  }

  /**
   * 生成卸载计划
   */
  planUnload(pluginName: string): LifecyclePlan {
    const steps: PlanStep[] = [
      {
        id: `${pluginName}:deactivate`,
        name: '停用插件',
        type: 'deactivate',
        priority: 10,
        dependsOn: [],
        timeout: 30000,
        retryable: false,
      },
      {
        id: `${pluginName}:unload`,
        name: '卸载插件',
        type: 'unload',
        priority: 20,
        dependsOn: [`${pluginName}:deactivate`],
        timeout: 10000,
        retryable: true,
      },
    ];

    return {
      pluginName,
      steps,
      totalSteps: steps.length,
      estimatedDurationMs: steps.reduce((sum, s) => sum + s.timeout, 0),
      createdAt: Date.now(),
    };
  }

  /**
   * 自定义计划
   */
  createPlan(pluginName: string, steps: PlanStep[]): LifecyclePlan {
    return {
      pluginName,
      steps: [...steps].sort((a, b) => a.priority - b.priority),
      totalSteps: steps.length,
      estimatedDurationMs: steps.reduce((sum, s) => sum + s.timeout, 0),
      createdAt: Date.now(),
    };
  }

  /**
   * 验证计划
   */
  validatePlan(plan: LifecyclePlan): string[] {
    const errors: string[] = [];

    if (plan.steps.length === 0) {
      errors.push('计划不能为空');
    }

    const stepIds = new Set<string>();

    for (const step of plan.steps) {
      if (stepIds.has(step.id)) {
        errors.push(`步骤 ID 重复: ${step.id}`);
      }

      stepIds.add(step.id);

      for (const dep of step.dependsOn) {
        if (!stepIds.has(dep) && !plan.steps.find((s) => s.id === dep)) {
          errors.push(`步骤 ${step.id} 依赖 ${dep} 未找到`);
        }
      }
    }

    return errors;
  }

  /**
   * 估算执行时间
   */
  estimateDuration(plan: LifecyclePlan): number {
    return plan.steps.reduce((max, step) => {
      const depTime = step.dependsOn.reduce((sum, depId) => {
        const dep = plan.steps.find((s) => s.id === depId);

        return sum + (dep ? dep.timeout : 0);
      }, 0);

      return Math.max(max, depTime + step.timeout);
    }, 0);
  }

  /**
   * 获取步骤依赖顺序（拓扑排序）
   */
  getExecutionOrder(plan: LifecyclePlan): PlanStep[] {
    const visited = new Set<string>();
    const order: PlanStep[] = [];
    const stepMap = new Map(plan.steps.map((s) => [s.id, s]));

    const visit = (stepId: string): void => {
      if (visited.has(stepId)) return;

      visited.add(stepId);

      const step = stepMap.get(stepId);

      if (step) {
        for (const dep of step.dependsOn) {
          visit(dep);
        }

        order.push(step);
      }
    };

    for (const step of plan.steps) {
      visit(step.id);
    }

    return order;
  }
}

export const lifecyclePlanner = new LifecyclePlanner();
