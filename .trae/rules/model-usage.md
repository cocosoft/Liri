# 模型使用规则

> 最后更新: 2026-08-28
> 架构决策（D1-D11 已定结论）见 [模型管理架构决策记录](../docs/model-management-decisions.md)

## 核心原则

**DB 是模型唯一事实来源。YAML 仅用于首次播种。**

**模型属性（上下文窗口、思考、缓存、能力）同样是 DB 数据**：
- `context_window` → `model_registry.context_window` 字段
- `thinking` / `context_caching` / `vision` 等 → `model_registry.capabilities`
- 运行时判断必须读 DB，**禁止在代码中按模型名建表查属性**（如 `KNOWN_CONTEXT_WINDOWS` 式 Record/Set 硬编码表）

## 模型数据流

```
用户通过 UI/API 创建模型
  → POST /v1/models → model_registry 表 (DB)
    → 字段: modelId, capabilities, pricing, enabled 等

后端启动
  → ModelPricingService.init() 从 DB 加载到内存
  → ModelRegistry.loadDbPricing() 缓存定价

前端请求
  → modelService.list() → GET /v1/models → handleListModels()
    → 遍历 model_registry 记录
    → 读取 pr.capabilities (DB) 决定 type
    → 返回 ModelInfo[] 给前端

任务路由
  → modelRouter 从 ConfigManager 读取任务分工
  → 用户可在 模型管理 → 任务分工 配置
  → API: GET/PUT /v1/models/tasks
```

## 排查模型问题的正确顺序

### 1. 先看任务分工
```
GET /v1/models/tasks
```
确认该任务类型映射到哪个模型。

### 2. 再看模型列表
```
GET /v1/models
```
确认模型是否存在、type 是否正确、enabled 是否为 true。

### 3. 再看 DB 原始数据
```
SELECT model_id, capabilities, enabled, provider_id FROM model_registry;
```
确认 capabilities 是否包含正确的值（如 `image_generation`）。

### 4. 再查 YAML（仅排查时参考，不作为事实来源）
YAML 文件: `app/src/ai/config/models.default.yaml`
仅在首次启动无 DB 数据时播种，后续不读取。

### 5. 最后看代码
只有前面 4 步都确认无误，才排查代码逻辑。

## 模型类型与 capability 映射

| capability | → type |
|-----------|--------|
| IMAGE_GENERATION | image |
| VIDEO_GENERATION | video |
| EMBEDDING | embedding |
| TEXT_TO_SPEECH / SPEECH_RECOGNITION | voice |
| (无以上) | chat |

映射逻辑: `ModelManagementAPI.ts` → `handleListModels()`

## 添加新模型的正确方式

### 通过 API（推荐）
```bash
POST /v1/models
{
  "modelId": "Tongyi-MAI/Z-Image",
  "displayName": "Z-Image",
  "providerId": "<provider-uuid>",
  "capabilities": ["image_generation"],
  "inputCostPerMillion": 0.1,
  "outputCostPerMillion": 0,
  "enabled": true
}
```

### 通过模型管理 UI
模型管理 → 供应商 → 选择供应商 → 添加模型 → 填写型号名和能力标签

## 禁止事项

- ❌ 在代码中硬编码模型名（如 `'dall-e-3'`）
- ❌ 在代码中硬编码供应商名
- ❌ 在工具参数 default 中写死模型名
- ❌ 绕过模型管理体系直接调 Provider API
- ❌ 修改 YAML 来"临时"添加模型（YAML 不是事实来源）
- ❌ **使用 Claude 模型代称**（`sonnet`/`opus`/`haiku`/`claude`/`anthropic`）作为模型名、类型、默认值或示例（存量已清理，禁止回流）
- ❌ **环境变量名嵌入 Claude 代称**（如 `LIRI_DEFAULT_HAIKU_MODEL`/`VERTEX_REGION_CLAUDE_` 已删除，禁止新增）
- ❌ **按模型名建属性表**：上下文窗口/思考预算/缓存支持等模型属性必须读 DB（`context_window`/`capabilities`），禁止 `Record<模型名, 数值>` 硬编码表

## 模型属性判定规范（2026-08-05 新增）

| 属性 | 事实来源 | 示例 |
|------|---------|------|
| 上下文窗口 | `model_registry.context_window` | `resolveContextWindowAsync()`（DB 优先，代码无模型名表） |
| 思考支持 | `capabilities` 含 `thinking` | 判定收敛 DB，禁止 `includes('opus')` 式判断 |
| 缓存支持 | `capabilities` 含 `context_caching` | 判定收敛 DB，禁止 `CACHE_SUPPORTED_MODELS` 式列表 |
| 任务能力 | `capabilities`（image/video/embedding/voice） | 现有体系 |

**协议适配白名单（合法，不属违规）**：
- Provider 协议实现内的模型前缀判断（如 `AnthropicProvider` 的 claude-sonnet 前缀、`BedrockProvider`）
- parser/formatter 按模型名前缀选解析格式（`DeepSeekFormatter` 等）
- tiktoken `encodingForModel()`（库 API 限制，需具体模型名）
- `ModelFetcher` 的 Anthropic 兼容子路径剥离、`dall-e` 能力分支
- 渠道类型枚举 `'claude'`、provider 类型枚举 `'anthropic'`（协议/类型契约，非指定供应商）

## 自动化检查（已落地：`bun run lint:models` + CI）

**状态订正（2026-11-15）**：本节原写「规划中」，与事实不符 —— `scripts/lint-models.ts` **早已存在并生效**（`app/package.json#ci` 与 `.github/workflows/ci.yml` 均执行，`lint:gate-parity` 持续比对两处）。脚本扫描源码根（`scripts/lib/sourceRoots.ts` 单一事实源）+ `client/src`，排除测试与白名单，分两类判定：

**A. 硬编码 —— 阻断（7 条模式）**

| # | 判据 |
|---|---|
| 1 | Claude 代称字面量（`'sonnet'` / `'opus'` / `'haiku'`） |
| 2 | `claude-*` 全名 |
| 3 | 品牌命名残留（`claude-code-guide` / `claude-ai`） |
| 4 | 代称环境变量名（`LIRI_DEFAULT_{HAIKU,OPUS,SONNET}_MODEL` / `ANTHROPIC_DEFAULT_*` / `VERTEX_REGION_CLAUDE`） |
| 5 | 模型属性硬编码表（`KNOWN_CONTEXT_WINDOWS` / `MODEL_CONTEXT_WINDOWS` / `CACHE_SUPPORTED_MODELS` / `MODEL_BUDGET_MULTIPLIERS`） |
| 6 | 业务层已知默认模型字面量（`gpt-4*` / `deepseek-*` / `dall-e-[23]` / `gemini-*` / `kimi` / `moonshot` / `qwen*`） |
| 7 | 代称并列提示文本（`sonnet, opus, haiku` 式帮助/示例） |

**B. 能力覆盖 —— 告警，不阻断**：读本机 `model_registry where enabled = 1` × `task_capability_mappings`，某 task 的必需能力对应 0 个启用模型即告警（2026-10-16 用户裁定：属**配置选择/缺口**，非代码质量违规 ⇒ 不让 CI 变红，但如实打印）。其输入是用户本机配置 ⇒ **本地专属**：CI / 干净环境无库时打印「未执行」而**不得**说成「通过」（AR-3）。已登记「故意无模型」的 `(task:capability)`：
`tts:text_to_speech`、`stt:speech_recognition`（走独立语音子系统，不经模型路由；理由必须非空，空理由即 `exit 1`）。

- **白名单**：脚本内 `IGNORE_PATH_FRAGMENTS`（协议适配 / 预设播种 / 类型枚举 / tiktoken 库约束 / 音频 `opus` 格式 / 模型名关键词分级等）；新增白名单**须同批**更新本节与脚本注释。
- **如实边界**：判据 6 只覆盖上列**已知族**的字面量；该族之外的任意模型名（如自建/私有命名）无可靠静态判据，仍需评审把关。

## 当前已注册的生图模型

- `Tongyi-MAI/Z-Image` — 硅基流动，capabilities: `["image_generation"]`

## 相关文件

| 文件 | 职责 |
|------|------|
| `app/src/ai/models/ModelPricingService.ts` | DB CRUD |
| `app/src/ai/models/ModelRegistry.ts` | 运行时缓存 |
| `app/src/ai/ModelManagementAPI.ts` | HTTP API |
| `app/src/ai/modelRouter.ts` | 任务路由 |
| `app/src/ai/config/models.default.yaml` | 首次播种（非事实来源） |
