# Spec：统一安全决策词汇（Security Verdict）

> 版本 1.0 ｜ 创建 2026-10-10 ｜ 状态：**S1 ✅ / S2 ✅**
> **来源**：`dev_docs/20261010/升级优化方案-20261010.md` §3 **P0-3**（对应核验项 S-5/S-6）
> **关联规则**：GR15（Spec-Driven）· CS01（归一化先查已有）· CS02（状态检测禁字符串匹配）· CS03（不做死抽象）· R02-002（类型单一来源）· R07-2（安全开关默认值固化）· `code-deletion.md`

---

## 1. 问题（根因）

外部审查（专项 A）指出两处 `INDETERMINATE → ALLOW` 隐性折叠，且本仓**无统一安全决策词汇**：

1. **无统一词汇**：现存**异构多套**表示 —— `SecurityBehavior='allow'|'deny'|'ask'`（`security/types.ts:27`）· `requireApproval` 布尔（`BashTool`）· `CodeRunStatus`（`CodeRunner/types.ts:96`）；且 `SecurityDecision` **接口重复定义**（`security/types.ts:51` 与 `SecurityIntegration.ts:22`）。
2. **`js_ast` 深扫静默降级（fail-open 盲区）**：`CodeRunner/staticValidation.ts:164-165` 原生扫描器不可用时**整段跳过**；`CodeValidationResult` 仅 `{ok,issues}`（`CodeRunner/types.ts:78-81`）⇒ 调用方**无法区分"未扫描"与"扫描通过"** ⇒ 等价于把 INDETERMINATE 折叠为 ALLOW。

---

## 2. 范围决策

- **做**：① 新增统一四态词汇 `SecurityVerdict`（`ALLOW`/`DENY`/`REQUIRE_REVIEW`/`INDETERMINATE`）+ 既有三态映射 + 多层合并（取最严）；② 去重 `SecurityDecision` 接口；③ `CodeValidationResult` 增 `scanStatus`（`ran`/`skipped`/`failed`），使"深扫未完成"**可识别**；④ code_run 深扫未完成时**不得落入 ALLOW**（灰度开关 `CODE_RUN_DEEP_SCAN_STRICT`，默认关 = 零行为变更）。
- **不做**（诚实边界）：
  - **不做**全仓 `SecurityBehavior` → `SecurityVerdict` 的破坏性迁移（波及 39+ 文件；参照 v0.4.70 去 `any` 评估）——本版仅**新增**统一词汇并提供**纯函数映射**，旧表示保持。
  - **不新建**审批交互链（code_run 的 `REQUIRE_REVIEW` 映射为**拒绝并给出可读原因**，非弹卡）。
  - **不默认开启**收紧姿态（`CODE_RUN_DEEP_SCAN_STRICT=false`）——默认翻转归 `P2-4` 灰度复评裁定。

---

## 3. 设计

### 3.1 `security/decision.ts`（新增，单一事实源）

```ts
export type SecurityVerdict = 'ALLOW' | 'DENY' | 'REQUIRE_REVIEW' | 'INDETERMINATE';
export type DeepScanStatus = 'ran' | 'skipped' | 'failed';

verdictFromBehavior(behavior: SecurityBehavior): SecurityVerdict   // allow→ALLOW / deny→DENY / ask→REQUIRE_REVIEW
combineVerdicts(vs: readonly SecurityVerdict[]): SecurityVerdict   // 取最严；空 ⇒ INDETERMINATE（保守）
isPermissive(v): boolean                                            // 仅 ALLOW
verdictFromScanStatus(status: DeepScanStatus, strict): SecurityVerdict
  // ran ⇒ ALLOW；skipped|failed ⇒ strict ? REQUIRE_REVIEW : INDETERMINATE
```

**严格度序**：`DENY(3) > REQUIRE_REVIEW(2) > INDETERMINATE(1) > ALLOW(0)`（**单调**：合并只收紧、不放宽）。

### 3.2 去重 `SecurityDecision`

`security/types.ts` 为唯一来源；`SecurityIntegration.ts` 改为**再导出**（删本地重复定义）。

### 3.3 `CodeValidationResult.scanStatus`

新增**必填**字段 `scanStatus: DeepScanStatus`（`CodeRunner/types.ts`），由 `validateCodeRunnerCode` 在**每条返回路径**写入：
- 语法门禁提前返回 ⇒ `skipped`（尚未到第 5 步）；
- 第 5 步：`nativeScanner` 缺失 ⇒ `skipped`；`scan.ok===false`/抛错 ⇒ `failed`；成功 ⇒ `ran`。

### 3.4 code_run 策略（`CodeRunnerTool`）

`resolveDeepScanVerdict(validation.scanStatus, feature('CODE_RUN_DEEP_SCAN_STRICT'))`：
- `ALLOW` ⇒ 照常执行；
- 否则（`INDETERMINATE` 或 `REQUIRE_REVIEW`）⇒ **不落入 ALLOW**；`REQUIRE_REVIEW` 时返回 `security-rejected`（含 `scanStatus` + 可读原因），`INDETERMINATE`（默认姿态）⇒ 照常执行但**结果显式带出 `scanStatus`**（可观测）。

---

## 4. 规则合规 Checklist

| 规则 | 落点 |
|---|---|
| CS01 | 复用既有 `SecurityBehavior`/`CodeValidationResult`，不新建第二套状态机 |
| CS02 | `scanStatus`/`SecurityVerdict` 为**枚举**，非用户可见字符串匹配 |
| CS03 | 不加投机抽象；策略为单一纯函数；默认姿态零行为变更 |
| R02-002 | `SecurityDecision` 单一来源（`security/types.ts`） |
| R07-2 | 新开关 `CODE_RUN_DEEP_SCAN_STRICT`（默认 `false`）**同批**更新 `featureFlags.ts` + `SAFETY_SWITCHES` + `project_rules §1.4` + 默认关登记表 |
| §1.6 | 不新增"模型可见输入"事件 ⇒ 无需新增事件类型（本版仅结构化结果字段） |

---

## 5. 验收

- **① 可区分**：原生缺失 ⇒ `scanStatus='skipped'`；原生解析失败 ⇒ `'failed'`；正常 ⇒ `'ran'`（用例覆盖三态）。
- **② 不折叠**：`combineVerdicts(['ALLOW','INDETERMINATE']) === 'INDETERMINATE'`；`combineVerdicts([]) === 'INDETERMINATE'`；`isPermissive('INDETERMINATE') === false`。
- **③ 默认零行为变更**：`CODE_RUN_DEEP_SCAN_STRICT=false` ⇒ 深扫 `skipped` 时 code_run 仍按原行为执行（但结果含 `scanStatus`）。
- **④ 收紧生效**：开关开 + `skipped`/`failed` ⇒ `status='security-rejected'`（明确原因），**不执行**。
- **⑤ 去重**：`SecurityIntegration.ts` 无重复 `SecurityDecision` 定义，`typecheck` 通过。
- 回归：`typecheck`（3 tsconfig）· `tests/tools` · `tests/security` 全绿；`lint:arch` 0 错；`lint:doc-code` 通过（新开关三处一致）。

---

## 6. 实施记录

| 切片 | 内容 | 落点 | 状态 |
|---|---|---|---|
| **S1** | 统一词汇 `decision.ts` + `SecurityDecision` 去重 + `scanStatus` 字段与写入 | `security/decision.ts`（新）· `security/types.ts` · `security/SecurityIntegration.ts` · `tools/CodeRunner/types.ts` · `tools/CodeRunner/staticValidation.ts` | ✅ 2026-10-10 |
| **S2** | code_run 策略接线 + 灰度开关（`CODE_RUN_DEEP_SCAN_STRICT`，默认关）+ R07-2 三处同步 + 用例 | `tools/CodeRunner/CodeRunnerTool.ts` · `core/featureFlags.ts` · `scripts/check-doc-code-consistency.js` · `project_rules.md §1.4` · `default-off-switches-review-gates.md` · `tests/security/securityVerdict.test.ts` | ✅ 2026-10-10 |
