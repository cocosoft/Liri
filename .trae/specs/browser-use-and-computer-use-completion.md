# Browser Use / Computer Use 能力补齐方案（2026-11-21）

> 状态：**P0–P3 已实施（2026-11-21）**，见文末「执行结果与偏差」；按 D0–D6 的推荐选项落地（D6 后续项已于 2026-11-21 晚补做：`browser_vision` 共用会话）
> 关联规则：CS01（复用已有）· CS04（Mock 零容忍）· CS05（根因优先）· CD05/CD06（先接线再删、独立提交）
> 结论依据：源码逐条取证 + 真机 `GET /v1/tools/visibility` 读数（2026-11-21，后端 18990）

---

## 0. 结论先行

1. **`computer_use` 不是从零开发**：工具（22 个动作）与 Windows/macOS/Linux 三套适配器都已实现，
   真正缺的是「解除归档 + 分类别 + 开关 + 截图反馈 + 清理 + 测试 + 输入加固」。
2. **`browser` 目前不可用且是假实现**：`BrowserTool.execute` 返回硬编码成功、1×1 像素假截图与假标签页
   （违反 CS04）；仓库里已有完整的 `PlaywrightBrowserDriver`，但**全仓零引用**，`playwright` 依赖也未安装。
   ⇒ 正确做法是「接线真实现 + 删除假分支」，不是补几个分支。
3. 两者都被登记在 `ARCHIVED_MISC_TOOLS`（永久不可见）；真机可见性接口证实
   `browser`/`computer_use` 均为 `effective=hidden, reasons=[archived]`。所以在打开可见性之前动执行层没有意义，
   反过来只打开可见性则会立刻把「假实现/高风险能力」交给模型。**必须同批处理**。

---

## 1. 现状取证

### 1.1 真机读数（2026-11-21，`GET /v1/tools/visibility`）

| 工具 | category | registration | effective | reasons | risk |
|---|---|---|---|---|---|
| `browser` | misc | registered | hidden | archived | high |
| `browser_vision` | video | registered | hidden | not-in-task-whitelist | high |
| `computer_use` | misc | registered | hidden | archived | high |

补充实测：`app/node_modules` 下 **无** `playwright` / `playwright-core`；`app/package.json` 也无该依赖。

### 1.2 Browser 侧

| 事实 | 落点 |
|---|---|
| 执行体是**模拟实现**：全部动作直接返回成功；截图是硬编码 1×1 PNG；`get_tabs` 返回写死的 Google/GitHub 两条 | `app/src/tools/BrowserTool/BrowserTool.ts:279-357`（假 PNG `:333-334`、假 tabs `:342-355`） |
| 真实驱动已存在但**零引用**（grep 仅命中自身） | `app/src/tools/BrowserTool/PlaywrightDriver.ts:63-176` |
| 驱动实现含 `navigate/click/type/fill/screenshot/pdf/get_content/evaluate/back/reload/close` 12 个动作 | 同上 `:14-32`、`:199+` |
| 驱动存在运行期 hack：把 `setDefaultTimeout` 挂到 page 对象、用 `_browser/_page` 私有字段保存状态 | 同上 `:91-146` |
| 依赖缺失时错误信息已给安装命令（但当前无人调用） | 同上 `:148-163` |
| 注册受编译期/进程级 flag 控制（`BROWSER` 默认 false；coding 变体生成物为 true） | `packages/kernel/src/core/featureFlags.ts:302`；`app/src/bootstrap/generatedVariantFlags.ts:9`；`app/src/tools/utils/ToolManagerUtils.ts:254` |
| 类别为 `misc` 且被列入**有意归档** ⇒ 任何任务白名单都不含、模型永远看不到 | `app/src/tools/toolCategories.ts:234`、`:298-301` |
| 归档工具连 `tool_search` 也排除（仅用户覆写 `on` 时例外） | `app/src/tools/ToolSearchTool/ToolSearchTool.ts:336-344` |
| 工具描述/参数文案已存在（可复用，不必新写） | `app/prompts/zh-CN/tool-descriptions.json:16`、`app/prompts/zh-CN/tool-params.json:48-53` |
| `browser_vision` 已实现 CDP 截图 + 视觉模型分析，但硬编码连接 9222，仓库内无人启动带调试端口的浏览器 | `app/src/tools/BrowserVisionTool/BrowserVisionTool.ts:194-240` |

### 1.3 Computer Use 侧

| 事实 | 落点 |
|---|---|
| 工具实现完整：22 个 action（截图/鼠标/键盘/剪贴板/窗口/启动应用等） | `app/src/tools/ComputerUseTool/ComputerUseTool.ts:22-45`、`:172-244` |
| 三平台适配器均存在，按 `process.platform` 选择，失败回落 Noop | `packages/infra/src/utils/computerUse/index.ts:40-71` |
| Windows 适配器真实可用（PowerShell + System.Drawing/user32） | `packages/infra/src/utils/computerUse/WindowsAdapter.ts:82-150` |
| 注册是**无条件**的，但仍被归档 ⇒ 不可见 | `app/src/tools/utils/ToolManagerUtils.ts:201` |
| 风险级 `EXTERNAL` ⇒ 每次调用都要审批；审批卡只给「仅本次 / 拒绝」，不提供永久放行 | `app/src/tools/toolEffects.ts:82`；`packages/infra/src/permission/PermissionChecker.ts:514-531`；`packages/infra/src/permission/toolApprovalSubmission.ts:100-120` |
| 截图只把 base64 塞进 `data` 返回，`ToolResult` 没有图片通道 ⇒ 模型看不到画面，只能拿到一大段 base64 文本 | `app/src/tools/ComputerUseTool/ComputerUseTool.ts:249-271`；`packages/infra/src/utils/toolContract/ToolResult.ts:149-157` |
| 结束清理钩子是**空实现**（只打日志，不释放适配器/临时截图） | `packages/query/src/query/taor/stopHooks.ts:124-133` |
| 两个工具均**无专属测试**，支持等级为 community | `app/docs/SUPPORT-LEVELS.md:75-81` |

### 1.4 已发现的安全缺陷（开放前必须修）

| # | 缺陷 | 落点 | 影响 |
|---|---|---|---|
| S1 | `launchApp` 把应用路径直接拼进单引号 PowerShell：`Start-Process '${bundleIdOrPath}'` | `WindowsAdapter.ts:321-328` | 路径含 `'` 即可跳出字符串执行任意 PowerShell |
| S2 | `activateApp` 把窗口名直接拼进 `FindWindow(..., '${_bundleId}')` | `WindowsAdapter.ts:330-345` | 同上，可注入 |
| S3 | `keyPress` 把按键名直接拼进 `SendWait('{${key}}')`，未做白名单校验 | `WindowsAdapter.ts:457-463` | 同上；键盘输入文本本身已 base64（安全），但按键名不安全 |
| S4 | 桌面自动化内部直接调 PowerShell，**绕过 bash/powershell 安全分析器** | `WindowsAdapter.ts:58-80` | 只能依赖工具级审批兜底；必须在计划中显式说明并加审计 |

---

## 2. 目标与非目标

**目标**

1. 两个工具都能被模型真实调用并产生可验证结果（不是模拟）。
2. 默认关闭、用户可在设置页开启；开启后立即可见（无需重启）。
3. 每次外部动作仍走审批（EXTERNAL 不降级），且有可回读的审计记录。
4. 截图能形成「执行 → 观察 → 修正」闭环，而不是把 base64 灌进上下文。
5. 失败可诊断：缺依赖、平台不支持、权限不足时给出可执行的处理指引。
6. 有专属单测；既有可见性/归档守卫同步更新。

**非目标**

- 不做云端浏览器 / 远程桌面接管。
- 不实现验证码、反爬、风控绕过。
- 不默认开启；不允许无人值守模式自动批准 EXTERNAL。
- 不改现有审批机制与风险分级框架。

---

## 3. 设计

### 3.1 共同层（两工具都适用）

1. **开关复用既有「用户可配门控」**，不新造机制：
   - 在 `packages/query/src/query/featureGate.ts:31-42` 的 `USER_CONFIG_KEYS` 登记
     `BROWSER` / `COMPUTER_USE`（后者为新 flag）；
   - `ToolManagerUtils` 中把 `coreFeature('BROWSER')` 换成用户可配门控（若 app 层直接依赖 query 层不合适，
     则在装配点注入 `UserFeatureReader`，保持分层）；
   - `client/src/components/settings/FeatureFlagsPanel.tsx` 增加两个 Toggle + 中英文文案。
2. **可见性**：从 `ARCHIVED_MISC_TOOLS` 移除两项；`browser` 归入既有 `network`；
   `computer_use` 新增 `desktop` 类别（需扩展 `ToolCategory` 联合类型，并加入 `chat/default/agent` 白名单，见 D2）。
3. **审批**：保持 `EXTERNAL`（每次 ask、只给本次/拒绝）。不新增「永久放行」档。
4. **可观测**：沿用会话事件 `assistant/tool_call` / `tool/result`，补充输出中的
   `action`、`durationMs`、截图临时路径（不落 base64）；关键失败记录 logger（warn/error）。
5. **资源清理**：把 `computer_use_cleanup` 落地为真实清理（释放适配器、删本次临时截图），
   `browser` 增加同族 `browser_cleanup`（或合并为 `gui_cleanup`），挂在既有 stopHookManager 上。

### 3.2 Browser Use

**引擎决策 D1**（三选一）：

| 选项 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| A（推荐） | 依赖 `playwright-core`，启动时优先系统 Chrome、回退 Edge（不下载 Chromium） | 体积小、用户可见、会话隔离好 | 需要系统有浏览器（Windows 基本都有） |
| B | 完整 `playwright` + 下载 Chromium | 行为确定 | 安装体积大、离线环境难 |
| C | 仅 CDP（现状 `browser_vision` 路线） | 零依赖、可复用用户登录态 | 要求用户手动开 `--remote-debugging-port=9222`，可用性差 |

**执行层改法**

1. 重写 `BrowserTool.execute`：删除 `:279-357` 全部模拟分支，改为委托会话级 driver；
   输出 schema `BrowserToolOutputSchema` 同步（保留 `success/message/data/tabs/screenshot` 兼容字段）。
2. 修复 `PlaywrightBrowserDriver`：
   - 去掉 `_browser/_page` 私有字段与 `setDefaultTimeout` 猴子补丁，改为持有真实 `Browser/Context/Page`；
   - `DEFAULT_PW_CONFIG.sandboxMode: 'docker'` 当前无人消费，删除或落实语义（不要留假配置）；
   - 每个会话一个 `BrowserContext`，空闲 N 分钟自动关闭；崩溃后重建一次。
3. 动作集合统一（对外保持向后兼容）：

   | 对外 action | driver 能力 | 说明 |
   |---|---|---|
   | `navigate` / `open_tab` | `goto` / `context.newPage` | `open_tab` 新建页并导航 |
   | `click` / `fill_form` | `click` / `fill` | `form_data` 逐个选择器填充 |
   | `screenshot` | `screenshot` | 落临时文件，返回路径 + 尺寸 |
   | `get_tabs` | `context.pages()` | 真实标签页列表 |
   | `get_content`（新增） | `content` / `innerText` | 给模型可读页面正文（截断上限） |
   | `back` / `reload` / `close`（新增） | 同名 | 生命周期控制 |
   | `evaluate` | **不开放**（v1） | 任意 JS ≈ 代码执行，需单独立项 |

4. **安全**：
   - `allowedDomains` 从配置读取，非空时只允许命中域；默认拦截 `file://`、`data:`、
     `localhost/127.0.0.1/内网段`（除非显式放行）；
   - 禁止下载落盘；`acceptDownloads: false`；
   - headless 默认 `false`（用户可见，降低"静默操作"风险），可配置。
5. **截图闭环**：截图保存到 `resolveTempDir()/browser-shots/`，返回路径与尺寸；
   需要理解页面时复用 `browser_vision` 的视觉分析（`RouteKey.IMAGE_ANALYZE`），
   而不是把 base64 塞进工具结果。

### 3.3 Computer Use

1. **开放步骤**：移出归档 → 新增 `desktop` 类别 → 新 flag `COMPUTER_USE` 默认 false →
   设置页 Toggle → 平台能力探测（`adapter.isSupported()` / `capabilities`），不支持时明确失败而非假装成功。
2. **输入加固（先行，必须）**：
   - `launchApp` / `activateApp`：改为 base64 传参（与应用内 `setClipboard` 的既有写法一致），
     或 `Start-Process -LiteralPath` + 转义；禁止字符串插值；
   - `keyPress` / `keyCombination`：按键名白名单（枚举 + 映射表），非法键直接拒绝；
   - Mac/Linux 适配器同批准入审计（`osascript` / `xdotool` 参数拼接同样检查）。
3. **截图闭环**：新增 `analyze?: boolean`：
   - `false`（默认）：返回截图文件路径 + 尺寸 + 大小；
   - `true`：调用既有视觉模型分析（复用 `browser_vision` 的 `analyzeImage` 路径），返回 `analysis` + 路径；
   - 任何情况下都**不把 base64 放进工具结果文本**（当前实现会撑爆上下文）。
4. **清理**：`computer_use_cleanup` 实装：删除本次会话临时截图、`resetComputerUseAdapter()`。
5. **坐标一致性**：校验多屏/DPI（截图物理像素 vs 鼠标逻辑坐标），必要时按 `scaleFactor` 归一；
   在 Windows 125%/150% 缩放下做真机验证。
6. **风险声明**：桌面自动化可操作任意前台窗口（含密码管理器），
   首次开启时给出明确提示；ESTOP 全局暂停继续作为兜底。

### 3.4 设置页

- 「功能开关」新增：`browser` / `computerUse`（含依赖状态：playwright-core 是否可用、系统浏览器路径）。
- 「工具可见性」：两工具从 archived 变为可见性可控；展示风险级别与「每次调用需审批」。
- 依赖缺失时：开关可打开但工具调用返回明确错误（不静默隐藏），并在设置页给出安装指引。

---

## 4. 分阶段实施

| 阶段 | 内容 | 可独立验证 |
|---|---|---|
| P0 | 安全加固 S1–S3 + 适配器输入白名单测试（不开放工具） | 构造含 `'` 的路径/按键，断言被拒或安全转义 |
| P1 | `computer_use` 开放：去归档 + `desktop` 类别 + flag + 能力探测 + 清理 + `analyze` | 真机截图/鼠标/键盘三连；审批卡每次出现；关闭开关后模型不可见 |
| P2 | `browser` 真实化：引擎依赖 + 重写 execute + 会话隔离 + 域名白名单 + 输出 schema | 本地静态页 navigate/click/fill/screenshot/get_content；缺依赖时错误含安装命令 |
| P3 | 设置页/文档/可观测收口 + `browser_vision` 与新 driver 共用截图（可选） | 设置页开关即时生效；可见性报表原因正确 |

每阶段独立提交（CD06），默认关闭（flag off）即回滚口径。

---

## 5. 验收标准

**Computer Use**

1. 真机 `screenshot` 返回真实 PNG（尺寸等于屏幕，非 1×1）；文件存在于临时目录。
2. 打开记事本 → `keyboardType` 输入文本 → `screenshot` 可见文本（人工核对）。
3. `mouseMove` + `click` 在自建测试窗口命中按钮。
4. 非支持平台返回明确错误；`NoopAdapter` 不返回成功。
5. 每次调用均弹审批；审批卡无「永久放行」档。

**Browser Use**

1. 启动本地静态页（`http://127.0.0.1:<port>`），`navigate` 返回真实标题；`get_content` 含页面正文。
2. `click` 后页面状态变化可被 `get_content` 观察到；不存在的选择器返回明确错误。
3. `screenshot` 生成真实图片文件（非 1×1、非硬编码 base64）。
4. `get_tabs` 返回真实页面列表，且与打开数量一致。
5. `allowedDomains` 外域名被拒；`file://` 被拒。
6. 未安装 `playwright-core` 时，错误信息包含可执行安装命令；工具不崩溃。

**通用**

- 关闭 flag：模型工具清单不含该工具；设置页显示「已关闭/未启用」原因。
- 开启后下一轮对话即可见，无需重启。
- `lint:arch`、`lint:infra`、`typecheck`、相关单测全绿。

---

## 6. 守卫与测试更新清单

| 文件 | 需要改什么 |
|---|---|
| `app/tests/tools/toolCategories.test.ts:277-334` | 现断言「misc 仍会裁 browser/computer_use」⇒ 随开放更新对照工具 |
| `app/tests/tools/toolVisibilityReport.test.ts:97-104` | 归档集断言改为遍历新的 `ARCHIVED_MISC_TOOLS`（应为空或其它工具） |
| `app/tests/tools/toolSearchCoverage.test.ts:43,89` | 现以 `computer_use` 作「永久不可见」样本 ⇒ 换样本 |
| `app/tests/tools/toolDataSourcesNotNewTools.test.ts:48` | 名单中含 `computer_use`，需确认语义 |
| `app/tests/tools/toolNameLists.test.ts` | `misc == ARCHIVED` 的守卫需同步 |
| 新增 `app/tests/tools/computerUseTool.test.ts` | 动作分派、参数校验、Noop 失败、`analyze` 分支（mock 适配器） |
| 新增 `app/tests/tools/browserTool.test.ts` | 动作映射、错误分支、域名白名单（mock driver） |
| 新增适配器测试 | 注入路径/按键（含 `'`、`;`、`$()`）断言被拒或安全编码 |

---

## 7. 决策点（需要拍板）

| ID | 决策 | 选项 | 建议 |
|---|---|---|---|
| D0 | 对外命名 | A 保持 `browser`，加别名 `browser_use`；B 直接改名 | **A**（不破坏既有提示词/测试/历史会话） |
| D1 | 浏览器引擎 | A `playwright-core` + 系统 Chrome/Edge；B 完整 Playwright + Chromium；C 仅 CDP | **A** |
| D2 | `computer_use` 默认可见任务 | A 新 `desktop` 类别，加入 chat/default/agent；B 仅 agent/长程任务 | **A**（仍需开关开启） |
| D3 | 审批粒度 | A 全部 `ask`；B 只读动作（截图/取窗口）免审批 | **A**（最安全，先观察再谈放宽） |
| D4 | 截图反馈 | A 复用视觉模型 `analyze`；B 扩展 ToolResult 图片通道 | **A**（改动小，跨 provider 风险低） |
| D5 | 默认开关 | A 两者默认关；B `computer_use` 默认开 | **A** |
| D6 | `browser_vision` | A 暂不动；B 与新 browser driver 共用会话与截图 | **B 列为 P3 可选项** |

---

## 8. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 桌面自动化误操作真实窗口 | 每次审批 + 首次开启提示 + ESTOP；默认关闭 |
| PowerShell 注入（S1–S3） | P0 先修 + 注入用例；不修不开放 |
| 浏览器驱动不稳定 / 系统无浏览器 | 启动自检 + 明确错误 + 回退 Edge/Chrome；失败不伪造成功 |
| 上下文被截图 base64 撑爆 | 只返回路径；需要理解时走视觉分析 |
| 破坏既有可见性守卫 | 守卫与实现同批更新；独立提交可 revert |
| 无人值守模式自动放行 EXTERNAL | 保持现状（EXTERNAL 永远人工）；不新增例外 |

---

## 9. 明确不做

1. 不开放 `evaluate`（任意 JS 执行）与下载落盘。
2. 不实现验证码/反爬绕过，不把用户 cookie 导出到外部服务。
3. 不为 EXTERNAL 工具新增「永久免审批」档。
4. 不在无人值守模式下自动批准两个工具。
5. 不重命名既有工具名（除非 D0 选 B）。

---

## 10. 证据索引

| 用途 | 路径 |
|---|---|
| Browser 假实现 | `app/src/tools/BrowserTool/BrowserTool.ts:279-357` |
| 未被接线的真驱动 | `app/src/tools/BrowserTool/PlaywrightDriver.ts` |
| 归档与类别 | `app/src/tools/toolCategories.ts:234-235`、`:298-301` |
| 注册门控 | `app/src/tools/utils/ToolManagerUtils.ts:201`、`:254` |
| 用户可配开关机制 | `packages/query/src/query/featureGate.ts:31-42` |
| 风险与审批 | `app/src/tools/toolEffects.ts:76-82`、`packages/infra/src/permission/PermissionChecker.ts:514-531` |
| ComputerUse 实现 | `app/src/tools/ComputerUseTool/ComputerUseTool.ts` |
| 平台适配器 | `packages/infra/src/utils/computerUse/{index,WindowsAdapter,MacAdapter,LinuxAdapter}.ts` |
| 清理钩子空实现 | `packages/query/src/query/taor/stopHooks.ts:124-133` |
| 支持等级 | `app/docs/SUPPORT-LEVELS.md:75-81` |
| 真机可见性读数 | `GET http://127.0.0.1:18990/v1/tools/visibility`（2026-11-21） |

---

## 11. 执行结果与偏差（2026-11-21 已落地）

**决策**：D0 A（保持 `browser` 名）· D1 A（`playwright-core` + 系统 Chrome/Edge）· D2 A（新增 `desktop`
类别，进 chat/default/agent 白名单）· D3 A（全部 `ask`）· D4 A（`analyze=true` 走视觉模型）·
D5 A（两者默认关）· D6 A（`browser_vision` 本轮不动）。

**P0：注入加固（S1–S3 + 数字位）**
- 新增 [`packages/infra/src/utils/computerUse/safety.ts`](../../packages/infra/src/utils/computerUse/safety.ts)：
  `psBase64Expression`（PowerShell 文本零插值注入）、`toSendKeysToken`/`buildSendKeysCombination`
  （按键白名单，未知键直接拒绝）、`escapeAppleScriptString`、`requireInt`/`requireNumber`。
- `WindowsAdapter`：`launchApp` / `activateApp` 改 base64 注入；`keyPress`/`keyCombination`/`keyDown`/`keyUp`/
  `keyHold` 走白名单；坐标/滚动/时长/质量/区域走范围校验。
- `MacAdapter`：`keystroke` / `tell application`（含 `id`）按 AppleScript 字面量转义；坐标/滚动/JXA 参数校验。
- `LinuxAdapter`：几何/质量/坐标校验（`execFile` args 数组本无 shell 注入面）。
- 用例 `app/tests/tools/computerUseInputSafety.test.ts`（12 例，含"源码不得再出现裸插值"静态守卫）。

**P1：computer_use 开放**
- 类别：`computer_use → desktop`（新类别，进 chat/default/agent）；移出 `ARCHIVED_MISC_TOOLS`（现为空集）。
- 开关：新 flag `COMPUTER_USE`（默认 false）+ 用户可配键 `features.computerUse`；
  `toolFeatureGate.ts` 为唯一登记点，**在出站定义处按轮求值**（约 `buildToolDefinitions`），并在执行入口兜底。
- 截图闭环：截图写 `<tmp>/liri-computer-use/<session>/`，结果只回**路径 + 尺寸 + 字节数**（不再回 base64）；
  `analyze=true` 复用视觉模型（`visionAnalyze.ts`）返回文字结论。
- 清理：stop hook `computer_use_cleanup` 真实删除本会话截图并 `resetComputerUseAdapter()`。
- 工具可注入适配器（单测无需真实桌面）：`app/tests/tools/computerUseTool.test.ts`（6 例）。

**P2：browser 真实现**
- 依赖 `playwright-core@1.65.1`（系统 Chrome / Edge，回退内置 Chromium；缺失时给可执行安装命令）。
- [`PlaywrightDriver.ts`](../../app/src/tools/BrowserTool/PlaywrightDriver.ts) 重写：
  进程级共享 browser + **会话级 context**（cookie 隔离）、空闲自动关闭（执行期间暂停计时）、
  动作 = open_tab / navigate / click / fill / screenshot / get_content / get_tabs / back / reload / close；
  **不开放 `evaluate`**；`acceptDownloads:false`；headless 默认 false。
- 安全：只允许 `http/https`；`file:`/`data:`/`javascript:` 拒绝；环回/内网默认拒绝（`allowPrivateNetwork`）；
  `allowedDomains` 白名单。
- `BrowserTool.execute` 删除全部模拟分支（假成功 / 1×1 假 PNG / 写死标签页），改为委托驱动；
  截图落盘 + 可选 `analyze`；出参 `screenshot` 改为**文件路径**。
- 用例 `app/tests/tools/browserTool.test.ts`（10 例，含 URL 规则）；真机验收（Chrome headless + 本地静态页）：
  navigate 真标题 · get_content · click 后正文变化 · fill 生效 · 截图 9024B 真 PNG · tabs=1 ·
  缺失选择器 30s 超时明确报错 · `file://` 被拒。

**P3：设置页 / 可见性 / 文档**
- 设置页「功能开关」新增 `browser` / `computerUse` 两个 Toggle（中英文案齐备，默认 false）。
- 可见性报表新增原因 `feature-gate-off`（shared 枚举 + 前端文案 + 优先级），且 `on` 覆写**不能**绕过总闸。
- `SUPPORT-LEVELS.md` 重新生成：两工具 `community → core`（均有专属测试）。
- 门禁：`typecheck`（app + client）· `bun test tests/tools`（1705 pass）· `lint:arch` / `lint:infra` /
  `lint:size` / `lint:session` / `lint:mock` / `lint:state-ratchet` / `lint:no-module-mock` /
  `lint:support-levels` 全绿。

**与方案的偏差（如实）**
1. **注册期不裁剪**：原方案 3.1.1 写"ToolManagerUtils 换成用户可配门控"，但注册只发生一次
   （`ensureToolLoaded` 幂等）⇒ 那样做会让"打开开关需重启"，与验收冲突。实际改为
   **出站定义按轮求值 + 执行入口兜底**（双层，均复用同一 `toolFeatureGate`）。
2. **未把两个工具写进 `DEFAULT_DISCLOSURE_TOOLS`**：该集合受 AC-16 披露预算门禁约束（只许收窄）。
   改为"**开关开启即视为披露**"（`isInDefaultDisclosure` 对受控工具按开关求值）⇒ 关闭时预算基线不变。
3. **变体默认不生效**：coding 变体矩阵历史上把 `BROWSER` 设为 true（当时工具被归档，等于无效配置）。
   为满足 D5/验收"关闭 flag ⇒ 不含该工具"，新增 `resolveOptInFeatureGate`（env > 用户设置 > **false**，
   **不读 `feature()` 的变体默认**），两个工具都走它；打包矩阵本轮未改。
4. **`browser_vision` 现与 `BrowserTool` 共用会话**（2026-11-21 晚，D6-B）：`browser_vision` 改为经 `getBrowserSessionDriver(sessionId)` 截图（jpeg + quality），不再直连 CDP 9222；截图落盘到会话截图目录，默认保留、`returnScreenshot=false` 才删除。回归：`app/tests/tools/browserVisionTool.test.ts`（3 例）。副作用：内核 `DEFAULT_CDP_ENDPOINT` 自此**零消费者**（保留待 ABI 清理批次处理，不在本轮删）。
5. 未新增"永久免审批"档；`EXTERNAL` 仍逐次审批（D3）。
