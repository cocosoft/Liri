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
| **B** | 侧车**作业化**：提交返句柄 + 完成通知；**复用唯一 IPC 基座** `utils/sidecarIpc.ts`（D10 GR02：**禁第三套 IPC**） | ✅ **B₁ 协议层已落地（2026-10-13）**；B₂ 主管接线待实施 |
| **C** | **提交→挂起→完成→续跑** 端到端：侧车完成回调 → 解冻续跑；可复现测试（= 原文验收） | ⏳ 依赖 B₂ |

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

## §4 B 片前置问题（原待裁定 ⇒ **2026-10-13 已裁定**）

| # | 问题 | 建议 |
|---|---|---|
| **Q1** | 侧车**作业协议**：复用 `sidecarIpc.ts` 现有**请求-响应**是否够，还是需新增**两类**消息（作业提交 / 完成通知）？ | **新增两类消息**（同名协议栈内扩展，**不建第二套 IPC**）：`job.submit`（返 `jobId`）+ `job.completed`（宿主向内核回调） |
| **Q2** | **挂起点**：在 `BudgetSuspendCoordinator` 现有的 `suspend()` 之外新增 `kind='tool-job'`，还是复用 `kind='guard'`？ | **新增 `kind='tool-job'`**（与 relief/guard **正交**，避免放行语义串线） |
| **Q3** | **冻结思考树的具体语义**（原文「冻结思考树/释放连接」）：仅"不推进轮次"即可，还是须释放侧车连接？ | **不推进轮次 + 保留连接**（释放连接留待实测证据；无证据不臆造策略） |
| **Q4** | **首批实现者**：哪些工具先实现 `ISnapshotCapable`？ | **暂无**（须先有 B 片作业协议；避免"契约先行但永无实现者"）—— 若你要先有实现者，最小候选 = 媒体侧车（`vision_worker`，已常驻且可能长耗时） |

**裁定结果（2026-10-13，用户裁决「按 (a) 推进」= 采纳上表建议，Q1 细化为「零新帧型」）**：

| # | 裁定 |
|---|---|
| **Q1** | **零新帧型（关键选型）**：提交 = `request`（`method='job.submit'`）→ 对端 `response({jobId})`；完成 = 侧车 → 宿主 **`notify`**（`event='job.completed'`）⇒ 复用 `utils/sidecarIpc.ts` 的**三类既有帧**，**不新增帧类型/传输、不建第三套 IPC**（D10 GR02） |
| **Q2** | **新增 `kind='tool-job'`**（与 `budget` / `guard` **正交**，避免放行语义串线）—— **B₂ 实施** |
| **Q3** | **不推进轮次 + 保留连接**（"释放连接"无实测证据 ⇒ **不臆造**策略） |
| **Q4** | **暂无实现者**（须先有 B₂ 接线）；若要求先有 ⇒ 最小候选 = 媒体侧车 `vision_worker` |

## §5 B₁ 片（**已落地**，2026-10-13）

- **文件**：`utils/sidecarIpc.ts`（在**唯一 IPC 基座**内扩展，**未新建第二套**）
- **协议常量/类型**：`SIDECAR_JOB_SUBMIT_METHOD='job.submit'` · `SIDECAR_JOB_COMPLETED_EVENT='job.completed'` · `SidecarJobSubmitParams` · `SidecarJobCompletedPayload`（`ok` **必填** —— 成功/失败**均须**通知，避免宿主永久挂起）
- **纯函数**：`buildJobSubmit()`（缺省**不塞** `payload: undefined`）· `buildJobCompleted()` · `parseJobCompleted()`
  —— 非 `notify` / 事件名不符 / `data` 非对象或数组 / 缺 `jobId`（含**空串**）/ **`ok` 非布尔** ⇒ `null`；
  **不臆造**：不可判定成败的通知一律丢弃，交**超时兜底**，而非猜成功。
- **测试**：`app/tests/utils/sidecarJobProtocol.test.ts` **5 例**（提交构造 / 成功往返 / 失败往返 + 无 `error` 分支 / **经既有分帧 `encodeFrame→decodeFrame` 往返仍可解析（证"零新帧型"成立）** / 11 种非法输入 ⇒ `null` 且不抛）
- **零行为**：协议层当前无调用方 ⇒ 不改变任何现有执行路径。

## §6 待实施

| 片 | 内容 |
|---|---|
| **B₂** | 主管/客户端接线：`notify` → 作业完成处理器；`submitJob()` 客户端 API；~~`kind='tool-job'` 挂起点~~（**改随 C 片** —— 需真实长耗时作业才触达） | ✅ **已落地（2026-10-13）** |
| **C** | 端到端「提交→挂起→完成→续跑」+ **可复现测试**（fixture worker，参照既有 `fixtures/fakeLspServer.js` 手法）= 原文验收 | ✅ **C₁ 已落地（2026-10-13）**：**宿主侧作业链路**「**提交即返 → 完成兑现**」以**子进程 oracle** 取得**真实跨进程端到端证据**（真实主管 + 真实侧车在**真实子进程**中断言；含成功 / 失败 / 超时兜底 / 崩溃结算）；**先红后绿**、回归 **11 pass / 0 fail / 0 skip**。**未做** = **C₂**（`kind='tool-job'` **挂起点** + worker 侧作业模式）⇒「**挂起 → 续跑**」段未覆盖。**绕行理由与代价**见 §8（运行器异常未解释，但**非产品接线**）|

## §8 C₁ 片（2026-10-13，**已落地**；运行器异常已绕行并单独登记）

- **已建**：作业型侧车夹具 `app/tests/tools/fixtures/fakeJobSidecar.js`（真实子进程、同步写 fd 1、支持 `slow`/`fail`/`never`）+ 跨进程测试 `app/tests/tools/sidecarJobE2E.test.ts`。
- **其余不变量**（3 例**直接在进程内**跑、仍绿）：**超时兜底** reject · **侧车退出**同口结算 · **并发 2 作业**独立兑现。
- **运行器异常（原阻断 2 例；**现由子进程 oracle 真跑覆盖**）**：**单作业**用例若在 **bun test** 进程内直接调主管，会稳定走超时兜底（≈ `jobTimeoutMs`）。**已排除（逐项证据）**：① 夹具未写出（同步落盘为证）；② 夹具侧 stdio 冲刷（改 `fs.writeSync` 无效）；③ 静态导入 / ④ 文件内位置 / ⑤ 实例生命周期共享；⑥ **`readline` 本身**（**两路证伪**：(a) 单独直读同一夹具时 `raw 'data'` 与 `readline` **都收到三帧**；(b) 在主管 `start()` 内加**原始 stdout 帧计数**后实测失败运行中 `notify` **迟到**——`readline.line n:2` 与含 `notify` 的 `stdout.data chunks:3` 相差 **3.02s**，即**作业超时 `stop()` 杀进程触发 EOF** 才交付 ⇒ 据此**把 `readline` 换成手写分帧**，**2 例仍 fail** ⇒ 排除）；⑦ **spawn 的 `env: {...process.env}` 覆盖**（去掉后现象不变）；⑧ **`child.on('exit')` 监听**（单变量实验挂 / 不挂**两者均正常**，`notifyAtMs` 183 / 184）。**未排除**：走**主管 `ToolSidecarSupervisor`** 时该异步帧**未及时投递**（原始计数显示**直到杀进程 EOF 才到达**）——主管 `start()` 其余结构（读取时序 / `stderr` 未读 / 测试运行器 × 子进程交互）尚未穷尽；**「脱离 `bun test` 的纯脚本」未试**。**结论两次更正（如实留痕）**：原推断「平台 `readline` 投递缺陷」→ 曾被一次「独立文件即通过」的观察撤回 → 该观察**不可复现**（新独立文件 2/2 失败）⇒ **最终定性：根因未定位**（不宣称平台缺陷、也不宣称已定位测试层原因）。**临时取证改动（TEMP-PROBE / 手写分帧 / 去 `env`）已 `git checkout` 全量回退**，回归 **9 pass / 2 skip / 0 fail**（**该轮状态；现已由 ⑩ 转为 11 pass / 0 fail / 0 skip**）。
- **⑨ 建议 3（2026-10-13，**脱离 `bun test` 的纯脚本**，决定性隔离）**：同一主管代码 + 同一夹具，改由 `bun tmpC1Probe.ts`（纯脚本，非测试运行器）驱动 ⇒ **3/3 全部正常**（启动 34–56ms、**兑现耗时 31/32/32ms**）；同脚本内**裸 spawn 直读**亦正常（`startup` +39ms / `response` +137ms / `notify` +167ms）。**反向对照**：`bun test` 内**只做裸 spawn（不引入主管）**亦正常（`notify` +169ms）。**⇒ 2×2 矩阵**：

  | | 裸 spawn | 经主管 |
  |---|---|---|
  | **纯脚本（bun）** | ✅ +167ms | ✅ 31–32ms（3/3） |
  | **`bun test`** | ✅ +169ms | ❌ **稳定超时**（2/2） |

  **⇒ 失败仅出现在「`bun test` × 主管」组合**；二者单独均正常 ⇒ **非产品接线、非协议/登记/派发、非夹具、非子进程 stdout 管道本身**；**机制仍未解释**（为何仅在运行器下，主管侧的 `'data'` 迟至杀进程 EOF 才交付）。**「测试运行器 × 子进程交互」由此从「未排除」升级为「已定位的差异所在」**。
- **⑩ 落地（2026-10-13）：子进程 oracle 绕行 ⇒ C₁ 端到端取得真实证据**。新增夹具 `tests/tools/fixtures/jobSupervisorChild.ts`（与既有 `PLAN-P0-1` 的 `executionCrashChild.ts` **同法**）：父测试 `spawnSync(process.execPath, …)` 拉起它，在其中用**真实主管** + **真实侧车** 跑一遍，把**事实**（启动/提交耗时、提交时在飞数、兑现耗时、结果或错误、结算后在飞数）以**单行 JSON**（前缀 `ORACLE_RESULT `）投给父进程 ⇒ **产品路径（真实主管 / 真实子进程 / 真实分帧）被真跑**，且**判定一律在父进程**（子进程**只报事实**、不自证）。**父进程断言**：提交耗时可忽略（< 500ms）且提交后在飞 = 1（**提交即返**）· 兑现 **< 1s**（oracle 侧超时兜底设 **4s** ⇒ 该断言把「真实 `notify` 兑现」与「超时兜底」在**证据层**区分开）· 结果 `{echo:'slow',n:1}` · 结算后在飞 = 0；失败分支断言 `error` 含 `fixture failure`。**先红后绿（可证伪）**：期望结果临时改 `n:2` ⇒ **1 fail / 4 pass**；还原 ⇒ **5 pass / 0 fail**。**回归**：`bun test tests/tools/sidecarJobE2E.test.ts tests/tools/sidecarJobRegistry.test.ts` = **11 pass / 0 fail / 0 skip**（原两条 `it.skip` 转为**真跑**）；`typecheck` 3 工程 0 错。**代价（如实）**：断言发生在**子进程**，父进程核对的是**投影结果**（结果行 + 退出码），**不如**进程内断言直接。**仍**未做：**C₂**（`kind='tool-job'` 挂起点 + worker 侧作业模式）⇒「挂起 → 续跑」段未覆盖。
- **处置**：**不改产品接线、不推红测**；运行器异常**单独登记**为 `TOOLGOV-TG2-C1-BLOCKED`（`fixed=false`：**绕行 ≠ 修复**），其 `reopenWhen` = 解释并消除该组合机制（届时断言可搬回父测试进程内）；C₁ 的端到端证据登记为 `TOOLGOV-TG2-C1-E2E-ORACLE`（`e2eVerified=true`）。

## §7 B₂ 片（**已落地**，2026-10-13）

- **新增** `tools/sidecar/sidecarJobs.ts` → `SidecarJobRegistry`（**只做登记与派发**，协议取自唯一基座 `utils/sidecarIpc`）
  - `register(jobId, timeoutMs, action)` ⇒ 完成 Promise，**每条都有超时兜底**（到期 reject，**绝不永久悬挂**）
  - `completeFromFrame(frame)`：**非作业帧 ⇒ `false`**（交回原分派）；**未知 `jobId` ⇒ `true` 但只留痕、不新增条目、不抛**（**不臆造**）；`ok=false` 亦结算（**成败同报**）
  - 同 `jobId` 重复登记 ⇒ **先结算旧的**（不静默覆盖，避免悬挂）
- **主管接线**（`ToolSidecarSupervisor`）
  - `handleFrame()` **顶部**（**必须在 `id` 校验之前**，因作业完成通知是**无 `id` 的 `notify` 帧**）派发作业完成通知
  - `submitJob(action, payload?, opts?)` ⇒ `{ jobId, completion }`；**提交失败 ⇒ 本地结算后抛出**（不留悬挂 Promise）
  - `deps.jobTimeoutMs`（默认 10 分钟）；`rejectAllPending()` 同口 `jobs.rejectAll()` ⇒ **崩溃/停止时在飞请求与在飞作业同因同果结算**
- **测试**：`app/tests/tools/sidecarJobRegistry.test.ts` **6 例**；**先红后绿**（`payload.ok` 分支写死恒真 ⇒ 1 fail / 5 pass → 6 pass / 0 fail）；回归 `tests/tools/sidecar*` **70/0**
- **如实边界**：`kind='tool-job'` 挂起点**未接**（随 C）；**worker 侧作业模式未实现**（`lspSidecar`/`mediaSidecar` 尚不处理 `job.submit`）⇒ 宿主 API **当前无调用方 ⇒ 生产零行为变更**
