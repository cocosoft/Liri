// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * hostWiring — 宿主级「全局 sink / 退出钩子 / 内存水位」装配（issue #8 · Cut C，2026-10-29）
 *
 * 迁出来源：`ChatManager` 构造函数内的全局注入段（原 `1097–1193`）。这些注册全部是
 * **进程级单例的唯一写入出口**注入（`chat` 层持有会话事件日志，其它模块不得反向 import）。
 *
 * 行为不变红线（issue #8）：不新增配置项、不改默认值、不改事件名。
 * 注册**顺序**与迁移前逐条一致（`registerDefaultOutputGuards` 仍由宿主在构造器最前调用）。
 *
 * 依赖一律**显式参数注入**（沿用 `chat/manager/` 既有做法，不建单例）。
 */

import { getMemoryPressureMonitor } from '@modules/monitoring';
import { registerSessionSummaryMemoryType } from '@modules/memory';
import { compactionOrchestrator } from '@modules/context';
import {
  setEvolutionAuditSink,
  setGoalEventSink,
  setSelfWakeAuditSink,
} from '@modules/tasks';
import { setWorkflowRunEventSink } from '@modules/workflow';
import { setExecutionEventSink } from '@modules/execution';
import {
  finishRequest,
  startRequest,
  type RequestEventAppender,
} from '../services/requestBoundary';
import { setYieldRecoveryAuditSink } from '../yield';

export interface HostWiringPorts {
  /** 会话事件日志的唯一写入出口（`chat` 层持有；多方 sink 共用同一实现） */
  appendStreamEvent: RequestEventAppender;
  /** 优雅退出：flush 全会话 text-batch 缓冲 */
  flushAllPendingEventBuffers: () => Promise<number>;
  /** 优雅退出：flush 各会话 TAORLoop 未落盘检查点 */
  flushAllCheckpoints: () => Promise<void>;
  /** 优雅退出：标记"本次为优雅关闭"（崩溃恢复据此跳过） */
  markCleanShutdown: () => Promise<unknown>;
  /** 退出钩子注册表（`ChatManager` 模块级；经参数传入以避免循环 import） */
  registerEventBufferFlusher: (fn: () => Promise<number>) => void;
  registerCleanShutdownHandler: (fn: () => Promise<void>) => void;
}

/**
 * 安装宿主级装配（幂等性由各被调方保证：sink 单槽覆盖、注册表去重语义与迁移前一致）。
 *
 * 调用时机：`tokenBudget` / `unifiedTracker` 创建并 `setTracker` **之后**（与迁移前顺序相同）。
 */
export function installHostWiring(ports: HostWiringPorts): void {
  // P2-2（2026-09-23）：compaction 的摘要请求**也是一次请求** ⇒ 同样落请求边界事件
  // （与普通请求共用同一编号序列，带 reason='compaction'）。本模块持有会话事件日志，
  // 故在此实现上报并注入单例编排器（避免 `context/` → `chat/` 的反向 import）。
  // 用量/延迟**能拿才写**；未拿到 usage ⇒ 只写真实墙钟耗时（不估不算）。
  compactionOrchestrator.setRequestReporter({
    start: (sessionId, info) =>
      startRequest(ports.appendStreamEvent, sessionId, {
        model: info.model,
        reason: 'compaction',
      }),
    finish: async (sessionId, requestId, info) => {
      await finishRequest(ports.appendStreamEvent, sessionId, requestId, {
        usage: info.usage as Record<string, unknown> | undefined,
        durationMs: info.durationMs,
      });
    },
  });
  // B2-2（2026-09-23）：目标生命周期事件落盘 —— 本模块持有会话事件日志，故在此注入
  // 唯一写入实现（与上方 requestReporter 同一手法；避免 `tasks/` → `chat/` 的反向依赖）。
  // 目标状态迁移与"注入模型的目标指令"（`goal/injected`）都经此出口落 `events.jsonl`。
  setGoalEventSink((sid, event) => ports.appendStreamEvent(sid, event));
  // B4-1（2026-09-23）：恢复通路审计落盘 —— 同上手法：本模块持有会话事件日志，
  // 故在此注入 `YieldRecoveryAudit` 的唯一写入出口（认领/恢复/放弃三条记录）。
  // 通道为**既有**会话事件日志（`events.jsonl`），不新建审计通道。
  setYieldRecoveryAuditSink((sid, event) =>
    ports.appendStreamEvent(sid, event)
  );
  // T-⑥12（2026-10-03）：自唤醒续跑审计落盘 —— 同上手法：本模块持有会话事件日志，
  // 故在此注入 `SelfWakeAudit` 的唯一写入出口（`session/wake`：resumed / resume_failed /
  // handler_absent 三节点）。通道同样为既有 `events.jsonl`，不新建审计通道、不改 UI。
  setSelfWakeAuditSink((sid, event) => ports.appendStreamEvent(sid, event));
  // T-②06（2026-10-03）：经验自动演化落盘审计 —— 同上手法：本模块持有会话事件日志，
  // 故在此注入 `EvolutionAudit` 的唯一写入出口（`evolution/applied`：提示覆盖层/技能侧车
  // 被自动改写时各一条）。通道为既有 `events.jsonl`，不新建审计通道、不改 UI。
  setEvolutionAuditSink((sid, event) => ports.appendStreamEvent(sid, event));
  // P1-19 ①（2026-10-05）：工作流成员级 run/step 事件实时落盘 —— 同上手法的唯一写入出口。
  // 使 `office:workflow` / `office:doc-pipeline` 在 run 执行期即逐条落 `assistant/workflow_*`
  // 事件（不再等工具结束后批末投影）；批末投影据 `metadata.workflowRun.liveEmitted` 去重。
  setWorkflowRunEventSink((sid, event) => ports.appendStreamEvent(sid, event));
  // PR5-S3（2026-10-09，`.trae/specs/durable-execution.md` §3.6）：Execution 生命周期事件落盘
  // —— 同上手法的唯一写入出口（`execution/status_changed` / `execution/recovery`）。
  // `execution` 模块不持有会话事件日志 ⇒ 经注入避免反向依赖；未注入 ⇒ 如实不落。
  setExecutionEventSink((sid, event) => ports.appendStreamEvent(sid, event));
  // D 阶段（v5 P0-⑥）：session_summary 自定义类型注册——构造期即执行（早于任何
  // memory scanner/memdir 扫描与压缩触发；registerMemoryType 幂等，重复调用安全）
  registerSessionSummaryMemoryType();
  // 优雅退出（2026-09-02 排查"会话中断"补充）：注册本实例全会话 text-batch
  // 缓冲 flush——进程收到 SIGTERM/SIGINT（watch 重启/Ctrl+C/系统关闭）时先落盘
  // 缓冲正文再退出，避免 torn-tail / open-turn（证据：mtjkl/mtjdmjpo torn + 105 次启动）。
  // 注册幂等（模块级数组，重复构造仅多一条 no-op 闭包）。
  ports.registerEventBufferFlusher(() => ports.flushAllPendingEventBuffers());
  // A6（2026-09-04）：退出前 flush 各会话 TAORLoop 未落盘 checkpoint（库不碰全局信号，
  // 宿主钩子链统一调用——main 信号链 → flushAllEventBuffers → 本闭包）
  ports.registerEventBufferFlusher(async () => {
    await ports.flushAllCheckpoints();
    return 0;
  });
  // M4（2026-09-17）：退出前为可中断会话写 cleanShutdown 标记——下次启动崩溃恢复跳过
  ports.registerCleanShutdownHandler(async () => {
    await ports.markCleanShutdown();
  });
  // 内存水位订阅（2026-09-02）：L0+ 触发时先落盘全部会话缓冲（脏页写回，
  // OS kswapd 式"压力前先写回"）；订阅在构造期幂等注册一次
  getMemoryPressureMonitor().subscribe((level) => {
    if (level >= 1) {
      void ports.flushAllPendingEventBuffers().catch(() => {});
    }
  });
}
