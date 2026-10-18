/**
 * 工具可见性契约（P1/P2/P3 工具治理，2026-10-16）
 *
 * **双端单一事实源**（对齐本文件所在目录的管理规则 §1「作为 API 契约的单一事实来源」）：
 * 后端派生可见性（`app/src/tools/toolVisibilityReport.ts`）与前端设置页
 * （`client/src/components/settings/ToolsPanel.tsx`）必须使用**同一份**枚举，
 * 否则任一侧新增取值 ⇒ 另一侧静默漏渲染（与 `status-types` 同源的漂移风险）。
 *
 * 消费方：
 * - 后端：`GET /v1/tools/visibility` 的响应体（`ToolVisibilityReport` 结构兼容本类型）；
 * - 前端：`toolService.visibility()` 的返回类型 + 原因徽标/风险二次确认的**穷尽映射**。
 */

/**
 * 工具可见性的**结构化原因**（穷尽枚举；由后端判定，前端只负责渲染文案）。
 *
 * ⚠️ 新增取值 ⇒ 前端 `TOOL_VISIBILITY_REASON_KEYS`（`Record<…, string>`）会 **typecheck 失败**
 * ⇒ 强制补 zh/en 文案（这是本枚举放在 shared 的目的）。
 */
export type SharedToolVisibilityReason =
  /** 恒保留（`MANDATORY_TOOLS`：`todo_write` / `agent`）⇒ 可见且不可 off */
  | "mandatory"
  /** 有意归档（`ARCHIVED_MISC_TOOLS`）⇒ 默认不可见（用户显式 `on` 可放开） */
  | "archived"
  /** 未登记类别（落 `misc`）⇒ 任何任务下都被裁 */
  | "unregistered-category"
  /** 类别已登记，但当前任务的类别白名单不含它 */
  | "not-in-task-whitelist"
  /** ∉ 生效工具面（未接线 / 工厂内 flag 门控关闭）⇒ 覆写也无效 */
  | "conditional"
  /** 用户显式 `off` */
  | "user-off"
  /** 用户显式 `on`，覆盖了默认判定 ⇒ 可见 */
  | "user-on-bypass";

/**
 * 工具**风险分级**（与后端 D5 能力契约同域；后端 `ToolRiskLevel` 即本类型的别名 ⇒ 无第二份枚举）。
 *
 * - `low`：无副作用（读/查/取）；
 * - `medium`：仅改本地状态（文件/DB/内存）；
 * - `high`：对外部系统/其他参与者可见影响，或执行任意代码/命令。
 */
export type SharedToolRiskLevel = "low" | "medium" | "high";

/**
 * 单个工具的可见性报表条目（`GET /v1/tools/visibility` 的元素）。
 *
 * ⚠️ `category` 为**字符串**：类别枚举属后端内部事实源（`tools/toolCategories.ts`），
 * 前端只做展示，不参与判定 ⇒ 不做第二份联合（避免 R02 双轨）。
 */
export interface SharedToolVisibilityEntry {
  name: string;
  /** 工具类别（如 `file` / `shell` / `image` / `misc`…；未登记类别为 `misc`） */
  category: string;
  /** 是否在**生效工具面**内（`conditional` ⇒ 本构建里未被实例化） */
  registration: "registered" | "conditional";
  /** 仅按任务类别白名单判定的可见性（**不含**用户覆写） */
  visibleByDefault: boolean;
  /** 叠加用户覆写后的最终判定 */
  effective: "visible" | "hidden";
  /** 结构化原因（`effective === "hidden"` ⇒ 必非空） */
  reasons: SharedToolVisibilityReason[];
  /** 风险级别（前端 `high` ⇒ 红色 + 二次确认） */
  risk: SharedToolRiskLevel;
  /**
   * 工具描述（C-3b T3 展示半边，2026-10-18）：与模型侧**同一份描述源**
   * （`ToolRegistry.getToolSchemas()` → `resolveToolParam`），仅供设置页展示；
   * `conditional`（未进注册表）⇒ 缺省。
   */
  description?: string;
}
