// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * lro/planStop.ts — B8（2026-11-09）：计划级「硬停止」收尾
 *
 * 复用点：连续无进展硬停止（U-04）/ 日预算耗尽停止（设计稿 §5-3）。
 * 只做三件确定的事（置 failed → 落盘 → 统一错误上报），判定与 failureReason 留在调用方。
 */
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@openliri/infra/error';
import type { Plan } from '../TaskOrchestrator';
import { PLAN_STATUS_FAILED } from '../TaskOrchestrator';

export function stopPlanWithError(input: {
  plan: Plan;
  savePlan: (plan: Plan) => void;
  taskId: string;
  planId: string | null;
  code: string;
  message: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  /** 附加事实（不猜：调用方给什么记什么） */
  details?: Record<string, unknown>;
  action: string;
}): void {
  input.plan.status = PLAN_STATUS_FAILED;
  input.plan.completedAt = new Date().toISOString();
  input.savePlan(input.plan);
  void handleError(
    new AppError(input.message, input.category, input.severity, input.code, {
      taskId: input.taskId,
      planId: input.planId,
      ...input.details,
    }),
    { module: 'tasks:longRunning', action: input.action }
  );
}
