# Spec：权限管理器同名双轨收敛（A3 / 组① T-①05）

> **来源**：`dev_docs/20261001/pending-tasks-consolidated-20261001.md` §1 ① **T-①05（A3）**。
> **原始出处**：会话导出 L4787 / L4521；`architecture-benchmark`。
> **状态（2026-10-03）**：✅ **已完成**（T1-1~T1-3 执行；§7 五项验收达成）。遗留见 §7 末（① security 侧工厂 0 消费者 ② 预存文档错误）。
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

**裁定结果（2026-10-03，用户已答）**：D1 **改名消歧** · D2 **随 D1 一并改名工厂** · D3 **同步订正 barrel 出口**。

⇒ 因 D1 选**改名**（非合并），§5-#1「A 是否有同步 `checkToolPermission`」**不再阻塞**本项（合并路径未采用）。

---

## 4. 计划（T1 草拟，待 D1 定后细化）

| 步骤 | 内容 | 完成判据 |
|------|------|----------|
| T1-0 | ✅ **已关闭（D1=a 下不再需要）**：合并路径未采用 ⇒ 无需取证 A 的同步 `checkToolPermission` 等价面 | ✅ 说明见 §3 裁定结果 |
| T1-1 | ✅ **已完成（2026-10-03）**：`security/PermissionManager.ts` 类 `PermissionManager` → **`SecurityPermissionView`**（含 private static `instance` 与 `getInstance()` 同步改名 + 类头 JSDoc 标注改名理由） | ✅ `Grep "class PermissionManager"`（限 `app/src`）**仅剩 1 处**（主管理器） |
| T1-2 | ✅ **已完成（2026-10-03）**：工厂 `createPermissionManager` → **`createSecurityPermissionView`**（D2）· barrel `security/index.ts:83` 改为转出 `SecurityPermissionView`（D3）· 消费者订正 3 文件（`SecurityIntegration.ts` 导入/字段/单例/返回类型 · `CompleteSecuritySystem.ts` import type + 2 处返回类型） | ✅ 全仓无同名不同语义的 `createPermissionManager`（security 侧工厂本为 **0 消费者**，改名后仍仅定义处）；`typecheck 0` |
| T1-3 | ✅ **已完成（2026-10-03）· 测试与验收** | §7 五项**逐项达成**；结论落 §7 + §9 |

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

> **2026-10-03 验收结论（T1-1~T1-3 执行后逐项核对）**

1. `Grep "class PermissionManager"`（限 `app/src`）**仅剩 1 处**；
   **✅ 达成**：仅剩 `permission/PermissionManager.ts:72`（主管理器）；security 侧为 `class SecurityPermissionView`。
2. 全仓无"同名不同语义"的 `createPermissionManager`（或已按 D2 区分）；
   **✅ 达成**：security 侧工厂改为 `createSecurityPermissionView`（原工厂本就 **0 消费者**，改名后仍仅定义处）；`permission` 侧保留 `createPermissionManager()`（多方消费者）。
3. `app typecheck` **0**；`lint:arch` **0 错**（警告回基线）；
   **✅ 达成**：`typecheck 0`；`lint:arch` 0 错 / 警告 2（基线）；文件数不变（**3848**，纯改名）。
4. 全量 `bun test tests/` **0 fail**；
   **✅ 达成**：**3821 pass / 9 skip / 0 fail**（与改名前一致，无回归）。
5. **防回退**：`security/index.ts` barrel 不残留旧名。
   **✅ 达成**：`:83` 已改为转出 `SecurityPermissionView`。

> **遗留（如实登记）**：① `security/` 侧工厂 `createSecurityPermissionView` 仍 **0 消费者**（改名前即如此，非本次引入）——是否下线待另行裁定；② **预存文档错误**：`app/docs/API.md:698` / `app/docs/DEVELOPMENT.md:553` 从 `./src/security` 导入 `getPermissionManager`/`getSandboxManager`/`getSecurityAudit`，但 `security/index.ts` **并未导出**这三者（`SandboxManager` 已于早前删除、`getPermissionManager` 是 `SecurityIntegration` 的**方法**而非模块导出）⇒ 文档示例失效，**不在本项范围**，另行登记。

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
| 2026-10-03 | **T0 裁定**（用户已答） | D1 改名消歧 · D2 随 D1 一并改名工厂 · D3 同步订正 barrel 出口 |
| 2026-10-03 | **T1-0 关闭**（D1=a 下不再需要） | 合并路径未采用 ⇒ 无需取证 A 的同步 `checkToolPermission` 等价面（§5-#1 不再阻塞） |
| 2026-10-03 | **T1-1/T1-2 已完成：改名消歧 + 工厂/barrel/消费者订正**（本次提交） | `security/PermissionManager.ts`：`class PermissionManager` → **`SecurityPermissionView`**（+ private static `instance` / `getInstance()` 同步改名 + 类头 JSDoc 标注理由）；工厂 `createPermissionManager` → **`createSecurityPermissionView`**；barrel `security/index.ts:83` 同步订正；消费者订正 3 文件（`SecurityIntegration.ts` 导入/字段/单例/返回类型 · `CompleteSecuritySystem.ts` import type + 2 返回类型）。**文件路径保留**（沿 T-①07/T-①04 手法）。**验证**：`Grep "class PermissionManager"`（限 `app/src`）**仅剩 1 处**（主管理器）· `typecheck 0` · `lint:arch` 0 错 / 警告回基线 2 / 文件数 **3848** 不变（纯改名） |
| 2026-10-03 | **T1-3 已完成：测试与验收（T-①05 收尾）**（本次提交） | §7 五项**逐项达成**（判据见 §7）。**验证**：全量 **3821 pass / 9 skip / 0 fail**（与改名前一致，无回归）。**遗留**：① `createSecurityPermissionView` 仍 0 消费者（改名前即如此）；② 预存文档错误（`docs/API.md:698`/`DEVELOPMENT.md:553` 导入 `security` 未导出的符号） |

（后续每步由实施者注明提交号、各步验证输出、以及 §5 各"未取证"项的实测结论。）
