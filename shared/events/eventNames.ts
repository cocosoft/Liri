/**
 * 会话事件名 —— 双端单一事实源（2026-09-30，台账 D-57）
 *
 * 背景：此前 app / client **各持一份手写事件名联合**（`app/src/session/types/events.ts` 与
 * `client/src/types/events.ts`），双方文件头都写明"双端必须保持一致"，但**无任何机制保证**，
 * 曾**实证漂移**（台账 D-1：client 落后 5 个类型 —— `goal/*` ×4 + `agent/recovery`，2026-09-28）。
 *
 * 本文件是事件名的**唯一事实源**：两端的事件名联合由此派生（`(typeof LIRI_EVENT_NAMES)[number]`）。
 * 载荷形状**仍各端自持**（后端载荷引用后端领域类型，不宜下沉到 shared）。
 *
 * 顺序约定：保持后端原文顺序（含原分组注释），便于与历史 diff 对齐。
 * 新增事件名只改本文件一处；某端漏派生或载荷缺失将由 `typecheck` 与
 * `app/tests/chat/eventTypeParity.test.ts` 门禁同时抓出。
 *
 * 详见 `.trae/specs/shared-event-name-single-source.md`。
 */

/** 会话事件名清单（双端唯一事实源） */
export const LIRI_EVENT_NAMES = [
  // ─── 对话核心 ───
  'turn/start',
  'turn/end',
  // U4（2026-10-06，`.trae/specs/online-quality-evaluation.md`）：每轮在线质量分（离线/梦境消费）
  'turn/quality',
  'user/message',
  'assistant/thinking',
  'assistant/text',
  // F-2（2026-09-02）：text 流式 chunk 聚合批事件（服务端 64KB/2s 合并落盘）
  'assistant/text-batch',
  'assistant/tool_call',
  'tool/result',
  'tool/canceled',
  // ─── 富块（M4-1-a 扩展，覆盖 question/todo/progress/doc_workflow/status） ───
  'assistant/status',
  'assistant/progress',
  'assistant/question',
  'assistant/todo',
  'assistant/doc_workflow',
  // P2-A（2026-09-17）：PDCA 自动启动快照富块（聊天正文内嵌卡片）
  'assistant/pdca_workflow',
  // P0-1 接入点第二刀 ②b（2026-09-24）：工作流 run 记录（run 级 2 + 成员级 2）
  'assistant/workflow_run_start',
  'assistant/workflow_step_start',
  'assistant/workflow_step_end',
  'assistant/workflow_run_end',
  'assistant/truncation',
  // ─── 交付物/diff（E-1，2026-08-23：deliverable/diff 事件化，T-H.2） ───
  'assistant/deliverable',
  'assistant/diff',
  // ─── 上下文管理 ───
  'context/compaction',
  'context/summary',
  // 2026-10-08（架构治理 P1 · §1.6 红线审计修复）：**steering 注入事件化** ——
  // `[STEERING]` 正文被 push 为 `role:'user'` 消息进入模型对话上下文 ⇒ 属「模型可见输入」，
  // 但修复前**只落 logger、无任何会话事件** ⇒ 会话结束后无法从事件日志重建"模型当时看到了
  // 哪段 steering"（与 `goal/injected` 的 X2 缺口同族）。三处同批同步，故类型联合随之扩张。
  // log-only：它记录的就是注入正文本身，**不回避**地为可重建性服务，不再回灌消息 surface。
  'context/steering',
  // TR-12-B（2026-09-22）：模型输入快照（工具清单 + 系统提示词分段，引用式去重）
  'context/model-input',
  // D-1（2026-09-02）：会话远期摘要事件化落盘（摘要也是轨迹，见 §8 设计）
  'session/summary',
  // ─── 系统与日志 ───
  'system/error',
  'system/warning',
  'system/info',
  'metric/timing',
  // ─── 通道 ───
  'channel/connect',
  'channel/disconnect',
  'channel/message',
  // P2-2（2026-09-23）：请求边界事件 —— turn × request 双边界
  // （见 `.trae/specs/request-boundary-events.md` v0.2；requestId = 本事件的 seq）
  'request/start',
  // B2-2（2026-09-23）：目标（Goal）生命周期事件族 —— 见 `.trae/specs/goal-entity.md` §4.1。
  // `goal/injected` 是 §1.6「模型可见 ⇔ 已落盘」红线（缺口 X2）的正面修复：
  // 目标指令（预算收尾 / 停滞停止 / idle 续接）进了模型输入，就必须有事件可重建。
  'goal/created',
  'goal/updated',
  'goal/status_changed',
  'goal/injected',
  // T-②02（2026-10-03）：目标**偏差**事件 —— PDCA 终态按 turn 预算消耗速率
  // （`goal_metrics.total_turns / max_turns`）越过既有阈值（`UNIFIED_THRESHOLDS`）时的
  // 可观测出口。与 `goal/status_changed` **互不混用**：偏差**不**触发状态迁移
  // （那是收口策略职责），仅作指标偏差的可重建记录（`.trae/specs/goal-metrics-closure.md`）。
  'goal/deviation',
  // P1-1②（2026-09-28）：**输出校验回喂**事件 —— 终稿未通过服务端结构预检（当前为 mermaid）
  // 时，注入模型的修正指令同样属"模型可见输入"，必须可重建（§1.6 红线，与 `goal/injected`
  // 同一理由：`text` 记注入原文，通道前缀由通道自身拼装）。
  'validation/injected',
  // P26-2 **P4**（2026-10-07）：**输出护栏改写审计** —— 护栏命中后调用方以安全文本**替换**
  // 已流出正文，历史与模型上下文由此**永久**变为打码文本；本事件为该次改写留痕
  // （默认只记**元数据**：动作 / 命中的护栏名 / 原文长度 / **原文 SHA-256**；仅当
  // `OUTPUT_GUARD_KEEP_ORIGINAL=true` 时才附**原文**）。log-only：**不进消息 surface**
  // （`originalText` 若入消息就等于把刚打码的内容又写回上下文）。
  'validation/output_guard_applied',
  // B4-1（2026-09-23）：子代理恢复通路审计事件（认领 / 恢复 / 放弃各一条）——
  // log-only（不入消息 surface，与 `session/title` 同口径）：它描述的是**恢复通路**，
  // 不是模型看到的内容。修复前这三个可判定节点**只有 logger 文本**，
  // 崩溃后"这次恢复到底发生了什么"无法从持久层按序重建。
  'agent/recovery',
  // ─── 生命周期 ───
  'session/start',
  'session/end',
  // T-⑥12（2026-10-03）：自唤醒（sleep_for / wake_on_job / wake_on_event）触发的**续跑审计** ——
  // 唤醒→续跑是系统自动发起（非用户触发），修复前四个可判定节点只有 logger 文本，
  // 崩溃后无法从持久层按序重建（与 `agent/recovery` B4-1 同一立项理由）。log-only。
  'session/wake',
  // T-②06（2026-10-03）：经验**自动演化**落盘审计 —— 由失败/评审样本演化出的提示覆盖层或
  // 技能侧车被写入时落一条（log-only，与 `agent/recovery` / `session/wake` 同口径：
  // 它描述"产物何时被自动改写"，不改状态机、不入消息 surface）。
  // 覆盖层正文本身的模型可见性由 `context/model-input` 的 sections 快照承担（§1.6 红线）。
  'evolution/applied',
  // ─── 标题（D5，2026-08-24：标题事件化，log-only 不入消息 surface） ───
  'session/title',
  // 2026-10-07（`.trae/specs/pattern-catalog-reachability-and-persistence.md`）：编排模式
  // **决策轨迹** —— 研究分流点命中研究意图时落一条（选了哪个模式 / 装配与可达状态 /
  // 功能门控是否开启 / 是否实际生效）。立项理由 = **可排查**（此前仅 logger ⇒ 会话结束后
  // 无法按序重建"为什么这次没走研究模式"）。log-only，不入消息 surface。
  // ⚠️ 如实边界：pattern 选择**不直接进入模型请求** ⇒ 本事件**非** `§1.6` 红线所迫。
  'pattern/decision',
  // ─── Code Mode（CM-5，2026-08-25：code_run 执行事件） ───
  'assistant/code_run',
  // ─── Execution 生命周期（PR5-S3，2026-10-09） ───
  // 立项理由 = **可重建**：Execution 生命周期（PR1 起）此前仅内存 + `execution_events` 表，
  // 会话事件流内没有它的轨迹 ⇒ 会话结束后无法按序重建"这次运行的 execution 状态如何演进"。
  // log-only（不入消息 surface，与 `agent/recovery` / `session/wake` 同口径）；
  // ⚠️ 如实边界：execution 状态**不直接进入模型请求** ⇒ **非** `§1.6` 红线所迫。
  'execution/status_changed',
  'execution/recovery',
] as const;

/** 会话事件名（联合类型）——两端事件名联合均由此派生 */
export type LiriEventName = (typeof LIRI_EVENT_NAMES)[number];
