# 工具名 wire codec（冒号命名空间工具无法下发到模型）

> 状态：**已实施**（2026-09-14，方案 A；含 F1 / 残余 Q3 一并落地）
> 发现时间：2026-09-14
> 触发路径：V-17 办公类门控运行期验证（`.trae/specs/module-onready-lifecycle.md` 后继）

---

## §0 实施记录（2026-09-14）

| 步骤 | 落点 | 状态 |
|------|------|:---:|
| 1 codec + 注册表反向别名 | 新增 `app/src/tools/toolNameCodec.ts`（`isWireSafeToolName`/`toWireToolName`）；`ToolRegistry.registerTool()` 自动登记 wire 安全别名（冲突跳过 + warn）、`unregisterTool()` 清理、新增 `resolveRegisteredName()` | ✅ |
| 2 出站改名 | `ChatManager._buildToolDefinitions`（chat 主链路）、`AgentTool.buildToolDefinitions`（子代理，工具池来自全局注册表 **同受影响**）+ `toolInstances` 键同步改 wire 名、`agentStrategy.buildToolDefinitions`（agent 策略） | ✅ |
| 3 入站归一 | **未找到唯一收敛点**（provider parser 分散；`TransportProviderAdapter.toParsedToolCall` 仅覆盖走 Transport 的 provider）⇒ 按 §4.4 回退：① 执行解析经 `ToolRegistry` 别名（`getTool()` 既有能力，零改动）；② 策略判定点显式归一 —— `ReActToolLoop` 门控调用点、`ToolExecutionService`（权限检查/日志/查找）；③ `agentStrategy.executeToolCalls` 按真名或 wire 名双向匹配 | ✅ |
| 4 策略层加固 | `ReActToolLoop` 门控判定前 `resolveRegisteredName`（**只扩大匹配，不产生 fail-open**） | ✅ |
| 5 白名单恢复 | `chat`/`default` 增补 `calendar`/`mail`/`doc`，并按 F1 增补 `misc` | ✅ |
| 6 运行期验证 | 见 §6（真实流式请求 + 浏览器门控走查） | ✅ |
| 7 预存 400 清理 | `image`/`video`/`tts` 等任务类型的 `media:*` 经同一 outbound codec 转安全名 ⇒ 一并消除（无需额外改动） | ✅ |
| 附：F1 | `toolCategories.ts` 注释与实现不一致（陈述"misc 保留在默认集"但未列）⇒ 实现侧补齐 `misc` | ✅ |
| 附：V-17 残余 Q3 | `createAgentLoop` 新增 `resolveInteractionTimeoutMsFromConfig()` / `resolveAutoDegradeOnTimeoutFromConfig()`，注入 `ReActToolLoop#interactionMaxWaitMs` / `autoDegradeOnTimeout`；**`external_action` 强制忽略降级开关（fail-safe）** | ✅ |

**决策记录（Q1–Q5）**：

| # | 决策 | 理由 |
|---|------|------|
| Q1 | codec 放在 `tools/`，**不**导入 `services/mcp/normalization.ts` 的谓词，各自持有同一正则常量 | `isValidMcpName` 语义是"MCP 协议名"（含 64 长度上限），用于 OpenAI wire 名会造成语义错配；正则本身是 wire 规范常量，非实现。已在 codec 文件注释中交代二者关系 |
| Q2 | 不新增统一归一 seam；按 §4.4 回退为"注册表别名 + 判定点显式归一" | 实证无唯一收敛点（见步骤 3）；新增 seam 会触及 `R03 模块边界` 且收益不确定 |
| Q3 | HTTP / 工具面（`/v1/tools`、`tool_search`）**保持真名**；仅模型侧注入用 wire 名 | 避免改动前端契约与 `api-spec.md`；真名仍是策略与用户配置的语言 |
| Q4 | 冲突 → 跳过别名登记 + `warn`（不 fail-loud、不静默改名） | 该工具降级为"不可下发"（可观测），不影响其他工具；当前全部冒号名映射唯一，无实际冲突 |
| Q5 | `local` 集不受影响 | 其白名单为 `file_read`/`search`/`interaction`，不含冒号工具 |

**未覆盖（已记录，非本方案范围）**：`chat/sessions/chatSession._buildToolDefinitions`（§3 列出的第 4 个构建点）**保持原样**。⚠ **理由已于 2026-09-14 更新（原表述"无法证实冒号名会流入"→ 实证结论：该路径未接线）**：① `_buildToolDefinitions` 仅被同类 `sendMessage()` / `streamMessage()`（`chatSession.ts#L159` / `#L217`）调用，而这两个方法**全仓无调用方**（逐条核对 `.sendMessage(` / `.streamMessage(` 调用点：全部指向 `chatManager`、provider `client`/`llmClient`、通道自身 `sendMessage`、`gateway`/`sessionManager` 抽象，**无一处指向该 legacy 会话类**）；② 拥有该类的 `ChatServiceImpl` 仅由 `chat/services/chatService.ts#L240` 的工厂构造，工厂导出仅被 `chat/index.ts#L101` 消费为单例，而该单例的实际消费者只有 `BriefTool` / `SaveConversationTool` 的 `getSessionMessages`（**不创建会话、不发消息**）。⇒ 该构建点**不在任何活的出站链路上**，故无 400 风险；修改未接线代码属无谓改动，**不改**。**若将来该路径被接线**，须按同一模式处理（出站 codec + 入站归一），并注意其 `options.tools` 由调用方提供。

**F2 已修复（2026-09-14，追加）**：`SkillTool.validateInput()` 的"同名系统工具"引导语。原实现只给出**注册名**（`calendar:add`）并断言"请直接调用该工具"——两处都不准确：① 模型侧只能用 **wire 安全名**（`calendar_add`），给注册名 ⇒ 模型照做仍可能调不到；② 该工具若被任务白名单裁掉（本次修复前办公类即是），"请直接调用"属**误导**，会诱导模型反复试错。现改为：给出 `调用名为 '<wire 名>'`，并补边界说明"若该调用名未出现在你当前可调用的工具列表中，说明本会话未启用该工具，请勿反复尝试"。回归：`tsc --noEmit` 0 + ESLint 0 + 全量测试通过。

---

## §1 现象与证据

### 1.1 直接现象

浏览器实测（`http://localhost:1420`，新建会话，发送"请调用 calendar:add 工具，为我添加一个日程…"）：

请求**未到达模型推理**即在 provider 参数校验阶段失败：

```
⚠ 请求参数有误
OpenAI stream error (400): {"error":{"message":
  "Invalid 'tools[27].function.name': string does not match pattern.
   Expected a string that matches the pattern '^[a-zA-Z0-9_-]+$'.",
  "type":"invalid_request_error"}}
```

后端日志同源（`core:api`，`severity: high`）：

```
[chatStream] OpenAI stream error (400): {"error":{"message":"Invalid 'tools[27].function.name'...
```

### 1.2 触发条件（后端日志确证）

`chat:streamFlow` 的裁剪日志（`streamMessage:tools — 按任务裁剪工具集`）对比：

| 时刻 | `taskType` | `before` | `after` | `removedNames` 含冒号工具 |
|------|-----------|---------|---------|--------------------------|
| 15:19:46 | default | 84 | 26 | ✅ 含 `media:*` |
| 15:24:20 | default | 84 | **33** | ❌ **不含** `calendar:*`/`mail:send`/`office:workflow` → 随后 400 |
| 15:31:xx（回退后） | default | 84 | **26** | ✅ 恢复含（请求 200，`finish_reason: stop`） |

⇒ 因果链闭合：**办公类类别进入 default 白名单 → `calendar:add` 进入 `tools[]` → 冒号违反函数名规范 → 400 → 整轮对话失败**。

### 1.3 更广的暴露面（预存缺陷，非本次引入）

含冒号的工具名清单（`ToolRegistry` 实际注册名）：

- `calendar:add` / `calendar:list` / `calendar:update` / `calendar:delete`
- `mail:send`
- `office:workflow`
- `media:image:convert|resize|crop|rotate|watermark|adjust`
- `media:video:compress|extract-audio|extract-thumbnail`
- `media:qr:generate|decode` / `media:pdf:extract` / `media:info` / `media:delete` / `media:deleteBatch`

`TASK_TOOL_CATEGORIES` 中**已经**含冒号工具的白名单（即**当前就会 400 的任务类型**）：

| taskType | 白名单类别 | 命中的冒号工具 |
|----------|-----------|---------------|
| `image` | `image` | `media:image:*`（6 个） |
| `video` / `text_to_video` / `image_to_video` | `video` / `media` | `media:video:*`、`media:*` |
| `tts` / `stt` | `media` | `media:*` |

⇒ 图片/视频/语音类任务**当前即处于 400 状态**（未被发现，因默认对话走 default 集）。

### 1.4 相关但不同的现象

普通对话中 `calendar:add` 的**可见但不可调用**：

- `GET /v1/tools`、`tool_search`、`SkillTool` 兜底分支读的都是 **registry（全局、含全部工具）** → 都能"看到" `calendar:add`（含参数签名）
- 模型实际可调用的函数列表来自 `registry.getToolSchemas()` **再经任务白名单裁剪** → 不含 `calendar:add`
- ⇒ 模型检索得到名字却无法调用；`SkillTool.ts#L307` 的引导语（"是系统工具，请直接调用该工具"）会给出**误导性指引**

**结论**：`1.4` 的修法（把办公类加入白名单）**必须与 `1.3` 的 codec 同时落地**，否则修一个必然触发另一个。

---

## §2 根因

**工具名是"内部标识"与"wire 格式"两种语义被混用**。

- 内部标识：`模块:动作` 命名空间（`calendar:add`）—— 便于归属、检索、策略匹配（`EXTERNAL_ACTION_TOOLS`、`TOOL_CATEGORIES`、`allowedTools` 均按此名书写）
- wire 格式：OpenAI 兼容 `tools[].function.name` 只接受 `^[a-zA-Z0-9_-]+$`（**不含冒号**）

代码在 `_buildToolDefinitions` 中把内部标识**原样**写入 wire 字段，故冒号工具一律 400。

**既有同类问题的先例（可复用）**：MCP 工具名同样不能满足该规范（含 `/`、`.`），已由 [`services/mcp/normalization.ts`](../app/src/services/mcp/normalization.ts) 归一化为 `mcp__server__tool`，并在 `MCPToolBridge` 侧映射回真实工具。**内建工具的冒号命名空间从未获得同等处理**。

---

## §3 影响面

| 层 | 受影响点 | 风险 |
|----|---------|------|
| wire（出站） | `ChatManager._buildToolDefinitions`（chat 主链路，含 `streamMessageFlow` / `ChatOrchestrator`）、`agent/strategies/agentStrategy.buildToolDefinitions`（SubAgent）、`AgentTool.buildToolDefinitions`、`chat/sessions/chatSession._buildToolDefinitions` | 冒号名 400 |
| 解析（入站） | provider 各 stream parser 产出的 `ParsedToolCall.name` → `ToolCall.name` → `ReActToolLoop` | 若出站改名，入站须回真名，否则 `getTool()` 查不到 |
| **策略/权限（按名判定）** | `chat/services/DecisionGate.EXTERNAL_ACTION_TOOLS`、`agent/tool-policy.OWNER_ONLY_TOOL_APPROVAL_CLASSES`（经 `normalizeToolName`）、`permission/`（`checkPermission(toolName)` / `PermissionSyncManager.isToolAllowed`）、`config.allowedTools` / `disallowedTools` | **若策略层拿到安全名而规则写的是真名 → 规则失配 → 潜在 fail-open（安全回归）** |
| 展示/工具面 | `GET /v1/tools`、`tool_search`、`skill_view`、`ToolSearchEngine`、前端工具块渲染、日志/审计 | 名称不一致会让模型"看到的名字"≠"能调用的名字"（§1.4） |

---

## §4 候选方案

### 方案 A：出站安全名 + 入站真名（wire codec）— 推荐

1. **新增 codec（唯一实现）**：`app/src/tools/toolNameCodec.ts`
   - `toWireToolName(name)`：`name` 已合规则原样返回；否则非法字符 → `_`（`calendar:add` → `calendar_add`、`media:image:convert` → `media_image_convert`）
   - `isWireSafeToolName(name)`：`^[a-zA-Z0-9_-]+$`
   - **不新增平行机制**：与 `services/mcp/normalization.ts` 的关系在 §7 Q1 决策（复用其 `isValidMcpName` 或提取共享谓词）
2. **注册期建立反向索引**：`ToolRegistry.registerTool()` 内，为不合规名自动登记 `toWireToolName(name)` 为**别名**（复用既有 `aliases` map 与 `getTool()` 的别名解析，**不新建映射表**）；若安全名与既有工具名/别名冲突 → 跳过并 `logger.warn`（该工具降级为不可下发，不静默）
3. **出站改名**：所有 `buildToolDefinitions` 实现统一 `name: toWireToolName(schema.name)`
4. **入站回真名**：在**工具调用解析的单一收敛点**把 wire 名归一为真名（`registry.getTool(wireName)?.name ?? wireName`），使下游（策略、权限、审计、执行、日志）**全部只见到真名**
   - 关键：必须先定位唯一收敛点；若不存在唯一收敛点，则须在各 provider parser 后统一归一（§7 Q2）
5. **策略层兜底加固**（即使 §4.4 落地，仍建议）：`classifySignal` 等按名判定处先经 `registry.getTool(name)?.name ?? name` 取值 —— 该方向**只会扩大匹配**，不产生 fail-open
6. **工具面一致**：`tool_search` / `skill_view` / `GET /v1/tools` 返回给模型的**可调用名**须与 wire 名一致（HTTP 契约是否保持真名，见 §7 Q3）

**优点**：一次修好全部冒号工具（calendar/mail/office/media）；不改内部命名约定；复用既有别名与 MCP 先例。
**缺点**：跨 4 个层（wire/解析/策略/展示），需逐层验证；入站唯一收敛点若不存在则改动点增多。

### 方案 B：重命名工具为下划线名（`calendar:add` → `calendar_add`）

**否决**：侵入面极大（注册、`EXTERNAL_ACTION_TOOLS`、`TOOL_CATEGORIES`、`allowedTools` 配置、测试、文档、前端展示），且废弃既有的"模块:动作"命名约定，收益与风险不匹配。

### 方案 C：维持现状（冒号工具永不进任何任务白名单）

**否决（单独使用）**：可消除 400，但办公类工具在对话中**永久不可用**（V-17 的办公类覆盖无法达成）；且 `image`/`video`/`tts` 任务类型的预存 400 依旧存在。

---

## §5 推荐

**方案 A**。落地顺序（每步独立可验证）：

1. codec + `ToolRegistry` 反向别名 + 单测（含冲突用例）
2. 出站改名（4 个 `buildToolDefinitions`）+ 单测（断言 wire 名全合规）
3. 入站归一（唯一收敛点）+ 单测（wire 名 → 真名 → 命中 Tool）
4. 策略层加固（`DecisionGate` 真名解析）+ 回归（`EXTERNAL_ACTION_TOOLS` 13 项对 wire 名同样命中）
5. **白名单恢复**：把 `calendar`/`mail`/`doc` 加入 `chat`/`default`（本方案的业务目的）
6. 运行期验证：`calendar:add` 冒号工具 → 弹"决策确认"卡 → 取消 → `.ics` 零新增
7. 清理预存 400：确认 `image`/`video`/`tts` 任务类型不再 400

---

## §6 验证计划

| # | 断言 | 手段 |
|---|------|------|
| 1 | 所有 wire 名满足 `^[a-zA-Z0-9_-]+$` | 单测：对 `registry.getToolSchemas()` 全体断言 |
| 2 | wire 名 ↔ 真名双向可逆、无冲突 | 单测：往返 + 冲突用例 |
| 3 | 入站 wire 名可解析到真名 Tool | 单测：`getTool('calendar_add').name === 'calendar:add'` |
| 4 | 门控对 wire 名同样命中 | 单测：`classifySignal({toolName:'calendar_add'})` → `external_action` |
| 5 | 对话不再 400 | 运行期：`stream:true` 真实请求 HTTP 200 + 日志无 `invalid_request_error` |
| 6 | 办公类弹卡 + 取消零副作用 | 运行期（浏览器）：弹卡 → 取消 → `~/.pyapp/office/calendars` 新增数 = 0 |
| 7 | 全量回归 | `tsc --noEmit` + 全量 `bun test` + `lint:arch` + ESLint |

---

## §7 开放问题（待决策）

| # | 问题 | 选项 |
|---|------|------|
| Q1 | 与 `services/mcp/normalization.ts` 的关系 | (a) 复用其谓词、codec 放 `tools/`（推荐，避免两套实现）(b) 提取公共 `toolNameWire.ts`，MCP 层改为引用 |
| Q2 | 入站唯一收敛点是否已存在 | 需先取证（provider parser 产出 `ParsedToolCall` 的位置是否唯一）；若分散，是否新增统一归一 seam（涉及 `R03 模块边界`） |
| Q3 | `GET /v1/tools` / `tool_search` 对外契约用真名还是 wire 名 | (a) HTTP 保持真名、仅注入模型侧用 wire 名（推荐，避免动前端与 api-spec）(b) 全链路改 wire 名（改动面大） |
| Q4 | 冲突时（安全名撞既有工具名）的处置 | 目前设计为"跳过 + warn"；是否需改为报错 fail-loud |
| Q5 | 是否同时把 `local`（小上下文）集视为受影响 | `local` 白名单为 `file_read/search/interaction`，不含冒号工具 → 不受影响，无需改动 |

---

## §8 附属发现（本次取证记录）

| # | 发现 | 处置 |
|---|------|------|
| F1 | `toolCategories.ts#L12` 注释称"未列出的工具默认归 `misc`（**保留在默认集**）"，但 `TASK_TOOL_CATEGORIES.default` **不含 `misc`** ⇒ 注释与实现矛盾，`MCPTool`/`browser`/`computer_use`/`plan`/`canvas`/`clipboard`/`mcp_resource` 等**在普通对话中不可调用** | 并入本方案评审（是否补 `misc` 进 default 属产品决策，非纯缺陷） |
| F2 | `SkillTool.ts#L307` 对"同名系统工具存在但模型不可调用"的场景给出**误导性引导**（"请直接调用该工具"），实际模型侧无该函数 | 建议改为提示"该工具未在当前会话启用"，可并入本方案第 5 步 |
| F3 | 预存 400：`image`/`video`/`text_to_video`/`image_to_video`/`tts`/`stt` 任务类型白名单含冒号工具 | 由方案 A 第 7 步统一消除 |
