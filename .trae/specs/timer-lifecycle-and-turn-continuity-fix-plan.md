# 修复方案：定时器生命周期 + 智能体停轮/反复提问

> 状态：**Phase 1-4 已实施；Phase 5-1、5-2 已实施；A4 评估完成（待决策是否实施）。**
> 基线：`478cde3e4`
> 输入：`C:\Users\csdnc\Documents\LiriProjects\proj_1792339340147_ca7ac3\output\隐藏BUG排查报告-定时器生命周期专项.md`（写于 2026-10-19 18:25:02）
> 追加取证：运行中会话 `session_mve0gkth422d248037`（事件日志 + `app.log`）

---

## 0. 先读结论

1. **报告已部分过时**：报告称 BUG-1/BUG-2 “未修复”，但当前工作区已出现另一写入方在 18:31:56 / 18:31:59 的未提交改动：
   - `MemoryIntegrationService`：已补 `syncTimer` + 幂等守卫 + `unref()` + `stop()/dispose()`（**基本完整**）；
   - `FileExporter`：只补了 `rotationTimer` 字段声明，**句柄仍未保存、无 `stop()`、构造函数仍启动定时器**（**半成品，字段是死字段**）。
2. **两处定时器当前都不可达**：`createDefaultMemoryIntegrationService()`、`getFileExporter()`、`createFileExporter()` 在 `app/src`、`app/tests`、`client/src` 中均为 **0 调用点**。因此报告所称“正在阻塞进程退出”属于**潜在缺陷**，不是当前已发生的运行时事故（CS06：不夸大）。
3. **报告的建议 2 已有基础设施**：仓内已存在 `scripts/lint-unref.ts`（`bun run lint:unref`），但只对**模块顶层**未 `unref` 的 `setInterval` 阻断，实例级只告警。应“扩展现有门禁”，不要另造一套 ESLint 规则（CS01）。
4. **“反复要用户回复”是另一个独立根因链**（见 §4）：写文件后的“结束本轮”注入、重读 steering 的收尾指向、工具失败一律询问用户；其中 3 处已在上一轮工作中改到工作区（未提交、未审阅）。

---

## 1. 现状核对（报告 vs 源码）

| 报告项 | 当前源码事实 | 判定 |
|---|---|---|
| BUG-1 `MemoryIntegrationService` 定时器不可控 | 工作区已有 `syncTimer`（`MemoryIntegrationService.ts:120`）、幂等守卫 + `unref` + `stop/dispose`（`:455-484`）；**HEAD 未包含**（未提交） | 工作区已修，需审阅/验证/提交 |
| BUG-2 `FileExporter` 构造即启动、句柄丢弃 | 仅有字段 `rotationTimer`（`FileExporter.ts:46`）；`startRotation()` 仍 `setInterval` 不赋值（`:170-176`）；无 `stop()`；构造函数仍调用 `startRotation()`（`:73`） | **半成品，必须补齐** |
| BUG-3 `initialize()` 可重入 | `initialize()`（`MemoryIntegrationService.ts:146-166`）仍无 `initialized` 早退；但 `startAutoSync()` 的新守卫已阻止定时器叠加 | 定时器叠加已消除；“initialize 幂等”未做 |
| 影响：进程无法退出 | 两个类当前均无静态消费者（见 §0.2）；属潜在风险 | 保留修复，但验收要写清“可被 future wiring 触发” |
| 建议 2：新增 ESLint 禁止裸 `setInterval` | 已有 `scripts/lint-unref.ts`，顶层阻断 / 实例级告警 | 扩展现有脚本 |
| 建议 1：`SafeInterval` + `LifecycleRegistry` | 仓内无此类（Grep 0 命中） | 可选，建议本期不引入 |

补充事实：
- `MemoryIntegrationService.startAutoSync()` 使用 `void this.syncMemories().catch(...)`，回调返回 `Promise` 的未处理拒绝已被收口，原报告的 async 回调风险已消除。
- `FileExporter` 构造函数还做了 `ensureOutputDir()` / `updateCurrentSize()`（`:67-70`）；本轮只要求“定时器零副作用”，目录探测是否外移单列为 P2（见 §3 Phase 4）。

---

## 2. 验收标准

**定时器部分**
1. 每个周期性定时器都有唯一所有者、可停止、可 `unref()`，重复启动幂等。
2. `FileExporter` 构造函数**不注册定时器**；公开工厂 `getFileExporter()/createFileExporter()` 行为保持“拿到即可轮换”。
3. `MemoryIntegrationService.initialize()` 幂等；`stop()/dispose()` 幂等。
4. `bun test` / CLI 短任务可自然退出：断言 `process.getActiveResourcesInfo()` 中无残留 `Timeout`。
5. `bun run lint:unref` 绿；新增的实例级违规在 CI 变为阻断（先用存量基线，只拦新增）。

**行为部分（反复停轮）**
6. 长任务中写出中间文件后，模型不被要求“结束本轮”；同一用户轮只提示一次。
7. 工具失败后优先自行改道；只在改道失败/需要授权时询问用户。
8. 复测同一任务：用户“请继续”次数显著下降（以事件日志计数为准，不凭观感）。

---

## 3. 实施步骤（分阶段、可独立回滚）

### Phase 0 —— 冻结并发写入（MUST 先做）

- 当前有**另一运行中会话**正在修改同一批文件（mtime 18:31:56/59），且工作区已有 18 项未提交变更。
- 动作：先确认改动归属（保留 / 回滚重做），实施期间避免两个写入方同时改 `MemoryIntegrationService.ts` / `FileExporter.ts`。
- 建议：每个 Phase 独立提交，提交信息写明“依据 + 回滚方式”（CD06）。

### Phase 1 —— FileExporter 补齐（P0）

文件：`app/src/monitoring/exporters/FileExporter.ts`

1. 构造函数移除 `this.startRotation()`（`:73`）；构造函数只保留字段赋值。
2. 新增公开 `start()`：
   - `if (this.rotationTimer || this.config.rotationInterval <= 0) return;`
   - `this.rotationTimer = setInterval(() => this.rotateFile(), this.config.rotationInterval);`
   - `this.rotationTimer.unref?.();`
3. 新增公开 `stop()`：`clearInterval` + 置 `null`（幂等）。
4. `getFileExporter()` / `createFileExporter()` 在返回前调用 `.start()`，保持工厂语义不变。
5. `setConfig()`：若 `rotationInterval` 变化，先 `stop()` 再按新值 `start()`（避免旧句柄泄漏）。
6. 断言：`rotationTimer` 字段不再是死字段（引用点 = start/stop/setConfig）。

回滚：单文件单提交，`git revert` 即可。

### Phase 2 —— MemoryIntegrationService 收口（P0）

文件：`app/src/memory/memdir/MemoryIntegrationService.ts`

1. 审阅并保留工作区已有修复（若决定重做，先回滚再按同形态提交）。
2. 补 `initialize()` 幂等：
   - `private initialized = false;`
   - 入口 `if (this.initialized) return;`
   - 成功末尾置 `true`；抛错保持 `false`。
   - 注意：`stop()` 只停定时器，不重置 `initialized`（避免“stop 后再 initialize”语义漂移）；如产品需要重启，新增 `restartAutoSync()`，不改变 initialize 契约。
3. 生命周期接线：
   - 该类目前无消费者；在真正接线 `createDefaultMemoryIntegrationService()` 的调用点，必须同时登记 `dispose()`（进程退出/服务重启时调用）。
   - 本期不新增 `LifecycleRegistry`；等出现第二个需要统一回收的服务时再做（避免过度设计）。

回滚：同上。

### Phase 3 —— 门禁扩展（P1）

文件：`scripts/lint-unref.ts`

1. 新增判据（仅对新代码阻断，存量走基线）：
   - `setInterval(...)` 返回值未赋给类字段（`private *Timer*` / `SafeInterval`）⇒ 记违规；
   - 类中出现 `setInterval` 但同类无 `clearInterval`/`stop`/`dispose` ⇒ 记违规；
   - 保留既有豁免：`src/hooks/**`、`*.tsx`。
2. 先以 `--list` 产出现状清单，建立基线文件；CI 只对新增项 `exit 1`。
3. 同步文档：在 `lint-unref.ts` 头注补充“实例级判据”的口径（当前头注只写了顶层阻断）。
4. **不新增** ESLint 自定义规则（与现有脚本重复）。

回滚：脚本 + 基线文件同提交回滚。

### Phase 4 —— 构造函数零 I/O（已实施）

- `FileExporter` 构造函数只做字段赋值；`ensureOutputDir()` / `updateCurrentSize()` 外移到 `start()`，
  `export()` 通过 `ensureOutputDirOnce()` 按需建目录（未调用 `start()` 也能正常导出）。
- `setConfig({ outputDir })` 变化时重置 `outputDirReady`，下次 `start/export` 重新确保目录。
- 统一 `SafeInterval` 封装：只在出现第 3 处同类泄漏时再引入（本期不做）。

---

## 4. 行为侧：智能体“做一点就要用户回复”

### 4.1 已取证根因（会话 `session_mve0gkth422d248037`）

| 编号 | 根因 | 证据 |
|---|---|---|
| A1 | 每次 `file_write/file_edit` 成功后注入 `[交付收敛]…并结束本轮；不要继续` | 模型思维链 **12 次**引用该指令；5 个轮次以“本轮交付物/产出物”收尾；用户 10+ 次“请继续” |
| A2 | 重读 steering 写明“要么直接向用户交付最终结论” | 本会话触发 8 次 |
| A3 | 工具失败提示要求“明确告知用户/询问用户” | TAOR 静默完成提醒被注入 17 次；本会话大量路径越界/安全拦截 |
| A4 | dev 后端 `bun --watch` 重启导致 SSE 断开、轮次 `canceled` | 日志轮换 13:33:39 / 17:27:13 与 `turn/end canceled` 吻合；智能体把文件写进 `app/` 源码树 |

### 4.2 工作区已落地的改动（上一轮，未提交）

| 文件 | 改动 |
|---|---|
| `app/src/chat/pipeline/streamMessageLifecycle.ts` | 交付提示改为条件式（不再命令结束本轮）；按 assistant 消息 id 每轮只注入一次 |
| `app/src/chat/toolResultPostProcess.ts` | 重读 steering 去掉“交付最终结论”的收尾指向 |
| `app/src/query/TAORLoop.ts` | 工具失败提示改为“先自行改道，改道失败再找用户” |
| `app/src/context/promptSections/builtinSections.ts` | 规则 5 / 异常处理改为自行恢复优先 |
| `app/prompts/zh-CN/{manifest.json,sections/toolIntegrity.md,sections/taskNegotiation.md}` | `prompts:export` 重新生成 |

> 处置选项（需确认）：保留这些改动并走 Phase 5 审阅；或回滚后与本方案一并重做。

### 4.3 Phase 5 —— 行为侧验证（待确认后实施）

1. 为 `buildToolRoundMessages` 增加单测：同一 assistant 消息内多次写文件 ⇒ 仅 1 次提示；不出现“结束本轮”。**（已实施：`app/tests/chat/streamMessageLifecycleWriteHint.test.ts`）**
2. 复测长任务（连续写 ≥3 个中间文件）：统计用户“请继续”次数与 `turn/end.finishReason`。**（已实施：见 §8.4）**
3. A4 单独评估（**本期不实施**）：
   - 让智能体把中间产物写到项目 `output/`，避免落进 `app/` 触发 watch 重启；
   - 或在长任务测试时关闭后端 `--watch`；
   - 或评估“客户端断线后服务端继续执行/重连恢复”的可行性（属架构改造，另立 spec）。

---

## 5. 验证矩阵

| 检查 | 命令 / 方法 | 期望 |
|---|---|---|
| 类型 | `cd app && bunx tsc --noEmit` | 0 error |
| Lint | `cd app && bunx eslint <changed files>` | 0 error |
| 定时器门禁 | `cd app && bun run lint:unref` | 通过；实例级新增违规被拦 |
| 资源残留 | `app/tests/monitoring/timerLifecycle.test.ts`（句柄字段断言 + 测试进程自然退出） | 无残留句柄；进程不挂住 |
| 轮次行为 | 复测长任务 + 统计事件日志 | 不再每写一个文件停一次 |
| 提示词 | `bun run lint:prompt-parity` / `lint:prompt-budget` / `prompts:check` | 全绿 |

---

## 6. 风险与回滚

| 风险 | 处置 |
|---|---|
| 两个写入方并发修改同一文件 | Phase 0 冻结；每 Phase 独立提交 |
| `FileExporter` 工厂语义变化 | 工厂内显式 `start()`，对外行为不变 |
| `setConfig` 热更新导致定时器泄漏 | 先 `stop()` 再 `start()`，纳入用例 |
| `initialize()` 幂等后无法“重启同步” | 明确 `stop()` 只停定时器；如需重启另加 `restartAutoSync()` |
| 提示词改动影响所有会话 | 只改文案，不动结构；`lint:prompt-parity` + `lint:prompt-budget` 把关 |
| 误删/误改关键模块 | 遵守 `code-deletion.md`：先摘入口、独立提交、保留回滚点 |

---

## 7. 决策状态（2026-10-19 已确认：执行 Phase 1-3）

1. 工作区里另一写入方的改动：**保留并补齐**（已按此执行）。
2. 本期范围：**只做 Phase 1-3（定时器）**；行为侧（§4.2）保持现状、待审阅（Phase 4-5 未动）。
3. `dev --watch 重启导致轮次 canceled`（A4）：**未立项**，留待后续决策。

---

## 8. 实施记录（Phase 1-3，2026-10-19）

### 8.1 改动清单

| 文件 | 改动 |
|---|---|
| `app/src/monitoring/exporters/FileExporter.ts` | 构造函数零 I/O（只赋值）；新增公开 `start()/stop()`（幂等）；工厂显式 `start()`；`setConfig()` 间隔变化停旧起新、目录变化重置就绪标记并切换当前文件到新目录；`export()` 首次按需建目录 |
| `app/src/memory/memdir/MemoryIntegrationService.ts` | 保留定时器句柄/幂等/`unref`/`stop()/dispose()`；新增 `initialized` 早退（initialize 幂等） |
| `app/src/memory/memdir/index.ts` | 工厂 JSDoc 补生命周期契约（调用方必须 `dispose()`） |
| `scripts/lint-unref.ts` | 扩展类作用域判据（句柄 / 清理入口 / unref）+ 文件级基线棘轮；新增 `--update-baseline`；修正 `.unref?.()` 与同名方法声明的误判 |
| `.trae/architecture/timer-unref-baseline.json` | 基线：108 → **28** 处实例级存量违规 / 95 → **26** 个文件（六批 + channels/网络专项后棘轮下调） |
| `app/tests/monitoring/timerLifecycle.test.ts` | 新增 4 条生命周期用例 |
| `app/tests/chat/streamMessageLifecycleWriteHint.test.ts` | 新增 4 条交付提示行为用例（条件式文案 / 按轮去重 / 新轮重现 / 失败不提示） |

### 8.2 验证结果

- `cd app && bun run typecheck`：通过（含 `tsconfig.root-scripts.json`）
- `cd app && bunx eslint <changed files>`：0 error
- `cd app && bun run lint:unref`：通过（类作用域违规 28 均在基线内）
- 基线移除反证：临时移除基线后门禁 `exit 1`，恢复后 `exit 0`（棘轮生效）
- `bun test tests/monitoring --timeout 120000`：42 pass / 0 fail
- `bun test tests/monitoring/timerLifecycle.test.ts`：6 pass / 0 fail（含构造函数零 I/O、outputDir 切换用例），测试进程自然退出
- `bun test tests/chat tests/memory --timeout 180000`：684 pass / 0 fail（111 文件）
- `bun test tests/chat/streamMessageLifecycleWriteHint.test.ts`：4 pass / 0 fail

### 8.3 并发写入提示

实施期间另一运行中会话仍在向本仓写入（本轮出现未跟踪的 `_probe_timer_ownership2.ts`）。提交前需：
1. 确认该临时文件归属并清理；
2. 复核 `MemoryIntegrationService.ts` / `FileExporter.ts` 未被后续写入覆盖；
3. 按 Phase 0 约定拆分提交。

### 8.4 Phase 5-2 实机复测结果（2026-10-19 19:00）

- 方式：通过本地 API 创建**临时会话** `session_mvf57imkc39b4e6ea5`，发送 1 条任务（顺序写 3 个文件），
  走真实流式路径 `POST /v1/chat/completions`（`stream:true`）；结束后删除该临时会话与测试文件。
- 用户消息：**1 条**（无任何「请继续」）。
- 轮次：**1 个 turn**；`turn/end` = `{ finishReason: 'tool_use', terminationReason: 'completed' }`。
- 写入时序：`timer-test-1.md` 19:00:26 → `timer-test-2.md` 19:00:28 → `timer-test-3.md` 19:00:30
  （每次写完都继续下一步，没有在第 1/2 个文件后收尾）。
- 事件日志中 `交付收敛` / `交付提示` 出现次数均为 **0**（模型思维链未再被收尾指令干扰）。
- 工具序列：3 × `file_write` + 4 × `todo_write` + 1 × `bash(dir 校验)`，最终输出汇总交付说明。
- 结论：**「每写一个文件就要用户回复一次」在实机链路已不再复现**。

### 8.5 A4 评估：客户端断线 / 进程重启导致轮次 `canceled`

**现状取证**

| 事实 | 证据 |
|---|---|
| SSE `close` 时，若会话仍在流式中 ⇒ 立即 `abortSessionStream` | `chat-handlers.ts:570-574` → `abortSessionOnClose`（`:99-120`，K4b：正常收尾不误伤） |
| 前端自带重连：最多 3 次，恢复到 `checkpointId` 走 `/resume` | `client/src/services/chatService.ts:1369-1457` |
| `/resume` 可从检查点恢复；无检查点时从 events 尾部重建未完成 turn | `app/src/chat/manager/streamResume.ts:117-181` |
| 轮次执行**绑定在 HTTP 响应生成器内**，没有"脱离 SSE 的后台执行 + 重新附着"机制 | `handleStreamingChat` 的 generator 生命周期 = 请求生命周期 |
| 原始会话出现 8 个 `finishReason: canceled` 轮次 | 会话 `session_mve0gkth422d248037` 事件日志 |
| 崩溃恢复会为"已 start 未 end"的轮次**合成** `turn/end { finishReason: 'canceled' }` | `EventLogRepair.ts:212-268`（`interruptedTurnClosers`） |
| 原会话元数据存在 `crashRecovery: failed_stale` + `crashedAt` | `session.json` |

**补充取证（2026-10-19）**
- `app.log` 中未找到实时收尾路径的 `turn 中止未闭合 ⇒ 补写 turn/end(canceled)` 告警 ⇒ 部分 `canceled` 来自**启动后的崩溃修复**（`EventLogRepair`），而非实时客户端断开。
- 全局 `/v1/events` SSE（`LocalHTTPServiceSSE.ts:33`）在轮转日志中共 13 对 connect→disconnect，其中 5 对 <10s（0.001s / 0.017s / 0.464s / 5.064s / 8.39s）；但它是**事件总线**连接，不是 chat 流，不能单独作为"C 延迟 abort"的依据。

**结论（诚实边界）**

1. **瞬时网络抖动**：已有前端 3 次自动重连 + checkpoint resume 覆盖，不是主要缺口。
2. **主动切换会话 / 发送新消息**：客户端会主动 abort 当前流，属**设计行为**，不应改。
3. **真实缺口**：后端进程重启（dev `--watch`、崩溃、升级）会杀掉在飞轮次；`EventLogRepair` 只能补写 `turn/end canceled`，长任务需要用户再回一次「请继续」。
4. 原会话的 `canceled` 并非全部由 `--watch` 造成；日志轮换时间只是体积阈值，不能当作重启证据（此前推断已修正）。

**可选项**

| 方案 | 成本 | 风险 | 建议 |
|---|---|---|---|
| A. 不改代码：长任务测试期间不切换会话/不关页；中间产物写 `output/` | 0 | 0 | **本期采用** |
| B. 开发期长任务用**无 watch** 启动 | 0（已有） | 低 | 直接用现有 `cd app && bun run start --http-port 18990`，无需新增脚本 |
| C. `close` 后延迟 5-10s 再 abort（给重连留窗口） | 中 | 中（需处理重连取消定时器、互斥锁/所有权） | 先看日志中短断开频率再定 |
| D. 后台执行 + 重新附着（detached execution） | 高 | 高（执行生命周期/结算/重复副作用，需新 spec） | **本期不立项** |

**建议**：采用 A；开发期长任务需要改源码时用 B（现有 `bun run start`，无需新增脚本）。C 需要"短断开"的真实频次证据；D 属架构改造，另立 spec 评估。

### 8.6 存量收敛第一批（结构型泄漏，2026-10-19）

优先处理 `no-handle` / `no-cleanup` 的结构型违规（共 12 处 / 8 文件）：

| 文件 | 处理 |
|---|---|
| `governance/EnhancedGovernanceManager.ts` | 2 个监控 interval 存入 `monitoringIntervals` + `unref`；`destroy()` 清空 Map |
| `keybindings/EnhancedKeybindingsManager.ts` | 3 个监控 interval 同上 |
| `sandbox/EnhancedSandboxManager.ts` | 2 个监控 interval 同上 |
| `chat/services/PerformanceOptimizationService.ts` | `cacheCleanupTimer` 字段 + `unref` + `stopCacheCleanup()/dispose()` |
| `config/enterprise/audit/EnterpriseAuditService.ts` | `retentionTimer` 字段 + `unref` + `stopRetentionSweeper()/dispose()` |
| `memory/memdir/MemoryCommands.ts` | `autoDreamTimer` 字段 + `unref` + `stopAutoDream()/dispose()` |
| `runtime/InboxManager.ts` | 补 `stopExpireScheduler()/dispose()` |
| `trace-recording/live/LiveViewServer.ts` | keepalive 句柄命名 + `unref`（close 时仍 clearInterval） |

结果：实例级违规 **108 → 97**（文件 95 → 88）；`lint:unref` 通过，基线已棘轮下调。

### 8.7 存量收敛第二批（可放弃的周期性维护，2026-10-19）

为以下 11 处定时器补 `unref?.()`（均已有句柄与清理入口，仅缺“不阻塞退出”）：

`cache/CacheService` · `cache/CacheSystem` · `cache/PersistedCacheService` · `cache/strategy/CacheStrategyManager` ·
`channels/cache/MediaCache` · `chronos/service/ExecutionHistoryService` · `chronos/service/TaskExpirationService` ·
`core/utils/Performance`（2 处） · `core/utils/ResourcePool` · `cost/CostMetricsBridge`

同时修正 `lint-unref` 的 `unref` 识别：在 `setInterval(...)` 调用结尾后最多 800 字符内（且不跨入下一个 `setInterval`）
查找 `.unref`，消除“回调较长导致 unref 落在 12 行窗口外”的误报（ContextEngine / infrastructure-diagnostics 因此转为合规）。

结果：实例级违规 **97 → 77**（文件 88 → 69）；基线已棘轮下调至 77 / 69。验证：`tsc` 通过、`eslint` 0 error、
`tests/integration/cost-metrics` + `tests/cost` 64 pass / 1 skip / 0 fail。

### 8.8 存量收敛第三批（监控/性能/观测，2026-10-19）

为 16 处周期性观测/维护定时器补 `unref?.()`：

- `monitoring/health/HealthChecker` · `monitoring/HealthMonitor`（2 处） · `monitoring/integration/SystemMonitor` ·
  `monitoring/logs/tail/LogTail` · `monitoring/MonitoringService`（2 处） · `monitoring/otel/MetricsBridge`
- `performance/EnhancedPerformanceManager`（3 处） · `performance/MemoryManager` · `performance/MemoryOptimizer`
- `utils/memoryMonitor` · `utils/telemetry` · `tools/monitoring/ToolMonitor`

结果：实例级违规 **77 → 61**（文件 69 → 57）；基线棘轮下调至 61 / 57。
验证：`tsc` 通过、`eslint` 0 error、`tests/monitoring` + `tests/ci/performance` + `tests/integration/cost-metrics`
共 73 pass / 0 fail。

### 8.9 存量收敛第四批（记忆/配置/媒体/安全等维护类，2026-10-19）

为 11 处周期性维护/刷新定时器补 `unref?.()`：

`memory/AutoMemoryHeartbeat` · `memory/MemorySyncService` · `memory/scanners/MemoryWatcher` ·
`memory/services/MemoryPrefetchQueue` · `memory/services/TeamMemoryService` · `memory/services/TeamMemorySyncService` ·
`media/temp/TempMediaManager` · `config/loader/ConfigLoader` · `governance/RuleSuggestionEngine` ·
`tokenBudget/UnifiedTokenTracker` · `security/patterns/SecurityPatternUpdater`

结果：实例级违规 **61 → 50**（文件 57 → 46）；基线棘轮下调至 50 / 46。
验证：`tsc` 通过、`eslint` 0 error、`tests/memory` + `tests/config` + `tests/security` + `tests/core/tokenBudget`
共 360 pass / 1 skip / 0 fail。

**剩余 50 处不再机械收敛**：集中在渠道心跳（QQ/Discord/WeChat/IRC）、网络连接池（MCP/SSH/WebSocket）、
队列/调度器（Cron/Dream/Knowledge）、UI 与“活跃操作超时”类定时器 —— `unref` 可能影响进程保活或任务等待语义，
必须逐处人工判定（留作后续专项）。

### 8.10 存量收敛第五批（Agent/AI 健康检查，2026-10-19）

为 4 处健康检查/轮询定时器补 `unref?.()`：
`agent/managers/MultiSourceAgentManager` · `ai/health/ModelHealthCheck` ·
`ai/local/llama/LlamaServerLogs` · `ai/local/llama/ModelDownloadService`

（`ai/providers/TopologyWatcher` 与 `ai/python/WorkerGuard` 经门禁识别修正后确认原本已 unref。）

结果：实例级违规 **50 → 46**（文件 46 → 42）；基线棘轮下调至 46 / 42。
验证：`tsc` 通过、`eslint` 0 error、`tests/ai` + `tests/agent` 共 292 pass / 0 fail。

### 8.11 存量收敛第六批（刷新/清理/健康检查，2026-10-19）

为 7 处周期性刷新/清理定时器补 `unref?.()`：
`services/analytics/sink` · `services/growthbook/GrowthBookClient` ·
`services/remoteManagedSettings/RemoteSettingsClient` · `runtime/NotificationPersistence` ·
`modules/doc/DocModule` · `chronos/service/ConfigService` · `daemon/ProcessManager`

结果：实例级违规 **46 → 39**（文件 42 → 35）；基线棘轮下调至 39 / 35。
验证：`tsc` 通过、`eslint` 0 error、`tests/runtime/NotificationPersistence` + `tests/modules/doc` + `tests/chronos`
共 166 pass / 0 fail。

**收敛到此为止（39 处保留在基线）**：剩余全部为渠道心跳、网络连接池/传输层、Cron/Dream/Knowledge 调度器、
UI/终端组件与“活跃操作超时”类定时器。它们与进程保活/任务等待强耦合，必须逐处设计评审，不能以门禁数量为目标批量改。

### 8.12 channels 专项评审（2026-10-19）

| 定时器 | 作用 | 处置 |
|---|---|---|
| `channels/qq/QQChannel.ts:273` Token 后台刷新 | 后台维护，WS 长连接独立保活 | **补 `unref`** |
| `channels/session/SessionResetPolicy.ts:217` 会话重置检查 | 后台维护 | **补 `unref`** |
| `channels/discord/DiscordChannel.ts:571` WS 心跳 | 传输层保活 | 保留（不加 `unref`） |
| `channels/irc/IrcChannel.ts:580` PING 保活 | 传输层保活 | 保留 |
| `channels/wechat/WechatChannel.ts:293` 消息轮询 | 该渠道**唯一入站循环**，`unref` 会导致进程提前退出 | 保留 |

结果：实例级违规 **39 → 37**（文件 35 → 33）；基线棘轮下调至 37 / 33。
验证：`tsc` 通过、`eslint` 0 error、`tests/channels` 共 475 pass / 0 fail。

### 8.13 网络保活专项（2026-10-19）

为 9 处连接保活/清理定时器补 `unref?.()`（连接对象自身负责保活，定时器仅维持会话）：

`bridge/managers/HeartbeatManager` · `bridge/websocket/WebSocketClient` ·
`remote/SSHConnectionPool`（清理 + keepalive） · `runtime/acp/client` · `runtime/acp/server` ·
`services/mcp/MCPServerManager`（健康检查 + 自动重连） · `services/mcp/transports/WebSocketTransport`

结果：实例级违规 **37 → 28**（文件 33 → 26）；基线棘轮下调至 28 / 26。
验证：`tsc` 通过、`eslint` 0 error、`tests/bridge` + `tests/mcp` + `tests/services/mcp` + `tests/acp`
共 45 pass / 18 skip / 0 fail。
