#!/usr/bin/env bun
/**
 * H-2（2026-10-18）—— **编排链路真实流量窗口取证**（非 CI 门禁）。
 *
 * 背景（清单 §9 H-2）：编排链路 P50/P95 长期「无持久化样本」；查询面
 * `GET /v1/monitor/orchestration` 已就绪，但 `OrchestrationMetrics` 是**进程内**指标
 * （事件日志只落 Agent 事件，不落 `orch:*`）⇒ 只能在一个**真实运行的进程**里采。
 *
 * 本脚本把该验收项变成**可复跑的一次性证据**：
 *   ① 真实解析 DB 中的 chat 模型并注入 AI 服务默认模型（不硬编码模型名）；
 *   ② 用**真实 CouncilOrchestrator** 跑 N 轮小规模辩论（2 位专家 × 1 轮 + 共识判定）；
 *   ③ 该路径会真实发布 `orch:council:start` / `orch:council:end`（以及 round / speaking），
 *      `OrchestrationMetrics` 按 `sessionId` 配对后得到 P50/P95；
 *   ④ 打印样本量 n、时间窗、逐事件计数与 P50/P95，并断言配对样本非零。
 *
 * 门控：仅 `LIRI_E2E=1` 时真实调用（默认 dry-run，不产生费用）。
 * 参数：
 *   - `LIRI_H2_MODEL`：可选；缺省取 `modelRouter.resolve('chat')`（DB 事实源）。
 *   - `H2_ROUNDS`：轮数，缺省 3，允许 1–10（仅 council 模式）。
 *   - `H2_MODE`：`council`（缺省）| `parallel` —— parallel 走 **AgentTool 的 `tasks[]`
 *     并行批次**（**单任务**，控制成本；真实模型，禁止调工具的提示词）。
 *     ⚠️ 成本/时长提示：worker 仍可能探索仓库 ⇒ 由 `H2_TIMEOUT_MS`（缺省 180s）
 *     到点 `abortController.abort()` 取消，并按「未取得代表性样本」失败退出。
 *
 * 用法（app 目录下）：
 *   `bun run evidence:orchestration-window`                 # dry-run
 *   `$env:LIRI_E2E='1'; bun run evidence:orchestration-window`
 *   `$env:LIRI_E2E='1'; $env:H2_MODE='parallel'; bun run evidence:orchestration-window`
 */
import {
  aiService,
  modelRouter,
  syncDBProvidersToRegistry,
} from '../src/ai/index';
import { modelPricingService } from '../src/ai/models/ModelPricingService';
import { getOrchestrationMetrics } from '../src/core/events/OrchestrationMetrics';
import {
  orchestrationEventLogPath,
  startOrchestrationEventLog,
  stopOrchestrationEventLog,
} from '../src/monitoring/orchestrationEventLog';
import {
  AgentTool,
  setAgentToolManager,
} from '../src/tools/AgentTool/AgentTool';
import { ToolFactory } from '../src/tools/ToolFactory';
import {
  getAllBuiltinToolLoaders,
  loadTools,
} from '../src/tools/utils/ToolManagerUtils';
import {
  getEmptyToolUseContext,
  type ToolUseContext,
} from '../src/tools/types/ToolUseContext';
import { getCouncilOrchestrator } from '../src/workspace/CouncilOrchestrator';
import type { CouncilAgentRole } from '../src/workspace/CouncilTypes';

/** 两位专家即可构成一次最小真实辩论（控制 token 成本） */
const EVIDENCE_AGENTS: CouncilAgentRole[] = [
  {
    agentId: 'architect',
    name: '架构师',
    expertise: ['系统架构', '模块设计'],
    weight: 1,
  },
  {
    agentId: 'performance',
    name: '性能专家',
    expertise: ['性能优化', '资源占用'],
    weight: 1,
  },
];

const TOPIC = 'H-2 证据：判断「进程内指标 + 只读查询面」是否足够支撑编排可观测';
const CONTEXT =
  '这是一次受控的真实编排取证：只要求给出一个简短结论，不需要展开方案。';

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function resolveRounds(): number {
  const raw = Number(process.env.H2_ROUNDS ?? '3');
  if (!Number.isFinite(raw)) return 3;
  return Math.min(10, Math.max(1, Math.trunc(raw)));
}

async function main(): Promise<void> {
  const live = process.env.LIRI_E2E === '1';
  const mode = (process.env.H2_MODE || 'council').trim().toLowerCase();
  const rounds = resolveRounds();

  await modelPricingService.initialize();
  await modelRouter.initFromDb();
  await syncDBProvidersToRegistry();

  const explicit = (process.env.LIRI_H2_MODEL || '').trim();
  const model =
    explicit || modelRouter.resolve('chat') || modelRouter.resolve('default');
  console.log('=== H-2 编排链路真实流量窗口 ===');
  console.log(
    `模式：${live ? '真实调用（LIRI_E2E=1）' : 'dry-run（未设 LIRI_E2E=1）'} · ${mode}`
  );
  console.log(`模型：${model || '(未解析到 chat/default 模型)'}`);
  if (mode === 'council') {
    console.log(`轮数：${rounds}（2 位专家 × 1 轮 + 共识判定）`);
  } else {
    console.log('批次：1 个并行子任务（AgentTool.tasks[]，单任务控成本）');
  }

  if (mode !== 'council' && mode !== 'parallel') {
    console.error(`未知 H2_MODE=${mode}（可选：council | parallel）`);
    process.exit(1);
  }

  if (!model) {
    console.error(
      '未能从模型路由解析 chat/default 模型；请设置 LIRI_H2_MODEL。'
    );
    process.exit(1);
  }

  if (!live) {
    console.log(
      mode === 'parallel'
        ? '\n将执行：更新 AI 服务默认模型 → AgentTool.execute({ tasks: [1] }) → 读取 getStats()。'
        : '\n将执行：更新 AI 服务默认模型 → 跑 N 轮 CouncilOrchestrator.startCouncil → 读取 getStats()。'
    );
    return;
  }

  aiService.updateConfig({ defaultModel: model });

  // H-2 持久化：受控窗口同时验证「事件落盘 → 离线复算」链路
  startOrchestrationEventLog({ enabled: true });
  if (mode === 'parallel') {
    await runParallelEvidence();
  } else {
    await runCouncilEvidence(rounds);
  }
}

/**
 * parallel 模式：真实 `AgentTool.tasks[]` 批次（**1 个任务**，控制成本/时长）。
 *
 * 判据（代表性样本）：`orch:parallel:start` 配对 n ≥ 1、p50 > 0，且
 * `metadata.parallelSuccessCount === 1`（worker 真跑完，而不是 fail-closed / 取消）。
 *
 * 安全阀：`H2_TIMEOUT_MS`（缺省 180000）到点即 `abortController.abort()`
 * ⇒ 批次取消、按「未取得代表性样本」失败退出（不静默当作成功）。
 */
async function runParallelEvidence(): Promise<void> {
  const metrics = getOrchestrationMetrics();
  // 裸脚本没有模块引导 ⇒ `getInheritableToolPool()` 为空 ⇒ worker 会 fail-closed
  // （实测：「worker 工具池为空」，批次瞬间结束，只能测到失败路径）。
  // 这里注入**真实内置工具池**，让 worker 走正常执行路径。
  const tools = loadTools(new ToolFactory(), getAllBuiltinToolLoaders());
  setAgentToolManager(() => tools);
  const tool = new AgentTool();
  const windowStart = Date.now();

  // 安全阀：模型若无视「不要调工具」去探索仓库，到点即取消（避免跑满 50 轮）
  const timeoutMs = Number(process.env.H2_TIMEOUT_MS ?? '180000');
  const context = getEmptyToolUseContext() as ToolUseContext;
  const abortController = new AbortController();
  context.abortController = abortController;
  context.sessionId = 'h2-evidence-parallel';
  let timedOut = false;
  const timer = setTimeout(
    () => {
      timedOut = true;
      abortController.abort();
    },
    Number.isFinite(timeoutMs) ? timeoutMs : 180_000
  );

  let result;
  try {
    result = await tool.execute(
      {
        description: 'H-2 证据：并行批次（单任务）',
        // 明确禁止调工具：否则 worker 会拿真实工具池去探索仓库（实测跑向 50 轮上限），
        // 既拉长窗口也把"批次延迟"污染成"探索延迟"。这里只要一次模型调用。
        prompt:
          '这是一次受控的真实并行编排取证。**不要调用任何工具**，直接给出结论。',
        tasks: [
          {
            id: 't1',
            description: '进程内指标是否够用',
            prompt:
              '不要调用工具，用一句话回答：进程内 P50/P95 是否足以支撑日常编排排查？',
          },
        ],
      },
      context
    );
  } finally {
    clearTimeout(timer);
  }

  await stopOrchestrationEventLog();

  const windowEnd = Date.now();
  const snapshot = metrics.getStats();
  const start = snapshot.events.find(
    (e) => e.eventType === 'orch:parallel:start'
  );
  const meta = result.metadata as Record<string, unknown> | undefined;
  const successCount = Number(meta?.['parallelSuccessCount'] ?? 0);

  console.log(
    `\n批次结果：status=${result.status}${timedOut ? '（已超时取消）' : ''}`
  );
  console.log('\n--- 进程内事件统计（OrchestrationMetrics.getStats） ---');
  for (const e of snapshot.events) {
    console.log(
      `  ${e.eventType} · count=${e.count} · p50=${round1(e.p50)}ms · p95=${round1(e.p95)}ms · avg=${round1(e.avg)}ms`
    );
  }

  console.log('\n--- 证据 ---');
  console.log(
    `① 时间窗：${new Date(windowStart).toISOString()} .. ${new Date(windowEnd).toISOString()}（${round1((windowEnd - windowStart) / 1000)}s）`
  );
  console.log(
    `② Parallel 链路：n=${start?.count ?? 0} · p50=${round1(start?.p50 ?? 0)}ms · p95=${round1(start?.p95 ?? 0)}ms`
  );
  console.log(
    `③ 事件总量=${snapshot.totalEvents} · 分类=${JSON.stringify(snapshot.byCategory)}`
  );
  console.log(
    `④ 持久化：${orchestrationEventLogPath()}（离线复算：bun run analyze:orchestration-events --since ${new Date(windowStart).toISOString()}）`
  );

  if (timedOut) {
    console.error(
      `未取得代表性样本：${timeoutMs}ms 超时已取消（worker 可能仍在探索仓库；可调 H2_TIMEOUT_MS）`
    );
    process.exit(1);
  }
  if (successCount < 1) {
    console.error(
      `未取得代表性样本：worker 未成功完成（parallelSuccessCount=${successCount}，status=${result.status}）`
    );
    process.exit(1);
  }
  if ((start?.count ?? 0) < 1 || (start?.p50 ?? 0) <= 0) {
    console.error(
      `配对样本不足：期望 ≥1 条 orch:parallel:start 且 p50>0，实际 n=${start?.count ?? 0} p50=${start?.p50 ?? 0}`
    );
    process.exit(1);
  }
}

/** council 模式：N 轮真实辩论（原有取证路径） */
async function runCouncilEvidence(rounds: number): Promise<void> {
  const metrics = getOrchestrationMetrics();
  const orchestrator = getCouncilOrchestrator();
  const windowStart = Date.now();

  for (let i = 1; i <= rounds; i++) {
    const started = performance.now();
    const session = await orchestrator.startCouncil(
      'h2-evidence',
      TOPIC,
      `${CONTEXT}（第 ${i}/${rounds} 次）`,
      EVIDENCE_AGENTS,
      { maxRounds: 1, ownerSessionId: `h2-evidence-${windowStart}-${i}` }
    );
    const ms = performance.now() - started;
    console.log(
      `[${i}] ${round1(ms)}ms · session=${session.sessionId} · 发言=${session.statements.length} · 结论=${session.result}`
    );
  }

  await stopOrchestrationEventLog();

  const windowEnd = Date.now();
  const snapshot = metrics.getStats();
  const council = snapshot.events.find(
    (e) => e.eventType === 'orch:council:start'
  );
  const speaking = snapshot.events.find(
    (e) => e.eventType === 'orch:council:agent:speaking'
  );

  console.log('\n--- 进程内事件统计（OrchestrationMetrics.getStats） ---');
  for (const e of snapshot.events) {
    console.log(
      `  ${e.eventType} · count=${e.count} · p50=${round1(e.p50)}ms · p95=${round1(e.p95)}ms · avg=${round1(e.avg)}ms`
    );
  }

  console.log('\n--- 证据 ---');
  console.log(
    `① 时间窗：${new Date(windowStart).toISOString()} .. ${new Date(windowEnd).toISOString()}（${round1((windowEnd - windowStart) / 1000)}s）`
  );
  console.log(
    `② Council 链路：n=${council?.count ?? 0} · p50=${round1(council?.p50 ?? 0)}ms · p95=${round1(council?.p95 ?? 0)}ms`
  );
  console.log(
    `③ 事件总量=${snapshot.totalEvents} · 分类=${JSON.stringify(snapshot.byCategory)} · 角色=${JSON.stringify(snapshot.byRole)} · speaking=${speaking?.count ?? 0}`
  );
  console.log(
    `④ 持久化：${orchestrationEventLogPath()}（离线复算：bun run analyze:orchestration-events --since ${new Date(windowStart).toISOString()}）`
  );

  const paired = council?.count ?? 0;
  if (paired < rounds || (council?.p50 ?? 0) <= 0) {
    console.error(
      `配对样本不足：期望 ${rounds} 条 orch:council:start 且 p50>0，实际 n=${paired} p50=${council?.p50 ?? 0}`
    );
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('取证运行失败：', err);
    process.exit(1);
  });
