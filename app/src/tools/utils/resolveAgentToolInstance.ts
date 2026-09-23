/**
 * 解析「Agent 工具的真实实例」（R6 修复，2026-09-22）
 *
 * **为什么需要**：`getToolManager().getTool('Agent')` 返回的是
 * [`ToolLazyWrapper`](./ToolLazyWrapper.ts)（`implements Tool`，**非 extends**），
 * 因此三处入口原先的 `tool instanceof AgentTool` **恒为 false**：
 *   - `infrastructure/http/handlers/agent-control-handlers.ts`（`GET /v1/agents/control`、
 *     `POST /v1/agents/:id/stop|pause`）⇒ 恒 503；
 *   - `commands/tools/ai/agent.ts`、`commands/tools/ai/agents.ts` ⇒ CLI 停批次静默失效。
 * 后果：`AgentTool.stopAgent`（含批次级取消 R1）的修复代码**一行都不会被执行**。
 *
 * **为什么收敛成一处**：三份内联的 `instanceof` 判定是同一条 bug 的三个副本，
 * 任一处漏改都会重现；且"按能力判定"的策略应只有一个真源。
 *
 * **判据 = 鸭子类型（能力判定）而非继承判定**：`unwrap()` 解决"这一版包装"，
 * 能力判定解决"这一类包装" —— 以后再加包装层也不会重新断裂。
 */

import { getLogger } from '@modules/monitoring';
import { getToolManager } from '../ToolManager';
import type { AgentTool } from '../AgentTool/AgentTool';

const logger = getLogger('tools:resolveAgentTool');

/** 能力判定：控制面/命令层真正依赖的最小契约面 */
interface AgentToolCapable {
  stopAgent?: unknown;
  getActiveAgents?: unknown;
}

function isAgentToolLike(candidate: unknown): candidate is AgentTool {
  if (!candidate || typeof candidate !== 'object') return false;
  const c = candidate as AgentToolCapable;
  return (
    typeof c.stopAgent === 'function' && typeof c.getActiveAgents === 'function'
  );
}

/**
 * 取 AgentTool 真身；拿不到（未注册 / 未加载 / 仍是包装器）⇒ `null`（fail-closed）。
 *
 * @param resolve 解析入口（默认 `getToolManager().getToolInstance()`；
 *   测试可注入，避免依赖全局单例）
 */
export function resolveAgentToolInstance(
  resolve: (name: string) => unknown = (name: string) =>
    getToolManager().getToolInstance(name)
): AgentTool | null {
  try {
    const tool = resolve('Agent');
    if (isAgentToolLike(tool)) return tool;
    if (tool) {
      // 升为 error：一旦出现，控制面会全量 503，属"静默失效"高发点
      logger.error('Agent 工具实例缺少控制面契约方法（无法停止/查询代理）', {
        toolName: (tool as { name?: string }).name ?? null,
      });
    }
    return null;
  } catch (err) {
    // @ignore-catch — 工具管理器未就绪时视为不可用（调用方按 503 处理）
    logger.error('解析 AgentTool 实例失败', { error: String(err) });
    return null;
  }
}
