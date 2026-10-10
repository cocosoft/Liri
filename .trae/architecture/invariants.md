# Liri 架构不变量规范（Invariants）

> 版本 1.0 ｜ 创建 2026-10-10 ｜ 权威范围：**系统必须始终成立的行为约束**
> 机器可读单一事实源：[`invariant-registry.json`](./invariant-registry.json)（本文件为其**人读版**）
> 关联规则：`AGENTS.md`（规则入口）· `.trae/rules/architecture-compliance.md` · `.trae/rules/code-deletion.md`（CD01–CD07）· `development-workflow.md`（GR15）
> 来源：`dev_docs/20261010/升级优化方案-20261010.md` §3 **P1-1**（外部 §③ 文档治理建议的本仓化落地）

---

## §0 三条硬原则（本文件的自我约束）

1. **文档不自证**：任何不变量都**不能仅凭本文件存在**而被视为已执行 —— 必须映射到**源码落点**与**验证落点**，由 CI 门禁（P1-2）校验其可解析。
2. **不把理想写成现状**：每条不变量标注 `status`（`verified` / `partial` / `gap`）—— `gap` = **治理缺口**（尚无自动化验证），**不得**默认已受保护。
3. **唯一事实源**：不变量语义以本文件为准；`Execution` 状态机以 `.trae/specs/execution-lifecycle-ownership.md` 为准；安全开关默认值以 `.trae/rules/project_rules.md §1.4` 为准。三者**互相引用，不各自维护第二套规则**。

---

## §1 验证级别（level）

| 级别 | 含义 |
|---|---|
| `static` | 静态结构 / 编译期 / 依赖方向检查 |
| `unit` | 单元测试 |
| `integration` | 集成测试（跨组件契约） |
| `fault-injection` | 崩溃 / 竞态 / 重启 / 故障注入 |
| `e2e-security` | 真实执行链路 / 内核沙箱的安全端到端 |

> **只有完成了相应级别的验证**，才可标 `verified`；覆盖不完整标 `partial`；无验证手段标 `gap`。

---

## §2 不变量清单

| ID | 不变量 | 级别 | 状态 | 源码落点 | 验证落点 |
|---|---|---|:--:|---|---|
| **INV-EXEC-001** | 执行所有权唯一（绝不双 RUNNING） | unit | ✅ verified | `execution/ExecutionManager.ts` | `tests/execution/ExecutionManager.test.ts` · `executionReviewBatchB.test.ts` |
| **INV-EXEC-002** | Generation fencing（迟到提交被拒） | fault-injection | ✅ verified | `execution/ExecutionManager.ts` | `executionReviewBatchB.test.ts` · `processCrashInjection.test.ts` |
| **INV-EXEC-003** | 终态不可逆 | unit | ✅ verified | `execution/types.ts` | `tests/execution/ExecutionManager.test.ts` |
| **INV-EXEC-004** | 取消语义（取消请求 ≠ 进程已退出） | unit | ✅ verified | `execution/ExecutionManager.ts` | `executionReviewBatchB.test.ts` · `processCrashInjection.test.ts` |
| **INV-EXEC-005** | 未结算执行有恢复策略 | fault-injection | ✅ verified | `execution/ExecutionManager.ts` | `recoveryFaultInjection.test.ts` · `processCrashInjection.test.ts` |
| **INV-EXEC-006** | 执行入口契约一致（渠道 / 客户端） | unit | ⚠️ partial | `channels/routing/messageRouter.ts` · `infrastructure/http/handlers/chat-handlers.ts` | `tests/chat/chatManagerToolLedgerFailClosed.test.ts` |
| **INV-RECOVERY-001** | 恢复可重复执行（幂等） | fault-injection | ✅ verified | `execution/ExecutionManager.ts` | `specialCResilience.test.ts` · `processCrashInjection.test.ts` |
| **INV-RECOVERY-002** | 写前记账先于副作用（fail-closed） | unit | ✅ verified | `execution/ExecutionManager.ts` · `chat/ChatManager.ts` | `tests/chat/chatManagerToolLedgerFailClosed.test.ts` |
| **INV-RECOVERY-003** | 未知副作用不得无条件重放 | unit | ✅ verified | `tools/toolEffects.ts` | `tests/tools/toolRecoveryPolicy.test.ts` |
| **INV-EVENT-001** | 事件序号并发唯一 | integration | ✅ verified | `execution/ExecutionStore.ts` | `tests/execution/specialCResilience.test.ts` |
| **INV-EVENT-002** | 事件类型三处同批（编译期强制） | static | ✅ verified | `shared/events/eventNames.ts` · `session/types/eventPayloads.ts` · `session/types/knownEventTypes.ts` | `tests/chat/eventTypeParity.test.ts` |
| **INV-SEC-001** | 最终执行安全一致（跨层单调） | integration | ✅ verified | `tools/bash/BashTool.ts` | `tests/security/crossLayerSecurityConsistency.test.ts` |
| **INV-SEC-002** | 审批有效性 | unit | ✅ verified | `tools/bash/BashTool.ts` · `permission/ApprovedCommandRegistry.ts` | `crossLayerSecurityConsistency.test.ts` · `bashSecuritySwitchDefaults.test.ts` |
| **INV-SEC-003** | 沙箱边界由运行时强制执行 | e2e-security | ⚠️ partial | `sandbox/landlock/runWithLandlock.ts` · `tools/bash/bashLandlockExec.ts` | `sandbox/negativeEnforcement.test.ts` · `spawnPathRestrictions.test.ts` |
| **INV-SEC-004** | 深扫未完成不得折叠为放行 | unit | ✅ verified | `tools/CodeRunner/staticValidation.ts` · `security/decision.ts` | `tests/security/securityVerdict.test.ts` |
| **INV-ARCH-001** | SPI 装配顺序约束 | unit | ✅ verified | `entrypoints/spiWiring.ts` · `core/spi/wiringGuard.ts` | `tests/core/spiWiringOrder.test.ts` |

> 路径相对**仓库根**；源码路径省略 `app/src/` 前缀（除 `shared/` 外）。完整路径见 `invariant-registry.json`。

---

## §3 治理缺口（`gap` / `partial`）—— 如实登记，不粉饰

| ID | 缺口 | 处置（触发条件） |
|---|---|---|
| **INV-EXEC-006** | 客户端路径的 **handler 级**行为（记账/终态结算/断开结算）无自动化用例 | 翻转 `CLIENT_STREAM_EXECUTION` 默认值前**必须**补 HTTP harness 用例（见 `.trae/specs/client-stream-execution.md §5.1`） |
| **INV-SEC-003** | 沙箱真实负向验证受**平台/opt-in 门控**（Linux+helper / `PERMISSION_SHIELD_E2E=1`） | ✅ **P1-6 已落地**：CI `sandbox-negative` job（ubuntu-latest 构建 helper + `SANDBOX_NEGATIVE_REQUIRE=1` ⇒ **环境不满足即失败**，不得静默跳过）；**跨平台无强隔离后端**仍属边界（**P2-4** 记入 `security-boundaries`） |

---

## §4 ADR / 设计决策索引（由既有 `.trae/specs/` 承担）

> 本仓**不另建** `docs/architecture/adr/` —— 既有 `.trae/specs/`（150+）已承担"背景 / 决策 / 替代方案 / 验收 / 实施记录"职能。
> 下表仅为**不变量 ↔ spec** 的索引（避免重复维护）：

| spec | 覆盖不变量 |
|---|---|
| `.trae/specs/execution-lifecycle-ownership.md` | INV-EXEC-001/002/003/004 |
| `.trae/specs/durable-execution.md` | INV-RECOVERY-001/002 · INV-EVENT-001 |
| `.trae/specs/process-crash-injection.md` | INV-EXEC-005 · INV-RECOVERY-001 |
| `.trae/specs/unknown-tool-call-recovery.md` | INV-RECOVERY-003 |
| `.trae/specs/client-stream-execution.md` | INV-EXEC-006 |
| `.trae/specs/security-decision-verdict.md` | INV-SEC-004 |
| `.trae/specs/bash-security-9th-review-hardening.md` | INV-SEC-001/002 |
| `.trae/specs/ast-family-phased-plan.md` | INV-SEC-003 |
| `.trae/specs/shared-event-name-single-source.md` | INV-EVENT-002 |
| `.trae/specs/kernel-style-architecture-governance.md` | INV-ARCH-001 |

---

## §5 变更时必须复查本文件的情形

- 修改**执行状态机 / 所有权 / 取消 / 恢复** ⇒ 复查 `INV-EXEC-*` / `INV-RECOVERY-*`；
- 修改**事件类型 / 载荷 / 序号** ⇒ 复查 `INV-EVENT-*`；
- 修改**安全门禁 / 审批 / 沙箱 / 深扫** ⇒ 复查 `INV-SEC-*`（并同步 `project_rules §1.4` 安全开关表）；
- **新增执行入口** ⇒ 复查 `INV-EXEC-006`（并登记 `.trae/architecture/execution-entrypoints.md`，P1-3）。

> 门禁（P1-2）：`scripts/lint-invariants.ts` 校验本注册表**每条** `sources`/`tests` 路径**存在**；
> `status=gap` 的项**必须**在 §3 缺口表出现（防"缺口被遗忘"）。

---

## §6 安全边界（跨平台隔离姿态，P2-4）

> **口径**：本节**如实**声明各平台**实际**具备的隔离能力 —— 用于防止两种虚假宣称：
> ①把"沙箱能力存在"说成"运行时不可越权"；②把"默认关"说成"已启用"。
> 复评裁定见 `.trae/specs/default-off-switches-review-gates.md §2.3`；门禁见 P1-6（`sandbox-negative` job）。

| 维度 | Linux | Windows / macOS | 依据 |
|---|:--:|:--:|---|
| **内核级隔离**（Landlock） | ✅ 可用（内核 5.13+ + `landlock-run` helper） | ❌ **无强隔离后端** | `sandbox/landlock/{LandlockDetector,runWithLandlock}.ts` |
| **bash 内核沙箱** | ⚠️ **默认关**（`sandbox.landlock.bashEnabled=false` ⇒ 默认仅**静态检查**） | ❌ 不可用 | `sandbox/landlock/config.ts` `DEFAULT_LANDLOCK_CONFIG` · R25 |
| **code_run 内核沙箱** | ✅ 启用（`landlock.enabled=true`）且**网络全禁**（`--net-deny`） | ❌ 不可用（降级为进程级限制） | `tools/CodeRunner/LinuxSandboxRunner.ts` |
| **文件系统收窄**（路径检查 / PathShield） | ✅ | ✅（跨平台） | `sandbox/utils/PathRestrictions.ts` · `pathShield*` |
| **最终环境清洗**（敏感键 / 执行控制键剥离） | ✅ | ✅（跨平台） | `security/sensitiveEnv.ts` · `INV-SEC-002` |
| **真实内核负向验证** | ✅ CI 强制（`sandbox-negative` job，见 P1-6） | — | `.github/workflows/ci.yml` |

**红线（不得违反的宣称）**：

1. **不得**在 Linux 之外宣称"运行时不可越权"—— 该平台**只有**静态检查 + 路径收窄；
2. **不得**在 bash 路径宣称"已受内核沙箱保护"—— `bashEnabled` **默认关**（翻转须经用户裁定，见 §2.3）；
3. **不得**把"沙箱类被调用"当作"越权被拒绝"的证据 —— 须有**真实文件/进程结果**断言（`INV-SEC-003`）。
