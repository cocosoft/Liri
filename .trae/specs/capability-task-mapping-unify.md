# 能力键统一与任务分工映射治理 Spec

> 版本: 0.1 | 创建: 2026-08-10 | 状态: **已完成（2026-08-10）**
> 关联: GR15（Spec-Driven Development）/ GR16-002 / model-usage.md（DB 唯一事实源）/ lint:models 能力断链检查
> 决策背景: 任务分工（task）与模型能力（capability）之间存在**多套映射源且关键字不匹配**，导致视频类任务能力路由失效、校验缺失；前端能力标签仅英文、i18n 未接线。

## 1. 诊断证据（2026-08-10 实测）

**三处任务→能力映射源并存且不一致**：

| 来源 | 运行时数据源 | 现状 |
|------|-------------|------|
| `capabilities.default.yaml` | **播种源** | 能力键 23 个 + taskMappings 7 条（chat/default/image/video/embedding/**voice**/**code**） |
| `task_capability_mappings` 表 | **DB 运行时权威**（CapabilityService `getTaskMappingsFromDb()`、lint-models 均读它） | 由 yaml 播种，video→video_generation 等 |
| `modelRouter.DEFAULT_TASK_CAPABILITY` | 硬编码 9 条 + `refreshTaskCapabilityMapping` 从 CapabilityService **合并** | text_to_video→`text_to_video`、image_to_video→`image_to_video`、tts/stt... |

**不匹配清单**：

1. **无效能力键**：modelRouter 将 `text_to_video`/`image_to_video` 任务映射到同名能力键，但标准能力集合（yaml 23 键 + types.ts `CapabilityKey` enum）**不存在这两个键**（视频仅 `video_generation`）→ 这两个任务的**能力路由永远匹配不到模型**（resolve 时能力 fallback 失效）。
2. **任务命名分叉**：yaml/DB taskMappings 用 `voice`（合并）、`code`；modelRouter 用 `tts`/`stt`、`coding`。合并逻辑 `{...DEFAULT, ...newMapping}` 使 `voice`/`code` 进入 mapping 但 `ALL_TASK_TYPES`（19 个）无对应 task → 双向脏数据。
3. **task 覆盖缺失**：19 个 task 中 `ocr`/`text_to_video`/`image_to_video`/`reranking`/`vision`/`tts`/`stt`/`knowledge_compile` 在 yaml/DB taskMappings **无映射** → 校验（`validateTaskAssignment`）对这些任务缺失/用无效键。
4. **前端英文标签（i18n 未接线）**：`CapabilitySelector.tsx` 调用 `getDisplayName(cap)` **未传 `t`** → [capabilityService.ts](file:///E:/PY/CODES/PY_APP/client/src/services/capabilityService.ts) 翻译分支短路，恒回退英文 `labelFallback`；分类名同。且 i18n `capability.*` 键大量缺失（缺 context_caching/batch_api/reranking/moderation/audio_input/video_input/image_editing/code_execution 等），**desc 键格式不一致**（yaml `capability.xxx.desc` vs zh.ts `xxxDesc`）。

## 2. 决策（用户已确认 2026-08-10）

- **D1 新增细分视频能力键**：`text_to_video` / `image_to_video` 作为独立能力键加入标准集合（与 `video_generation` 区分）。
- **D2 保持 tts/stt 细分**：task 维持 `tts`/`stt` 两个，各自映射 `text_to_speech`/`speech_recognition`；yaml/DB taskMappings 用 `tts`/`stt` 替换 `voice` 合并项。
- **D3 单一事实源收敛**：能力键权威 = `capabilities.default.yaml` + `types.ts CapabilityKey`；运行时映射权威 = DB `task_capability_mappings`（由 yaml 播种）；`modelRouter` 不再硬编码能力键，仅从 CapabilityService 读取。
- **D4 前端 i18n 统一**：能力/分类标签一律走 `t(labelKey)`，zh/en 补全 `capability.*` 键。**实施注记**：i18next 叶子字符串与 `.desc` 嵌套路径冲突，desc 键采用扁平 `labelKeyDesc` 形态（前端 `getDescription` 拼接 `${labelKey}Desc`，与既有 zh/en 格式一致）；yaml `descriptionKey` 保留作为语义字段。

## 3. 统一后的能力键全集（25 个）

现有 23 个 + 新增 2 个：
`text_to_video`（category: media，taskTypes: [text_to_video]，dependencies: []）、`image_to_video`（category: media，taskTypes: [image_to_video]）。

## 4. 统一后的任务→能力映射（19 个 task 全覆盖）

| task | 能力（required） | 说明 |
|------|-----------------|------|
| default/chat/coding/translation/quick/agent/scheduled/local | streaming+function_calling+tool_use（chat 类） | coding 与 yaml `code` 归一为 coding |
| embedding | embedding | |
| image | image_generation | |
| vision | vision | |
| ocr | vision（可选项，实施时定） | 补入 taskMappings |
| text_to_video | text_to_video | **新增能力键** |
| image_to_video | image_to_video | **新增能力键** |
| video | video_generation | |
| tts | text_to_speech | 替换 `voice` |
| stt | speech_recognition | 替换 `voice` |
| reranking | reranking | 补入 taskMappings |
| knowledge_compile | （无特定能力） | 补入 taskMappings（required: []） |

## 5. 数据模型与迁移

- **新增能力键无需 DB 迁移**（`text_to_video`/`image_to_video` 此前无模型使用，属"合法化"而非改名）。
- **DB `task_capability_mappings`**：实施后重新播种（删除旧行 + 按新 yaml taskMappings 写入），保证 yaml/DB 一致。
- `model_registry`：无结构变化；已有 video 模型能力（video_generation）不受影响。

## 6. 实施步骤

### Phase 1 — 能力键定义统一（后端）✅
- [x] `capabilities.default.yaml`：新增 `text_to_video`/`image_to_video` 能力键（media 分类，sortOrder 4/5，taskTypes 对应）
- [x] `types.ts` `CapabilityKey` enum 同步新增 `TEXT_TO_VIDEO`/`IMAGE_TO_VIDEO`
- [x] CapabilityService 播种/`getAll` API 返回新键（watch 重启自动播种）

### Phase 2 — taskMappings 统一（后端 + DB）✅
- [x] `capabilities.default.yaml` taskMappings：覆盖全部 19 个 task；`voice`→`tts`/`stt`；`code`→`coding`；补 ocr/reranking/knowledge_compile/text_to_video/image_to_video/vision/translation/quick/agent/scheduled/local
- [x] **根因修复**：`CapabilityService.mergeYamlToDb` 增加「YAML 已移除的 mapping 清理」（`deleteTaskMapping`），yaml 成为唯一播种源，DB 无 voice/code 残留；新增能力键自动播种
- [x] DB `task_capability_mappings` 已通过 watch 重启自动同步（lint:models 识别出 7 个能力断链证明新映射生效）

### Phase 3 — modelRouter 收敛（后端）✅
- [x] `DEFAULT_TASK_CAPABILITY` 键全部与标准集合一致（text_to_video/image_to_video 已合法化），注释更新为「仅 CapabilityService 不可用时兜底」
- [x] 三处 `nonChatCaps` 列表（modelRouter / AppModelConfigService / ModelRuntimeAPI）同步新增 text_to_video/image_to_video
- [x] `TASK_DEFINITIONS`/`TaskType` 与 taskMappings 对齐（无 voice/code）

### Phase 4 — 前端 i18n（前端）✅
- [x] `CapabilitySelector.tsx`：`getDisplayName(cap, t)`/`getCategoryDisplayName(cat, t)` 传入 `t`；搜索匹配覆盖中英文显示名
- [x] `capabilityService.getDescription` 改用 `${labelKey}Desc` 扁平键翻译
- [x] `zh.ts`/`en.ts`：补全缺失 16 个能力 label+desc（含 text_to_video/image_to_video/reranking/moderation/context_caching 等）

### Phase 5 — 验证 ✅
- [x] `typecheck`（前后端）/ `lint`（改动文件 0 error）/ `lint:arch`（0 error）/ 全量测试 **2331 pass / 0 fail**
- [x] `lint:models`：硬编码违规 0；能力断链从 1 项扩展为 7 项（**均为「无 enabled 模型」的数据问题**，证明新 taskMappings 全量生效）
- [x] 前端设置页能力选择器显示中文标签（需实机确认渲染）

## 7. 合规检查表

- [ ] CS01 归一化：映射源收敛到 CapabilityService（不另起第三套）；复用 yaml 播种 + DB 表
- [ ] model-usage.md：能力键仅存在于 yaml + DB，代码不写死能力键名（D3 去除 modelRouter 硬编码）
- [ ] §1.5 模型数据一致性：task_capability_mappings 重播种后 yaml/DB 一致
- [ ] R03-002：改动集中在 ai/ 与前端 components/services，不越层
- [ ] R04-001：无新增超 800 行文件
- [ ] lint:models 白名单：如需新增协议适配白名单（如新能力键属协议层）同步登记
