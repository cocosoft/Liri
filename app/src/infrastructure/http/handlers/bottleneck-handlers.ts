/**
 * 瓶颈感知 API 处理器
 *
 * POST /v1/workspaces/:id/intelligence/bottleneck
 */
import type http from "node:http";
import { Logger, LogLevel } from "@modules/monitoring";
import type { HandlerCtx } from "./handler-utils";
import { bottleneckAnalyzer } from "@modules/workspace/BottleneckAnalyzer";

const logger = new Logger({ module: "BottleneckHandlers", level: LogLevel.INFO });

/**
 * POST /v1/workspaces/:id/intelligence/bottleneck
 * 分析关键路径瓶颈
 */
export async function handleBottleneckAnalysis(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const data = JSON.parse(body);
    const { steps } = data;

    if (!steps || !Array.isArray(steps) || steps.length === 0) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "缺少必要参数：steps（关键路径步骤列表）" }));
      return;
    }

    const summary = bottleneckAnalyzer.analyze(steps);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(summary));
  } catch (err) {
    logger.error("瓶颈分析失败", { error: String(err) });
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "瓶颈分析失败" }));
    }
  }
}