/**
 * SelfWakeTool — `sleep_for` / `sleep_until` 的 BaseTool 包装（台账 N-37 修复）
 *
 * 背景：`tasks/selfwake/SelfWakeTools.ts` 原先只导出 **JSON schema + 执行器函数**，
 * 全仓零引用（既无 BaseTool 包装、也无注册点）⇒ 四个自唤醒工具对模型完全不可达，
 * `SelfWakeService` 的调度 API 亦无生产调用者；N-26 修好的「fire → 会话续跑」因此
 * 一直没有触发场景。本文件把其中**真正可触发**的两个包装为 BaseTool 并注册进
 * `ToolManagerUtils.getBuiltinToolLoaders()`。
 *
 * 为何只注册两个（`sleep_for` / `sleep_until`）：
 *   `WakeStore.getDueWakes()` 仅返回**带 `triggerAt` 且已到期**的条目。
 *   - `sleepFor` / `sleepUntil` 会写 `triggerAt`（短时走 setTimeout、长时走 CronScheduler
 *     tick）⇒ 到点 `fire()` → 恢复通路，**真实可用**；
 *   - `wakeOnJob` / `wakeOnEvent` 创建的条目**没有 `triggerAt`**，且全仓不存在"任务完成 /
 *     事件到达"的唤醒生产者 ⇒ 被选出并 fire 的概率为 **0**。
 *   注册它们等于给模型一个永不兑现的等待（违反 CS04「禁止假能力」）⇒ 暂不注册；
 *   待补齐 COMPLETION / EVENT 的触发源后再纳入（见台账 N-37）。
 */
import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';
import {
  SLEEP_FOR_TOOL,
  SLEEP_UNTIL_TOOL,
  createSelfWakeToolExecutors,
} from '@modules/tasks';
import { getCg3SelfWakeService } from '@modules/tasks';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:SelfWakeTool');

/** 本文件支持的两个工具名（均为 TIMER 类，见文件头说明） */
type SelfWakeTimerToolName = 'sleep_for' | 'sleep_until';

/** SelfWakeTools 中工具定义的形态（JSON schema 风格） */
interface SelfWakeToolSchema {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

/** 把 SelfWakeTools 的 JSON schema 映射为 BaseTool 的 `ToolParam[]`（不复制定义） */
function toToolParams(def: SelfWakeToolSchema): ToolParam[] {
  const required = def.parameters.required ?? [];
  return Object.entries(def.parameters.properties).map(([name, p]) => ({
    name,
    type: p.type,
    description: p.description,
    required: required.includes(name),
  }));
}

class SelfWakeTimerTool extends BaseTool {
  name: string;
  description: string;
  params: ToolParam[];

  private readonly action: SelfWakeTimerToolName;

  constructor(def: SelfWakeToolSchema, action: SelfWakeTimerToolName) {
    super();
    this.name = def.name;
    this.description = def.description;
    this.params = toToolParams(def);
    this.action = action;
  }

  async execute(input: unknown, context?: ToolUseContext): Promise<ToolResult> {
    const sessionId = context?.sessionId;
    if (!sessionId) {
      // 无会话上下文 ⇒ 唤醒无从归属（到点后的续跑需要 sessionId），显式失败
      return {
        success: false,
        error: `${this.name} requires a session context (context.sessionId is missing)`,
      };
    }

    // 惰性取服务：CG3 与工具装配的启动顺序不固定，故在**执行时**解析
    const selfWake = getCg3SelfWakeService();
    if (!selfWake) {
      return {
        success: false,
        error:
          'SelfWake 服务未初始化（CG3 未启动），无法登记唤醒。请检查启动模式是否包含 CG3 闭环。',
      };
    }

    // taskId 仅作信息性字段（唤醒续跑按 sessionId 归属；ToolUseContext 无 taskId）
    const taskId = sessionId;
    const args = (input ?? {}) as Record<string, unknown>;
    const executors = createSelfWakeToolExecutors(selfWake);

    try {
      const result =
        this.action === 'sleep_for'
          ? await executors.sleep_for({
              seconds: Number(args.seconds),
              sessionId,
              taskId,
            })
          : await executors.sleep_until({
              when: String(args.when),
              sessionId,
              taskId,
            });

      logger.info('selfwake: 唤醒已登记', {
        tool: this.name,
        sessionId,
        wakeId: (result as { wakeId?: string }).wakeId,
        triggerAt: (result as { triggerAt?: number }).triggerAt,
      });
      return { success: true, data: result, output: JSON.stringify(result) };
    } catch (err) {
      return { success: false, error: `登记唤醒失败: ${String(err)}` };
    }
  }
}

/** sleep_for：挂起 N 秒（≤5min setTimeout 精确，>5min CronScheduler tick） */
export function createSleepForTool(): BaseTool {
  return new SelfWakeTimerTool(
    SLEEP_FOR_TOOL as unknown as SelfWakeToolSchema,
    'sleep_for'
  );
}

/** sleep_until：挂起到指定 ISO 时间 */
export function createSleepUntilTool(): BaseTool {
  return new SelfWakeTimerTool(
    SLEEP_UNTIL_TOOL as unknown as SelfWakeToolSchema,
    'sleep_until'
  );
}
