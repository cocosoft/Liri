/**
 * planRestore — TaskCard 刷新/重连后状态恢复（基于后端 Plan 持久化）
 *
 * #12 修复：前端 planTaskStore 为纯内存（SSE 事件驱动），刷新后清空，
 * TaskCard 回退到消息块静态快照（首任务 in_progress、其余 pending）→ 永久"执行中"。
 * 后端 taskOrchestrator 已把 Plan（含完整 steps 状态）持久化到
 * ~/.pyapp/data/plans/plan_<id>.json 并提供 GET /v1/plans/:id，
 * 此处扫描消息中的 task_decomposition blocks 提取 planId，从后端恢复真实状态。
 */
import type { Message, TaskCardData, TaskCardTask } from "@/types";
import type { Plan } from "@/services/planService";
import { planService } from "@/services/planService";
import { usePlanTaskStore } from "@/stores/planTaskStore";
import { createLogger } from "@/utils/logger";
import { handleClientError } from "@/utils/handleError";

const logger = createLogger("utils:planRestore");

/** 后端 Plan.status → 前端 TaskCardData.status */
function mapPlanStatus(status: Plan["status"]): TaskCardData["status"] {
  // completed/failed/aborted 均代表任务已结束（无论成败），running 为执行中
  if (status === "completed" || status === "failed" || status === "aborted") {
    return "done";
  }
  if (status === "running") return "executing";
  return "planning";
}

/** 后端 PlanStep.status → 前端 TaskCardTask.status */
function mapStepStatus(status: string): TaskCardTask["status"] {
  switch (status) {
    case "running":
      return "in_progress";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      // S3 修复：cancelled 独立终态（用户中止），前端显示"已取消"橙色，不再归为 failed
      return "cancelled";
    default:
      return "pending";
  }
}

/** 后端 Plan → 前端 TaskCardData（刷新后从后端恢复真实状态） */
export function mapPlanToTaskCard(plan: Plan): TaskCardData {
  return {
    title: plan.description || "任务分解",
    status: mapPlanStatus(plan.status),
    planId: plan.id,
    tasks: plan.steps.map((step) => ({
      id: step.id,
      name: step.description,
      status: mapStepStatus(step.status),
      dependsOn: step.dependsOn || [],
      result: step.result,
    })),
  };
}

/**
 * 扫描消息中的 task_decomposition blocks，从后端恢复 planTaskStore。
 * fire-and-forget（调用方不 await）：失败静默，回退静态快照，不阻断会话加载。
 */
export async function restorePlanTasks(messages: Message[]): Promise<void> {
  const startedAt = Date.now();
  const planIds = new Set<string>();
  for (const msg of messages) {
    for (const block of msg.blocks ?? []) {
      if (block.type === "task_decomposition" && block.taskCard?.planId) {
        planIds.add(block.taskCard.planId);
      }
    }
  }
  if (planIds.size === 0) return;

  logger.info("[planRestore] 扫描完成，待恢复计划数", {
    messageCount: messages.length,
    planIdCount: planIds.size,
    planIds: [...planIds],
    scanElapsedMs: Date.now() - startedAt,
  });

  let restored = 0;
  let skipped = 0;
  let failed = 0;
  for (const planId of planIds) {
    const planStart = Date.now();
    try {
      const plan = await planService.get(planId);
      const elapsedMs = Date.now() - planStart;
      if (!plan) {
        // 404（plan 已清理）→ 保持静态快照
        skipped++;
        logger.warn("[planRestore] 后端无此计划，跳过恢复", {
          planId,
          elapsedMs,
        });
        continue;
      }
      const taskCard = mapPlanToTaskCard(plan);
      usePlanTaskStore.getState().upsert(planId, taskCard);
      restored++;
      logger.info("[planRestore] 计划状态恢复成功", {
        planId,
        planStatus: plan.status,
        stepCount: plan.steps.length,
        taskCount: taskCard.tasks.length,
        elapsedMs,
      });
    } catch (e) {
      failed++;
      logger.warn("[planRestore] 计划查询失败", {
        planId,
        elapsedMs: Date.now() - planStart,
        error: e instanceof Error ? e.message : String(e),
      });
      handleClientError(
        e,
        { module: "utils:planRestore", action: "restorePlanTasks" },
        "warn",
      );
    }
  }

  logger.info("[planRestore] 恢复完成", {
    total: planIds.size,
    restored,
    skipped,
    failed,
    totalElapsedMs: Date.now() - startedAt,
  });
}
