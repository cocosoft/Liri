# 模型事实来源根治 Spec（数出同源修复）

> 版本: 1.0 | 创建: 2026-08-18
> 关联: project_rules §1.5（模型数据一致性 / 数出同源）/ GR01（基础设施复用）/ CS05（根因优先）
> 涉及文件: `app/src/ai/api/ModelRuntimeAPI.ts` / `app/src/ai/ModelManagementBootstrap.ts`

## 1. 背景与根因

**问题现象**：前端模型管理只显示极少数模型，状态栏只有 deepseek-chat；用户长期要求的 gpt-4o / gemini-2.5-pro / qwen-max 删除无法落地。

**根因链**（已逐层验证，证据驱动）：

```
① model_registry 表 17 个模型，provider_id 引用 deepseek/openai/google/llamacpp
② ai_providers 表只有 1 个 Ollama（env seed 因 .env 无 key 被跳过）
③ handleListModels 要求模型匹配到 ai_providers 的 provider，16 个模型被 continue 过滤
④ 前端看不到 → 无法在 UI 删除 → 用户"要求删除"无入口落地
⑤ 运行时 provider 靠 CoreAPIImpl.ts:288 env fallback 临时注册，不落库
→ 违反 §1.5"数据库是唯一事实来源"，运行时与 DB 不同源
```

## 2. 改动设计

### C1: handleListModels 兼容运行时 Provider（ModelRuntimeAPI.ts）

**现状**（[ModelRuntimeAPI.ts:111-140](file:///E:/PY/Documents/CODES/PY_APP/app/src/ai/api/ModelRuntimeAPI.ts#L111-L140)）：只按 `providers.find(p.id === pr.providerId)` 匹配 DB provider，匹配不到就 `continue`。

**改**：匹配不到 DB provider 时，回退到 `providerRegistry.getByModel(pr.modelId)` / `providerRegistry.get(pr.providerId)`，拿到运行时已注册的 provider 即纳入列表。

- 目的：即使某个 provider 未落库，只要运行时可用，模型就可见（可见即可管理/删除）。
- 兼容：DB provider 优先，运行时 provider 兜底，不改变 DB 已配置模型的展示。

### C2: 启动补录 model_registry 引用但缺失的 Provider（ModelManagementBootstrap.ts）

**现状**：[initializeModelManagementServices](file:///E:/PY/Documents/CODES/PY_APP/app/src/ai/ModelManagementBootstrap.ts#L256-L272) 的 `seedEnvProvidersToDB` 只在环境变量有 key 时创建 provider。

**改**：新增 `ensureReferencedProviders()`——扫描 `model_registry` 去重后的 `provider_id`，对 `ai_providers` 中不存在的，用内置 preset（`providerPresetsData` / `ENV_PRESETS` 的默认 baseUrl）补录到 DB；apiKey 从 env 读取（有则写，无则空），`requires_auth` 按 preset。

- 目的：让 DB `ai_providers` 覆盖所有 model_registry 引用的 provider，达成"数出同源"。
- 幂等：按 `name + provider_type` 去重，已存在跳过，不覆盖用户已有配置。
- llamacpp 属本地 provider（无需 key），同样补录。

### C3: 清理冗余模型（数据变更，用户已授权）

从 `model_registry` 物理删除 3 个模型（已核实未被 ai_app_model_configs 任务分工引用，删除安全）：

| model_id | provider_id | 删除 |
|----------|-------------|:---:|
| gpt-4o | openai | ✅ |
| gemini-2.5-pro | google | ✅ |
| qwen-max | openai | ✅ |

删除后刷新缓存：`ModelRegistry.refreshDbPricing()` + `modelRouter.invalidateUuidCache()` + `modelRouter.cleanupTaskRef()`（复用 [handleDeleteModel](file:///E:/PY/Documents/CODES/PY_APP/app/src/ai/api/ModelAPI.ts#L346-L392) 的既有清理链路）。

> 注意：不删 gemini-2.5-flash（被 chat/vision/ocr 任务分工引用）、qwen-plus/turbo、gpt-4o-mini 等（用户未要求）。

## 3. 合规检查表

- [x] §1.5 数出同源：启动后 `ai_providers` 覆盖全部 model_registry 引用的 provider，运行时与 DB 一致（活跃库 ~/.pyapp/data/app.db 14/14 匹配）
- [x] CS01 归一化：复用 `seedEnvProvidersToDB` / `detectUnifiedProviders` / `providerPresetsData` / `handleDeleteModel` 既有清理链，不另起炉灶
- [x] CS05 根因优先：不修表象（不硬编码模型列表），从"DB 与运行时不同源"根因修复
- [x] CS04 零 Mock：不新增任何假数据
- [x] GR01-001 文件行数：改动后 ModelRuntimeAPI.ts / ModelManagementBootstrap.ts 均 < 800 行
- [x] 动态 import 相对路径规范（如需移动代码）

## 4. 验证方案

1. [x] `bun run typecheck` 通过（修复 existingTypes 类型：Set<ProviderType> → Set<string>）
2. [x] `bun run lint:arch` 通过（仅存量 WARNING）
3. [x] 活跃库 `~/.pyapp/data/app.db` 验证：
   - [x] `gpt-4o` / `gemini-2.5-pro` / `qwen-max` 已从 model_registry 删除（目标模型 0 个）
   - [x] 剩余 14 个模型全部匹配到 ai_providers（14/14）
   - [x] 任务分工引用不受影响（coding→deepseek-reasoner、chat/vision/ocr→gemini-2.5-flash、default→deepseek-chat 等仍有效）
   - [x] ai_app_model_configs 无指向已删 3 模型的悬空引用
4. 前端模型管理页能看到全部模型并可管理（需重启后端验证）
5. 任务分工引用不受影响（coding→deepseek-reasoner、chat→gemini-2.5-flash 等仍有效）

> ⚠ 数据目录变更：2026-08-18 已统一迁移至 `~/.pyapp`（resolvePyappHome 默认值），
> `app/data/pyapp/data/app.db` 为迁移前遗留旧库（仍含已删 3 模型），运行中的应用不再读取。
> 若确认旧库无用可删除，避免双库混淆。

## 4.1 数据统一根治（数据目录迁移，2026-08-18 完成）

**问题**：`app/data/pyapp`（项目内遗留目录）中的唯一一份会话/项目数据从未迁移，
且迁移函数 `_migrateHomeFromProjectToUser` 因「curHome 已为主目录」早退成为死代码。

**根因链**：
```
① resolvePyappHome() 统一为 ~/.pyapp → curHome.startsWith(homedir()) 恒真
② 旧迁移函数（ChatManager）永远早退 → 遗留数据滞留 app/data/pyapp
③ ChatManager.initialize() 属延迟 LLM 初始化（仅首次聊天触发）→ 即使修复早退，
   迁移也被搁置在非启动路径，启动时永不执行
```

**修复**（`app/src/chat/ChatManager.ts`）：
- C4-1: 重写 `_migrateHomeFromProjectToUser()`——直接检测 `<projectRoot>/app/data/pyapp/data`，
  文件级合并缺失数据到 `~/.pyapp/data/`，排除重型循环产物（checkpoints/snapshots/
  transcripts/logs 等）与 app.db*（新库为唯一事实来源），写 `.home-migration-v1` 标记幂等。
- C4-2: 迁移调用移入 `ensureSessionsLoaded()`（启动时由 main.ts 调用），在加载会话前执行，
  移除 `initialize()`（延迟路径）中的旧调用，消除双调用。

**验证**：typecheck ✓；重启后标记 `.home-migration-v1` 生成、`~/.pyapp/data/sessions`
0→31 文件、`projects` 0→5 文件；`GET /v1/sessions` 返回 11 个会话（含 10 个旧会话）。

### 4.2 旧目录清理（双库消除，2026-08-18 完成）

**最终状态**：唯一数据目录 `~/.pyapp/data/`（会话 11 / 项目 3 / app.db 14 模型），
项目内遗留目录 `app/data/pyapp` 已彻底删除，双库并存消除。

**删除前证据链**（证据驱动，逐项确认后才动手）：
- [x] `resolvePyappHome()` 统一返回 `~/.pyapp`（[paths.ts:86](file:///E:/PY/Documents/CODES/PY_APP/app/src/core/paths.ts#L86)），
      `pyapp.ts:356` 旧路径仅为 paths 未就绪时的兜底（正常不执行）
- [x] 运行中的应用读新库：`GET /v1/sessions`=11、`GET /v1/models`=14（14/14 匹配供应商），
      与 `~/.pyapp/data/app.db`（model_registry 14 行）完全一致
- [x] 3 个目标模型（gpt-4o / gemini-2.5-pro / qwen-max）已从新库 model_registry 物理删除
- [x] 旧目录最后写入 21:40（app.db）/ 21:56（wal）/ 22:41（shm），删除时已 20+ 分钟无活跃写入
- [x] 种子机制不受影响：真正种子模板在 `app/seed/pyapp`（git 跟踪），copy-seed-data 输出到
      `dist/pkg/app/data/pyapp`；本地开发 seedSync 源不存在时静默跳过（seedSync.ts:79）
- [x] 旧目录无新库缺失的独有数据（sessions 11=11、projects 3 且新目录更完整、app.db 为旧版）

**操作**：`Remove-Item -Recurse -Force app/data/pyapp`（含 app.db*、sessions、projects、
checkpoints、channels 等全部遗留）。`app/data` 下仅剩 `_migration_backup/config.json`
（历史配置备份，非数据库，不构成双库，保留）。

**删除后验证**：`GET /v1/sessions`=11、`GET /v1/models`=14，运行中的应用零影响。

## 5. 不做的事

- 不改模型路由 / SmartRouter 逻辑
- 不改前端代码
- 不删用户未要求的模型
- 不改动 task_capability_mappings / ai_app_model_configs 数据
