/**
 * 调度器生命周期窄契约（A4 残留项 T1-1；spec `orchestration-lifecycle-contract.md`）。
 *
 * 动机：编排家族中 4 个**定时调度器**已天然同形于 `start()` / `stop()` / `isRunning()`
 * （`dream/DreamScheduler` · `tasks/cron/CronScheduler` · `tasks/alwayson/DiscoveryScheduler` ·
 * `knowledge/KnowledgeCompileScheduler`），但此前**无显式契约**——新调度器漏实现其一不会被任何检查拦住。
 *
 * 边界（**明确不做什么**，见 spec §1.3）：
 * - 本接口**只覆盖定时/周期调度器**（时间驱动）。
 * - **LLM 回合循环**（`ReActToolLoop` / `TAORLoop`）不实现本接口 —— 那类应继承 `query/ReActLoop`
 *   （其契约为 think→act→observe，含熔断/探索预算等回合机制，与时间驱动无关）。
 * - **一次性编排**（如 `ParallelAgentScheduler` / `TaskOrchestrator`）也不实现 —— 它们是「单入口 +
 *   可选 abort」，无 start/stop 语义；强行统一会引入空实现（违反 CS03）。
 * - 显式排除 `tools/AgentTool/CuratorScheduler`（D2=b 裁定）：其生命周期由**外部轮询**驱动，
 *   自身无 timer、无 start/stop，属如实标注的例外。
 *
 * 签名取舍：`start()` 返回 `void | Promise<void>` —— 现有实现两种都有
 * （`DiscoveryScheduler` / `KnowledgeCompileScheduler` 同步；`DreamScheduler` / `CronScheduler` 异步）。
 * 调用方须容忍两者（`await` 作用于 `void` 是安全的）。
 */
export interface SchedulerLifecycle {
  /** 启动调度；**须幂等**（已启动时重复调用应为 no-op） */
  start(): void | Promise<void>;
  /** 停止调度并释放定时器/订阅；**须幂等** */
  stop(): void;
  /** 是否处于已启动状态 */
  isRunning(): boolean;
}
