# 模型能力自动探测与服务状态检测 Spec

> 版本: 0.2 | 创建: 2026-08-19 | 状态: **已实施**
> 关联: GR15（Spec-Driven Development）/ model-usage.md（DB 唯一事实来源）/ §1.5 模型数据一致性 / coding-standards CS01/CS04
> 决策背景: qwen3.6-27B 不支持工具调用导致 `Ollama stream failed (400): Bad Request`，运行时靠「错误反向推断 + 降级重试」兜底，但用户无法在添加/安装模型时预知该模型是否支持工具调用、视觉等能力；同时 Ollama/llama.cpp 本地服务运行状态缺少统一检测与展示。

## 1. 诊断证据（2026-08-19 实测）

**问题一：模型能力不可预知**
- `POST /api/chat` 带 tools 请求 qwen3.6-27b:latest → 400 `{"error":"registry.ollama.ai/library/qwen3.6-27b:latest does not support tools"}`（229ms）
- 同一模型不带 tools → 200 OK（冷启动首 token 15.3s，warm 9.5s）—— 印证需 600s 长超时
- 运行时已有降级：`OllamaProvider.noToolSupportModels`（内存缓存）+ 剥离 tools 重试；`LlamaCppProvider.probeToolSupport`（/props 探测，60s 缓存）
- **缺口**：探测结果不落库、无统一 API、前端不可见；Ollama 缓存无 TTL

**问题二：本地服务状态无统一展示**
- llama.cpp 已有 `GET /v1/llama/status`（`LlamaServerStatusInfo`，含 running/port/model），前端 `LlamaConfigPanel` 展示
- Ollama 仅 `OllamaProvider.isAvailable()`（/api/tags），模型管理页 Provider 卡片**无在线/离线状态**

**关键验证（2026-08-19）—— Ollama /api/show 静态探测可行**：
```
GET /api/show {model:'qwen3.6-27b:latest'}
→ template 不含 Tools/tool_calls 关键字   → 不支持工具（与实际 400 行为一致 ✓）
→ projector_info 不存在                   → 非视觉模型 ✓
```
静态探测免费、毫秒级、不消耗推理资源，优于发真实请求（15s+）。

## 2. 决策（用户已确认 2026-08-19）

| 决策 | 内容 |
|------|------|
| D1 | **探测结果持久化到 DB**：写入 `model_registry.capabilities`，DB 仍是模型能力唯一事实来源，用户可手动改 |
| D2 | **触发时机**：添加/批量导入模型后自动触发 + 模型列表「检测能力」手动按钮 |
| D3 | **探测能力范围**：`tool_use`（工具调用）+ `vision`（视觉输入）两项核心能力，一次探测覆盖 |
| D4 | **服务状态展示**：模型管理页 Provider 卡片显示「在线/离线」徽标（本地服务 ollama/llamacpp） |
| D5 | **探测范围限定**：仅本地可静态探测的 Provider（ollama/llamacpp）；云端模型跳过探测（能力由用户在 UI 配置，避免发真实请求消耗额度） |

## 3. 探测策略（静态优先，不消耗推理）

| Provider | tool_use | vision | 实现 |
|----------|----------|--------|------|
| ollama | `GET /api/show` → `template` 含 `Tools`/`tool_calls` | `GET /api/show` → `projector_info` 存在 | 新增 `OllamaProvider.probeCapabilities()` |
| llamacpp | `/props` → `chat_template_caps.supports_tools && supports_tool_calls` | `/props` 有则读，无则未知 | 复用 `probeToolSupport`（改公开）+ 新增 vision 探测 |
| 其他（openai/deepseek 等） | **跳过**（返回 `skipped`） | **跳过** | 不探测 |

**探测返回结构**：`{ tool_use: true|false|'unknown', vision: true|false|'unknown', method: 'static'|'inferred'|'skipped' }`

**写回合并规则**：探测结果与 `model_registry.capabilities` 现有能力**合并**（保留用户手动添加的能力标签，不覆盖），探测确认的 true/false 写入，探测不到（unknown）不动。

## 4. 数据模型与迁移

- **无需表结构变更**：复用 `model_registry.capabilities`（TEXT JSON 数组，已存在）
- 探测能力键取自标准能力集合：`tool_use`（tools 分类）、`vision`（vision 分类），见 `capabilities.default.yaml`
- 探测结果落库后，前端模型列表/详情可直接读取展示（数出同源）

## 5. 实施步骤

### Phase 1 — 后端探测核心（新模块）
- [x] 新增 `app/src/ai/services/ModelCapabilityProbe.ts`：统一探测入口
  - `probe(modelId): Promise<ProbeResult>` — 通过 `model_registry` 查 providerType → 按类型分派
  - ollama → 调 `OllamaProvider.probeCapabilities(model)`；llamacpp → 调 `LlamaCppProvider.probeCapabilities(model)`；其他 → skipped
  - `persist(modelId, result)` — 合并写回 `upsertPricing({ modelId, capabilities })` + 刷新 ModelRegistry/ModelRouter 缓存
  - 单例导出 `getModelCapabilityProbe()`
- [x] 修改 `OllamaProvider.ts`：
  - 新增 `probeCapabilities(model)`：`GET /api/show` 解析 template/projector_info；探测失败返回 `{ tool_use:'unknown', vision:'unknown' }`（不阻断）
  - `noToolSupportModels` 增加 TTL 过期（对齐 LlamaCppProvider `TOOL_SUPPORT_CACHE_TTL_MS = 60s`）
- [x] 修改 `LlamaCppProvider.ts`：`probeToolSupport` 由 private 改 public，新增 `probeCapabilities(model)`（tool_use 复用探测 + vision 从 /props 读）

> **实现要点**：`OllamaProvider.probeCapabilities` 的 tool_use 判定正则覆盖真实模板形式
> （`{{.Tools}}` / `{{- if .Tools }}` / `{{.ToolCalls}}` / `tool_calls`），避免误判。

### Phase 2 — 后端 API
- [x] 新增 `app/src/ai/api/ModelCapabilityAPI.ts`：
  - `POST /v1/models/probe` — 探测单个模型并（可选）写回 DB
    - body: `{ modelId, persist?: boolean }` 默认 persist=true（**v0.2 变更**：modelId 由 body 传入而非 URL 路径，
      因 Ollama 模型名含 `/`（如 `registry.ollama.ai/library/qwen3.6-27b:latest`），URL 捕获无法完整匹配）
    - 返回: `{ data: { modelId, providerType, method, tool_use, vision, persisted } }`
  - `GET /v1/providers/status` — 本地服务状态
    - 返回: `{ data: [{ providerType, running, detail? }] }`（ollama→isAvailable(/api/tags)；llamacpp→复用 LlamaCppServerManager.getStatus 的 running）
- [x] 修改 `ModelManagementAPI.ts` ROUTES 注册（遵循子域拆分模式，handler 放 api/ 下）

### Phase 3 — 前端
- [x] 扩展 service：`modelService.probeCapabilities(modelId, persist?)`、`modelService.providerStatus()`
- [x] 修改 `ModelPage.tsx`：
  - 模型 Tab 顶部显示本地服务（Ollama/llama.cpp）「在线/离线」徽标（20s 轮询 `/v1/providers/status`）
  - 模型列表新增「检测能力」按钮（POST probe，toast 展示 tool_use/vision 结果）+ 结果徽章
  - 添加模型成功后自动触发探测（fire-and-forget，不阻塞；云端模型返回 skipped 不打扰）
- [x] 前端文案与 ModelPage 现有风格一致（硬编码中文，未走 i18n —— 该文件全程硬编码中文，保持局部一致）
  （偏差：spec v0.1 原计划 i18n + Provider 卡片徽标，实现改为 models Tab 顶部状态行 + 硬编码中文，见 §7）

### Phase 4 — 测试与验证
- [x] 新增 `app/tests/ai/providers/OllamaCapabilityProbe.test.ts`（/api/show 模板解析、projector_info、失败 unknown）
  （偏差：spec v0.1 原计划 services 层测试；probe 分派依赖 DB 同步后的 registry 状态，改为聚焦纯解析逻辑）
- [x] `OllamaProvider.test.ts` 既有 4 用例覆盖降级/缓存/错误 body
- [x] `bun run typecheck`（前后端）/ `bun run lint:arch`（仅存量 WARNING）/ 相关测试 10 pass 0 fail
- [ ] 实测：qwen3.6-27b 探测 → tool_use=false 落库；模型管理页状态徽标正常

## 6. 合规检查表

- [x] CS01 归一化：探测逻辑收敛到 `ModelCapabilityProbe` 单一模块；复用 LlamaCppProvider 现有 probeToolSupport，不另起实现
- [x] CS04 Mock 零容忍：探测全部基于真实服务响应（/api/show、/props、/api/tags），无假数据
- [x] CS02 状态检测：工具支持判断基于服务端真实响应/缓存标记，不做模型名字符串匹配
- [x] model-usage.md：能力键仅用标准集合（tool_use/vision）；探测结果写 DB（唯一事实来源）；不按模型名建属性表
- [x] §1.5 模型数据一致性：探测落库后经 ModelRegistry/ModelRouter 缓存刷新，运行时与 DB 一致
- [x] R03-002：改动集中在 `app/src/ai/` 与前端 `components/services`，不越层
- [x] R04-001：无新增超 800 行文件
- [x] 错误处理：所有 handler 走 `handleError`（module: `ai:modelManagement`）

## 7. 变更记录

- **v0.2（2026-08-19）**：状态更新为已实施；`POST /v1/models/:id/probe` → `POST /v1/models/probe`（modelId 移入 body，理由见 Phase 2）；服务状态展示从 Provider 卡片改为 models Tab 顶部状态行；新增测试文件为 OllamaCapabilityProbe.test.ts。
