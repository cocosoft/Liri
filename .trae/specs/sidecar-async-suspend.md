# 侧车异步挂起（T1-2② / TG-2+TG-6）—— A 片设计稿与分片

> 版本: **v1.0** ｜ 创建: 2026-10-13 ｜ 状态: **A 片已落地**（契约 + 探测）；**B/C 待裁定后实施**
> 原文: `dev_docs/20261012/工具治理方案-20261012.md` 阶段 **1.2（TG-2+TG-6 合并正名）**（`:149`）
> 前置: **已解除** —— 原文 `:155` 记「② 阻塞于 `long-task-suspend-resume.md`（债二，未实现）⇒ 待其落地后再接 `ISnapshotCapable`（避免建无消费者空抽象，CS03）」；债二**已落地**（`BUDGET-SUSPEND-RESUME`，含 `SUSPENDED` 投影通路）。

---

## §1 原文要求（逐字）

> ① 取消信号 100% 下传（G15）；② 长耗时侧车工具**不得同步阻塞**——提交后须能向内核投影 `SUSPENDED`（冻结思考树/释放连接），完成后通知解冻续跑
> 涉及 `services/mcp/McpToolWrapper.ts`、`mcp/MCPTool.ts`、`tools/toolContract/Tool.ts`（可选 `ISnapshotCapable`）、`query/TAORLoop.ts`
> 验收：取消后远端终止 + **「提交→挂起→完成→续跑」可复现测试**

**① 已满足**（S2-2/G15：`McpToolWrapper`/`MCPTool` 均传 `options.signal`，`tests/tools/toolCancellation.test.ts`）⇒ 本稿只做 ②。

## §2 分片（可独立提交）

| 片 | 内容 | 状态 |
|---|---|---|
| **A** | **契约 + 探测**：`ISnapshotCapable`（可选实现）+ `isSnapshotCapable()`（鸭子类型 + 字面量收窄）；**不改编排类树**、不接挂起点 | ✅ **已落地（2026-10-13）** |
| **B** | 侧车**作业化**：提交返句柄 + 完成通知；**复用唯一 IPC 基座** `utils/sidecarIpc.ts`（D10 GR02：**禁第三套 IPC**） | ⏳ 待裁定（§4 Q1） |
| **C** | **提交→挂起→完成→续跑** 端到端：侧车完成回调 → 解冻续跑；可复现测试（= 原文验收） | ⏳ 依赖 B |

## §3 A 片（已落地）

- **契约**：`utils/toolContract/Tool.ts`
  - `SnapshotHandle = Readonly<Record<string, unknown>>` —— **不透明**（中心层只搬运、不解释）；
  - `ISnapshotCapable { readonly snapshotCapable: true; freezeForSuspend(); resumeFromSnapshot(handle) }`
    —— **可选实现**（**不并入 `Tool` 基接口**：绝大多数工具是同步短任务，强制实现即造无意义空实现，CS03）；
    `snapshotCapable` 用**字面量 `true`** ⇒ typecheck 期即可判别"实现了但未声明"。
- **探测**：`isSnapshotCapable(candidate: unknown): candidate is ISnapshotCapable`
  - **三要件同时**成立才 `true`；非对象 / `null` / 标记非字面量 `true` / 缺任一方法 ⇒ `false`（**不臆造**、不抛异常）；
  - **纯函数**、不 `import` 任何具体工具类、**不改编排类树**。
- **零行为**：无任何工具实现该接口 ⇒ 契约与探测**均不改变现有执行路径**（逐字等价现状）。
- **测试**：`app/tests/tools/snapshotCapable.test.ts` **5 例**（三要件齐备且**探测无副作用** / 只挂标记不实现 ⇒ false / 标记非字面量 ⇒ false / 普通工具 ⇒ false / 非对象与原始值 ⇒ false 不抛）。

## §4 待裁定（B 片前置，**不臆造**）

| # | 问题 | 建议 |
|---|---|---|
| **Q1** | 侧车**作业协议**：复用 `sidecarIpc.ts` 现有**请求-响应**是否够，还是需新增**两类**消息（作业提交 / 完成通知）？ | **新增两类消息**（同名协议栈内扩展，**不建第二套 IPC**）：`job.submit`（返 `jobId`）+ `job.completed`（宿主向内核回调） |
| **Q2** | **挂起点**：在 `BudgetSuspendCoordinator` 现有的 `suspend()` 之外新增 `kind='tool-job'`，还是复用 `kind='guard'`？ | **新增 `kind='tool-job'`**（与 relief/guard **正交**，避免放行语义串线） |
| **Q3** | **冻结思考树的具体语义**（原文「冻结思考树/释放连接」）：仅"不推进轮次"即可，还是须释放侧车连接？ | **不推进轮次 + 保留连接**（释放连接留待实测证据；无证据不臆造策略） |
| **Q4** | **首批实现者**：哪些工具先实现 `ISnapshotCapable`？ | **暂无**（须先有 B 片作业协议；避免"契约先行但永无实现者"）—— 若你要先有实现者，最小候选 = 媒体侧车（`vision_worker`，已常驻且可能长耗时） |

> ⚠️ **未裁定前不写 B/C 片代码**（HARD-GATE）。
