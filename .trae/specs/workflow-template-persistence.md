# 工作流模板持久化 Spec（P2-1 落盘部分）

> 版本: 1.0 | 创建: 2026-09-13 | 状态: **首版已完成（2026-09-13）**
> 关联: GR15 / CS01（复用既有 store 模式）/ project_rules §1.1（禁删库结构）/ §1.5（统一 app.db）/ §1.6.1（api-spec 唯一事实来源）
> 前置：路线图阶段三第 12 项（P2-1）

## 1. Problem Statement

工作流模板的 5 个 HTTP CRUD 路由（`/v1/workflows/templates`）是**真实消费者**，但用户自定义模板原先是**纯内存 Map**（原 `workflow-template-handlers.ts#L255` `const userTemplates = new Map()`）→ **进程重启即丢失**（确切缺陷，非风格问题）。

## 2. 事实与影响评估

| 面 | 事实（附证据） | 结论 |
|---|---|---|
| 表名冲突 | 全仓检索 `workflow_templates` → 无任何 DB 表占用（仅有前端侧栏 key 与日志 action 字符串） | 可安全新建表 |
| 本仓持久化惯例 | 每域一个 store 类单例，`constructor(dbPath = resolveDbPath())` + `init()` 建表 + 回调式 `db.run/all/get`（`workspace/AgentRoleStore.ts#L78-L138`、`workspace/TaskStore.ts#L100`） | **复用该模式**，不引入新持久化框架（CS01） |
| 库文件 | 统一唯一 `app.db`（`resolveDbPath()`） | **不新建 `.db` 文件**（§1.5） |
| 结构约束 | 仅**新增**表，未删改既有结构 | 符合 §1.1「严禁删除数据库结构，仅允许新增/修改」 |
| API 形状 | handler 的状态码/错误处理/字段保持不变 | **无 API 变更**（但 api-spec 原先缺这些端点，本批补齐） |

## 3. 决策

| ID | 决策 | 理由 |
|---|---|---|
| D1 | 新增 `workflow_templates` 表，落在唯一 `app.db` | 复用既有 DB；不新建库文件 |
| D2 | `steps` / `tags` 以 **JSON 文本**存储；`created_at` / `updated_at` 存 **ISO 文本** | 与 `WorkflowTemplate` 域类型同源，避免时间戳精度/时区转换失真（数出同源） |
| D3 | **4 个内建模板保持代码内静态**，不入库 | 它们是产品内置能力，不是用户数据；入库会引入"内置被误删/篡改"风险 |
| D4 | handler 只替换存储层，**语义/状态码/日志不变**；`update`/`delete` 的 404 判定改由 store 的 get/remove 结果驱动 | 最小侵入；且消除原 `has()` + `delete()` 两次访问 |
| D5 | **不在本批**做"模板 ↔ Provider 绑定"，也不处理 P3-1（前端 `workspaceService` 5 个方法无组件引用） | 绑定涉及两套类型族语义差异（`WorkflowTemplate` 带 `suggestedAgentRole`，不驱动工具调用），需独立决策 |
| D6 | P3-2（`ENABLE_WORKFLOWS` / `WORKFLOW_SCRIPTS` 特性位）**已由 V-3 删除闭环**，无需再处理 | 见 `预存错误与待处理问题.md` V-3 |

## 4. 影响文件

| # | 文件 | 改动 |
|---|---|---|
| 1 | `app/src/workspace/WorkflowTemplateStore.ts` | **新建**：store 类（`init`/`list`/`get`/`upsert`/`remove`）+ 单例 `getWorkflowTemplateStore()` + `WORKFLOW_TEMPLATES_TABLE` |
| 2 | `app/src/infrastructure/http/handlers/workflow-template-handlers.ts` | 删除内存 Map；5 个 handler 改为经 store 读写（语义不变） |
| 3 | `app/src/workspace/__tests__/WorkflowTemplateStore.test.ts` | **新建**：6 用例（含**跨实例持久化**验证） |
| 4 | `.trae/docs/api-spec.md` | 补齐 5 个模板端点条目（原先缺失，触碰即补） |

## 5. 验证方案

| 项 | 通过标准 |
|---|---|
| 类型/架构 | `bun run typecheck` 0；`lint-architecture.ts` 0 |
| 单测 | store 6 用例通过，含**跨实例持久化**（新建 store 读同一 DB 仍能取到 → 证明落盘） |
| 残留 | 全仓 `userTemplates` → 仅剩注释引用，无代码残留 |
| 回归 | `src/workspace/__tests__` + `src/modules/__tests__` + `src/session/storage/__tests__` 全绿 |
| HTTP 端到端 ✅ **实测通过（2026-09-13）** | 起 `--http-only` 服务（隔离 `LIRI_HOME` + 非默认端口 18991）跑通：POST **201**（服务端生成 id `user_*`）→ LIST **5** → GET **200** → PUT **200**（GET 复读已更新名）→ **重启进程后 LIST 仍 5（持久化实证）** → DELETE **200** `{success:true}` → GET **404** → 再 DELETE **404** → LIST 回到 **4**；内建保护 PUT `builtin:bug-fix` → **403** |
| ⚠ 未做 | 模板 ↔ Provider 绑定 |

## 6. 实施结果（2026-09-13 已完成）

| 文件 | 结果 |
|---|---|
| `workspace/WorkflowTemplateStore.ts` | ✅ 新建（复用 `AgentRoleStore` 模式：`resolveDbPath()` 默认注入、回调式 sqlite3、`init()` 幂等、`upsert` 用 `ON CONFLICT DO UPDATE`） |
| `infrastructure/http/handlers/workflow-template-handlers.ts` | ✅ 内存 Map 删除；`list`/`get`/`create`/`update`/`delete` 全部改经 store；`userTemplates` 残留 **0** |
| `workspace/__tests__/WorkflowTemplateStore.test.ts` | ✅ 新建，**6 pass / 0 fail**（init 幂等 / 字段完整往返 / **跨实例持久化** / get 命中与 null / 同 id 覆盖不产生重复行 / remove 首次 true 再次 false） |

**验证**：`bun run typecheck` exit 0；**107 单测 0 fail**（14 文件 360 断言）；定向 ESLint 0；`scripts/lint-architecture.ts` 0 错误 / 0 警告。

**未做（明确）**：模板 ↔ Provider 绑定。

**HTTP 端到端实测记录（2026-09-13）**：以隔离环境（`LIRI_HOME` 指向临时目录、端口 18991、`--http-only`）启动真实服务后逐项实测，结果见 §5 第 5 行；**重启后数据仍在**是关键断言。实测同时反证：临时环境下的 `data/app.db` 主文件仅 4096B（1 页），数据实际驻留在 `app.db-wal`（2.7MB）——该库处于 **WAL 模式**，未 checkpoint 前主文件不增长（SQLite 正常行为，非缺陷；但"只拷贝 app.db"会丢数据这一点值得运维留意）。测试结束已停止服务、删除临时 HOME，并核实**真实用户库 `~/.pyapp/data/app.db` 未被污染**（无 `workflow_templates` 表）。