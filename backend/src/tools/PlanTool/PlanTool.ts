/**
 * 计划模式工具
 * 参考CC源码 cc_code/backend/utils/planModeV2.ts 实现
 * 提供计划生成、管理和执行功能
 */

import { BaseTool } from '../BaseTool';
import type {
  ToolResult,
  ToolUseContext,
  ToolParam,
  ToolCallProgress,
  ValidationResult,
} from '../types';
import { createToolResult } from '../types/ToolResult';

/**
 * 计划工具输入类型
 */
export interface PlanToolInput {
  /** 操作类型 */
  action: 'create' | 'list' | 'get' | 'update' | 'delete' | 'execute';
  /** 计划ID */
  plan_id?: string;
  /** 计划名称 */
  name?: string;
  /** 计划描述 */
  description?: string;
  /** 计划步骤 */
  steps?: PlanStep[];
  /** 计划状态 */
  status?: 'draft' | 'active' | 'completed' | 'cancelled';
  /** 执行参数 */
  execution_params?: Record<string, any>;
}

/**
 * 计划步骤接口
 */
export interface PlanStep {
  /** 步骤ID */
  id: string;
  /** 步骤名称 */
  name: string;
  /** 步骤描述 */
  description: string;
  /** 步骤类型 */
  type: 'tool' | 'command' | 'condition' | 'loop';
  /** 步骤参数 */
  params: Record<string, any>;
  /** 依赖步骤 */
  dependencies?: string[];
}

/**
 * 计划工具输出类型
 */
export interface PlanToolOutput {
  /** 操作结果 */
  success: boolean;
  /** 消息 */
  message: string;
  /** 计划数据 */
  plan?: PlanData;
  /** 计划列表 */
  plans?: PlanData[];
  /** 执行结果 */
  execution_result?: any;
}

/**
 * 计划数据接口
 */
export interface PlanData {
  /** 计划ID */
  id: string;
  /** 计划名称 */
  name: string;
  /** 计划描述 */
  description: string;
  /** 计划步骤 */
  steps: PlanStep[];
  /** 计划状态 */
  status: 'draft' | 'active' | 'completed' | 'cancelled';
  /** 创建时间 */
  created_at: string;
  /** 更新时间 */
  updated_at: string;
}

/**
 * 计划模式工具
 */
export class PlanTool extends BaseTool<
  PlanToolInput,
  PlanToolOutput
> {
  name = 'plan';
  description = 'Create, manage, and execute plans';

  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      description: 'Action to perform: create, list, get, update, delete, execute',
      required: true,
      enum: ['create', 'list', 'get', 'update', 'delete', 'execute'],
    },
    {
      name: 'plan_id',
      type: 'string',
      description: 'Plan ID for get, update, delete, or execute action',
      required: false,
    },
    {
      name: 'name',
      type: 'string',
      description: 'Plan name for create or update action',
      required: false,
    },
    {
      name: 'description',
      type: 'string',
      description: 'Plan description for create or update action',
      required: false,
    },
    {
      name: 'steps',
      type: 'array',
      description: 'Plan steps for create or update action',
      required: false,
    },
    {
      name: 'status',
      type: 'string',
      description: 'Plan status for update action',
      required: false,
      enum: ['draft', 'active', 'completed', 'cancelled'],
    },
    {
      name: 'execution_params',
      type: 'object',
      description: 'Execution parameters for execute action',
      required: false,
    },
  ];

  aliases = ['planning', 'schedule', 'project'];
  searchHint = 'Create, manage, and execute plans';
  maxResultSizeChars = 100000;

  /**
   * 模拟计划存储
   */
  private plans: Map<string, PlanData> = new Map();

  /**
   * 检查工具是否只读
   */
  isReadOnly(input?: Record<string, unknown>): boolean {
    const action = (input?.action as string) || '';
    return action === 'list' || action === 'get';
  }

  /**
   * 检查工具是否并发安全
   */
  isConcurrencySafe(): boolean {
    return false;
  }

  /**
   * 验证输入
   */
  validateInput(input: PlanToolInput): ValidationResult {
    const validActions = ['create', 'list', 'get', 'update', 'delete', 'execute'];

    if (!input.action || !validActions.includes(input.action)) {
      return {
        result: false,
        message: `Invalid action. Must be one of: ${validActions.join(', ')}`,
        errorCode: 1,
      };
    }

    if (['get', 'update', 'delete', 'execute'].includes(input.action) && !input.plan_id) {
      return {
        result: false,
        message: 'plan_id is required for get, update, delete, or execute action',
        errorCode: 2,
      };
    }

    if (['create', 'update'].includes(input.action) && !input.name) {
      return {
        result: false,
        message: 'name is required for create or update action',
        errorCode: 3,
      };
    }

    if (input.action === 'create' && !input.steps) {
      return {
        result: false,
        message: 'steps is required for create action',
        errorCode: 4,
      };
    }

    return { result: true };
  }

  /**
   * 获取用户可见的工具名称
   */
  userFacingName(input?: Partial<PlanToolInput>): string {
    const action = input?.action || '';
    switch (action) {
      case 'create':
        return 'Plan: Create';
      case 'list':
        return 'Plan: List';
      case 'get':
        return 'Plan: Get';
      case 'update':
        return 'Plan: Update';
      case 'delete':
        return 'Plan: Delete';
      case 'execute':
        return 'Plan: Execute';
      default:
        return this.name;
    }
  }

  /**
   * 获取工具使用摘要
   */
  getToolUseSummary(input?: Partial<PlanToolInput>): string | null {
    const action = input?.action || '';
    switch (action) {
      case 'create':
        return `Create plan: ${input?.name || ''}`;
      case 'list':
        return 'List all plans';
      case 'get':
        return `Get plan: ${input?.plan_id || ''}`;
      case 'update':
        return `Update plan: ${input?.plan_id || ''}`;
      case 'delete':
        return `Delete plan: ${input?.plan_id || ''}`;
      case 'execute':
        return `Execute plan: ${input?.plan_id || ''}`;
      default:
        return null;
    }
  }

  /**
   * 获取活动描述
   */
  getActivityDescription(input?: Partial<PlanToolInput>): string | null {
    const action = input?.action || '';
    switch (action) {
      case 'create':
        return `Creating plan: ${input?.name || ''}`;
      case 'list':
        return 'Listing all plans';
      case 'get':
        return `Getting plan: ${input?.plan_id || ''}`;
      case 'update':
        return `Updating plan: ${input?.plan_id || ''}`;
      case 'delete':
        return `Deleting plan: ${input?.plan_id || ''}`;
      case 'execute':
        return `Executing plan: ${input?.plan_id || ''}`;
      default:
        return null;
    }
  }

  /**
   * 获取工具用于自动分类器的输入
   */
  toAutoClassifierInput(input: PlanToolInput): unknown {
    return `${input.action} ${input.plan_id || input.name || ''}`;
  }

  /**
   * 执行工具
   */
  async execute(
    input: PlanToolInput,
    context: ToolUseContext,
    onProgress?: ToolCallProgress<any>
  ): Promise<ToolResult<PlanToolOutput>> {
    const validation = this.validateInput(input);
    if (!validation.result) {
      return createToolResult(
        {
          success: false,
          message: validation.message || 'Validation failed',
        },
        {
          success: false,
          error: validation.message,
        }
      );
    }

    try {
      let result: PlanToolOutput;

      switch (input.action) {
        case 'create': {
          const planId = `plan_${Date.now()}`;
          const plan: PlanData = {
            id: planId,
            name: input.name!,
            description: input.description || '',
            steps: input.steps!,
            status: 'draft',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          this.plans.set(planId, plan);
          result = {
            success: true,
            message: `Plan created successfully: ${planId}`,
            plan,
          };
          break;
        }

        case 'list': {
          const plans = Array.from(this.plans.values());
          result = {
            success: true,
            message: `Retrieved ${plans.length} plans`,
            plans,
          };
          break;
        }

        case 'get': {
          const plan = this.plans.get(input.plan_id!);
          if (!plan) {
            result = {
              success: false,
              message: `Plan not found: ${input.plan_id!}`,
            };
          } else {
            result = {
              success: true,
              message: `Retrieved plan: ${input.plan_id!}`,
              plan,
            };
          }
          break;
        }

        case 'update': {
          const plan = this.plans.get(input.plan_id!);
          if (!plan) {
            result = {
              success: false,
              message: `Plan not found: ${input.plan_id!}`,
            };
          } else {
            const updatedPlan: PlanData = {
              ...plan,
              name: input.name || plan.name,
              description: input.description || plan.description,
              steps: input.steps || plan.steps,
              status: input.status || plan.status,
              updated_at: new Date().toISOString(),
            };
            this.plans.set(input.plan_id!, updatedPlan);
            result = {
              success: true,
              message: `Plan updated successfully: ${input.plan_id!}`,
              plan: updatedPlan,
            };
          }
          break;
        }

        case 'delete': {
          if (!this.plans.has(input.plan_id!)) {
            result = {
              success: false,
              message: `Plan not found: ${input.plan_id!}`,
            };
          } else {
            this.plans.delete(input.plan_id!);
            result = {
              success: true,
              message: `Plan deleted successfully: ${input.plan_id!}`,
            };
          }
          break;
        }

        case 'execute': {
          const plan = this.plans.get(input.plan_id!);
          if (!plan) {
            result = {
              success: false,
              message: `Plan not found: ${input.plan_id!}`,
            };
          } else {
            // 模拟执行计划
            const executionResults = [];
            for (const step of plan.steps) {
              executionResults.push({
                step_id: step.id,
                step_name: step.name,
                status: 'completed',
                result: `Executed step: ${step.name}`,
                timestamp: new Date().toISOString(),
              });
            }
            
            // 更新计划状态
            const updatedPlan: PlanData = {
              ...plan,
              status: 'completed',
              updated_at: new Date().toISOString(),
            };
            this.plans.set(input.plan_id!, updatedPlan);
            
            result = {
              success: true,
              message: `Plan executed successfully: ${input.plan_id!}`,
              execution_result: {
                plan_id: input.plan_id!,
                steps: executionResults,
                completed_at: new Date().toISOString(),
              },
            };
          }
          break;
        }

        default:
          result = {
            success: false,
            message: `Unknown action: ${input.action}`,
          };
      }

      return createToolResult(result, {
        success: result.success,
        output: result.message,
      });
    } catch (error: any) {
      return createToolResult(
        {
          success: false,
          message: `Plan operation failed: ${error.message}`,
        },
        {
          success: false,
          error: `Plan operation failed: ${error.message}`,
        }
      );
    }
  }
}

export default PlanTool;