/**
 * 记忆查询结果（memory 域自有类型）
 *
 * 2026-10-01 D-166（`R00-001` 倒挂收口）：本类型原定义在 **service 层** 的
 * `services/prompt/MemoryPromptProvider.ts`，而唯一消费者是 `memory`(infra) 的
 * `MemorySummarizer` ⇒ 构成 `memory`(infra) -> `services`(service) 倒挂（原 D-158 清单 M4）。
 *
 * 按"**类型归属其域**"移交持有方：类型随 memory 域下沉至此；`services/prompt` 改为**反向引用**
 * （service → infra 合法 ✓），且该方向**是该文件既有做法**（其 `SessionContext` 早已这样引用）。
 * 全仓仅 2 处引用（定义 + `MemorySummarizer`）⇒ 移交零涟漪。
 */

export interface MemoryQueryResult {
  summaries: string[];
  totalCount: number;
}
