# 模型管理架构决策记录（长期文档）

> 状态：长期有效 · 来源：[Phase 3 对比矩阵（2026-08-28）](../../dev_docs/20260828/model-management-comparison-matrix.md)（对标 deepseek-harness，D1–D11 全维度）
> 维护规则：新增/修改模型管理行为时，先查本页决策，避免与既有架构决策冲突。

---

## 一、决策总览

| ID | 决策 | 状态 | 日期 |
|----|------|:----:|------|
| D1 | DB 是模型/Provider 唯一事实来源；`ALL_MODEL_CONFIGS` 为 DB Proxy；禁止模型名硬编码 | ✅ 已落地 | 2026-08-28 |
| D2 | Provider 注册用 `ProviderRegistry.replace()` 原子替换；拓扑变更广播 `providers:changed` SSE | ✅ 已落地 | 2026-08-28 |
| D3 | 目录准入：DB 强一致为主 + 自愈开关 `ai.autoRegisterUnknownModels`（默认关） | ✅ 已落地 | 2026-08-28 |
| D5 | 模型记录：会话级 `metadata.model` + 消息级 `metadata.model` 双层落盘 | ✅ 已落地 | 2026-08-28 |
| D6 | 凭据存独立 `CredentialStore`（`~/.pyapp/credentials.json`），DB 仅存占位标记 | ✅ 已落地 | 2026-08-28 |
| D9 | Provider 更新走 `expectedRevision` 乐观并发；拓扑观察器 `ProviderTopologyWatcher` 实现进程级 HMR | ✅ 已落地 | 2026-08-28 |
| D10 | 表单 schema 驱动（字段定义单一来源 + 通用渲染器），新增字段只改 schema | ✅ 已落地 | 2026-08-28 |
| D11 | 模型管理核心单测 30 项（凭据/原子替换/路由/同步），不触 DB | ✅ 已落地 | 2026-08-28 |

---

## 二、决策明细（ADR 风格）

### D1 数据模型与事实来源

- **决策**：`model_registry` / `ai_providers` / `ai_app_model_configs`（SQLite）为唯一事实源；YAML 仅首次播种；`ALL_MODEL_CONFIGS` 通过 Proxy 代理到 DB（`ModelConfigs.ts`），不再有静态配置表。
- **约束**：禁止新增按模型名建属性表（`Record<模型名, 数值>`）；`scripts/lint-models.ts` 扫描硬编码（模型名/供应商名/Claude 代称 env），必须保持 0 违规。
- **证据**：[ModelConfigs.ts](../../app/src/ai/models/ModelConfigs.ts)、[lint-models.ts](../../scripts/lint-models.ts)

### D2 Provider 管理与注册

- **决策**：写 DB 后经 `ProviderSyncService` 同步到 `ProviderRegistry`；注册统一走 `replace()`（同 id 单次 Map 原子覆盖，保留默认 provider，无 unregister→register 间隙）；拓扑变更（增删改/启停）广播 `providers:changed` SSE。
- **证据**：[ProviderRegistry.ts](../../app/src/ai/providers/ProviderRegistry.ts)、[ProviderSyncService.ts](../../app/src/ai/providers/ProviderSyncService.ts)、[ProviderAPI.ts](../../app/src/ai/api/ProviderAPI.ts)

### D3 目录准入（产品决策）

- **决策**：保持 **DB 强一致**——未登记模型默认拒绝调用（不采用 dsh advisory 直通），报错引导「模型管理 → 添加模型」登记。
- **自愈开关**：`ai.autoRegisterUnknownModels`（默认 `false`，可在「设置 → AI 配置」面板切换）。开启后，未知模型自动登记为自定义模型（`is_custom=1`、`pricingSource=manual`、登记到默认 Provider）并放行本次请求。
- **登记通道**：手动添加 / 供应商拉取 / Ollama / llama / 官方价格同步，全部自动落库登记（无"仅内存不落库"路径）。
- **证据**：[aiService.ts](../../app/src/ai/services/aiService.ts)、[AIConfigPanel.tsx](../../client/src/components/settings/AIConfigPanel.tsx)

### D5 模型记录（会话/消息级）

- **决策**：会话级 `session.metadata.model`（创建/切换写入，压缩按会话模型解析上下文窗口）；消息级 `message.metadata.model`（主链路 `buildAssistantMessage` 显式携带 `response.model`，`_addAndPersistMessage` 兜底回填会话模型）。
- **证据**：[sendMessageFlow.ts](../../app/src/chat/orchestrator/sendMessageFlow.ts)、[ChatManager.ts](../../app/src/chat/ChatManager.ts)

### D6 凭据管理

- **决策**：真实 API Key 存独立 `CredentialStore`（`~/.pyapp/credentials.json`，0600），DB `ai_providers.api_key` 仅存 `CRED_STORED_MARKER` 占位；提供 `normalizeApiKey` 校验（可打印 ASCII）、脱敏返回、write-only 语义（前端不回填）。
- **约束**：禁止在 DB/日志/响应中回写明文密钥。
- **证据**：[CredentialStore.ts](../../app/src/ai/credentials/CredentialStore.ts)

### D9 配置热更新 / HMR

- **决策**：
  - Provider 更新支持 `expectedRevision`（更新前 `updated_at`），stale write 拒绝并返回 409（`PROVIDER_STALE_WRITE`）；前端编辑携带 `updatedAt` 作为版本 token。
  - `ProviderTopologyWatcher` 周期（默认 5s）采样 `ai_providers` / `model_registry` 指纹（`COUNT + MAX(updated_at)`），变更即自动同步运行时 + 刷新任务分工 + 广播 `providers:changed`——任何写入路径（含迁移/外部直写）无需重启即生效。
- **证据**：[ProviderManager.ts](../../app/src/ai/providers/ProviderManager.ts)、[TopologyWatcher.ts](../../app/src/ai/providers/TopologyWatcher.ts)

### D10 管理 UI（schema 驱动表单）

- **决策**：Provider 编辑表单由 schema 驱动：`ProviderFormSchema`（字段定义单一来源）+ `SchemaFormField`（通用渲染器，支持 text/password/select/checkbox/textarea + 凭据控制）。新增字段只改 schema，表单自动对齐。
- **证据**：[ProviderFormSchema.ts](../../client/src/components/modelAdmin/ProviderFormSchema.ts)、[SchemaFormField.tsx](../../client/src/components/modelAdmin/SchemaFormField.tsx)

### D11 测试覆盖

- **决策**：模型管理核心单测 30 项（CredentialStore 8 + ProviderRegistry 原子替换 3 + modelRouter 路由 14 + ProviderSyncService 凭据解析 5），均不触 DB（缓存注入 / 临时文件隔离）。
- **证据**：`app/src/ai/**/__tests__/*.test.ts`

---

## 三、配置项

| 键 | 类型 | 默认 | 说明 |
|----|------|:----:|------|
| `ai.autoRegisterUnknownModels` | boolean | `false` | 未知模型自动登记并放行（D3 自愈开关） |

写入方式：`config.json` 的 `"ai": { "autoRegisterUnknownModels": true }`，或「设置 → AI 配置」面板切换，或 `PUT /v1/config/ai.autoRegisterUnknownModels`。

---

## 四、剩余可选深化（非阻塞）

- D11：适配器 / 前端组件 / 属性不变量测试（dsh 仍领先，需 mock Provider 适配器与 React 测试设施）。
- D10：schema 引擎推广到模型/定价等其余表单。
- D5：消息级 model 历史数据回填迁移（存量消息无 model 字段）。

---

## 五、相关文件

| 文件 | 职责 |
|------|------|
| `model-usage.md`（本目录） | 模型使用规则（DB 事实源/禁硬编码/任务路由） |
| `dev_docs/20260828/model-management-comparison-matrix.md` | 一次性的对比分析（含 dsh 侧证据） |
| `app/src/ai/models/ModelRegistry.ts` | 运行时模型缓存（DB 驱动） |
| `app/src/ai/models/ModelPricingService.ts` | model_registry 表 CRUD |
| `app/src/ai/modelRouter.ts` | 任务路由（19 任务类型） |
| `app/src/ai/providers/` | Provider 管理 / 同步 / 拓扑观察器 |
| `app/src/ai/credentials/` | 独立凭据存储 |
