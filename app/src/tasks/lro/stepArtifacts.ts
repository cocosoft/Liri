// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * stepArtifacts —— 步骤产物的写后读回与缺陷捕获（LRO 拆分批 U-22/S1）
 *
 * **来源**：从 `LongRunningTaskOrchestrator.ts` 外移 `collectPendingReadBacks`（纯函数）/
 * `_readBackWrittenArtifacts` / `_recordEscalation`。
 *
 * **职责（单一：把"步骤产出了什么"变成可验证的证据与可重规划的缺陷输入）**：
 *   ① 选出仍需机械补做读回的产物路径（去重 + 上限）；
 *   ② 对"本步写入但未读回"的产物补做只读 `file_read`，结果并入步骤证据；
 *   ③ escalate 时把 `reviewResult.issues` 落为缺陷清单（增量 replan 输入）并持久化。
 *
 * **行为等价**：日志文案/级别、失败留痕与 `undefined` 返回语义**逐字未变**。
 */

import { handleError } from '@modules/error';
import { getLogger } from '@modules/monitoring';

import { getToolRegistry } from '../../tools/index.js';
import type { ToolUseContext } from '../../tools/types/Tool.js';
import type { PlanStep } from '../TaskOrchestrator';

const logger = getLogger('tasks:longRunning');

/** 增量 replan 的缺陷条目（与宿主的 `EscalationRecord` 结构一致） */
export interface StepEscalation {
  stepId: string;
  stepDescription: string;
  defects: string[];
}

export interface StepArtifactsDeps {
  taskId: string;
  createToolContext: () => ToolUseContext;
  persistCheckpoint: () => Promise<void>;
  /** 与宿主共享的缺陷清单（就地 push ⇒ 宿主 `_lastEscalations` 同步可见） */
  lastEscalations: StepEscalation[];
}

/**
 * 选出仍需"机械补做读回"的产物路径（纯函数，可单测）：已写入、**本步未被读回**、
 * 去重后取前 `max` 个（上限防止一次补读过多文件）。
 */
export function collectPendingReadBacks(
  written: Iterable<string>,
  alreadyRead: Iterable<string>,
  max = 3
): string[] {
  const read = new Set(alreadyRead);
  const pending: string[] = [];
  for (const p of new Set(written)) {
    if (read.has(p) || pending.includes(p)) continue;
    pending.push(p);
    if (pending.length >= max) break;
  }
  return pending;
}

/**
 * 写后读回（**机械保障**，2026-10-08）：对"本步成功写入、但本步内未被读回"的产物，
 * 各补做一次**只读**的 `file_read`，把结果原样返回为可并入步骤证据的文本。
 *
 * 为什么需要：验收标准普遍形如"`file_read` 读取 X 返回内容为 v"，而提示词层的"写后读回"
 * 只是**引导**（真机实测执行器常漏做）⇒ 审查（正确地）判"验收标准未被实际验证"⇒ 步骤 failed。
 * 本方法把该动作**机械化**，保证证据一定存在。
 *
 * 边界（刻意保守）：仅为**本步自身写入**的路径补做；上限 3 个；只读、不改动任何文件；
 * 读失败（不存在/被拦）**如实记录**（失败本身也是证据）；输出**明确标注为编排器补做**，
 * 不冒充模型行为。
 */
export async function readBackWrittenArtifacts(
  deps: StepArtifactsDeps,
  written: ReadonlySet<string>,
  alreadyRead: ReadonlySet<string>
): Promise<string> {
  const pending = collectPendingReadBacks(written, alreadyRead);
  if (pending.length === 0) return '';
  const tool = getToolRegistry().getTool('file_read');
  if (!tool) {
    logger.warn('[orchestrator] 写后读回保障跳过：file_read 未注册', {
      taskId: deps.taskId,
    });
    return '';
  }
  const toolContext = deps.createToolContext();
  const lines: string[] = ['', '【编排器补做读回校验（写后机械保障）】'];
  for (const filePath of pending) {
    try {
      const res = (await tool.execute({ file_path: filePath }, toolContext)) as
        | { success?: boolean; data?: unknown; error?: string }
        | null
        | undefined;
      const failed = !res || res.error !== undefined || res.success === false;
      if (failed) {
        lines.push(`- file_read(${filePath}) → ❌ ${res?.error ?? '读取失败'}`);
        logger.warn('[orchestrator] 写后读回保障：读回失败', {
          taskId: deps.taskId,
          filePath,
          error: res?.error,
        });
        continue;
      }
      const text =
        typeof res.data === 'string'
          ? res.data
          : res.data === undefined || res.data === null
            ? ''
            : JSON.stringify(res.data);
      lines.push(`- file_read(${filePath}) → ${text.slice(0, 400)}`);
      logger.info('[orchestrator] 写后读回保障：已补做读回', {
        taskId: deps.taskId,
        filePath,
        contentLength: text.length,
      });
    } catch (e) {
      lines.push(`- file_read(${filePath}) → ❌ ${String(e)}`);
      await handleError(e, {
        module: 'tasks:longRunning',
        action: 'readBackWrittenArtifacts',
        context: { taskId: deps.taskId, filePath },
      });
    }
  }
  return lines.join('\n');
}

/**
 * D5（M6，2026-08-13）：捕获 escalate 缺陷 → 增量 replan 输入（基线 + 缺陷清单）
 * 缺陷取自步骤 reviewResult.issues（severity + description），落 checkpoint 支持跨重启恢复。
 */
export async function recordEscalation(
  deps: StepArtifactsDeps,
  step: PlanStep
): Promise<void> {
  const defects = (step.reviewResult?.issues ?? [])
    .map((issue) => {
      const i = issue as { severity?: string; description?: string };
      const desc = i.description ?? '';
      return desc ? `[${i.severity ?? 'unknown'}] ${desc}` : '';
    })
    .filter(Boolean);
  deps.lastEscalations.push({
    stepId: step.id,
    stepDescription: step.description,
    defects,
  });
  await deps.persistCheckpoint();
  logger.info('[orchestrator] escalate 已捕获缺陷（增量 replan 输入）', {
    taskId: deps.taskId,
    stepId: step.id,
    defectCount: defects.length,
    stepDesc: step.description.slice(0, 60),
  });
}
