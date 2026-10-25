# Spec：多租户数据面边界裁定 —— ContextPersistence 进程级快照 / DreamCycleDb 全局台账

> 版本 1.0 ｜ 创建 2026-10-25 ｜ 状态：🟢 **裁定已定案**（两项均维持现状，零代码；owner 化触发条件已登记）
> 来源：台账 `dev_docs/error_repairs/预存错误与待处理问题.md` L12080-12103（2026-10-25 取证）；完整取证与方案选项见本地工作笔记 `dev_docs/20261025/进程级快照与Dream台账-租户化设计方案-20261025.md`（v1.1，dev_docs 不入库）
> 裁定口径：与 [`google-ai-review-adjudication.md`](google-ai-review-adjudication.md) §1 一致（✅ 已实现 / 🟡 部分 / ⏸ 延期 / ❌ 不采纳）
> 关联契约：多租户数据面契约 = `google-ai-review-adjudication.md` §3.4（2026-10-24 拍板，知识五仓 2026-10-25 收口）；租户化改造模板 = knowledge 五仓实施 5 次（`bf6c4b259` 等）
>
> **本 spec 是裁决记录，不是施工单**：两项裁定均为「维持现状」，无实施轮；owner 化改造待触发条件成立后另行立项。

---

## 1. 裁定结论（2026-10-25 用户拍板）

| # | 对象 | 语义（取证） | 裁定 | 依据 |
|---|------|------------|------|------|
| 1 | **ContextPersistence**（`context/persistence/`） | **进程级快照**：启动 `load()` 全量恢复 ContextStore、关闭 `save()` 全量落盘；`hydrateOnStartup()` 在 T1 启动（**无请求身份**）；`getPersistence()` 模块级惰性单例钉死共享 `app.db` | ✅ **维持进程级快照**（零代码） | 启动无身份是硬约束（`load()` 无法回答「读哪个 owner」）；ContextStore 是进程级工作记忆（LRU/maxSize 1000）非用户 CRUD 数据面；快照 = 跨用户整库 dump，非请求可归属数据 |
| 2 | **DreamCycleDb**（`dream/DreamCycleDb.ts`） | **系统级运行台账**（类比 `agent_runs`）：每次周期扫**全部会话**（`sessions_scanned`）；Dream 调度（cron + 空闲检测）与内容面（SOUL/USER/knowledge/memory）均进程级全局 | ✅ **维持全局台账**（零代码） | 台账按用户分无意义；消费面均为无身份写（`mirrorCycleToDb`）/只读查（analytics）；Dream 本身仍全局单任务 |

## 2. owner 化改造触发条件（⏸ 登记，满足即立项）

### 2.1 ContextPersistence（三项同现才值得）

1. 单进程服务**多租户**成为真实部署形态（当前不存在）；
2. 存在**请求可归属**的 ContextStore 消费者（当前 `contextStore.` 仅生命周期使用，无业务侧 per-request 读写）；
3. 明确的「按租户恢复上下文现场」需求（如租户间上下文严格隔离审计要求）。

> 实施时按 CD05 分步（先摘入口 → 观察 → 再删实现）+ 独立提交可回滚；CD07 关键域（上下文持久化/会话恢复）六步核查。

### 2.2 DreamCycleDb（单一触发）

- **Dream 子系统租户化方案定案并立项**（每租户独立 dream 引擎 + 独立 SOUL/USER/knowledge/memory）。
- 届时 `dream_cycles` 与 `agent_runs` **同批、同模板**改造（B2 系列先例：库切租户 `resolveTenantDbPath` + 三桶单例 + 每 DML 归属过滤 + 旧库补 `owner_key` 列），避免单例/分桶重复改造。

## 3. 取证基线（要点，行号可核）

| 事实 | 证据 |
|------|------|
| `SqliteContextPersistenceImpl` 构造器 `dbPath = resolveDbPath()` 构造期解析、无请求身份 | [ContextPersistence.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/context/persistence/ContextPersistence.ts#L235-L237) |
| `getPersistence()` 模块级惰性单例，无参构造钉死共享 `app.db` | [ContextPersistenceLifecycle.ts:23-46](file:///e:/PY/Documents/CODES/PY_APP/app/src/context/persistence/ContextPersistenceLifecycle.ts#L23-L46) |
| `hydrateOnStartup()` 启动调用（T1，无身份）；`serializeOnShutdownSync()` 关闭调用 | [main.ts:1415](file:///e:/PY/Documents/CODES/PY_APP/app/src/main.ts#L1414-L1417) · [main.ts:445](file:///e:/PY/Documents/CODES/PY_APP/app/src/main.ts#L442-L449) |
| ContextStore 进程级单例（内存 Map，maxSize 1000，LRU evict，TTL） | [ContextStore.ts:40-48, 256](file:///e:/PY/Documents/CODES/PY_APP/app/src/context/ContextStore.ts#L40-L48) |
| `load()`/`save()` 整库 dump（非按用户细粒度读写） | [ContextPersistence.ts:348-446](file:///e:/PY/Documents/CODES/PY_APP/app/src/context/persistence/ContextPersistence.ts#L348-L446) |
| `dream_cycles` 周期记录表 + `getDreamCycleDb()` 惰性 async 单例 | [DreamCycleDb.ts:43-67, 396-401](file:///e:/PY/Documents/CODES/PY_APP/app/src/dream/DreamCycleDb.ts#L395-L401) |
| 每次周期扫全部会话（非按用户筛选）；Dream 全局单任务调度 | [UnifiedDreamCycle.ts:155-166](file:///e:/PY/Documents/CODES/PY_APP/app/src/dream/UnifiedDreamCycle.ts#L155-L166) · [DreamScheduler.ts:43-45](file:///e:/PY/Documents/CODES/PY_APP/app/src/dream/DreamScheduler.ts#L43-L45) |

## 4. 合规自查

| 规则 | 结论 |
|------|------|
| CD07 | ✅ 本轮零删除零改造；未来实施按六步核查 + 独立提交 + 回滚路径 |
| CS06 | ✅ 裁定全部基于回仓取证（`file:line` 可核）；无编造 |
| 数据面契约 §3.4 | ✅ 本裁定是契约的**边界声明**：快照恢复介质与系统级运行台账不属「请求可归属用户数据面」，不参与 owner 化 |
