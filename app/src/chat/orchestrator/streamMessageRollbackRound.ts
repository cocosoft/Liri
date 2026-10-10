/**
 * streamMessageFlow 的「**回滚轮次启动**」——仅写操作工具轮次才做文件基线扫描（P2-1k）。
 *
 * 动因（S3 工具调用 · 副作用基线）：该段此前**内联**在 `runStreamMessage` 的工具轮分支内
 * （约 26 行）：先按**工具只读性**判定本轮是否存在写操作，再决定是否 `startRollbackRound`
 * （递归扫描 `scanPaths`，项目根 68000+ 文件逐个 `stat`）——以及失败时的告警/上报兜底。
 * 判据（`isReadOnly` 缺省即视为**写**）与"为何只读要跳过"的事故背景全沉在编排函数里
 * ⇒ 无法独立测试。
 *
 * 拆分手法（与 P2-1d-3 / P2-1i 一致）：**判据与动作一并收口为单一职责单元**，
 * 编排函数内只保留**一次调用**。
 *
 * 事故背景（2026-09-02 修复，随迁保留）：
 * `recordRoundStart` 递归扫描 `scanPaths`（项目根 68000+ 文件逐个 stat），`await` 阻塞工具循环
 * 最长 10s+（实测 18s，`session_mtjk9u70s2g5tqssgk`），期间前端无 chunk ⇒ SSE 断流
 * （`BodyStreamBuffer was aborted`）。只读工具（`file_read`/`grep`/`glob` 等）不产生文件副作用，
 * 无需基线扫描。
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import type { ChatOrchestratorHost } from './ChatOrchestrator.js';

// 复用与原编排函数**同名**的 logger ⇒ 日志 `module` 字段与拆分前逐字一致（`chat:streamFlow`）。
const logger = getLogger('chat:streamFlow');

export interface RollbackRoundDeps {
  host: ChatOrchestratorHost;
  sessionId: string;
  /** 本轮工具调用（仅读 `name`） */
  toolCalls: ReadonlyArray<{ name?: string }>;
  /** 回滚轮次号（`toolResultRegistry.nextRound()` 已分配） */
  roundId: number;
}

/**
 * 本轮存在**写操作工具** ⇒ 启动文件回滚基线扫描；否则跳过（记 `debug`）。
 *
 * 只读性判据（与拆分前**逐字等价**）：工具**未实现** `isReadOnly`（含工具不存在 /
 * 注册表缺失）⇒ 视为**写**（fail-safe：宁可多扫，不可漏扫）；`isReadOnly()` 为 `true`
 * ⇒ 只读，跳过。
 *
 * 启动失败**不阻断**工具循环（CS03）：`warn` 留痕 + `handleError` 上报（`.catch` 兜底）。
 */
export async function maybeStartRollbackRound(
  deps: RollbackRoundDeps
): Promise<void> {
  const { host, sessionId, toolCalls, roundId } = deps;
  const hasWritableTool = toolCalls.some((tc) => {
    const tool = host.getToolRegistry()?.getTool(tc.name ?? '');
    const roChecker = tool as { isReadOnly?: () => boolean } | undefined;
    return typeof roChecker?.isReadOnly !== 'function'
      ? true
      : !roChecker.isReadOnly();
  });
  if (hasWritableTool) {
    await host.startRollbackRound(sessionId, roundId).catch((err) => {
      logger.warn('回滚轮次启动失败', { error: String(err) });
      handleError(err, {
        module: 'chat:ChatManager',
        action: 'rollback:startRound',
      }).catch(() => {});
    });
  } else {
    logger.debug('回滚：本轮全只读工具，跳过文件基线扫描', {
      sessionId,
      toolNames: toolCalls.map((tc) => tc.name),
    });
  }
}
