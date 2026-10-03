# Spec：权限管理器同名双轨收敛（A3 / 组① T-①05）

> **来源**：`dev_docs/20261001/pending-tasks-consolidated-20261001.md` §1 ① **T-①05（A3）**。
> **原始出处**：会话导出 L4787 / L4521；`architecture-benchmark`。
> **状态（2026-10-03）**：**已立项取证**；T0 裁定待用户作答；T1 未开工。
> **前置**：无（D-157 收的是 `permission → sandbox` 另一条边，与本项正交）。

---

## 0. 一句话定性

`permission/PermissionManager.ts` 与 `security/PermissionManager.ts` **同名类并存**（两个独立实现的完整规则引擎），
且 **security 侧自述为"同步补充视图"**（与主模块共用规则存储）⇒ 属**同名双轨**（**非死码**：两侧均有生产消费者）。

---

## 1. 取证（回仓实测，2026-10-03）

`Grep "class PermissionManager"`（限 `app/src`）= **2 命中**。

### 1.1 `permission/PermissionManager.ts:72`（**主权限管理器**）

| 项 | 事实 |
|---|---|
| 单例 | `static instance: PermissionManager`（:73）；`getInstance()` :132；工厂 `createPermissionManager()` :1225 |
| 依赖 | `FineGrainedPermissionManager`(:64) · `SandboxIntegrationService`(:57) · `permissionMetrics`(:65) · OTel(`SpanStatusCode`/`metrics` :61) |
| 语义 | `mode`(默认 DEFAULT) · `defaultBehavior`（env `PERMISSION_DEFAULT_BEHAVIOR`，'allow'/'deny'）· `currentUserRole`（auth 登录注入，E↔A 打通） |
| 消费者 | `@modules/permission` barrel → `runtime/api/CoreAPIImpl.ts:102` · `tools/CodeRunner/CodeRunnerTool.ts:25` · `tools/security/ToolPermissionManager.ts:6` · `infrastructure/http/handlers/security-handlers.ts:9` · `auth-handlers.ts:25`（+`RoleType`）· `permission/PermissionService.ts:32` · 测试（`permission/__tests__/PermissionDecision.test.ts:11`、`tests/permission/PermissionCheckerInbox.test.ts:38`） |
| 定位 | **运行主体**（聊天工具执行门禁的异步决策链路） |

### 1.2 `security/PermissionManager.ts:118`（**security 侧补充视图**）

| 项 | 事实 |
|---|---|
| 单例 | `static instance: PermissionManager`（:119）；`getInstance()` :161；工厂 `createPermissionManager(defaultAllow)` :439 |
| 自持状态 | `rules: Map<string, PermissionRule>`(:120) · `defaultAllow: boolean`(:121) |
| 公共 API | `init`(:171) · `addRule`(:214) · `removeRule`(:223) · `checkPermission`(:238) · `checkToolPermission`(:276) · `checkFeaturePermission`(:288) · `checkResourcePermission`(:300) · `checkOperationPermission`(:312) · `checkCustomPermission`(:328) · `getRules`(:338) · `getRuleCount`(:345) · `getRule`(:353) · `updateRule`(:362) · `clearRules`(:379) · `exportRules`(:387) · `importRules`(:395) · `stop`(:405) · `getDefaultAllow`(:422) · `setDefaultAllow`(:430) |
| **自述定位** | :129-133 注释：**"主模块为异步决策链路（ChatManager 工具执行门禁），本管理器为 SecurityIntegration 的同步补充视图；两者共用同一规则存储，杜绝双实现规则不一致"**；`syncRulesFromMainModule()`(:134) 从主模块同步 deny 规则（P0-3，消"空壳恒放行"） |
| 消费者 | `security/SecurityIntegration.ts:9`（**仅** `getInstance()` :40 + `checkToolPermission()` :106）· `security/index.ts:83`（barrel 转出）· `security/CompleteSecuritySystem.ts:4`（`import type`）· docs（`API.md:698` / `DEVELOPMENT.md:553` 的 `getPermissionManager` 来自 `./src/security`） |
| 定位 | **同步补充视图**（唯一生产消费者 = `SecurityIntegration`） |

### 1.3 关键对比

| 维度 | A（permission/） | B（security/） |
|---|---|---|
| 实现 | 完整引擎 + 模式/角色/FineGrained/Sandbox/OTel | 完整引擎（自持 rules Map） |
| 规则存储 | 主存储（`permission_rules.json` 经 FineGrained/服务层） | 经 `syncRulesFromMainModule()` 单向同步 |
| 消费者 | 多处（CoreAPI/tools/http handlers/CLI 等） | **仅 `SecurityIntegration`** |
| 决策时序 | 异步决策链路 | **同步**补充 |

⇒ **两者不是"重复实现"**（B 的存在理由是**同步**视图），但**同名**使读者无法区分（`import { PermissionManager }` 来源不同、语义不同）⇒ 违反 `§1.12` 术语/命名清晰原则。

---

## 2. 定性（碎片）

| # | 碎片 | 事实 | 性质 |
|---|------|------|------|
| ① | **同名类并存** | A 与 B 均 `class PermissionManager`（含同名单例 `instance` + 同名工厂 `createPermissionManager()`） | 命名级 |
| ② | **B 的真实语义未在命名中体现** | B 自述"同步补充视图"，名字却是通用 `PermissionManager` | 命名级 |
| ③ | **同名工厂函数** | 两文件**各自导出 `createPermissionManager()`**（:1225 / :439）—— 同名不同语义，跨模块引用时极易混用 | 命名级 |

> **非死码**（与 T-①04/T-①07 的零可达类**不同**）：两侧均有生产消费者 ⇒ 处置应为**改名消歧**或**合并**，**不是**下线。

---

## 3. T0 裁定（**待用户作答**）

| 编号 | 决策项 | 选项 |
|:----:|--------|------|
| **D1** | **处置手法** | (a) **改名消歧**（保留双实现，B 改为能体现"同步补充视图"语义的名，如 `SecurityPermissionView`/`SyncedPermissionView`）；(b) **合并**（`SecurityIntegration` 改调 A 的同步面，删除 B —— 需先取证 A 是否有同步等价 `checkToolPermission`）；(c) 暂不动，仅登记 |
| **D2** | **工厂函数同名** | 随 D1 一并处理：A 保留 `createPermissionManager()`，B 改名（如 `createSecurityPermissionView()`）—— 是否同意 |
| **D3** | **barrel 出口** | `security/index.ts:83` 现转出 `PermissionManager`；改名后是否同步订正出口名（**建议是**，避免残留同名） |

---

## 4. 计划（T1 草拟，待 D1 定后细化）

| 步骤 | 内容 | 完成判据 |
|------|------|----------|
| T1-0 | 前置取证补全：① A 是否具备**同步** `checkToolPermission` 等价面（决定 D1(b) 可行性）；② `SecurityIntegration` 对 B 的**全部**方法/字段依赖（是否仅 `checkToolPermission`） | 逐项有 `Grep`/`Read` 证据 |
| T1-1 | 依 D1 执行（改名 or 合并） | `Grep "class PermissionManager"`（限 `app/src`）**仅剩 1 处** |
| T1-2 | 依 D2 处理同名工厂；依 D3 订正 barrel | 全仓无"同名不同语义"的 `createPermissionManager` |
| T1-3 | 测试与验收 | 见 §7 |

---

## 5. 未取证（T1-0 负责关闭）

| # | 项 | 现状 |
|---|----|------|
| 1 | A 是否有**同步** `checkToolPermission`（决定能否合并） | 未取证（A 注释称其为"异步决策链路"，但方法签名未读） |
| 2 | `SecurityIntegration` 是否只用 B 的 `checkToolPermission` | 已见 :106 一处，未穷尽 |
| 3 | `security/CompleteSecuritySystem.ts:4` 的 `import type` 用途 | 未读 |
| 4 | `docs/` 中的 `getPermissionManager`（来自 `./src/security`）指向哪个 | 未读（可能是 B 的工厂封装） |

---

## 6. 影响面（初估）

| 类别 | 内容 |
|------|------|
| 改名（若 D1=a） | `security/PermissionManager.ts`（类 + 单例 + 工厂 + 文件头注释）· `security/index.ts:83`(barrel) · `security/SecurityIntegration.ts:9,40` · `security/CompleteSecuritySystem.ts:4`(type) · 文档 2 处 |
| 合并（若 D1=b） | 上述 + 删除 `security/PermissionManager.ts`（若 A 提供同步等价面） |
| **不动** | A（主权限管理器）的全部运行时行为、`permission_rules.json` 存储格式、HTTP 路由契约 |

---

## 7. 验收（可证伪）

1. `Grep "class PermissionManager"`（限 `app/src`）**仅剩 1 处**；
2. 全仓无"同名不同语义"的 `createPermissionManager`（或已按 D2 区分）；
3. `app typecheck` **0**；`lint:arch` **0 错**（警告回基线）；
4. 全量 `bun test tests/` **0 fail**；
5. **防回退**：`security/index.ts` barrel 不残留旧名。

---

## 8. 合规（对照 workspace rules）

| 规则 | 落点 |
|------|------|
| `CS01` 归一化 | 先取证两侧语义是否真不同（§1.3）——**本项已据证据判定"非重复、是同步视图"**，故不照搬"下线"手法 |
| `CS02` 状态检测禁止字符串匹配 | 命名消歧依据**类型事实**，非用户可见字符串 |
| `CS03` 回退最小化 | 改名/合并不得留双名兼容层 |
| `CS06` 证据驱动 | §1 每条附 `文件:行号`；未取证项入 §5 |

---

## 9. 实施记录

| 日期 | 事件 | 备注 |
|---|---|---|
| 2026-10-03 | **立项 + 取证**（本次提交） | 回仓实测 2 个同名 `PermissionManager`（`permission/:72` 主管理器 · `security/:118` 同步补充视图）；**定性为同名双轨（非死码）**；同名工厂 `createPermissionManager()` 各一份。**T0 裁定待用户作答**（D1–D3） |

（后续每步由实施者注明提交号、各步验证输出、以及 §5 各"未取证"项的实测结论。）
