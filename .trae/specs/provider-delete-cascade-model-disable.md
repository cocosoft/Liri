# Spec：删除供应商时级联处理强绑定模型（N-59 根治）

- **状态**：**已实施并验证**（2026-09-20；用户评审通过后实施，V1-V5 全通过）
- **关联台账**：N-59（孤儿模型「大瓦特私有化(Agent)」绑定的供应商已被删除）
- **触发背景**：切换会话时模型恢复 400：`模型 246676332 的供应商 (1490b517-…) 未找到或未启用`（[ModelRuntimeAPI.ts:507](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/api/ModelRuntimeAPI.ts#L507)）。

## 1. 已核实证据

| 事实 | 证据 |
|------|------|
| 供应商**确实已被删除** | `ai_providers` 表共 **7 行**，无 `1490b517-3a07-4d34-8c6c-01e682b94407` |
| 模型记录**残留且仍启用** | `model_registry`：`id=887dffa1-…`、`model_id=246676332`、`display_name=大瓦特私有化(Agent)`、`provider_id=1490b517-…`、**`enabled=1`**、`is_custom=1` |
| 删除链路**无级联** | [ProviderManager.ts:577-589](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/providers/ProviderManager.ts#L577-L589) `deleteProvider` 仅执行 `DELETE FROM ai_providers WHERE id = ?` |
| 既有补录机制**覆盖不到本例** | [ModelManagementBootstrap.ts:221-248](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/ModelManagementBootstrap.ts#L221-L248) `ensureReferencedProviders` 按 **provider_type** 比对并只对 `REFERENCED_PROVIDER_PRESETS` 内的类型补录，`:246` 注释明写"未知类型（如自定义 UUID 的 provider）跳过" |
| 影响面（仅 1 个真孤儿） | `model_registry` 17 行中 `provider_id` 不在 `ai_providers` 的有 4 行，但另 3 行（`deepseek-v4-pro`/`-flash`/`llama3.1-8b`）存的是 **provider_type**，由 [ModelRuntimeAPI.ts:497-502](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/api/ModelRuntimeAPI.ts#L497-L502) 的 `getByType` 兼容分支解析，**非缺陷** |

**两种绑定形态（设计必须区分）**：
- **强绑定**：`model_registry.provider_id = <provider UUID>`（自定义供应商场景）—— 供应商删除即失效
- **松绑定**：`model_registry.provider_id = <provider_type>`（如 `deepseek`）—— 只要**同类型仍有任一 provider** 即可解析，删除单个 UUID 供应商**不应**影响它

## 2. 目标与非目标

**目标**：删除供应商时，不再留下"引用不存在供应商且仍 `enabled=1`"的强绑定模型；存量同类数据一次性收敛。

**非目标**：不删除**结构**（项目硬约束：仅允许新增/修改字段）；不删除用户的模型**数据行**（只停用，保留用户重绑/删除的选择）；不改松绑定（type 形式）的解析逻辑；不做"删除供应商前强制用户先处理模型"的阻塞式校验（本次选自动停用 + 明示）。

## 3. 改动方案

1. **`ProviderManager.deleteProvider(id)`**（机制修复，主改动）
   - 删除前查出**强绑定**该供应商的模型：`SELECT id, model_id, display_name FROM model_registry WHERE provider_id = ?`（参数为 provider UUID）
   - 删除供应商行后，对上述模型 `UPDATE model_registry SET enabled = 0, updated_at = ?`（**停用而非删除**）
   - 日志：`供应商已删除: <name> (<id>)；同时停用 N 个强绑定模型: [<model_id>…]`
   - **保持返回类型 `Promise<boolean>` 不变**（避免破坏 [ProviderAPI.ts:203](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/api/ProviderAPI.ts#L203) 与 [provider.ts:340](file:///e:/PY/Documents/CODES/PY_APP/app/src/commands/provider/provider.ts#L340) 两处调用点）
   - **同批新增** `getModelsBoundToProvider(id): Promise<ModelRef[]>`（只读），供 API 层在删除前取清单
2. **`ProviderAPI` 删除 handler**（[ProviderAPI.ts:203](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/api/ProviderAPI.ts#L203) 附近）
   - 删除前调用 `getModelsBoundToProvider(id)`，响应体增加 `disabledModels: string[]`（模型显示名或 model_id），使调用方可提示"已同时停用 N 个模型"
3. **存量一次性收敛**（`ModelManagementBootstrap`，复用既有自检钩子模式）
   - 新增自检（与 `ensureReferencedProviders` 并列、同样在启动时执行、同样幂等）：扫描 `model_registry` 中 **`provider_id` 形如 UUID 且不在 `ai_providers`** 的记录，将它们 `enabled = 0` 并记 `warn` 日志（含清单）
   - **只处理 UUID 形态**（强绑定），不碰 type 形态（松绑定，见 §1）
   - 幂等性：仅当 `enabled=1` 时才 UPDATE，重复启动无写放大
4. **前端消费 `disabledModels`**（2026-09-20 追加，用户批准）：
   - `client/src/services/providerService.ts`：`remove(id)` 由 `Promise<void>` 改为返回 `{ disabledModels: string[] }`
   - `client/src/stores/modelAdminStore.ts`：`deleteProvider` 返回 `string[]`（失败时空数组）
   - `client/src/components/views/ModelPage.tsx`：`handleDelete` 在 `disabledModels.length > 0` 时用**既有** `toastStore.toastWarning` 提示；i18n 新增 `settings.modelDeleteProviderDisabledModels`（zh/en 同步）
   - 复用既有 `toastStore` 而非 `useToast` hook（ModelPage 已在用前者，CS01 归一化）

## 4. 风险与对策

| 风险 | 对策 |
|------|------|
| 误伤松绑定模型（type 形式） | 判据严格限定"**UUID 形态** 且 不在 `ai_providers`"；type 形式显式排除 |
| 用户随后重建同名供应商 → 模型仍停用 | 属预期（停用可逆、数据保留）；用户可在模型管理重新启用或重绑 |
| 存量自检自动改用户数据 | 仅改为 `enabled=0`（**非删除**、可逆）；与既有 `ensureReferencedProviders` 的"自动写 DB"属同一既有约定；日志留痕 |
| ~~停用导致模型从列表消失~~ **已查证不成立** | [ModelRuntimeAPI.ts:179-181](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/api/ModelRuntimeAPI.ts#L179-L181) 的纳入判据是"**是否有匹配的活跃供应商**"（`if (!matchingProvider) continue;`），**不按 `enabled` 过滤**；`enabled` 仅原样透传（`:192-193`）⇒ 停用不会让"有供应商"的模型从列表消失 |
| 同类型多供应商 | 仅对 UUID 强绑定生效，天然不受影响 |

## 5. 验证结果（2026-09-20，V1-V5 全通过）

- **V1 机制（实测）**：创建自定义供应商（`afc40ab0-…`）+ 强绑定模型（`17cf7cc2-…`，`enabled=1`）→ `DELETE /v1/providers/afc40ab0-…` → 响应 `{"success":true,"disabledModels":["N59 Test Model"]}` ✓；DB 断言：模型 `enabled` **1 → 0**、供应商行已消失（`ai_providers` 中该 id 查询为空）✓；日志含"同时停用 1 个强绑定模型"✓
- **V2 不误伤（实测）**：`model_registry` 中 `provider_id='deepseek'`（**provider_type 松绑定**）的 `deepseek-v4-flash` 在删除自定义供应商前后 **`enabled` 恒为 1** ✓
- **V3 存量 + 幂等（实测）**：重启后启动自检生效 —— 现存孤儿 `887dffa1-…`（大瓦特私有化，`provider_id=1490b517-…` 已不存在）**`enabled` 1 → 0** ✓，日志 warn 逐字为 `检测到 1 个模型强绑定的供应商已不存在，已自动停用: [246676332]（可逆：在模型管理重新绑定供应商后重新启用）`；**再次重启后该 warn 0 匹配**（幂等，无重复写）✓
- **V4 回归**：app `typecheck` **EXIT=0**；全量 `bun test` **2856 pass / 19 skip / 0 fail** ✓（与改动前基线一致）
- **V5 边界（实测）**：删除不存在的供应商 id → **HTTP 404** ✓；创建后立即删除**无模型引用**的供应商 → 响应 `{"success":true,"disabledModels":[]}`（无多余 UPDATE）✓
- **测试数据已清零**：`ai_providers` 回到 **7 行**、`model_registry` 仍 **17 行**、`model_id LIKE 'n59-test-%'` 为 **0 行** ✓（孤儿模型的 `enabled=0` 是本次修复的正当结果，非测试残留）

## 6. 回滚

- 机制：移除 `deleteProvider` 内的停用语句即回到"仅删供应商"
- 存量：`UPDATE model_registry SET enabled = 1 WHERE id = '887dffa1-…'` 可手工恢复

## 7. 实施前必查（已查清，2026-09-20）

1. **`handleListModels` 不按 `enabled` 过滤** —— 纳入判据是"是否有匹配的**活跃供应商**"（[ModelRuntimeAPI.ts:179-181](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/api/ModelRuntimeAPI.ts#L179-L181) `if (!matchingProvider) continue;`），`enabled` 仅原样透传（`:192-193`）⇒ §4 第 4 条风险**不成立**，停用方案安全。
2. **`model_registry` 无外键约束** —— `pragma_foreign_key_list('model_registry')` 返回空、DDL 无 `FOREIGN KEY`、索引仅 `sqlite_autoindex_model_registry_1` 与 `idx_model_registry_id` ⇒ 删除供应商不会触发任何 SQLite 级联，无需对齐 FK 行为。

## 8. 已知局限（如实登记，不在本次范围）

- **孤儿模型仍不可见于模型列表**：因纳入判据是"有匹配供应商"，供应商被删的模型会从 `/v1/models` 消失（实测 16 个模型中不含 `大瓦特私有化(Agent)`）⇒ 用户**无法在 UI 上重绑或删除它**。**部分缓解（2026-09-20）**：删除供应商时会以 warning toast 明确告知"已同时停用 N 个模型"（浏览器实测逐字为 `已同时停用 1 个绑定该供应商的模型：N59 UI Test Model（…）`），用户至少知道发生了什么；但**事后找回/重绑**仍需按 N-47 占位项思路另立项。
- 不处理"会话 `metadata.model` 指向已停用模型"的连带影响：切换时仍走失败分支（现为 warn 降级），本次不新增前端提示。
