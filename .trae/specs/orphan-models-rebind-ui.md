# Spec：孤儿模型的可见性与重绑（N-59 后续 · 按 N-47 占位项思路）

- **状态**：**已实施并验证**（2026-09-20；用户确认设计点后实施；V1-V5 全通过，含实施中实测发现并修复的 1 个缺陷）
- **关联台账**：N-59（删供应商级联停用）、N-47（受控 select 的孤儿值占位项 —— 本 Spec 沿用同一"让孤儿可见"的思路）
- **背景**：N-59 修复后，供应商被删除时其强绑定模型会被**级联停用**，但该模型因 `handleListModels` 的 `if (!matchingProvider) continue;`（[ModelRuntimeAPI.ts:181](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/api/ModelRuntimeAPI.ts#L181)）**从 `/v1/models` 消失** ⇒ 用户在 UI 上看不到它，**无法重绑或删除**（Spec `provider-delete-cascade-model-disable.md` §8 已如实登记该局限）。

## 1. 已核实前提

| 事实 | 证据 |
|------|------|
| **重绑写入能力已具备** | `PUT /v1/models/:id` → [ModelAPI.ts:252](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/api/ModelAPI.ts#L252) `handleUpdateModel`，其 [`:277-278`](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/api/ModelAPI.ts#L277-L278) **已支持 `body.providerId`** ⇒ 无需新增写入端点 |
| 删除能力已具备 | `DELETE /v1/models/:id` → `handleDeleteModel`（同名文件 `:346`） |
| 启用/停用已具备 | `ModelPricingService.toggleModelById(id)`（翻转语义） |
| **不能改 `/v1/models` 语义** | 该端点被三处消费：聊天模型选择器、任务分工下拉、模型管理主列表 —— 放开 `continue` 会让**不可用模型进入聊天选择器**（回退风险）⇒ 采用**独立端点** |
| 现存孤儿（实测） | `model_registry` 中 1 条：`大瓦特私有化(Agent)`（`model_id=246676332`、`provider_id=1490b517-…` 不存在、`enabled=0`） |

## 2. 目标与非目标

**目标**：用户能在模型管理页看到"供应商已删除"的模型，并把它**重绑**到现有供应商（重绑后自动启用），或删除它。

**非目标**：不改 `GET /v1/models` 的返回语义；不改 N-59 的级联停用与自检；不新增"重绑"专用写端点（复用 `PUT /v1/models/:id`）。

## 3. 改动方案

### 后端

1. **判据收敛（CS01，先查已有）**：新增独立工具模块 `app/src/ai/models/orphanModels.ts`（`isOrphanProviderId()` 纯函数 + `collectOrphanModels()` 收集器）—— **更正**：原计划做成 `ModelPricingService.getOrphanModels()` 方法，但该服务反向依赖 `providerManager` 会形成**循环 import**，故改为独立工具模块（内部动态 import 两者）。
   - `ModelManagementBootstrap.disableModelsWithMissingProvider()` 改为**复用它**（消除重复判据，避免两处漂移）
2. **新增只读端点** `GET /v1/models/orphans` → 新增 handler `handleListOrphanModels`（放 `ModelAPI.ts`），返回 `{ data: [...] }`
   - **路由注册顺序（关键）**：必须注册在 `/v1/models/([^/]+)$` **之前**，否则 `orphans` 会被当作 `:id` 劫持（[ModelManagementAPI.ts:403](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/ModelManagementAPI.ts#L403) 已有此注释约定）
3. **`api-spec.md` 同步登记**（项目规则 §1.6.1 强制）

### 前端

4. `services/modelService.ts`：新增 `listOrphanModels()`
5. `stores/modelAdminStore.ts`：新增 `orphanModels` 状态 + `loadOrphans()` + `rebindModel(modelId, providerId)`
   - `rebindModel`：`PUT /v1/models/:id {providerId}` → 若该模型当前 `enabled === false`，再调 `POST /v1/models/:id/toggle`（**仅翻转一次**，即自动启用）→ 重新加载孤儿与主列表
6. `components/views/ModelPage.tsx`：主列表**上方**新增「⚠ 供应商缺失的模型」区块（**仅 `orphanModels.length > 0` 时渲染**）
   - 每行：模型名 + `modelId` + 原供应商 id（截断 + `title` 全量）+ **重绑下拉**（现有供应商，取自 `providers`）+ 删除按钮
   - 重绑成功后 `toastWarning`（或 info）提示结果；失败走既有 `store.error` / toast
7. i18n（`zh.ts` / `en.ts`）：区块标题、说明行、下拉占位、重绑按钮、成功与失败提示

## 4. 风险与对策

| 风险 | 对策 |
|------|------|
| 新端点被 `:id` 路由劫持 | 注册顺序放在 `/:id` 之前；V1 验证直接请求 `/v1/models/orphans` 必须命中新 handler（而非 404 或"模型不存在"） |
| 重绑后自动启用误伤（用户本想保持停用） | 已确认产品选择为**自动启用**；仅当 `enabled === false` 时 toggle 一次（不盲目翻转） |
| 孤儿模型数量多时区块过长 | 区块内沿用主列表样式；本次不做分页（实测仅 1 条，不为假设场景加复杂度，CS03） |
| 与 N-59 自检判据漂移 | 统一收敛到 `getOrphanModels()`（§3.1） |

## 5. 验证结果（2026-09-20，V1-V5 全通过）

- **V1 后端**：`GET /v1/models/orphans` 返回**恰好 1 条**（`246676332` / 大瓦特私有化 / `enabled=false`）✓；`GET /v1/models` 仍为 **16 条**、不含该孤儿（**语义未变**）✓
- **V2/V3 浏览器实测（自建测试数据，不碰用户数据）**：区块显示正确（标题/说明逐字、2 行、下拉含目标供应商）；重绑 `N59 Rebind Test2` → `N59-REBIND-B` 后 **<1 秒内**：
  - toast **逐字** `已把 N59 Rebind Test2 重新绑定到 N59-REBIND-B 并启用`（于 0.3–0.5 秒抓到）
  - **不刷新页面**主列表 **17 → 18**，含该模型且 provider 为 `N59-REBIND-B`
  - 孤儿区块 **2 行 → 1 行**（仅剩用户的 `大瓦特私有化(Agent)`，全程未被触碰）
  - 后端核对：`/v1/models/orphans` 剩 **1** 条、`/v1/models` **18** 条且 `n59-rebind-test2` `enabled: true`、`providerId` 与所选供应商一致
- **V4 静态/单测**：app `typecheck` EXIT=0、`bun test` **2856 pass / 0 fail**；client `typecheck` EXIT=0、vitest **26 文件 / 244 例通过**
- **V5 边界**：无孤儿时区块不渲染（重绑后仅剩用户孤儿故仍有 1 行；空列表路径由 `orphanModels.length > 0` 守卫）

### 5.1 实施中实测发现并修复的缺陷

| 现象 | 根因 | 修复 |
|------|------|------|
| 首轮验证：重绑后**主列表未就地刷新**（仍 16 条，**刷新页面**才 17 条） | 主模型列表是 ModelPage 的**本地 state**（`loadModels()`），而 `store.rebindModel` 只刷新孤儿列表与供应商列表 | `handleRebindOrphan` 成功后追加 `await loadModels()`；复测确认**无需刷新**即 17 → 18 |

**另：首轮"toast 未观察到"经复核为抓取时机问题**（`toastStore` 时长为 4000ms，首轮约在第 3 秒之后才抓）——**非缺陷**；复测在 0.3–0.5 秒内抓到 ✓。

### 5.2 测试数据清理

providers 回到 **7 行**、`model_registry` **17 行**、`n59-*` 残留 **0** ✓（用户孤儿 `大瓦特私有化(Agent)` 保持 `enabled=0`，未被本次验证触碰）

## 6. 回滚

- 后端：移除新端点与路由（`/v1/models` 语义本就未变，无回滚面）
- 前端：移除区块与 store 字段

## 7. 实施后需同步的文档

- `dev_docs/error_repairs/预存错误与待处理问题.md`：N-59 的"已知局限"改为**已解决**并指向本 Spec
- `.trae/docs/api-spec.md`：登记 `GET /v1/models/orphans`
