/**
 * Trace 统计 API Handler
 *
 * 暴露 AITracePlugin 的实时 token 消耗统计数据给前端。
 * Trace 是必选基础设施，记录真实 API token 消耗，
 * 前端监控点（用量中心、仪表板、Footer）通过此 API 获取真实数据。
 *
 * GET /v1/trace/stats  — Trace 统计快照
 */
import type http from 'http';
import { handleError } from '@modules/error';
import { currentOwnerKey } from '@openliri/kernel/identity/requestScope.js';

export async function handleTraceStats(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { getAITracePlugin } =
      await import('../../../trace-recording/index.js');
    const plugin = getAITracePlugin();
    if (!plugin) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Trace 引擎未启动' },
          data: null,
        })
      );
      return;
    }

    const engine = plugin.getEngine();
    // 多租户 P3：只回**当前身份**的统计桶（本地身份 ⇒ undefined ⇒ `''` 桶，
    // 桌面端与改造前一致；远端身份看不到别人的 token 消耗）
    const stats = engine ? engine.getStatsSnapshot(currentOwnerKey()) : null;
    const pluginStatus = plugin.getStatus();
    const writerStats = engine ? engine.getWriterStats() : null;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        data: {
          status: pluginStatus,
          stats,
          writer: writerStats,
        },
      })
    );
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:trace',
      action: 'trace_stats',
    });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: { message: '获取 Trace 统计失败' },
        data: null,
      })
    );
  }
}
