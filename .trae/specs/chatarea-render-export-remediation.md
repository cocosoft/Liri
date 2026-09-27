# ChatArea 渲染 & 聊天记录导出 —— 排查结论与修复计划

> 状态：**待评审 → 按阶段执行**（本文档为"先查尽、再逐一修"的收敛产物）
> 生成：2026-09-27 | 方法：3 路并行（ChatArea 渲染代码审计 / 导出链路端到端审计 / 真机浏览器实测）+ 关键结论人工复核
> 相关台账：[预存错误与待处理问题.md](../../dev_docs/error_repairs/预存错误与待处理问题.md)

---

## 0. 证据分级（本文档统一口径）

| 标记 | 含义 |
|---|---|
| **[实测]** | 真机 DOM/网络/console 实测数值，或后端 API 实测返回 |
| **[代码]** | 已逐行读源码确认（附 文件:行号） |
| **[待验]** | 仅有推断/单一侧证据，修复前需先验证 |

> CS06：任何无证据推断都不作为修复依据。

---

## 1. 已修（本会话，2026-09-27，供去重）

| # | 问题 | 位置 | 状态 |
|---|---|---|---|
| X1 | 长文件路径 chip 不换行撑破气泡 → 横向滚动条 | `components/ChatArea/FileLink.tsx` | ✅ 已修并真机复验 |
| X2 | legacy 路径 `blocks` 有效即透传 ⇒ `<think>/<response>` 按正文渲染 | `stores/chat/chat-toolcall.slice.ts#stripProtocolTagsInBlocks` + `legacyMessageImporter.ts` + `chat-message-set-messages.ts` | ✅ 已修并真机复验 |
| X3 | **孤儿** `role:tool` 消息卡片显示信封 JSON | `components/ChatArea/ToolResultMessage.tsx` | ✅ 已修并真机复验 |

---

## 2. 结论摘要（按严重度）

| 级别 | 数量 | 代表问题 |
|---|---|---|
| P0 严重 | 6 | 调试面板泄漏到正式渲染、工具结果信封 JSON 仍可见（另一条渲染路径）、导出 Markdown 含信封 JSON、`chat.tool` 缺键、表格空单元格丢列、轮次导航在虚拟列表下点击无效 |
| P1 中 | 17 | 导出内容不完整/无元数据/无转义、块被静默截断且无出口、memo 漏比较字段、`prose` 类全站失效、暗色专用配色在 light 模式不可读、死按钮、CS02 字符串状态匹配 |
| P2 低/维护 | 20+ | i18n 全量迁移、重复渲染实现收敛、死代码清理、性能与可访问性 |

---

## 3. P0：先修（用户可见 / 改动小 / 风险低）

> **执行状态（2026-09-27，第 1 批已执行）**
> - ✅ **P0-1**（调试面板）：已改为显式 opt-in（`VITE_SHOW_DEBUG==="true"`）。**更正**：原判"无条件渲染"过重——实际已有 `NODE_ENV==="development"` 门控（仅 dev 可见，生产构建不出现）。真机复验：`Debug:`/`🐛` 计数 **0**。
> - ✅ **P0-2**（信封渲染）：合并入口改为 `decodeToolResultContent`。真机复验：工具卡 7 张，`"type": "tool_result"`/`toolCallId` 计数 **0**，正文为真实输出（无 `\"` 转义）。
> - ✅ **P0-4**（i18n 缺键）：补 `chat.tool`（zh/en）+ 菜单项走 `t()`。产物复验：`chat.tool` 键名 **0**。
> - ✅ **P0-5**（表格列错位）：`splitCells` 保留空单元格 + 行按表头补齐。真机 6 张真实表格列数 **6/6 一致**；空单元格分支由单测覆盖（突变验证：还原旧 filter ⇒ 1 fail）。
> - ⚠️ **P0-6**（轮次导航）：点击已改为虚拟列表可达（`highlightedRoundId`），真机点击**已生效且按轮单调**（1→10963、2→11057、3→11669、4→11763）；但落点按既有 `align:"center"`，且"第 1 轮"≠ 会话首轮（**分页未加载更早消息**）⇒ 轮数口径不一致归 **P1-6**，落点策略归 **D5**。
> - ✅ **P0-3 + D7**（导出）：tool 消息合并进助手消息 + 解码。产物复验（新导出 vs 修复前）：角色节 **50 → 13**、`🛠` 节 **12+ → 0**、`tool_result` **20+ → 0**、字面 `\n` 转义 **→ 0**、字节 **42KB → 10.7KB**；JSON `role:tool` **→ 0**、`tool_result` **37 → 0**。
> - ℹ️ 导出产物复核仍见（属 P1 计划内）：进度噪音（P1-18）、进行时摘要（P1-21）、JSON 静默截断 5000（1 处，P1-2）。

### P0-1 调试面板泄漏到正式对话流 **[实测+代码]**

- **现象**：助手气泡顶部渲染红框 `🐛 Debug: N blocks`，实测一个会话内出现 4 处（`10/11/7/30 blocks`）；展开显示 msgId、块类型、groupId、isStreaming 等内部信息。
- **证据**：`components/ChatArea/ChatMessage.tsx:1296` 无条件渲染 `<DebugBlockInfo .../>`，组件定义在同文件 `:1311-1322`。
- **修法**（择一，建议 a）：
  a. 删除 `DebugBlockInfo` 与调用点（内部信息已有轨迹视图/日志承载）；
  b. 用构建期常量门控（`import.meta.env.DEV`）+ 默认关闭。
- **验收**：任一会话 DOM 内不再出现 `🐛 Debug:` 文本（真机 + 简单断言测试）。

### P0-2 工具结果信封 JSON 仍经**另一条路径**可见 **[实测+代码]**

- **现象**：工具芯片 → 详情 → `结果` 区显示 `[{"type":"tool_result","value":"{\"matches\":[],…}","toolCallId":"call_00_…"}]`（双重编码 + 转义反斜杠）。X3 只修了**孤儿 `role:tool` 卡片**这条路径。
- **根因**：`stores/chat/chat-message-set-messages.ts:110-113` 把 tool 消息 content（= 信封 JSON）**原样**写入 `toolResultsByCallId` 与 `cacheToolResult`，Phase 3 再合并进 `block.toolCall.result` ⇒ `ToolCallGroup` 的结果区（`ToolCallGroup.tsx:226-231` 走 `MarkdownRenderer`）显示信封。
- **修法**：在**唯一入口**解包（CS01 归一化）：`chat-message-set-messages.ts:110-113` 处对 `rawContent` 调用既有 `unwrapToolResultEnvelope()` 后再 set/cache。
- **验收**：真机打开含工具调用的会话，`"type": "tool_result"` 计数 = 0；`_hasFullResult` 展开后亦为真实输出。

### P0-3 导出 Markdown 中的 tool 消息未解包 **[实测+代码]**

- **根因**：`client/src/utils/messageText.ts:137-138` 对 `message.content` 直接 push（仅判断是否字符串），tool 角色即信封 JSON。
- **产物实证**（用户提供 `chat-export-1790486543020.md`，406 行 / 42KB）：`[{"type":"tool_result","value":…,"toolCallId":"…"}]` 出现 **20+ 处**，且以 `### 🛠 chat.tool (…)` **单独成节** —— 同一工具在助手消息内已有 `🔧 写入文件 — 正在写入：…` 摘要 ⇒ **重复且噪声**。
- **附加形态**（同一产物）：
  - `value` **双重编码**：`"value":"\"{\\n  \\\"questionId\\\"…}"` ⇒ 仅解信封仍留转义噪声，需**再解一层** JSON 字符串；
  - **空信封**：`[{"type":"tool_result","toolCallId":"call_00_seHq…"}]`（无 `value`）⇒ 需兜底文案而非空白。
- **修法**：tool 角色 content 先 `unwrapToolResultEnvelope`（并做二次 JSON 解码美化 + 空值兜底）；同时**决定是否保留 tool 单独成节**（见 §6 D7）。
- **验收**：补单测——输入信封 → 导出文本不含 `"type": "tool_result"`；双重编码 → 输出为可读 JSON 而非 `\"`。

### P0-4 i18n 缺键 + 硬编码并存 **[实测+代码]**

- `client/src/i18n/locales/zh.ts:199-202` 只有 `assistant/user/system` + `toolResult`，**无 `chat.tool`**；而 `SessionHeader.tsx:53` 用 `labels.tool`。
- **产物实证**：导出件中角色标题逐字为 `### 🛠 chat.tool  (2026/9/6 12:20:24)` ⇒ **渲染出的是键名本身**（非空白），已确认。
- `SessionHeader.tsx:397` 「导出为 Markdown」硬编码中文，而 `chat.exportAsMarkdown`（`zh.ts:385`）已存在。
- **修法**：补 `chat.tool`（zh/en 同步），菜单项改走 `t()`。
- **验收**：`bunx vitest` 全绿 + 真机复验导出件标题为「工具」。

### P0-5 表格空单元格被丢弃 ⇒ 列错位 **[代码]**

- **根因**：`components/ChatArea/TableBlock.tsx:14-20` `splitCells` 用 `.filter(cell => cell.trim())`，`| a |  | c |` 变 2 格 ⇒ 表头/分隔行/数据行列数错位。
- **修法**：不丢空 cell（只剥首尾 `|` 产生的空串），按表头列数对齐补空；保留 `\|` 转义保护。
- **验收**：新增单测（含空单元格、含 `\|`、列数不齐）——突变验证：还原 filter ⇒ 用例转红。

### P0-6 轮次导航在虚拟列表下点击无效 **[代码+实测旁证]**

- **根因**：`components/ChatArea/RoundNavigator.tsx:201-206` 与 `:222-229` 用 `container.querySelector('[data-msg-id=…]')` 定位消息；消息列表为虚拟列表，离屏消息不在 DOM ⇒ 点较远轮次**静默无反应**，且每次 scroll 对每轮做一次 DOM 查询（O(轮数)）。
- **另有**：实测导航锚点数（4）与 header 轮数（7）不一致（见 P1-6）。
- **修法**：改用 `VirtualScrollContext` 暴露的 `scrollToMessageId`（已存在），移除 querySelector 路径；轮数口径与 header 对齐。
- **验收**：真机在 20+ 轮会话点击第 1 轮/最后一轮均能定位；单测覆盖 rounds 与 messageId 解析。

---

## 4. P1：中优先级

> **执行状态（2026-09-27，第 2 批已执行）** —— 已修并复验：
> - ✅ **P1-1**（JSON 丢块级结构化载荷）：改为 `{...b}` 透传。**产物实证**：`questionData` **0 → 2** 处命中（`taskCard` 该会话本无此块，符合预期）。
> - ✅ **P1-2**（静默截断）：改为带标注截断。产物实证：`已截断：仅导出前 5000 字` 命中 **6** 处。
> - ✅ **P1-3**（无会话元数据）：md 补头部（`# 标题` + 会话 ID + 消息数/轮数 + 导出时间）、json 改为 `{session, exportedAt, messageCount, messages}`。**产物实证**：两份文件均已带元信息。
> - ⚠️ **P1-4**（导出内容结构保护）：**最小化实现**——仅转义与自身标记同形的角色标题行（`\### 👤/🤖/⚙️/🛠 `）；`---` 歧义与渲染器层面的 HTML 执行风险**有意不做**（全文 HTML 转义会破坏正文里合法的 Markdown/HTML 代码示例，降低保真度）。产物实测无碰撞样本（`escaped-role-headings = 0`）⇒ 仅源码级验证。
> - ✅ **P1-7**（`ChatMessage` memo 漏比较字段）：补 `error/finishReason/durationMs/agentName/timestamp/replyToId`。
> - ✅ **P1-8 + P1-21**（进行时文案）：摘要时态随状态（终态 `正在→已`）。**真机 + 产物双重实证**：17 个工具芯片中含「✓ + 正在」的 **0** 个；导出件 `已写入/已搜索/已读取/已询问` 命中 **27** 处。
> - ✅ **P1-12**（暗色专用配色 light 不可读）：`ThinkingBlock`（颜色移交 Tailwind 类）、`ImageToolResult`、`OcrResult`、`AnalysisResultCard`、`DocWorkflowProgress` 补 light 基础色 + `dark:` 变体。**真机浅色模式实测**：思考块标题 `rgb(75,85,99)`、正文 `rgb(31,41,55)`，可读。
> - ✅ **P1-13**（死按钮）：无 `onAction` 处理者时不渲染操作按钮。
> - ✅ **P1-14**（截断无出口）：超长正文补「复制全文」；工具 JSON 超限补「复制完整结果」。**未触发样本** ⇒ 源码级验证。
> - ✅ **P1-15**（Diff 文案误导）：`✓ 接受` → `复制 diff`、`✗ 拒绝` → `✗ 忽略此改动`、占位文案 `已拒绝` → `已忽略`、提示语补"此处不会自动改动文件"。**未找到 diff 样本** ⇒ 源码级验证。
> - ✅ **P1-16**（CS02 字符串状态匹配）：`GroupStatusLine` 只按结构化 status 精确匹配，删除 `content.includes(...)` 兜底。
> - ✅ **P1-18**（导出进度噪音）：过滤通用进度占位。产物实证：`任务执行中/正在等待模型` 命中 **2 → 0**。
> - ✅ **P1-17**（长会话滚动）**已达成（D5 = B，2026-09-27，经 7 轮真机迭代）**：
>   - **A 通过**（整页重载进入长会话贴底：2s/5s/8s 三点 `distance` 恒 0，读数逐字节一致）；
>   - **B 通过**（切走切回恢复阅读位置：`offsetFromEnd` 10→11、`topVisibleIndex` 10→9，差值均 1 ≤ 2；2s/5s/8s 稳定不抖动；未落底部亦未落顶部——`distance/scrollHeight ≈ 0.943`，`scrollTop` 精确等于切走前顶部可见消息的 `translateY`）；
>   - **C 通过**（手动滚动 1s/4s/8s `scrollTop` 恒为 15207，未被抢回）；
>   - 实现（`ChatMessageList` 侧；`useAutoScroll` 已降为"只负责跟随与按钮态"）：**距尾偏移锚点** `SCROLL_ANCHORS`（`Map<会话, offsetFromEnd>`，LRU 50）+ **DOM 几何判定顶部可见项** + **恢复窗口 5s / 120ms 定时重应用**（解决"惰性测高期被 clamp 到中段"）+ **窗口起始 800ms 静默期**（避免加载期 scroll 事件误取消）+ **用户滚动即取消**（80ms 宽限）+ 锚点写入双重守卫（窗口内不写、只写属当前会话的消息）+ **窗口与定时器无条件启动**（修复"消息异步到达即 early-return ⇒ 定时器从未启动"）。
>   - **第 7 轮定位并修复的根因**：锚点原读 `virtualizer.getVirtualItems()[0].index` —— ① 它是**最小已渲染索引（含 overscan=10）**，比真实阅读位置靠前约 10 条；② scroll 事件当拍 React 尚未按新 `scrollTop` 重渲染，读到的是**上一帧**范围。实测"从底部向上滚"被记成底部 overscan 起点（锚点 10 而非 29），切回 `scrollToIndex(19)` 落点 `translateY(19)=76144`（偏 9 条），与该读数完全吻合。修法：延后一帧、按 `[data-index]` 元素与容器顶边的**几何相交**取顶部可见项（渲染顺序即索引顺序），并对 scroll 做 rAF 去抖（避免逐个读几何强制同步布局）。
>   - **残留限制（已知、非本次验收项）**：恢复按**索引对齐到消息顶部**，不保留"消息内部像素偏移"（实测一次丢失 1390px 内偏移）——单条消息高于一屏时落点会吸附到该消息起始处。若需像素级记忆，需另存"索引 + 消息内偏移比例"，留待后续。
>   - 附带观察（本项已可解释，非缺陷）：长会话中段"无 >20px 元素"与 `scrollHeight` 大幅波动（50825→57556→50691→50906）同源——虚拟列表**估算高度 → 实测高度**的收敛过程，属固有行为。
> - ✅ **P1-5 / P1-14**（导出覆盖度与截断可见性，**D6 = B：默认轻量 + 完整版导出**，2026-09-27 已实施）：
>   - `utils/messageText.ts`：`getMessageExportText(msg, full=false)` —— `full` 时思考不截断（原 300 字）、工具结果不截断（原 200 字）、工具调用附 `json` 参数块；
>   - `ChatArea/SessionHeader.tsx`：`exportAsMarkdown(..., { full })`；导出菜单新增第 2 项「导出为 Markdown（完整版）」（`chat.exportAsMarkdownFull`，文件名 `chat-export-<ts>-full.md`），与轻量版共存；菜单共 5 项（Markdown / Markdown（完整版）/ JSON / HTML / Word）。
>   - i18n 新增 `chat.exportAsMarkdownFull`（zh:「导出为 Markdown（完整版）」/ en:「Export as Markdown (Full)」）。
>   - **真机核验（2026-09-27，21 轮 / 48 消息会话）**：完整版 `chat-export-1790494916926-full.md` **10352 行 / 导出器截断标记 0 处**；轻量版 `chat-export-1790495002883.md` **1910 行 / 截断标记 22 处**（均为「（思考过长，已截断：仅导出前 300 字…）」，最大原文 16307 字）⇒ 完整版不截断成立。
> - ✅ **P1-6**（轮数口径）**已修复并真机复验（2026-09-27，D8 = 统一到总量 + 尾锚定）**：导航器轮数改取后端 `session.roundCount`（与 header / 侧栏 / 导出同源），已加载部分按**尾锚定**绝对编号；渲染门槛改总量口径 —— 尾页无 user 消息时不再"整体消失"，改为 `↑N`（更早 N 轮未加载）入口。**真机 9 会话验证**：`4 轮→2,3,4`、`7 轮→6,7`、`8 轮→5,6,7,8`、`3 轮→3`（最大轮号 == 徽标总数）；不变式 `↑N + 数字按钮数 = 总轮数` 处处成立。
> - 🆕 **P1-6b（本轮新确证缺陷）：长会话「↑ 加载更早消息」点击后无任何反应** —— 根因：尾页 30 条 `lastEventSeq` **全缺**（该会话全量 709 条仅 16 条具备）⇒ `oldestSeq = null` ⇒ `loadOlderMessagesImpl` 首行守卫**静默 return**。**D9 = 根因修复 + 可见反馈**：前端可见反馈（warn + 不可点击提示 + i18n）与**后端读取侧统一分页键**均**已实施并真机验收通过**（详见 §10.0：25 页覆盖全量 709 条、每页首条 seq 恒有值、末页 `hasMore=false`；前端游标链 `before=5382→4943` 正确推进）。
> - ℹ️ **P1-6 诊断数据**（后端原始响应，会话 `session_mtw7nr44dkgini0x0a5`）：`limit=30` ⇒ 30 条**全为 `tool`**、`hasMore=true`；全量 ⇒ **709 条 = tool 661 / assistant 27 / user 21**，最后一条 user 在索引 662（**距尾 47 条 > 每页 30**）⇒ 尾页必然无 user。台账详见 `dev_docs/error_repairs/预存错误与待处理问题.md`「P1-6 诊断」。
>
> **第 5 批（P2-3 死代码 + D2/D3 收尾）已执行（2026-09-27）**
> - ✅ **P2-3 死代码清理**（先逐个 grep 复核零引用，再删）：删除 `AgentProgressBlock.tsx`、`CouncilPanel.tsx`、`OutlineConfirmCard.tsx`、`ImageToolResult/ImageCompareView.tsx`、`ImageToolResult/ClickableImageRef.tsx`（共 5 个文件，全部仅自引用）；`PdcaActivityStrip.tsx` 的**组件本体零引用** ⇒ 删除组件 + 专属 `AutoLaunchedBanner` + 无用 imports，**保留被 4 处复用的具名导出**（PROGRESS_EVENT_TYPES/AUTO_LAUNCHED_TYPE/STAGE_META/DECISION_META/FALLBACK_META/findLatestEvent/stageMetaOf/textOf），并在文件头写明现状与"可另行重命名"提示。
> - ✅ **D2 定案 = 补齐 HTML/Word**：会话级导出新增两项（菜单 4 项），实现**复用** `utils/exportMessage#exportMessageAsFormat`（md→HTML/Word 壳，CS01 不另立实现）；`handleExportMarkdown` 抽出 `buildSessionMarkdown()` 供三种格式共用；三个 handler 补 catch → `handleClientError`。真机复验：菜单逐字为 `导出为 Markdown / 导出为 JSON / 导出为 HTML / 导出为 Word`，HTML/Word 均执行成功（产物已核对）。
> - ✅ **D3 定案 = 维持浏览器 blob 下载**（不改后端落盘，与 `~/.pyapp` 三层路径无交集）。
> - 🆕 **新发现并修复：导出未闭合代码围栏会吞掉后续消息**（本轮新缺陷）：某条消息正文含**奇数个** ``` （内容被截断/模型未闭合）⇒ Markdown 渲染器把其后**所有**消息当作代码块内容（实测第 8 条之后 5 个角色标题与 `---` 分隔线全进 `<pre>`）；md / html / word **三种格式同源受影响**。修法：`utils/exportMessage#balanceCodeFences`（逐条补齐闭合围栏）+ 单测 + 真机复验：
>   | 指标 | 修复前 | 修复后 |
>   |---|---|---|
>   | HTML 内 `<h3>`（角色标题被转换数） | **8** | **13** |
>   | HTML 内残留字面 `### ` | **5** | **0** |
>   | `<pre>` 块数（应仅真实代码块） | 4 | 4 |
>
> **第 3 批（P1-9 / P1-10 / P1-11）已执行 —— D1 定案 = C（清理失效类 + 明确归属）**
> - ✅ **P1-9**（`prose*` 全站失效）：**更正原判"排版缺失"过重** —— 实测 Tailwind 3（`@tailwind base/components/utilities`）+ `plugins: []` + 无 `@tailwindcss/typography` ⇒ `prose*` 确为失效类，但聊天 markdown 的排版由自定义渲染器（HeadingRenderer / ListRenderer / TableBlock / CodeBlock）+ 全局 `pre`/hljs 规则承担，真机排查中标题/列表/表格/代码块渲染**均正常**。故按 D1=C **清理 11 处失效类**（聊天 2、文件预览 2、知识库编辑 1、知识页 1、文件浏览器 2、帮助页 1、Office 预览 1）——**零视觉变化**，只消除"看起来在生效"的误导。
> - ✅ **P1-10**（`.streaming-cursor` 同名双定义）：`index.css`（2px 闪烁光标）与 `markdown-theme.css`（26px 三点脉冲）均全局引入，生效取决于注入顺序（dev 实测为 index.css）⇒ 删除 3 点脉冲块 + `pulse-dot` keyframes，保留**单一实现**（即当前实际生效者，零视觉变化，且 dev/build 收敛一致）；同步更正 `ChatMessage` 中与生效样式不符的注释。
> - ✅ **P1-11**（主题归属不清）：`markdown-theme.css` 头部补归属说明（`.markdown-body` 仅 SkillDetail 使用；聊天区不使用；`prose*` 未安装；标题 `!important` 的迁移前置条件）。

| # | 问题 | 位置（关键证据） | 修法要点 |
|---|---|---|---|
| P1-1 | JSON 导出丢**块级结构化载荷**：`taskCard`/`questionData`/`deliverableData`/`diffData`/`*WorkflowData`/块级 `error` 全丢（**更正**：消息级 `toolCalls` **已在**导出，故 `toolCall.arguments` 并未丢失——原判断过重） | `SessionHeader.tsx:78-88` **[代码]** + 产物实证（`"taskCard"`/`"questionData"` 在 JSON 中**零命中**，`"arguments"` 有命中来自 `toolCalls`） | 透传 `{...b}`，仅对超长 `content` 做**带标注**截断 |
| P1-2 | JSON 导出静默 `substring(0,5000)` 无标注 | `SessionHeader.tsx:80-83` **[代码]** + 产物实证：恰好 `content` 长度 == 5000 的块 **2 个** | 复用 `messageText.ts:130-133` 的无歧义标注（保留量+原文量+去处） |
| P1-3 | 导出**无会话元数据**（标题/ID/工作区/时间/轮数） | `SessionHeader.tsx:38-106` **[代码]** | 头部补元数据块（md 前言 + json 顶层字段） |
| P1-4 | 导出内容**无转义/无围栏**：内容含 `---`/`###`/内联 HTML 会破坏结构（含注入风险） | `SessionHeader.tsx:70` **[代码]** | 角色标题行结构化隔离 + 内容 HTML 转义（对齐 `utils/exportMessage.ts:91-97` 的既有做法） |
| P1-5 | 导出 Markdown **thinking 截 300 字**、工具结果 **截 200 字**、工具调用**仅摘要无参数** | `messageText.ts:110-136,178-219` **[代码]** | 明确"可选全量导出"；或至少补"去哪看完整内容"的指引（现已部分具备） |
| P1-6 | 轮次导航锚点数与会话轮数不一致（实测 4 vs header 7；另 21 轮会话**完全不渲染**导航）——根因：`rounds` 只基于**已加载**消息，而分页更早消息未加载；且尾页可能**一条 user 都没有**（实测 709 条中最后一条 user 距尾 47 条）⇒ `rounds.length = 0` ⇒ 组件 return null | `RoundNavigator.tsx` rounds 来源；真机 2026-09-27 三会话 + 后端原始响应 **[实测]** | **✅ 已实施（D8）**：轮数改取后端总量 `session.roundCount`（与 header 同源）；渲染门槛改总量口径；已加载部分按尾锚定绝对编号；无 user 消息时给「更早 N 轮未加载」入口 |
| P1-7 | `ChatMessage` 自定义 memo **漏比较** `error/finishReason/durationMs/agentName/timestamp/replyToId` ⇒ 流结束回填时不重渲染 | `ChatMessage.tsx:1047-1101` **[代码]** | 补比较字段（或改浅比较 + 稳定 props） |
| P1-8 | 工具芯片文案 `正在…` 与 `✓` 已完成状态冲突 | 真机实测（`✓ 文件搜索 正在搜索文件：*`） | 文案随 status 变化（完成态用"已…"） |
| P1-9 | `prose`/`prose-sm`/`prose-invert` **全站无样式**（无 typography 插件、无自定义 `.prose`） | `tailwind.config.js:11` `plugins: []`、`package.json` 无 `@tailwindcss/typography` **[代码]** | 二选一：装插件，或给 `MarkdownRenderer` 挂既有 `.markdown-body` |
| P1-10 | `.streaming-cursor` **同文件双定义**（2px 竖条 vs 26px 三点） | `src/index.css:182-190` vs `ChatArea/markdown-theme.css:293-340` **[代码]** | 保留一份（dev/build 注入顺序不同可能不一致） |
| P1-11 | `markdown-theme.css` 的 `.markdown-body` 仅 SkillDetail 使用，聊天区从未挂载 | 同上 **[代码]** | 归属明确化（配合 P1-9） |
| P1-12 | 暗色专用调色板在 **light 模式**不可读（`bg-red-900/20`+`text-red-300` 无 `dark:` 配对） | `ImageToolResult.tsx:36,44,99`、`analysis/OcrResult.tsx:20,36,46`、`DocWorkflowProgress.tsx:77,95,163,195`、`ThinkingBlock.tsx:62-95` **[代码]** | 补 light 基础色 + `dark:` 变体；去掉内联 hex |
| P1-13 | `DeliverableCard` 回调未接通 ⇒ "进入工作模式"永不渲染、action 按钮空操作 | `BlockRenderer.tsx:131` 只传 `data` **[代码]** | 接通回调或删除无效 UI（死按钮比缺失更糟） |
| P1-14 | 块内容静默截断且无出口：>150000 字符消息只渲染前 5000；工具 JSON >50000 只显示前 3000 | `MarkdownRenderer.tsx:56-76`、`ToolCallGroup.tsx:94-113` **[代码]** | 补"复制全文 / 导出"出口 |
| P1-15 | `DiffBlock` "接受"按钮实际行为是**复制到剪贴板**（文案与行为不符） | `DiffBlock.tsx:144-151,182-201` **[代码]** | 改文案为"复制 diff"，或实现真正 apply |
| P1-16 | CS02 违规：状态判定用字符串匹配（`content.includes("Running")` 等） | `GroupStatusLine.tsx:21-26`、`StatusFloatBar.tsx:282-289`、`WatermarkTag.tsx:19-26` **[代码]** | 收敛到结构化字段（后两处已有 `TODO: CS05-ROOTFIX`） |
| P1-17 | 长会话初始滚动位置不一致：21 轮会话停在中部、二次进入回**顶部**且"滚动到底部"按钮**不出现** | 真机实测表 **[实测]** | 定义期望（建议：进入即贴底 + 按钮常驻直到贴底）；虚拟列表测高不稳定需一并评估 |
| P1-18 | **导出含进度噪音**：`📊 [进度] 任务执行中，正在等待模型/工具响应...` 落进导出件（`messageText.ts` 只过滤了 `Running tool:` 等一类） | 产物实证（md:31-32） **[实测]** | 扩展导出过滤规则（进度类块默认不导出或折叠为一行） |
| P1-19 | **tool 消息单独成节且与助手内 `🔧 …` 摘要重复**（同一产物中 50 个角色节 / 12+ 个 `role: tool` 节） | 产物实证 **[实测]** | 见 §6 D7：合并进所属助手消息 or 保留但去重 |
| P1-20 | **导出件无会话元数据**（实测首行即 `### 👤 用户`） | 产物实证 **[实测]** | 同 P1-3（本条为其产物证据） |
| P1-21 | 工具结果摘要用**进行时**文案（`🔧 写入文件 — 正在写入：… (17743 字符)`）导出的“已完成”记录语义矛盾 | 产物实证（md:35） **[实测]** | 同 P1-8（导出侧复用同一修法） |

---

## 5. P2：维护性 / 体验打磨

> **执行状态（2026-09-27，第 4 批已执行——决策无关子集）**
> - ✅ **P2-4 性能（子集）**：`VirtualScrollContext` 的 value/两个回调 → `useMemo`+`useCallback`（原每次 render 新建 ⇒ Provider 全体消费者重渲染）；`PdcaWorkflowCard.useLiveProgress` 与 `PdcaActivityStrip` 的 `findLatestEvent` → `useMemo`（后者**必须置于早退 return 之前**以保持 hooks 无条件）。
>   ⚠️ **`SessionListItem` 日志降级（info→debug）已回退**：`race-condition-logs.test.tsx` 以 `console.info` spy 锁定这三条竞态排查日志（spy `console.info`），降级即破坏既有契约（测试失败实证）⇒ 保留 `info`。
> - ✅ **P2-5 可访问性（子集）**：`CodeBlock` 复制按钮补 `focus-visible:opacity-100` + `aria-label`；`ThinkingBlock` 折叠按钮补 `aria-expanded`。
> - ✅ **P2-6 导出工程化（决策无关部分）**：`triggerBlobDownload`/`sanitizeFilename` **收敛为单一实现**（原 3 处 / 2 处重复 ⇒ 改一处即全域生效）；`sanitizeFilename` 补 Windows 保留设备名（CON/PRN/AUX/NUL/COM1-9/LPT1-9，按主名判定）、结尾点/空格、超长截断；`SessionHistorySidebar.handleExportSession` **补 catch → `handleClientError`**（§1.9）；导出按钮空会话/导出中**禁用 + 原因提示**。
> - ✅ **P2-8 零散（子集）**：`StatusFloatBar` 补 `skipped` 图标；`FileAttachmentBar` 补 `relative`（拖拽提示层定位基准）；`OfficePreview` `html!` → `html ?? ""`；`CodeRunCard` `logs.join("")` → `join("\n")`；`DocWorkflowProgress` 写死 600px → `max-w-xl w-full`。
>   ⚠️ **更正**：`ChatMessageList` 的 `formatDateLabel(message.timestamp!)` **不是缺陷**——渲染条件 `shouldShowDateSeparator` 已在 `dateUtils.ts:71` 守卫 `!current.timestamp || !previous.timestamp`，断言安全；按"不为不可能场景加防御"不修改。
> - ✅ **P2-9 会话切换整表重排**：根因定位 = 排序主键 `lastEventSeq` 对**缺失**者按 `0` 兜底 ⇒ 缺失方被排到**最前**（与真机 `{total:14, movedCount:14}` 吻合）。改为**全体具备才启用该主键，否则整体回退 timestamp 序**，并在 warn 中增加 `primaryKey` 便于分诊。
> - ✅ **P2-2 重复渲染实现收敛（2026-09-27，D10 = 全量收敛）**：
>   - **删除非扁平渲染路径**：`ToolExecutionGroup` 旧版分支 + `BlockItem.tsx`（唯一消费者）+ `toolcall_flat` feature flag（默认 `true` 且**全仓无 UI/配置入口** ⇒ 旧版分支不可达）。旧版分支内的 P1-5「孤立工具结果」提示卡**合并进唯一实现**（此前扁平模式下该提示缺失 ⇒ 属修复）。
>   - **`ChatMessage.renderBlocksWithGroups`**：新增局部 `renderBlock()`，收敛原 3 处重复的 `BlockRenderer` 展开调用（user 消息合成 text block 那处上下文不同，未纳入）。
>   - **媒体工具名清单单一定义**（`utils/toolHumanSummary.ts`）：`isMediaToolName`（语义 A，8 项 ⇒ 结果走 `ImageToolResult`）与 `isMediaDisplayToolName`（语义 B，3 项 ⇒ 默认展开 + 不进折叠组，B ⊂ A）；替换 `ToolCallGroup` 本地常量与 2 处硬编码、`ChatMessage` 内 3 处硬编码。
>   - **门禁**：`tsc --noEmit` 0；改动文件 eslint 0；`vitest run` **49 文件 / 471 用例全通过**（新增 `tests/toolMediaNames.test.ts` 3 例，守护 A/B 语义不得合并）。
>   - **真机复验（2026-09-27，`http://localhost:1420`）**：工具卡片与「工具返回」折叠卡正常渲染、展开后条目（参数 + results + 时间线）非空白；console 无 error（仅 info + 1 条与本次无关的 SSE `net::ERR_ABORTED`）。
> - ✅ **P2-1 i18n 全量迁移（2026-09-27，分 5 批完成）**：范围红线 = **仅用户可见 UI 文案**（❌ 不动 logger 日志、代码注释、className、枚举/状态值）。14 个组件 + `i18n/locales/zh.ts` / `en.ts` **成对补键**（`chat` 段按批分组注释追加，zh/en 顺序一致）：
>   - 第 1 批：`QuestionBlock`（整组件）、`SessionContextMenu`、`TaskCard`、`ProgressCard`；
>   - 第 2 批：`DeliverableCard`、`CodeRunCard`、`ToolCallGroup`、`ToolInlineTags`、`ToolResultMessage`、`ToolExecutionGroup`；
>   - 第 3 批：`DAGFullScreen`、`DAGMiniMap`、`ImageViewer`、`SaveKnowledgeModal`；
>   - 第 4 批：`FileLink`、`FileAttachmentBar`（错别字「放开放置文件」→「拖放文件到此处」）、`FilePreviewContent`、`OfficePreview`、`DocWorkflowProgress`；
>   - 第 5 批：`ChatMessage`（`INTERRUPTED_HINT_*` 常量改为 i18n 键 + 中文兜底默认值、成果标题兜底）、`ChatMessageList`（欢迎页官网）。
>   - **范式**：JSX 用 `t("chat.x", "中文兜底")`；模块级文案映射表 `label: "中文"` → `labelKey: "chat.x"`，渲染处 `t(key)`；**未登记的枚举值回退显示后端原值**（不编造，CS06）；既有可复用键（`common.save/cancel/delete/close/loading`、`chat.executing/completed/failed/taskPending/closePreview/fileReadFailed`、`chat.saveToKnowledge`）一律复用不新增（CS01）。
>   - **门禁**：`tsc --noEmit` 0；改动文件 eslint **0 warning**（含若干 prettier 自动修正，以及 `ImageViewer` 一处 `useCallback` 上移 + 依赖补全以消除既有 `react-hooks/exhaustive-deps` warning）；`vitest run` **49 文件 / 471 用例全通过**（与基线一致）。
>   - **核验更正**：`ChatMessageList` 中「加载更早消息」等文案在迁移前**已是 `t()`**（全文件已无中文串字面量，仅欢迎页官网一处未迁移）；`DocWorkflowProgress` 的英文 status 改按 `STATUS_LABEL_KEY` 映射（未登记回退原值）。**未做真机复验**（纯文案改动，门禁 + 源码级核验覆盖）。
>   - **口径更正 → 残留已收尾（2026-09-27，第 9 批）**：迁移范围 = 上述 14 个组件 + **第 9 批补扫**。第 8 批取证的三处（`StatusFloatBar` `停止 AI 回复`/`停止`、`InboxBlock` `紧急`/`分钟后过期`、`ImageDisplayResult` `引用到对话`/`复制引用`/`下载`/`共 n 张图片`）**已全部迁移**；第 9 批再深扫 ChatArea，另捕 8 处计划外漏网（`BlockRenderer` 兜底、`DiffBlock` 已忽略、`PdcaActivityStrip`/`PdcaWorkflowCard` 状态文案与决策标签、`SessionHeader` 导出件元信息/截断/耗时/Token 行、`SessionHistorySidebar` 渠道来源标签 + `会话加载失败`/`重试`、`SessionListItem` 轮数后缀、`ChatArea` `查看技术详情`、`ImageDisplayResult` `没有可显示的图片`/`全部引用`）。**扫描口径**：裸 JSX 文本行、JSX 属性字面量、非 `t()` 包裹的字符串字面量三种 grep 形态全目录覆盖；ChatArea 内已无裸用户可见中文（保留项见台账「第 9 批」）。ChatArea 之外（`media/TaskCard.tsx`、`views/ProjectsPage.tsx`）待核实清单同见台账。
>   - **口径再更正 → 范围扩至「全 client/src 全量」（2026-09-27，第 10 批，用户裁定）**：经量化，**「ChatArea 之外的残留」实为全前端级迁移** —— 形态①（裸 JSX 文本行）在 `components/views/**` 单独即 **602 处 / 74 文件**；形态①+② 合并去重后 **206 文件**（`views` 59 / `common` 19 / `settings` 19 / `Knowledge` 25 / `ChatArea` 9 / `views/office` 12 / `modelAdmin` 7 / `views/media` 6 / 其余 40）。故 **P2-1 的「全量」口径 = 「`client/src` 全量」**。**台账路径更正**：`components/media/TaskCard.tsx`、`src/views/ProjectsPage.tsx` 两处路径不存在，实际为 `components/views/...`。
>   - ✅ **第 10 批：全 client/src 迁移已完成（2026-09-27，12 波 / 约 212 文件）**：W1(10) → W2(12) → W3a(12) → W3b(15) → W4a(7) → W4b(18) → W5(20+24) → W6a(26) → W6b(10) → W7a(34) → W7b-1(13) → W7b-2(11)。
>     - **键对等（终值）**：**zh 2543 → 5488 / en 2444 → 5389**，新增 **2945 组键逐键成对**；`en_missing` **恒为 99**（= HEAD 基线既有缺口，未新增未修，见台账 **N-74**）；`zh_missing = 0`。
>     - **残留复扫（终值，三形态口径）**：形态① **201 处/55 文件 → 38 处/18 文件**；形态② **58 处/25 文件 → 11 处/5 文件**。剩余命中经逐条归档为**注释续行**（`ChatArea` 9 文件、`ChatInspector.tsx`、`TrajectoryDetail`、`deriveTrajectoryTimeline.ts`、`ModelSelector.tsx:9` JSDoc 示例等）、**模型可见输入**（`CreateDocModal` 的 `<option value="周报|…">`，按 §1.6 保留）、**真实例外 1 处**（`SafetyPositionBanner.tsx` 中文枚举，需 spec）⇒ **用户可见 UI 文案已清零**。
>     - **文案漂移核验（终值）**：`git diff -U0 -- client/src` 提取 **4436 移除行 / 2655 中文片段**，未命中**恒为同样 3 项**（`HelpPage` 标识符键 1 + `MemoryPage` `{{phrase}}` 插值 2，已逐项排除）⇒ **全程零文案漂移**。
>     - **门禁（每波均跑）**：`typecheck` **0**；改动文件 `eslint` **0 error**（余 warning 全为改动前既有）；`vitest run` **49 文件 / 471 用例全通过**（与基线一致，零回归）。
>     - **顺带修复既有缺陷 3 项**：`AgentStrategySelector` 缺键渲染裸键名；`useKeyboard` 中文 title 选择器致英文下 Ctrl+, 失效；`BackendStatusBadge` 3 处残留被误判为"无中文"。
>     - **新登记（需后续专项）**：① `SafetyLayer` 中文枚举（CS02，需 spec）；② 模型域双前缀 `model.*` / `settings.model.*` 归一；③ `buddySprites`/`memoryConstants` 模块级 `i18n.t()` 切语言不刷新（彻底修法需动 9 个消费方，属重构）；④ `canvas-editor/utils/i18n.ts` 零消费者孤立字典（并入死代码清理）；⑤ `N-74` en 缺 3 键。详见台账「第 10 批 / 总收尾」。
> - ✅ **P2-3 死代码（D4 = 直接删除）已执行（2026-09-27）**：删前逐个 grep 复核**全仓零代码引用**（含 `.trae` 文档命中除外）后删除 5 个仅自引用文件；`PdcaActivityStrip` 组件本体零引用 ⇒ 删组件 + 专属 `AutoLaunchedBanner`，**保留 4 处复用的具名导出**（`PdcaWorkflowCard` / `usePdcaEntry` / `usePdcaAutoAppend` / `ChatPdcaDrawer`）。详见台账「第 5 批」。
> - ✅ **P2-6 剩余已收口**：D2 = 补齐 HTML/Word（复用 `exportMessageAsFormat`，菜单 5 项）、D3 = 维持浏览器 blob 下载；`triggerBlobDownload`/`sanitizeFilename` 归一、Windows 保留名/结尾点/超长、`handleExportSession` 补 catch、导出按钮禁用均已落地（台账「第 4 批」）。
> - ✅ **P2-5 可访问性剩余（2026-09-27）**：
>   - hover-only 按钮补键盘可达：`SessionListItem` 删除、`ChatInput` 识图翻译/移除图片、`FileLink` 打开所在目录 ⇒ className 加 `focus-visible:opacity-100`；`ImageDisplayResult`/`ImageGenerateResult` 悬浮操作容器 ⇒ `group-focus-within:opacity-100`。
>   - 补可访问名：`SessionListItem` 删除按钮、`ChatInput` 两处、`RoundNavigator` 折叠/轮次按钮（`aria-label`，`title` 同步走 i18n）。
>   - `ChatMessage` "⋯" 菜单键盘：Esc 关闭并归还焦点、↑↓ 在菜单项间移动、关闭态 ↓ 打开并聚焦首项；**焦点离开判定改挂菜单容器**（`e.currentTarget.contains(e.relatedTarget)`）——原挂在触发按钮上的 `onBlur` 会在焦点移入菜单项时误关菜单。
>   - dialog 语义：`DAGFullScreen` 与 `SaveKnowledgeModal` 补 `role="dialog"` + `aria-modal` + `aria-labelledby`/`aria-label` + Escape 关闭。
>   - `StatusFloatBar` 展开指示：纯 `svg` → **真 `<button>`**（`aria-expanded` + `aria-label`）。**有意不给外层可点击 `div` 加 `role="button"`**——那会让 stop/PDCA 等嵌套按钮在 A11y 树中被判 presentational（回归）。
>   - **核验更正**：`ImageViewer` **已有** Escape/方向键与 `alt`，工具栏按钮均带 `title`（可作可访问名）⇒ 未改动。
>   - **门禁**：`tsc --noEmit` 0；改动文件 eslint 0 warning；`vitest run` **49 文件 / 471 用例全通过**。
> - ✅ **P2-8 零散剩余（2026-09-27）**：`InboxBlock` 过期倒计时补 30s 心跳重算（原渲染期一次性快照）；`SessionHeader` 标题输入 `style width:200px` → `w-full max-w-[200px]`；回复引用内层 `truncate` 补 `title`（截断 500 字）；`DebugBlockInfo` 的 `title={b.content}` → `slice(0,500)`；`OfficePreview` docx 暗色由 `invert-[0.9]` 改 `invert + hue-rotate-180`，并在 `index.css` 对 `.office-preview-content img` 施加同一滤镜链（`invert(1) hue-rotate(180deg)` 两次叠加 ≈ 原色 ⇒ **图片不再被一起反色**）。
>   ⚠️ **证据否定**：审计条目「`ToolCallGroup` 的 `title` 内嵌整份文件内容（~9.4k）」**无法复现**——`ToolCallGroup.tsx` 内 `title` 命中 0 处，`utils/toolHumanSummary.ts#getArgStr` 已 `>40 字`截断；全仓唯一无界 `title={b.content}` 位于 `ChatMessage.tsx` 的 DebugBlockInfo（已修）。
> - ✅ **P2-7 导出性能/规模（2026-09-27）**：
>   - 后端 `handleExportSessionEvents`（[session-handlers.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/infrastructure/http/handlers/session-handlers.ts)）：先 `writeHead` 再**边分页边 `res.write`**（jsonl 每行一条、json 手写 `{"events":[` … `],"count":N}`），并新增 `writeWithBackpressure()` 等 `drain` / 客户端 `close` 时停止导出；catch 补「头已发出 ⇒ 必须 `res.end()`」分支（否则客户端挂起）。
>   - 前端 `SessionHeader.tsx`：`exportAsMarkdown`/`exportAsJson` 改 async，**逐条累加 + 每 20 条 `await` 让出事件循环**；JSON 侧改为逐条 `stringify` 后按 2 空格缩进拼装（产出与 `JSON.stringify(..., null, 2)` **逐字符一致**），避免整体 stringify 的长同步任务。**未采用 Worker**（需新增 worker 文件与消息协议，与收益不成比例）。
>   - **门禁**：`app` `tsc --noEmit` 0 + eslint 0 + `bun test tests/runtime tests/session` **291 pass / 0 fail**；`client` `tsc --noEmit` 0 + eslint 0 + `vitest run` **49 文件 / 471 用例全通过**。

| # | 主题 | 要点（证据见审计明细） |
|---|---|---|
| P2-1 | **i18n 全量迁移**（✅ 已完成 2026-09-27，5 批） | 硬编码最密集：`QuestionBlock.tsx`（整组件）、`SessionContextMenu.tsx`、`TaskCard/ProgressCard/DeliverableCard/CodeRunCard`、`ToolCallGroup/ToolInlineTags/ToolResultMessage/ToolExecutionGroup`、`DAGFullScreen/DAGMiniMap`、`ImageViewer`、`SaveKnowledgeModal`、`FileLink/FileAttachmentBar/FilePreviewContent/OfficePreview`（含错别字"放开放置文件"）、`ChatMessage.tsx:40-43` 中断提示、`ChatMessageList.tsx` 加载更早/官网、`DocWorkflowProgress` 直接显示英文 status |
| P2-2 | **重复渲染实现收敛**（✅ 已完成 2026-09-27，D10） | `BlockRenderer` vs `BlockItem`（status/tool_call/text/code_run 各一份）；`ToolExecutionGroup` 内部扁平/旧版两套；媒体工具名清单在 `ChatMessage.tsx:1535`（3 个）与 `ToolCallGroup.tsx:24-33`（8 个）**不一致** |
| P2-3 | **死代码**（✅ 已完成 2026-09-27，D4 = 直接删除） | 未被引用：`AgentProgressBlock.tsx`、`CouncilPanel.tsx`、`OutlineConfirmCard.tsx`、`ImageCompareView.tsx`、`ClickableImageRef.tsx`；`PdcaActivityStrip.tsx` 仅具名导出存活、组件本体已死 ⇒ 建议**先确认再删**（需你决定） |
| P2-4 | **性能** | `VirtualScrollContext.tsx:34-52` value 未 memo；`InlineCodeLink`×`pathCache` 每个 code token O(tokens×paths)；`PdcaWorkflowCard/PdcaActivityStrip` 在 render 内 `Object.values().filter().sort()`；`SessionListItem.tsx:85-115` 每次点击 logger.info + 250ms 延迟 |
| P2-5 | **可访问性**（✅ 已完成 2026-09-27） | hover-only 按钮（`SessionListItem` 删除、媒体悬浮操作）⇒ `focus-visible:` / `group-focus-within:`；`aria-label`（`RoundNavigator`/删除/识图翻译）；`ChatMessage` "⋯" 菜单 Esc/方向键 + 焦点离开改挂容器；`DAGFullScreen`/`SaveKnowledgeModal` dialog 语义 + Esc；`StatusFloatBar` 展开指示改真按钮（`aria-expanded`） |
| P2-6 | **导出工程化**（✅ 已完成 2026-09-27，D2/D3） | `triggerBlobDownload`×3、`sanitizeFilename`×2 重复实现 ⇒ 归一；文件名未处理 Windows 保留名/结尾点/长度；`SessionHistorySidebar.handleExportSession` **无 catch**（违背 §1.9）；导出按钮无 disabled（空会话/流式中无提示） |
| P2-7 | **导出性能/规模**（✅ 已完成 2026-09-27） | 后端 `handleExportSessionEvents` ⇒ 先 `writeHead` 再逐页 `res.write` + `writeWithBackpressure`（等 `drain`/客户端断开即停）+ catch 补「头已发出 ⇒ `res.end()`」；前端 `SessionHeader` 的 `exportAsMarkdown`/`exportAsJson` ⇒ async 逐条累加、每 20 条让出事件循环（JSON 逐条 stringify 后缩进拼装，产出与整体 `JSON.stringify(...,2)` 一致） |
| P2-8 | **零散**（✅ 已完成 2026-09-27；1 项证据否定） | 已修：`InboxBlock:138` 过期快照 ⇒ 30s 心跳；`SessionHeader:275` 200px ⇒ `w-full max-w-[200px]`；`OfficePreview:240` docx 暗色 ⇒ `invert + hue-rotate-180` + CSS 对 img 施加同链（图片不被反色）；回复引用截断补 `title`；`ChatMessage` DebugBlockInfo `title` 截断 500 字。⚠️ 否定：`ToolCallGroup` 的 `title` 内嵌 ~9.4k **无法复现**（该文件 `title` 命中 0 处，`getArgStr` 已 40 字截断）。已随 P2-2/P2-6 完成：`StatusFloatBar` `skipped` 图标、`FileAttachmentBar` `relative`、`DocWorkflowProgress` 宽度；`ChatMessageList:645` `timestamp!` 经核验非缺陷 |
| P2-9 | **会话切换时近乎全量重排消息**：`[setMessages:SORT] 检测到顺序不一致，已归一化 {total:14, movedCount:14}`（另两例 18/18、30/29）——`movedCount ≈ total` 说明每次切换几乎整表重排，可能带来无谓重建/闪烁 | 真机 console（**warn 级**，非 error）**[实测]** | 核查排序判定条件（是否每次都对同一批消息判为乱序）与重排开销 |

---

## 6. 需你决策（阻塞项）

| # | 决策点 | 选项 |
|---|---|---|
| D1 | Markdown 排版兜底方案（P1-9/11） | **✅ 已定案（2026-09-27）= C**：清理失效 `prose*` 类 + 明确 `.markdown-body` 归属，不新增依赖、不改现有排版（A 引入 typography：11 处视觉同时变化；B 启用 `.markdown-body`：与自定义渲染器争排版且含 `!important`） |
| D2 | 导出格式集合（P2-6） | **✅ 已定案（2026-09-27）= 补齐 HTML/Word**：复用单条导出的 md→HTML/Word 渲染；"导出全部会话"未采纳（需新接口/打包，体量大） |
| D3 | 落盘方式（P2-6） | **✅ 已定案（2026-09-27）= 维持浏览器 blob 下载**（不改受控目录、不加确认弹窗） |
| D4 | 死代码（P2-3） | **✅ 已定案（2026-09-27）= 直接删除**：5 个零引用文件 + `PdcaActivityStrip` 组件本体（具名导出保留） |
| D5 | 长会话滚动期望（P1-17） | **✅ 已定案（2026-09-27）= 进入即贴底 + 记忆每会话阅读位置**（距尾偏移锚点 + DOM 几何顶部可见项；真机 A/B/C 全通过） |
| D6 | 工具结果可见性（P1-5/P1-14） | **✅ 已定案（2026-09-27）= 默认轻量（保留截断）+ 新增「导出完整 Markdown」**（`full` 版不截断、工具调用附参数） |
| D7 | tool 消息导出形态（P0-3/P1-19） | A. 合并进所属助手消息（去重，推荐） / B. 保留独立成节但解包+去重 |
| D8 | **轮数口径**（P1-6a） | **✅ 已定案（2026-09-27）= 统一到总量 + 尾锚定**：导航器以 `session.roundCount` 为总量，已加载部分按尾锚定绝对编号，无 user 消息时渲染「更早 N 轮未加载」入口（B 改口径为"用户提问轮"需后端新字段；C 双数字并标注未采纳） |
| D9 | **分页游标修复方式**（P1-6b） | **✅ 已定案且已实施（2026-09-27）= 根因修复 + 可见反馈**：前端消除"静默失败"（warn + 不可点击提示）；后端改为**读取侧统一分页键**（[§10.0](#100-实施与验收2026-09-27) 已实施并真机验收通过） |
| D10 | **重复渲染收敛范围**（P2-2） | **✅ 已定案且已实施（2026-09-27）= 全量收敛**：删除不可达的旧版渲染路径（`BlockItem` + `toolcall_flat`，无 UI 入口 ⇒ 不可达）+ 媒体工具名清单收敛到单一定义处（**保留 A/B 两语义不合并**）。备选"保留 flag、仅收敛清单"未采纳（P2-2 核心重复未消） |

---

## 7. 执行顺序建议（每步独立可验证）

```
第 1 批（P0，改动小、用户可见）
  P0-1 调试面板 → P0-4 i18n 缺键 → P0-5 表格空单元格 → P0-6 轮次导航
  → P0-2 信封解包（合并入口）→ P0-3 导出信封解包
  门禁：client tsc 0 / eslint 0 / vitest 全绿 + 真机复验（信封计数=0、Debug 文本=0）

第 2 批（P1 功能正确性）
  P1-1~4 导出正确性（字段/标注/元数据/转义）→ P1-7 memo → P1-8 文案 → P1-13 死按钮
  → P1-12 light 模式配色 → P1-14 截断出口 → P1-15 Diff 语义 → P1-17 滚动（需 D5）

第 3 批（P1 样式根因，需 D1）
  P1-9/10/11 prose / streaming-cursor / markdown-theme 归属统一

第 4 批（P2 分批）
  i18n 批量迁移（✅ 已完成）→ 重复渲染收敛（✅ 已完成）→ 死代码（✅ 已完成，D4）→ 导出工程化（✅ 已完成，D2/D3）
  → 可访问性（✅ 已完成）→ 导出性能/规模（✅ 已完成）→ 零散（✅ 已完成；1 项证据否定）
  剩余：P2-4 性能（未执行；抽查 `SessionListItem` 的 250ms 延迟 + logger.info 仍在）
```

**通用门禁**：每批结束跑 `client` 的 `tsc --noEmit` + `eslint` + `vitest run`（必要时 `test:coverage`），并至少做一次真机复验；新增守卫测试需做**突变验证**（还原旧实现即转红）。

---

## 8. 本次未覆盖（诚实边界）

- 响应式（700/500 宽）**未实测**：工具链无 viewport 缩放能力，`window.resizeTo` 无效 ⇒ 仅给出源码风险点（`App.tsx:227` 侧栏 `lg:block` 隐藏、`Sidebar.tsx:495` `lg:hidden` 底部导航 `z-50` 可能遮挡底部状态条）**[待验]**
- ~~导出**文件本体**未读取~~ → **已补齐（2026-09-27，用户提供 3 份真机导出）**，实证见下
- 未触发的块类型（真实 `<table>`、`CodeBlock`、diff、code_run、图片/视频/音频结果卡、空会话、浮动栏）在实测会话中**未出现**，其渲染未实测
- App 侧（后端）除导出 handler 外未做渲染相关审计（本次范围限定客户端显示与导出）

### 8.1 导出产物实证（`E:\PY\Downloads\chat-export-*`，2026-09-27）

| 产物 | 规模 | 关键实测 |
|---|---|---|
| `…543020.md` / `…611519.md`（同一会话导出两次） | 42,094 B / 406 行 | 角色节 **50** 个、`---` 分隔 **49** 个（结构自洽，无断行错位）；**无** `<think>`/`<response>` 残留；**无** `<script>/<div>` 等 HTML；thinking 截断标注规范（`仅导出前 300 字，原文共 15999 字；完整思考见会话内`） |
| `…584048.json` | 149,036 B / 1,319 行 | 信封 `tool_result` **37** 处（含 `blocks[].content` 与 `role:"tool"` 消息）；块 `content` 恰好 5000 字符的 **2** 个（静默截断实证）；`taskCard`/`questionData` **零命中**（块级结构化载荷丢失实证）；消息级 `toolCalls` 存在（含 arguments） |

**由产物新确认/更正**：P0-3（含**双重编码**与**空信封**两种形态）、P0-4（标题逐字为 `🛠 chat.tool`）、P1-2、P1-18、P1-19、P1-21；**更正 P1-1**（原判断"丢 arguments"过重——`toolCalls` 已在导出，实际丢的是块级结构化载荷）。

---

## 9. 审计方法留痕（可复现）

1. ChatArea 渲染代码审计：逐文件通读 + 分类检索（溢出/截断/重复实现/状态/memo/性能/a11y/i18n），产出 60+ 条带 文件:行号 的候选。
2. 导出链路审计：从 UI 入口向上下游追踪，识别 **5 条独立导出链路**（会话 md/json、侧栏元数据、轨迹 jsonl/json、单条消息 md/html/word、CLI）并明确 `trace-recording/ExportService` 属**无关链路**。
3. 真机实测：4 个会话 + DOM 几何测量 + network/console 取证；发现 `Debug: N blocks` 泄漏、信封 JSON、轮次导航 4≠7、初始滚动位置不稳定等**仅运行时可见**的问题。
4. 人工复核：对 P0 全部 6 项与 5 条高影响结论逐条读源码确认（见各条 [代码] 标记），剔除推测项。

---

## 10. P1-6b 后端分页游标根因修复（**已实施并真机验收通过**，2026-09-27）

> 决策依据：§6 **D9 = 根因修复 + 可见反馈**。前端可见反馈与后端根因**均已实施**。

### 10.0 实施与验收（2026-09-27）

**实现**
- 新增 [paginationSeq.ts](file:///e:/PY/DOCUMENTS/CODES/PY_APP/app/src/runtime/api/paginationSeq.ts)：纯函数 `withPaginationSeq`（**不修改入参**；无需回填时返回原引用 ⇒ 健康会话零开销）。
- [CoreAPIImpl._paginateMessages](file:///e:/PY/DOCUMENTS/CODES/PY_APP/app/src/runtime/api/CoreAPIImpl.ts#L1718-L1745)：**仅在 `limit > 0` 的分页路径**先归一化再过滤/切片；不传 limit 的全量响应**保持原样**（不改动其他消费者可见字段）。
- 墓碑过滤 `_filterDeletedRanges` 仍在归一化**之前**（派生路径），跨键域问题不存在。

**真机验收（后端契约）**：会话 `session_mtw7nr44dkgini0x0a5`，页内同步翻页探测

| 验收项 | 实测结果 |
|---|---|
| ① 连续翻页覆盖全量 | **25 页**，`Σadded = seen = 709` = 全量；每页 `added` 均 > 0（`30,29×22,27,14`），**无停滞页** |
| ② 每页首条 `lastEventSeq` | **恒为数字**，`5382 → 1` **严格递减**，全程 **0 次 `ABSENT`** |
| ③ 末页 `hasMore` | **false** |
| ④ 删除轮次回归 | **未构造删除样本**（墓碑过滤代码本次未改动；`tests/session/*` 291 例通过） |

**真机验收（前端 UI）**：「加载更早」为**可点击 `BUTTON`**（文本 `↑ 加载更早消息`）；点击发出 `?limit=30&before=5382` → `before=4943`（正是第 0/1 页首条 seq，**游标链正确推进**），顶部内容变为更早消息；控制台 `[loadOlderMessages] 分页游标缺失` **0 条**。

**测试**：`app/tests/runtime/paginationSeq.test.ts` **6/6 通过**，含**突变对照**（未归一化 ⇒ 30 条即停滞；归一化 ⇒ 覆盖全量 120/120）。

**门禁**：`app` `tsc --noEmit` **0**；`eslint`（改动文件）**0**；`bun test tests/runtime tests/session` **291 pass / 0 fail**。（`client` 侧本轮未改动）

**旁记（非缺陷）**：复验期间因后端重启，前端出现 `ERR_CONNECTION_REFUSED /health|/v1/events` 重连日志，且页面**自行切换**到另一会话 —— 发生在后端不可达窗口内，**疑为重连恢复行为**（未复现、未定位），仅记录。

### 10.1 现状与证据（真机 + 源码双证）

| 事实 | 证据 |
|---|---|
| 长会话 `session_mtw7nr44dkgini0x0a5` 全量 **709 条中仅 16 条**带 `lastEventSeq`（全为 assistant，326…5377） | 页面内 XHR 取 `/v1/sessions/:id/messages` 原始响应 |
| `limit=30` 的**尾页 30 条 `lastEventSeq` 全缺**，且 30 条全为 `tool` | 同上 |
| 后端分页键 `key(m) = m.lastEventSeq ?? m.timestamp ?? 0`（**混合键域**） | [CoreAPIImpl.ts](file:///e:/PY/DOCUMENTS/CODES/PY_APP/app/src/runtime/api/CoreAPIImpl.ts#L1719) `_paginateMessages` |
| 前端游标**只读** `messages[0].lastEventSeq`，**无 timestamp 兜底** | [sessionSlice.ts:738-740](file:///e:/PY/DOCUMENTS/CODES/PY_APP/client/src/stores/root-store/sessionSlice.ts#L738-L740) |
| 游标为 null 时前端**静默 return**（已改为 warn + 不可点击提示） | [chat-message-actions.ts:635-643](file:///e:/PY/DOCUMENTS/CODES/PY_APP/client/src/stores/chat/chat-message-actions.ts#L635-L643) |

**结论①（两侧契约不一致）**：后端允许"缺 `lastEventSeq` 时按 `timestamp` 兜底"，前端却只认 `lastEventSeq` ⇒ 尾页首条缺该字段时游标恒为 `null`，"加载更早"必然失效。

**结论②（更深根因，量纲混用）**：**即便前端补上 `timestamp` 兜底也修不好** —— `lastEventSeq` 是**事件序号**（本例 326…5377），`timestamp` 是 **epoch 毫秒**（1.7e12 量级）。过滤 `key(m) <= before` 一旦 `before` 落在 timestamp 量纲，则所有消息都满足 `<=`（**过滤失效**）⇒ 仍返回同一页 ⇒ 前端 id 去重后无变化、`hasMore` 恒 true（**静默空转**）。所以"补兜底"只是把"静默失败"换成"静默空转"。

### 10.2 推荐方案：读取侧统一分页键（不改 API 契约）

在 `CoreAPIImpl.getSessionMessages` **返回前**（三条路径各自调用 `_paginateMessages` 之前），对缺失 `lastEventSeq` 的条目按**最终数组顺序**回填单调序号：

```
backfillPaginationSeq(list):
  prev = 0
  for m in list (按当前数组顺序):
    if typeof m.lastEventSeq !== "number": m.lastEventSeq = prev + 1
    prev = max(prev, m.lastEventSeq)
```

要点：
- **只改响应，不写盘**；不动 `_deriveSessionMessagesFromEvents`，也不动 `deleteMessage` 的墓碑 seq 空间 —— `_filterDeletedRanges` 必须在回填**之前**完成（否则墓碑比对会跨键域）。
- 回填后**每页首条 `lastEventSeq` 恒有值** ⇒ 前端游标恢复非 null、"加载更早"可用（**前端无需再改**）。
- `setMessages` 在 `allHaveSeq` 成立时会改用该键排序：回填值按数组顺序单调 ⇒ 排序结果与现状一致（幂等）。

### 10.3 备选方案（更彻底，改动更大）

分页改为**按数组位置**（新增 `offset` 语义，或游标改为"已加载条数"），与 `lastEventSeq` 彻底解耦。优点：语义最干净、对任何 seq 缺失免疫；代价：**API 契约变更**（前后端同批改）+ 3 处调用点同步。

### 10.4 验收标准（实施后逐条验证）

1. ✅ 同一会话：`limit=30` **连续翻页可达最早一条**（去重后累计 = 全量条数），期间 `hasMore` 最终转 `false`。*实测：25 页 / `seen=709` / 末页 `hasMore=false`*。
2. ✅ 每页返回首条 `lastEventSeq` **恒为非空数字**；跨页游标严格递减（边界重复由前端 id 去重）。*实测：`5382 → 1` 严格递减，0 次 `ABSENT`*。
3. 前端 UI：「↑ 加载更早消息」为**可点击 button**（不再出现"暂不可加载"），点击后**发出 `limit=30&before=<上页首条 seq>` 请求**且游标链严格递减、顶部内容变为更早消息，`oldestSeq` 非 null。
   > ⚠️ **判据更正（2026-09-27 真机实证）**：**不能用 `[data-index]` 项数或 `scrollHeight` 是否递增来判定** —— 该列表是**窗口化渲染**（只挂载视口 ± overscan，实测在 11~21 项间波动，`scrollHeight` 在一次点击后由 57556→41131→13570 递减，属懒测高正常表现）。必须以**网络请求（游标链）+ 顶部消息内容变化**为判据。
4. ⏳ 回归：删除轮次（N-50 墓碑过滤）仍生效 —— 被删轮次不出现在任何分页结果中。*未构造删除样本（该代码路径未改动）*。
5. ✅ 门禁：`app` `tsc --noEmit` 0 / `eslint`（改动文件）0 / `bun test tests/runtime tests/session` **291 pass**；突变验证用例已落地（`app/tests/runtime/paginationSeq.test.ts` 6/6，含"未归一化即停滞"对照）。

### 10.5 风险与回退（CS03）

- 风险：回填 seq 与真实 seq 混排 ⇒ 必须保证**单调**（`prev+1` 与 `max` 组合），且过滤与切片使用**同一键函数**。
- 回退：方案为**响应期纯计算、无持久化副作用** ⇒ 移除回填函数即回到现状；且前端已具备"游标缺失 → 明示不可用"的降级展示，不会退回静默失败。
