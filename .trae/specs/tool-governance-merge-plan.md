# 工具治理方案 v3：包化、核心最小集与按需发现（2026-11-21）

> 状态：**C1–C5 已实施**（2026-11-21；未提交）。实施落点与验收见 §15；
> P4 物理拆包：**media / browser 驱动 / tool-base 契约 / office 域已拆**（§15.8 / §15.9），工具类 `BrowserTool`·`ComputerUseTool` 与 desktop 待后续处理。
> v3 变更：采纳 v2 的建议项（D1–D8），并把「profile / 工具包元数据 / 插件工具契约 / 设置页 / 守卫」
> 细化到文件与函数级；新增 §14 落地清单。v2 的参考对照与重复项判定保留。
> 修订说明：v1 的结论是「`file_write`/`file_edit`/`file_convert` 三合一」。参考
> `E:\PY\Documents\CODES\REF\BA_REF\deepseek-harness` 后**撤回该首选结论**：
> 参考实现把 `read` / `write` / `edit` 保持为**独立工具**，通过「插件包 + profile + 每工具开关」控制可见面；
> 且本仓 `toolCategories.ts:588-591` 早已实测否决过合族（工具总数反增、schema 并集不减少）。
> v2 改为：**包化 → 核心最小集 → 按需发现**；合并只作为附录中的"已评估、暂不采用"。
> 关联规则：CS01（复用已有）· CS04（零 Mock/重复实现）· CS05（根因优先）· CD05/CD06 · R02 · R06-006
> 数据来源：`bun run scripts/analyze-tool-usage.ts`（100 会话 / 60 MB / 9280 次调用）+ `GET /v1/tools`（60 个）+ 源码取证

---

## 0. 结论先行

1. **能做成插件，而且不必新造框架**：Liri 已有 `plugin-sdk`（`ToolPlugin` / `ToolRegistration` / `createToolPlugin`）、
   `SdkPluginAdapter`（把插件工具注册进全局 `ToolRegistry`）、`CAPABILITY_PACKS`（8 个能力包）、
   `CORE_MINIMAL`（7 工具下限）、`DEFAULT_DISCLOSURE_TOOLS`（12/13 个默认披露）、`tool_search`（按需发现）。
   缺的不是"插件系统"，而是**统一的工具包元数据 + 运行时 profile + 插件工具的类别/风险声明**。
2. **核心可以压到个位数（8–9）**：现有 `CORE_MINIMAL` 7 项
   （bash / file_read / file_write / file_edit / grep / glob / ask_user_question）
   再加 `tool_search`（否则隐藏工具永久不可达）= **8**；再加 `todo_write` = **9**。
   建议以**运行时 profile（精简 8/9 / 标准 12–13 / 全量）**提供，而不是只靠编译变体。
3. **不要做 op 合并**：`file_read` / `file_write` / `file_edit` 保持独立（与参考一致）；
   三者同属一个 `file` 工具包即可。合并只在"同资源、同权限、同类别、且披露预算不增"时才考虑，
   目前没有新的合格对象。
4. **真正的重复要按类型处理**：幽灵名/死键清理、模型面与内部面（`image` vs `media_*`）的实现统一；
   这些是治理债，不是靠合并解决。
5. **v3 已把建议固化为决策**：放弃 file 3→1；核心 9；平台 shell 二选一；运行时 profile（默认 standard）；
   插件工具强制声明 category/risk；物理拆包只做 media/office/browser/desktop 四域。

---

## 1. 参考架构（deepseek-harness）对照

### 1.1 事实

| 维度 | 参考实现 | 证据 |
|---|---|---|
| 框架 | 全插件化（Cordis）：工具、模型适配、会话日志、agent loop 都是插件，服务与事件挂在共享上下文 | `docs/architecture.zh.md:9-11` |
| 组合 | `profile`（具名组装）+ `bundle`（组合包 patch）+ `cordis.patch.yml`，按层覆盖 | 同上 `:13-27` |
| 工具包 | `packages/*/tool-*`，一个包可提供多个工具；模型侧 schema 由 `ctx.tools.schemas()` 白名单组装 | `docs/tool-catalog.zh.md:8-18`、`docs/subsystems/tools.zh.md:9-11` |
| 文件工具 | `dsh-tool-fs` 一个包提供 **read / read_image / write / edit 四个独立工具**，各自有 `read/readImage/write/edit` 开关 | `packages/fs/tool-fs/README.zh.md:44-69` |
| 最小集 | `sdk-minimal` 完整独立树：`tool-fs` 只开 `readImage`，加 `working_directory` 与终端工具 ⇒ 模型可见工具约 4 个 | `packages/bundle/sdk-minimal/cordis.patch.yml` |
| 默认集 | `dsh-base` 仍挂约 17 个工具插件行（bash/pwsh、fs、search、skill、subagent、todo、goal、web…） | `packages/bundle/base/cordis.patch.yml` |
| 运行时管理 | `plugin_manager` / `plugin_market` 支持安装、启停、查看 bundle；变更影响 profile 内所有会话 | `docs/tool-catalog.zh.md:22-23,62` |
| 安全 | 写文件受 sandbox 后端约束；审批策略独立于工具 schema；策略插件（先读后写）可插拔 | `docs/subsystems/tools.zh.md`、`tool-fs/README.zh.md:74-79` |

### 1.2 可直接借鉴的三条

1. **"包"是治理单位，不是"合并后的工具"**：一个包 = 一组同域工具 + 开关 + 依赖 + 平台门控；
   模型面仍是多个小工具，选择成本低于"一个大 op 联合体"。
2. **profile 决定默认面**：同一套包，`minimal` 只给个位数工具，`standard` 给核心 + 常用，
   `full` 全开；不需要为每种组合改代码。
3. **核心只放"发现入口"**：参考用 profile 预组合决定可见面；Liri 额外已有 `tool_search select:`（参考仓未提供同类工具），
   因此可以做到"核心 8–9 + 其余按需发现"，比参考的静态组合更灵活；两者结合即可。

### 1.3 不照搬的部分

- **不做 npm 插件市场**：本方案只做"内置工具包 + 用户启停"；第三方插件走既有 `plugin-sdk`，不新增市场。
- **不做"一工具一包"的物理拆分**：69 个工具拆成 69 个包，构建/依赖/发布成本过高；
  先做逻辑包（元数据 + 懒加载），只对重域（媒体/办公/浏览器/桌面）做物理拆包。
- **不把 agent loop 插件化**：Liri 的四阶段启动与模块系统已稳定，不在本次范围。

---

## 2. Liri 现状（已有机制与实测）

### 2.1 已有机制（应复用，勿重复建设）

| 机制 | 事实 | 落点 |
|---|---|---|
| 插件 SDK | `ToolPlugin` / `ToolRegistration` / `createToolPlugin`，manifest 校验 | `packages/plugin-sdk/src/plugin-sdk/{types,categories,core,ManifestLoader}.ts` |
| 插件工具注册 | SDK 插件工具 → `buildRegisteredTool` → 全局 `ToolRegistry`（冲突报错） | `app/src/plugins/core/SdkPluginAdapter.ts:210-235`、`app/src/plugins/utils/toolRegistration.ts:46-64` |
| 能力包 | 8 个包（media_image/video/audio、doc_extra、collab、schedule、workspace、system_extra），由 `TOOL_PACK_*` flag 控制 | `app/src/tools/toolCategories.ts:703-799` |
| 核心最小集 | `CORE_MINIMAL` 时恰好 7 个工具（编译变体，仅 core 为 true） | `app/src/tools/utils/ToolManagerUtils.ts:84-100,146-150` |
| 默认披露 | `DEFAULT_DISCLOSURE_TOOLS` 12 项；Windows 额外 `powershell` ⇒ 13 | `app/src/tools/toolCategories.ts:597-634` |
| 严格预算 | coding/agent 各 25；按 `STRICT_DISCLOSURE_PRIORITY` 截断 | 同上 `:1015-1044` |
| 按需发现 | `tool_search select:<name>` 记入会话级 discovered 集，下一轮注入 | `app/src/tools/ToolSearchTool/ToolSearchTool.ts:347-412`、`app/src/chat/orchestrator/streamMessageToolSelection.ts:103-115` |
| 每工具三态 | 设置页 `settings.tools`：auto/on/off（on 可绕过归档/裁剪） | `toolVisibilityReport.ts:218-229` |

### 2.2 实测数据

| 指标 | 数值 |
|---|---|
| 注册名 / 运行时工具 | 69 / 60 |
| 100 会话调用 | 9280 次；仅 27 个工具被用到；44 个零调用 |
| Top 5 | bash 35.3%、grep 27.9%、file_read 23.1%、tool_search 3.1%、file_write 2.7%（≈92%） |
| 默认可见 | 13 个（含 Windows powershell） |
| 单轮峰值 | 75 个 / 115.4 KB（历史宽松面；严格预算下 coding/agent 25） |

### 2.3 缺口

1. **`CORE_MINIMAL` 是编译期变体**：桌面用户无法在设置里切换；且 7 项里**没有 `tool_search`** ⇒ 隐藏的 60+ 工具在 core 下不可达（`ToolManagerUtils.ts:92-100`）。
2. **能力包没有"profile"维度**：包只有开关，没有"哪些包属于标准/精简/全量"的声明；默认面靠任务类别 + 披露白名单间接决定。
3. **第三方插件工具没有类别/风险声明**：`PluginToolDeclaration` 只有 name/description/parameters
   （`toolRegistration.ts:17-22`）⇒ 注册后 `getToolCategory` 落 `misc`、被任务裁剪；风险落 `undeclared` ⇒ 每次询问。
   连带三处失效：可见性覆写只认 `TOOL_NAME_CONSTANTS`（`toolVisibilityOverrides.ts:71-73,116-120`，插件工具名被当"未知"丢弃）、
   可见性报表只遍历常量表（`toolVisibilityReport.ts:181`，插件工具不出现）、`tool_search` 的覆盖表同样查不到。
4. **运行时 profile 与恒集有冲突点**：`getMandatoryTools()` 读进程级 flag（`toolCategories.ts:558-563`），
   `agent` 在 AGENT 开启时恒保留 ⇒ `minimal` profile 必须显式排除 `agent`，否则压不到个位数。
5. **包与工具的关系只在一张表**：`CAPABILITY_PACKS` 有 tools 清单，但缺 `defaultIn` / `requires` / `platform` / `risk` 等元数据，
   无法生成 profile 与设置页分组。
6. **幽灵名/死键**：`knowledge_write` / `knowledge_search` / `search_codebase` / `music_generate` 在台账或类别表里，当前构建无实现（见 §7）。

---

## 3. 目标形态：三层工具面

```
L0 核心（8–9）        —— 永远下发（profile=minimal/standard/full 都含）
L1 工具包（8–10 包）   —— 按 profile / 用户开关 / 任务面启用
L2 按需发现（其余）     —— 仍注册可调用，模型经 tool_search 拉入下一轮
```

| 层 | 内容 | 数量 | 入口 |
|---|---|---|---|
| L0 | `bash`（Unix）/`powershell`（Windows）、`file_read`、`file_write`、`file_edit`、`grep`、`glob`、`ask_user_question`、`tool_search`、（可选）`todo_write` | 8–9 | 恒下发 |
| L1 | media_image、media_video、media_audio、doc_extra、collab、schedule、workspace、system_extra；新增 `desktop`（computer_use/browser/browser_vision）、`knowledge`、`web`、`code`（可选拆分） | 8–12 包 | 设置页开关 / profile |
| L2 | 其余全部（含 task_output/task_stop、lsp、repl、mcp_*、vfs、notebook、kanban…） | 余量 | `tool_search` |

**关键不变量**

1. L0 必须含 `tool_search`，否则 L2 不可达。
2. L1 的每个包必须声明 `tools[]` + `defaultIn` + `requires` + `platform?` + `risk`；
   包内工具可以**单独三态开关**（复用 `settings.tools`），不必为每个组合新建包。
3. L2 工具**仍然注册**（执行面不变），只是默认不下发；`tool_search` 发现后下一轮可见。
4. 任何 profile 切换都必须经过既有披露预算门禁（AC-16 / `measure:tool-disclosure`），不得悄悄突破上限。

---

## 4. L0 核心最小集设计

### 4.1 建议集合

| # | 工具 | 依据 |
|---|---|---|
| 1 | `bash`（Unix）或 `powershell`（Windows） | 最高频（35.3%）；平台各留一套，避免双壳 |
| 2 | `file_read` | 23.1% |
| 3 | `file_write` | 2.7% |
| 4 | `file_edit` | 0.5%，但与 write 成对使用 |
| 5 | `grep` | 27.9% |
| 6 | `glob` | 1.0%，与 grep 互补 |
| 7 | `ask_user_question` | 唯一人工交互入口 |
| 8 | `tool_search` | **L2 唯一入口**（必须） |
| 9 | `todo_write`（可选） | 长任务进度可见性；若 `TODO` flag 关则可省 |

平台 shell 二选一后为 **8 项**；保留 `todo_write` 为 **9 项**，符合"个位数"。

### 4.2 与现有 `CORE_MINIMAL` 的差异

- 现有 7 项 **缺 `tool_search`**：core 变体下隐藏工具不可达 ⇒ 必须补（`ToolManagerUtils.ts:92-100`）。
- 现有 7 项含 `bash`（Windows 上是 cmd.exe），但 `powershell` 在 Windows 默认披露面里是刚需（`toolCategories.ts:612-634`）
  ⇒ 建议按平台替换，而不是两个都给。
- 现有 `CORE_MINIMAL` 只在编译期（`variant-matrix.ts` 的 `minimalToolSurface`）⇒ v2 增加**运行时 profile**，
  编译变体保留用于产物体积裁剪。

### 4.3 profile 设计

| profile | 工具面 | 适用 |
|---|---|---|
| `minimal` | L0（8） | 低配 / 小上下文模型 / 嵌入式 |
| `standard`（默认） | 现有 `DEFAULT_DISCLOSURE_TOOLS`（12/13） | 日常对话 / 编码 |
| `full` | 全量（受任务类别与预算限制） | 调试 / 高级用户 |

- profile 持久化在用户配置（与 `settings.tools` 同层），**每轮现读**，切换即时生效。
- 实现上复用 `filterToolsByTask` 之前的"显式允许集"：profile 作为 `forcedVisibleTools` 的补集/白名单来源，
  不新增第二套过滤链（CS01）。
- 设置页：通用配置 → 「工具面」三选一 + 显示当前可见工具数 / schema 体积估算。

---

## 5. 工具包（Plugin / Pack）设计

### 5.1 统一元数据（扩展现有 `CAPABILITY_PACKS`，不新建第三张表）

在 `CapabilityPackSpec` 上补字段：

```ts
interface CapabilityPackSpec {
  id: CapabilityPack;
  flag: FeatureFlag;            // 已有
  tools: readonly string[];     // 已有
  summary: string;              // 已有
  defaultIn: readonly Profile[];// 新增：minimal? standard? full?
  requires?: readonly CapabilityPack[]; // 新增：依赖包
  platform?: NodeJS.Platform;   // 新增：平台专属包（如 desktop 仅 win/mac）
  risk: 'high' | 'write' | 'read'; // 新增：包级风险（展示/默认开关用）
}
```

- 包内**每个工具**仍可被 `settings.tools` 三态覆写（已有），无需新增机制。
- 包开关与 profile 的关系：`profile` 决定"默认开哪些包"，用户显式开关优先级更高。
- 现有 8 个包保持 id 不变（避免迁移）；新增 `desktop`（computer_use / browser / browser_vision）、
  `knowledge`（knowledge_save 等）、`web`（web_fetch / web_search）、`code`（lsp / repl / code_run）作为可选包。
  **新增包默认 `defaultIn: ['full']`**，不改变现状。

### 5.2 第三方插件工具契约（补类别与风险）

`PluginToolDeclaration` / SDK `ToolRegistration` 增加**可选**字段：

| 字段 | 作用 | 缺省 |
|---|---|---|
| `category` | 工具类别（决定任务面可见性） | `plugin`（新增类别，仅 plugin 开关开启时可见） |
| `pack` | 归属工具包（动态包，按插件启用） | 插件 id |
| `riskClass` | `read` / `write` / `shell` / `external` | `undeclared`（保持每次询问） |
| `readOnly` | 是否只读（用于并发/沙箱豁免判定） | false |

- 注册路径不变：`SdkPluginAdapter.registerTools()` → `ToolRegistry`；新增"注册时登记类别/风险"一步。
- 防护：插件工具若未声明 `category`，落 `plugin` 类别并**只在插件启用时**加入允许集，避免"注册了但模型看不见"。
- 卸载：`unregisterTools()` 同步移除类别/包登记（可逆副作用）。
- 这是参考实现"包内多工具 + 配置开关"在 Liri 的最小落地，不引入市场。

### 5.3 物理打包策略

| 阶段 | 做法 | 理由 |
|---|---|---|
| A（本方案） | **逻辑包**：元数据 + 懒加载 + 设置页分组；文件仍留在 `app/src/tools` | 零搬迁风险；先拿到治理收益 |
| B（按需） | 把重域抽成独立包：`packages/tool-media`、`tool-office`、`tool-browser`、`tool-desktop` | 这些域依赖重（sharp/pdf/playwright/PowerShell），独立包可真正裁剪产物体积 |
| B′（2026-11-21 已落地） | `packages/tool-media`（15 个纯对象工具）、`packages/tool-browser`（`PlaywrightDriver` + `schemas`）、`packages/tool-base`（`BaseTool` 契约 + 副作用/能力/风险派生）、`packages/tool-office`（`DocGenerateTool` / `PDFTool` / `converter` / Jupyter nbformat 模型）；`MediaModule` / `BrowserTool` / `NotebookManager` / `NotebookToolImpl` **留在 app** 负责注册与生命周期 | 工具类继承 `BaseTool`，搬迁需**先**把基类契约下沉到包（本轮已完成，app 保留转发 shim ⇒ 57 处引用零改动）；office 域随之可整体迁出 |
| C（不做） | 一工具一包（69 包） | 包管理与构建成本远大于收益 |

---

## 6. 按需发现（L2）机制

已有实现，直接复用：

1. 模型调用 `tool_search({query:"select:<tool_name>"})`
   → `ToolSearchTool.ts:347-412` 记录到会话级 `recordDiscoveredTools`；
2. 下一轮 `selectToolsForTurn` 通过 `discoveredToolNames` 把工具补回（`streamMessageToolSelection.ts:103-115`）；
3. 归档工具仍被排除（除非用户显式 `on`），不会被检索旁路绕过（`ToolSearchTool.ts:336-345`）。

需要补的只有**可观测与上限**：

- 记录每次发现的工具名、轮次、是否最终被调用（已有 `logger.info('tool_search:discovered')`，补统计）；
- 单会话 discovered 集上限（防止一次拉入几十个工具把披露预算打回 115 KB）；
- 设置页展示"本会话已发现 N 个工具"。

---

## 7. 重复项判定（v1 矩阵修订）

> 结论：**包化解决"可见面"，实现去重解决"代码重复"；op 合并不再作为首选。**
> 既有否决依据：`toolCategories.ts:588-591`——合族会让工具总数 82→88（违反 AC-16 只减不增），
> schema 参数面并集不减少。

| 簇 | 处理方式（v2） | 说明 |
|---|---|---|
| `file_read` / `read_project_file` | **保持独立**，同属 `file` 包（逻辑） | 资源不同（本地 FS vs 项目 sandbox），不是重复实现 |
| `file_write` / `file_edit` / `file_convert` | **保持独立**，同属 `file` 包 | 参考实现同样保持 read/write/edit 独立；包开关即可裁剪 |
| `create_project` / `read_project_file` / `write_project_file` | 同一 `project` 包，工具独立 | 打包不改语义；跨类别问题消失 |
| `brief` / `save_conversation` | 同一 `session` 包，工具独立 | 类别不同的问题由包层解决（包不参与任务类别裁剪） |
| `mcp_tool` / `mcp_resource` / `mcp_auth` | 同一 `mcp` 包，工具独立 | 受 flag 约束；auth 保持独立开关 |
| `doc_generate` / `pdf` | 同一 `doc` 包 | 不再讨论 2→1 |
| `image` / `video` / `music` / `media_*` | 同一 `media` 包；**只做实现统一** | 模型面与内部面（前端 `mediaService`）共用底层服务 |
| `grep` / `glob` | 同一 `search` 包，保持独立 | 热路径，语义不同 |
| `bash` / `powershell` | 同一 `shell` 包，按平台二选一 | 安全链不同，绝不合并 |
| `task_list` / `task_output` / `task_stop` | 同一 `task` 包，保持独立 | 生命周期不同（既有裁定） |
| `vfs` | 独立 `vfs` 包 | 已族内合并，独立命名空间 |
| `knowledge_write` / `knowledge_search` / `search_codebase` / `music_generate` | **清理**（见 §8 / §15.5） | 幽灵名/死键，不是合并对象 |

> 2026-11-21 取证订正（§15.5）：四者性质不同 —— **仅 `search_codebase` 是死键**（无实现 / 无注册 / 不在常量表）；
> `knowledge_*` 与 `music_generate` **都有真实实现**，只是当前未注册（影子工具），**不删**（CD07）。

---

## 8. 分阶段实施

| 阶段 | 内容 | 验收 |
|---|---|---|
| P0 | 扩展 `CapabilityPackSpec`（defaultIn/requires/platform/risk）；补 `plugin` 类别与插件工具声明字段 | 类型检查、包元数据单测、既有 8 包零行为变更 |
| P1 | 运行时 profile（minimal 9 / standard 12-13 / full）；设置页「工具面」；复用 `filterToolsByTask` | 切 profile 即时生效；`measure:tool-disclosure` 不超基线；核心 9 项准确 |
| P2 | 设置页按包分组 + 每工具三态联动；可见性报表增加"所属包/是否在 profile" | 报表与真实裁剪同源；开关后下一轮生效 |
| P3 | 幽灵名/死键清理（独立提交）；媒体内部面实现统一 | `GET /v1/tools` 无孤儿名；模型面与内部面行为一致 |
| P4（可选） | 重域物理拆包（media/office/browser/desktop） | 产物体积下降；懒加载按需加载可观测 |

**不设"合并阶段"**：v1 的 `file` 3→1 不再执行。

---

## 9. 度量与验收

**基线（已采集）**：69 / 60 / 9280 次 / 27 个在用 / 44 个零调用 / 默认可见 13 / 峰值 115.4 KB。

**目标（P1 完成后）**：

| 指标 | 目标 |
|---|---|
| `minimal` profile 可见工具数 | 9（含 `tool_search` 与 `todo_write`） |
| `standard` profile | 12/13（不突破 AC-16 基线） |
| 单轮披露 schema | `minimal` ≤ 当前 13 项面；`standard` 不增 |
| L2 可达性 | 任意注册工具可经 `tool_search select:` 在下一轮可见（抽样 10 个） |
| 插件工具 | 声明 category/risk 后可见且审批正确；未声明落 `plugin` 类别不被静默裁剪 |
| 回归 | `lint:arch` / `lint:infra` / `typecheck` / `bun test` / `lint:status` 全绿 |

---

## 10. 已定决策（v3 采纳，不再作为开放问题）

| ID | 决策 | 结论 | 依据 |
|---|---|---|---|
| D1 | v1 的 `file` 3→1 | **放弃** | 参考保持 read/write/edit 独立；本仓合族否决记录 `toolCategories.ts:588-591` |
| D2 | 核心集大小 | **9**（含 `tool_search` 与 `todo_write`） | 发现入口不可缺；长任务需要进度可见 |
| D3 | 平台 shell | **二选一**：Unix `bash` / Windows `powershell` | 避免双壳 schema 与两套安全链同时暴露 |
| D4 | `CORE_MINIMAL` | **升级为运行时 profile**；编译变体保留用于产物裁剪 | 桌面用户可切换，无需重编译 |
| D5 | 默认 profile | **`standard`**（现状 12/13） | 合入即零行为变更；`minimal` 供用户选 |
| D6 | 插件工具声明 | **强制** `category` / `riskClass`；未声明落 `plugin` 类别 + `undeclared` | 不静默可见、不静默放行 |
| D7 | 物理拆包 | **仅四域**：media / office / browser / desktop | 重依赖可裁剪；不做一工具一包 |
| D8 | 幽灵名清理 | 先核实运行期注册；确认无实现则移除 | CD01–CD04；独立提交 |

> 仍属实现级选择（不需要产品拍板，实施时按注释记录）：
> `plugin` 类别命名、`full` profile 是否关闭默认披露收窄、`media_*` 实现统一的先后顺序。

---

## 11. 风险与回滚

| 风险 | 缓解 |
|---|---|
| minimal 下模型找不到工具 | L0 必含 `tool_search`；设置页显示"已隐藏 N 个，可用 tool_search 发现" |
| profile 破坏既有披露基线 | 复用 AC-16 门禁；`measure:tool-disclosure --update` 需显式评审 |
| 插件工具类别/风险声明遗漏 | 默认 `plugin` 类别 + `undeclared` 风险（不静默可见、不静默放行） |
| 包元数据与真实注册面漂移 | 守卫测试：包内 tools 必须存在于 `TOOL_NAMES`（或运行期注册表） |
| 逻辑包与物理包命名漂移 | 包 id 单一事实源；物理拆包沿用同一 id |
| 回滚 | 每阶段独立提交；profile 默认 standard ⇒ P1 合入后默认零行为变更；包元数据只增不改语义 |

---

## 12. 明确不做

1. 不做 `file_read`/`file_write`/`file_edit` 的 op 合并。
2. 不做 npm 插件市场 / 第三方包自动安装（参考有，本仓不在本次范围）。
3. 不做"一工具一包"的物理拆分。
4. 不删除任何前端直接调用的内部工具（`media_*`）。
5. 不以"零调用"作为删除依据（CD07）。
6. 不改变审批/风险默认语义。

---

## 13. 证据索引

### Liri

| 用途 | 路径 |
|---|---|
| 插件 SDK 与工具注册 | `packages/plugin-sdk/src/plugin-sdk/{types,categories}.ts`、`app/src/plugins/core/SdkPluginAdapter.ts:210-260` |
| 插件工具声明 | `app/src/plugins/utils/toolRegistration.ts:17-64` |
| 能力包 | `app/src/tools/toolCategories.ts:703-799` |
| 核心最小集 | `app/src/tools/utils/ToolManagerUtils.ts:84-100,146-150`、`app/tests/tools/coreToolSurface.test.ts` |
| 默认披露与预算 | `app/src/tools/toolCategories.ts:575-634,1015-1044` |
| 合族否决记录 | `app/src/tools/toolCategories.ts:588-591` |
| 按需发现 | `app/src/tools/ToolSearchTool/ToolSearchTool.ts:336-412`、`app/src/chat/orchestrator/streamMessageToolSelection.ts:103-115` |
| 使用量实测 | `bun run scripts/analyze-tool-usage.ts`（9280 次 / 27 个 / 44 零调用 / 峰值 115.4 KB） |
| 运行时工具面 | `GET http://127.0.0.1:18990/v1/tools`（60 个） |

### 参考仓库

| 用途 | 路径 |
|---|---|
| 插件化架构与 profile/bundle/patch | `REF/BA_REF/deepseek-harness/docs/architecture.zh.md:9-27` |
| 工具目录与包映射 | `.../docs/tool-catalog.zh.md:8-54` |
| 工具流水线/注册表 | `.../docs/subsystems/tools.zh.md:9-11` |
| 一个包多工具 + 开关 | `.../packages/fs/tool-fs/README.zh.md:44-69` |
| 最小 profile | `.../packages/bundle/sdk-minimal/cordis.patch.yml` |
| 默认组合包 | `.../packages/bundle/base/cordis.patch.yml` |
| 插件管理工具 | `.../docs/tool-catalog.zh.md:22-23,62` |

---

## 14. v3 落地细化（文件 / 函数级）

### 14.1 运行时 profile

**配置**：`settings.toolSurface`（`'minimal' | 'standard' | 'full'`，默认 `standard`）。
沿用通用命名空间端点 `GET/PUT /v1/settings/{ns}`（与 `settings.tools` 同一条通路，`toolVisibilityOverrides.ts:62-68` 已注明），
**不新增 HTTP 路由**。

**新文件** `app/src/tools/toolSurfaceProfile.ts`：

```ts
export type ToolSurfaceProfile = 'minimal' | 'standard' | 'full';
export const TOOL_SURFACE_SETTINGS_KEY = 'settings.toolSurface';

/** 每轮现读（与 featureGate 同口径：改设置无需重启） */
export function readToolSurfaceProfile(): ToolSurfaceProfile;

/** L0：核心 9（平台 shell 二选一） */
export function getCoreToolNames(platform?: NodeJS.Platform): readonly string[];
// common: file_read, file_write, file_edit, grep, glob,
//         ask_user_question, tool_search, todo_write
// shell : win32 ? powershell : bash
```

**插入点**：`app/src/chat/orchestrator/streamMessageToolSelection.ts:144-203` 的 `selectToolsForTurn`

- 入参接口 `ToolSelectionInput` 增加 `surface?: ToolSurfaceProfile`；
- 唯一调用方 `streamMessageToolSelectionFlow.ts:104-130` 在**非重放分支**传 `surface: readToolSurfaceProfile()`
  （重放分支仍只传 `forcedVisibleTools`，保证快照可复现）。

```
forcedVisibleTools 分支（重放）            —— 不变，短路
surface === 'minimal'                     —— 只保留 getCoreToolNames() ∪ discovered，跳过 filterToolsByTask
surface === 'standard'                    —— 现有链路逐字不变
surface === 'full'                        —— 现有链路 + 忽略默认披露白名单（任务类别/预算仍生效）
```

关键细节：

- `minimal` **跳过** `filterToolsByTask`：任务裁剪会随 `taskType` 变化，导致"核心面漂移"；
  且恒集（`getMandatoryTools()`）在 AGENT 开启时会把 `agent` 一并保留，压不到 9。
  跳过任务裁剪后，`minimal` 的工具面是**恒定集合**，可预测、可门禁。
- `minimal` 下 `agent` 不进入可见面（尽管 AGENT flag 让它在恒集里）——在 core 过滤后自然排除；
  无需改 `getMandatoryTools()` 的进程级语义。
- `discoveredToolNames` 的追加要在 core 过滤**之后**（现有 `appendDiscoveredTools` 顺序即满足）⇒
  `minimal` 仍然可以经 `tool_search` 拉入任意工具。
- 重放继续走 `forcedVisibleTools`（`streamMessageToolSelectionFlow.ts:115-129`），profile 改动不影响历史回放。

### 14.2 工具包元数据（扩展现有 `CAPABILITY_PACKS`）

**文件**：`app/src/tools/toolCategories.ts`（`CapabilityPackSpec` / `CAPABILITY_PACKS`）

```ts
type ToolPackProfile = 'minimal' | 'standard' | 'full';

interface CapabilityPackSpec {
  flag: FeatureFlag;
  tools: readonly string[];
  summary: string;
  defaultIn: readonly ToolPackProfile[];   // 新增
  requires?: readonly CapabilityPack[];    // 新增
  platform?: NodeJS.Platform;              // 新增
  risk: 'high' | 'write' | 'read';         // 新增
  physicalPackage?: string;                // 新增（P4 物理拆包时填）
}
```

- 现有 8 包：`defaultIn: ['standard', 'full']`（保持现状可见面），`risk` 按包内最高风险填。
- 新增 4 包（默认只在 `full`，不改变现状）：
  - `desktop`：`computer_use` / `browser` / `browser_vision`（依赖 browser/computer 方案先解除归档）
  - `knowledge`：`knowledge_save`（+ 运行期 `knowledge_*`）
  - `web`：`web_fetch` / `web_search`（`defaultIn` 含 `standard`，与当前默认披露一致）
  - `code`：`lsp` / `repl` / `code_run`
- 守卫：每个工具只能属于一个包；包内工具必须存在于 `TOOL_NAMES` ∪ 运行期注册表；
  `defaultIn` 必须是合法 profile。

### 14.3 插件工具契约（补齐类别 / 风险 / 可知性）

**SDK 类型**：`packages/plugin-sdk/src/plugin-sdk/types.ts` 的 `ToolRegistration` 增加可选字段：

```ts
category?: string;      // 缺省 'plugin'
pack?: string;          // 缺省 = pluginId
riskClass?: 'read' | 'write' | 'shell' | 'external' | 'undeclared';
readOnly?: boolean;
```

**适配层**：`app/src/plugins/utils/toolRegistration.ts`

- `PluginToolDeclaration` 同步加字段（可序列化子集，子进程宿主路径同样可用）；
- `buildRegisteredTool()` 把 `riskClass` / `isReadOnly` 透传给 `buildTool`（`ToolBuilder.ts:61-70` 接受 `Partial<Tool>`）。
  ⇒ `deriveToolRiskClass` 的既有分支（`toolRiskClass.ts:64-66`）直接生效，**无需**改风险引擎。

**运行期元数据登记**：新文件 `app/src/tools/runtimeToolMeta.ts`

```ts
export interface RuntimeToolMeta {
  category: ToolCategory | 'plugin';
  pack: string;
  riskClass?: ToolRiskClass;
  readOnly?: boolean;
}
export function registerRuntimeToolMeta(name: string, meta: RuntimeToolMeta): () => void;
export function getRuntimeToolMeta(name: string): RuntimeToolMeta | undefined;
export function listRuntimeToolNames(): readonly string[];
```

**必需的三处接线**（否则插件工具"注册了但模型看不见/设置改不了"）：

| 触点 | 现状 | 改法 |
|---|---|---|
| `getToolCategory()` `toolCategories.ts:351-354` | 未命中 ⇒ `misc` | 先查 `runtimeToolMeta`；插件工具缺省 `plugin` |
| `toolVisibilityOverrides.KNOWN_TOOL_NAMES` `toolVisibilityOverrides.ts:71-73,116-120` | 只认 `TOOL_NAME_CONSTANTS` | 改为 `isKnownToolName = 静态 ∪ runtime`；卸载时移除 |
| `resolveToolVisibilityReport()` `toolVisibilityReport.ts:180-186` | 只遍历常量表 | 遍历 `Object.values(TOOL_NAME_CONSTANTS) ∪ listRuntimeToolNames()` |

补充：

- `ToolCategory` 联合新增 `'plugin'`（`toolCategories.ts:57`）；`plugin` 类别加入 `chat/default/coding/agent` 白名单，
  且 `isOutsideDefaultDisclosure` 对运行期插件工具 **返回 false**（用户显式启用的插件属于"显式能力声明"，与 `toolProfile` 同口径）。
- 注册/卸载：`SdkPluginAdapter.registerTools()`（`:218-235`）注册前写 meta，`unregisterTools()`（`:241-260`）删除 meta；
  meta 的登记函数返回 disposer，接 `ctx.onDispose` LIFO（已存在，`SdkPluginAdapter.ts:57,152-167`）。
- 安全默认：未声明 `category` ⇒ `plugin`；未声明 `riskClass` ⇒ `undeclared`（每次审批），不会被静默放行。

### 14.4 设置页

| 文件 | 改动 |
|---|---|
| `client/src/components/settings/ToolsPanel.tsx` | 顶部加「工具面：精简 / 标准 / 全量」选择器；读写 `/v1/settings/toolSurface`；显示"可见 N / 已隐藏 M（可 tool_search 发现）" |
| `client/src/components/settings/toolsPanelModel.ts` | 按 `pack` 分组；新增 `inProfiles` 徽标 |
| `client/src/components/settings/FeatureFlagsPanel.tsx` | 包开关已存在；补 `desktop/knowledge/web/code` 四项（仅当 §14.2 新增包落地） |
| `client/src/i18n/locales/{zh,en}/settings.ts` | 新增文案（工具面、包分组、隐藏计数） |
| `app/src/tools/toolVisibilityReport.ts` | 报表条目增加 `pack` / `inProfiles` 字段 |

### 14.5 代码改动清单（按提交拆）

| 提交 | 文件 | 内容 | 零行为变更验证 |
|---|---|---|---|
| C1 | `toolCategories.ts` | 扩展 `CapabilityPackSpec` + 现有 8 包补字段 + 新增包（默认 full） | 现有可见面不变；包元数据单测 |
| C2 | `toolSurfaceProfile.ts`（新）、`streamMessageToolSelection.ts`、设置 UI | 运行时 profile（默认 standard） | 不配置 `settings.toolSurface` ⇒ 逐字等于现状 |
| C3 | `plugin-sdk/types.ts`、`toolRegistration.ts`、`runtimeToolMeta.ts`（新）、`SdkPluginAdapter.ts`、`toolCategories.ts`、`toolVisibilityOverrides.ts`、`toolVisibilityReport.ts` | 插件工具类别/风险/可知性 | 未声明字段的插件工具：类别 `plugin`、风险 `undeclared`（安全默认） |
| C4 | `coreToolSurface` 相关 | 编译 core 变体补 `tool_search`（7→8） | 变体行为按设计变化；非 core 零变更 |
| C5 | 幽灵名/死键 + 媒体内部面 | 清理与实现统一 | `GET /v1/tools` 无孤儿名 |

### 14.6 守卫与测试

| 测试 | 断言 |
|---|---|
| `app/tests/tools/coreToolSurface.test.ts` | 编译 core 8 项（原 7 + `tool_search`；不含 `todo_write`）——与运行时 minimal 9 项区分 |
| 新增 `app/tests/tools/toolSurfaceProfile.test.ts` | minimal 恰好 9（平台 shell 二选一）；standard 与现状一致；full 只放开默认披露收窄 |
| 新增 `app/tests/tools/toolPackMetadata.test.ts` | 每工具唯一归属；包内工具存在；`defaultIn` 合法；`requires` 无环 |
| `app/tests/tools/toolVisibilityOverrides.test.ts` | 运行期插件工具可被 `on/off`；卸载后条目失效 |
| `app/tests/tools/toolVisibilityReport.test.ts` | 报表含运行期工具与 `pack` 字段 |
| `app/tests/plugins/pluginSdkManifestContract.test.ts` | `ToolRegistration` 新字段向后兼容（缺省合法） |
| 新增 `app/tests/tools/runtimeToolMeta.test.ts` | 注册/卸载幂等；类别查询优先级；disposer LIFO |

### 14.7 度量与验收命令

```bash
cd app
bun run scripts/analyze-tool-usage.ts          # 调用分布不变（治理不改执行）
bun run measure:tool-disclosure                # 披露预算不超基线
bun test tests/tools tests/plugins
bun run typecheck
```

真机验收：

1. 设置 → 工具面切 `minimal` ⇒ 模型工具清单恰 9（Windows 为 powershell 版）；
2. 在 minimal 下让模型 `tool_search select:image_generate` ⇒ 下一轮该工具可见并可调用；
3. 切回 `standard` ⇒ 可见面恢复 12/13，无重启；
4. 安装一个声明了 `category/riskClass` 的测试插件 ⇒ 工具出现在可见性报表、可三态开关、审批按声明风险走；
5. 卸载插件 ⇒ 工具与报表条目同时消失。

### 14.8 实施顺序与回滚

1. C1（包元数据）→ 2. C2（profile）→ 3. C3（插件契约）→ 4. C4（core 变体补 tool_search）→ 5. C5（清理）。
   与 §8 的阶段映射：C1=P0、C2=P1、C3=P0/P2、C4=P1 的配套、C5=P3；P4 物理拆包在 C1 的 `physicalPackage` 字段就绪后再排期。
   - 每步独立提交；C2 默认 `standard` ⇒ 合入即零行为变更；
   - C3 未声明字段的插件工具走安全默认，不需迁移存量插件；
   - 回滚：C2 删除 `settings.toolSurface` 即回 standard；C3 的 meta 登记与工具注册同生命周期，卸载即撤销。

---

## 15. 实施记录（2026-11-21，未提交）

### 15.1 C1：包元数据

| 落点 | 内容 |
|---|---|
| `app/src/tools/toolCategories.ts` | `CapabilityPack` +4（`desktop` / `knowledge` / `web` / `code`）；`ToolPackProfile`；`CapabilityPackSpec` 补 `defaultIn` / `requires` / `platform` / `risk` / `physicalPackage` |
| 同上 | 现有 8 包补 `defaultIn: ['standard','full']` + `risk`；`browser_vision` 移入 `desktop`（原在 `media_video`）；`knowledge_save` 移入 `knowledge`（原在 `system_extra`） |
| `packages/kernel/src/core/featureFlags.ts` | 新增 `TOOL_PACK_{DESKTOP,KNOWLEDGE,WEB,CODE}`，**默认 true** ⇒ 零行为变更 |
| `app/tests/tools/toolPackMetadata.test.ts` | 新增：`defaultIn` 合法 / 一工具一包 / 包内名字在 `TOOL_CATEGORIES` / `requires` 无环 / `risk` 合法 |

### 15.2 C2：运行时 profile

| 落点 | 内容 |
|---|---|
| `app/src/tools/toolSurfaceProfile.ts`（新） | `ToolSurfaceProfile` / `TOOL_SURFACE_SETTINGS_KEY`（`settings.toolSurface`）/ `normalize` / `read`（每轮现读）/ `getCoreToolNames()`（**9 项**，平台 shell 二选一） |
| `app/src/chat/orchestrator/streamMessageToolSelection.ts` | `ToolSelectionInput.surface`；`minimal` 跳过 `filterToolsByTask`（核心 ∪ `on` ∪ discovered）；`standard` 逐字不变；`full` 传 `skipDefaultDisclosure` |
| `.../streamMessageToolSelectionFlow.ts` | 非重放分支传 `surface`；日志区分 minimal / replay（重放不读 profile） |
| `app/src/tools/toolCategories.ts` | `filterToolsByTask(..., { skipDefaultDisclosure })`（仅 full 使用；任务类别与严格预算仍生效） |
| `app/src/tools/toolVisibilityReport.ts` + `app/src/runtime/api/sessionAgentOps.ts` | 报表按当前档位判定（`minimal` ⇒ 核心集 + `not-in-minimal-surface`；`full` ⇒ 跳过默认披露收窄） |
| `shared/types/tool-visibility.ts` | 新增原因 `not-in-minimal-surface`（前端穷尽映射） |
| `client/**` | `ToolsPanel` 顶部「工具面：精简/标准/全量」；`toolService.get/setToolSurface`；`ENDPOINTS.settings.toolSurface`；zh/en 文案与原因徽标 |
| `app/tests/tools/toolSurfaceProfile.test.ts` | 新增：9 项核心 / 平台二选一 / minimal 恒定面 / discovered 与 `on` 可拉入 / standard 与未配置等价 / full 只放开披露收窄 / 重放优先 |

#### 15.2.1 P2：报表包归属 + 设置页分组 + 包开关（2026-11-21 续做）

| 落点 | 内容 |
|---|---|
| `toolVisibilityReport.ts` | 条目新增 `pack`（`getCapabilityPackOf` / 运行期 `RuntimeToolMeta.pack`）与 `inProfiles`（包的 `defaultIn`；插件工具 = `standard/full`），**同源派生**、不参与判定 |
| `shared/types/tool-visibility.ts` | 契约同步加 `pack?` / `inProfiles?`（字符串，前端只展示） |
| `toolsPanelModel.ts` | `groupByPack()`（包名升序、未归包置底）+ `TOOL_PROFILE_LABEL_KEYS`；不改 `groupOf` / 统计 / 三态 |
| `ToolsPanel.tsx` | 行内渲染**包徽标 + 档位徽标**；新增「分组：按可见性 / 按能力包」视图切换（默认仍按可见性 ⇒ 既有交互不变） |
| `FeatureFlagsPanel.tsx` + `SettingsPage.tsx` | 补 4 个新包开关（desktop / knowledge / web / code，默认开）+ zh/en 文案 |
| `packages/query/src/query/featureGate.ts` | 12 个 `TOOL_PACK_*` 登记为用户可配；`isCapabilityPackEnabled()` 改走 `resolveFeatureGate`（env > 用户设置 > `feature()`）⇒ 开关写进配置后**下一轮生效**（此前只读 `feature()`，属假开关） |

### 15.3 C3：插件工具契约

| 落点 | 内容 |
|---|---|
| `packages/plugin-sdk/.../types.ts` | `ToolRegistration` + `category?` / `pack?` / `riskClass?` / `readOnly?`（全部可选 ⇒ 存量插件零改动） |
| `app/src/plugins/utils/toolRegistration.ts` | `PluginToolDeclaration` 同步 + `toRuntimeToolMeta()`（非法类别/风险 ⇒ 安全默认）+ `buildRegisteredTool` 透传 `riskClass` / `isReadOnly` |
| `app/src/tools/runtimeToolMeta.ts`（新） | 进程级登记表：`register`（返回 disposer，只撤销自己）/ `unregister` / `get` / `list` |
| `app/src/tools/toolCategories.ts` | `ToolCategory` + `'plugin'`；加入 chat/default/coding/agent 白名单；`getToolCategory` 先查运行期；`isInDefaultDisclosure` 对运行期工具返回 true；`isKnownToolCategory` 迁入本模块 |
| `app/src/tools/toolVisibilityOverrides.ts` | `KNOWN_TOOL_NAMES` → `isKnownToolName()`（静态 ∪ 运行期，**现查**） |
| `app/src/tools/toolVisibilityReport.ts` | 名字域 ∪ `listRuntimeToolNames()`；运行期工具不算 `conditional`；风险展示读 `meta.riskClass` |
| `SdkPluginAdapter` **与** `PluginHostSupervisor` | 注册成功后登记 meta；卸载（含子进程停止）撤销 meta |
| `app/tests/tools/runtimeToolMeta.test.ts`、`app/tests/plugins/pluginToolMetaContract.test.ts` | 新增：登记/撤销幂等、后登记不被误删、三处接线、声明映射与安全默认 |

### 15.4 C4：编译 core 变体补 `tool_search`

`app/src/tools/utils/ToolManagerUtils.ts` 的 `CORE_MINIMAL_TOOL_KEYS` **7 → 8**（补 `createToolSearchTool`）；
`app/tests/tools/coreToolSurface.test.ts` 与 `app/scripts/variant-matrix.ts` 注释同步。
与运行时 `minimal`（9 项，含 `todo_write`）是两件事：前者产物裁剪，后者用户档位。

### 15.5 C5：幽灵名 / 死键（CD01–CD04 取证）

| 名字 | 取证结论 | 处置 |
|---|---|---|
| `search_codebase` | 不在 `TOOL_NAME_CONSTANTS`；全仓无 Tool 实现、无注册点；仅类别表 + ACP 放行表残留 | **已删**（`toolCategories.ts` 类别键、`acp/approval-classifier.ts` 放行名单） |
| `knowledge_search` / `knowledge_write` | **有真实实现**（`app/src/knowledge/tools/*`，含 UI 与 agent policy 登记），但 `createKnowledge*Tool()` 当前**无调用点** ⇒ 未注册的影子工具 | **保留**（CD07：有实现，删除属另一决策；如要接线需单独变更） |
| `music_generate` | 有实现（`MusicGenerateTool`），未注册；已在 `shadowToolDispositions` 登记 `awaiting-provider` | **保留**（同上） |

#### 15.5.1 媒体内部面实现统一（2026-11-21 续做）

**核实结论**：底层算法**已经唯一** —— `ImageProcessor` / `VideoProcessor` / `FFmpegWrapper`（infra）；
前端 `client/src/services/mediaService.ts` 也只是 `/v1/tools` 的薄包装（`toolService.execute("media_*")`），
没有第二份本地处理实现。真正的不统一只有三类，已按下表收口：

| 不统一点 | 处置 |
|---|---|
| 模型面 `new ImageProcessor()` / `new VideoProcessor()` / `new FFmpegWrapper()`（6 处） vs `media_*` 用单例 | `ImageTool` / `ImageAnalysisTool` → `imageProcessor`；`VideoTool` → `videoProcessor` + `ffmpegWrapper`；`MusicTool` → `ffmpegWrapper`；`ImageAnalysisTool` 内**重复的动态导入 + 二次实例化**一并删除 |
| `VideoProcessor` 缺 `trim` / `convert` ⇒ `VideoTool` 自己拼 ffmpeg 参数（第二份实现） | `VideoProcessor` 新增 `trim()` / `convert()`（内部走 `ffmpegWrapper.run`，参数与时限逐字保留）；`VideoTool` 改为调用 |
| `image` 的 watermark 缺 `opacity`（`media_image_watermark` 有） | `image` 补 `watermarkOpacity` / `watermarkFontSize` / `watermarkColor` 三个 schema 参数并透传 |

附带：`VideoGenerateTool` 的临时文件落盘从手写 `mkdirSync + writeFileSync(resolveTempDir())`
改为 infra 既有的 `tempMediaManager.writeFile()`（统一命名 + 自动过期清理，失败返回 `null` 不抛）。

**守卫**：`app/tests/tools/mediaImplementationUnification.test.ts` —— 静态断言模型面不得出现
`new ImageProcessor|VideoProcessor|FFmpegWrapper`、`VideoTool` 不得再出现 `-c copy`、
`mediaService` 不得 import `node:fs` / `sharp`、水印选项集两侧对齐。

**有意不统一（勿"修"）**：`resolveSafePath` 只给 `media_*` 用。模型面的 `image` / `video` / `music`
要能编辑**项目目录/用户指定路径**的文件，强加媒体目录限制会**收紧**现有能力（属行为变更，
不是统一）；越权仍由 ToolExecutor 的权限链 + `imageSanitizationPolicy` 拦截。

### 15.6 验收记录

| 命令 | 结果 |
|---|---|
| `cd app && bun run typecheck` | ✅ 0 错 |
| `cd client && bun run typecheck` | ✅ 0 错 |
| `bun test tests/tools` | ✅（新增 3 个测试文件全绿；原有工具面 / 报表 / 披露预算用例通过） |
| `bun test tests/plugins` | ✅（新增契约用例全绿） |
| `bun test tests/chat` | ✅ 全绿（`standard` 默认 ⇒ 工具面与改动前一致） |
| `cd client && bunx vitest run settings/__tests__/ToolsPanel.test.tsx toolsPanelModel.test.ts` | ✅ 29 pass（顺带补全该测试滞后的原因清单：缺 `feature-gate-off`） |
| `bun run measure:tool-disclosure` | ✅（基线已按用户裁定 `--update` 至 3673；见下） |
| `bun test tests/gates/toolDisclosureBudget.test.ts` | ✅ 13 pass |
| `bun test tests/tools/mediaImplementationUnification.test.ts` | ✅ 11 pass（媒体实现统一守卫） |
| `bun test tests/tools/toolVisibilityReport.test.ts` 等 | ✅ 38 pass（含 P2 包归属：`pack` / `inProfiles` 与 `CAPABILITY_PACKS` 同源） |
| `cd client && bunx vitest run settings/__tests__/ToolsPanel… toolsPanelModel…` | ✅ 35 pass（包徽标 / 按包视图 / 分组纯函数） |
| `bun run lint:arch` / `lint:infra` / `lint:size` | ✅ |

**基线 +85 字符的归属（与本轮无关，已显式评审）**：上一阶段（未提交）对 `TodoWriteTool` 描述加长
（"收尾要求：…"共 85 字符）⇒ 默认面 `sourceDescriptionChars` 3588 → 3673；
`providerSurfaceTokens`（1512）与 `structuralTokens`（2396）**未变**。
用户裁定（2026-11-21）：**保留该描述改进并更新基线**（`bun run measure:tool-disclosure --update`），
不采用"回退描述"方案。

### 15.7 遗留

1. ~~AC-16 基线~~ —— 已按用户裁定更新基线（§15.6）。
2. ~~报表 `pack` / `inProfiles` + 设置页按包分组 + 包开关~~ —— 已完成（§15.2.1）。
3. `knowledge_*` 接线与 `music_generate` provider 属功能决策，不在治理范围。
4. ~~P4 物理拆包（可选）~~ —— media + browser 驱动/schema 已落地（§15.8）；工具类（`BrowserTool` / `ComputerUseTool`）与 office/desktop 待工具基类契约下移后再拆。

### 15.8 P4：重域物理拆包（media + browser 驱动，2026-11-21）

**拆出边界（用户裁定）**

| 新包 | 内容 | 留在 app 的部分 |
|---|---|---|
| `packages/tool-media`（`@openliri/tool-media`） | `app/src/tools/media/` 下 19 个文件：15 个工具的 creator + `MediaPathGuard` / `MediaErrorCodes` / `MediaToolResult` / `mediaOutputSchemas` | `MediaModule.ts`（`globalToolManager.registerTool` 接线 + 生命周期）；改为从包出口导入 15 个 creator |
| `packages/tool-browser`（`@openliri/tool-browser`） | `PlaywrightDriver.ts` + `schemas.ts` | `BrowserTool.ts`（继承 app 的 `BaseTool`），改为从包出口导入 |

**为什么不搬工具类**：`BrowserTool` / `ComputerUseTool` / media 工具的注册面依赖 app 的 `BaseTool` 与 `ToolManager` 单例 ⇒ 需先在 `packages` 侧建立"工具基类契约"再搬，属另一轮；本轮只搬**无基类依赖**的实现体，避免"包内反向依赖 app"（R29/R30 会直接拦截）。

**配套登记**

- `app/tsconfig.json` `paths`：新增 `@openliri/tool-media` / `@openliri/tool-browser`（含 `/*` 子路径）。
- `scripts/modules-to-layers.json`：两包均登记 `layer: app`。
- `lint:infra`：新增 **R29**（`packages/tool-media`）/ **R30**（`packages/tool-browser`）物理包边界规则（包内禁止相对路径逃逸进 `app/`、禁止依赖 entry/ui；app 侧别名归属校验）。
- ESLint：新增 `app/eslint.tool-media.config.js` / `eslint.tool-browser.config.js` 与 `lint:tool-media` / `lint:tool-browser`，并同步 `app/package.json#ci` 与 `.github/workflows/ci.yml`（`lint:gate-parity` 覆盖）。
- 测试：`toolOutputJsonSchema` / `browserTool` / `mediaImplementationUnification` 的导入与源码扫描路径同步到新包。

**验收（cwd=app）**：`typecheck` ✅ · `bun test tests/tools`（1743 pass / 0 fail）✅ · `lint:infra`（R1–R30 合规）✅ · `lint:arch` / `lint:size` / `lint:refs` / `lint:case` / `lint:unref` / `lint:gate-parity` ✅ · `measure:tool-disclosure`（未超基线）✅ · `export-tool-params --check`（69 工具 / 379 描述一致）✅ · client `typecheck` ✅。工具名录与参数**未变化**（`media_*` 未进 `TOOL_NAMES`，本就由 `MediaModule` 运行期注册）。

### 15.9 P4 续：工具基类契约下移 + office 域拆包（2026-11-21）

**前置结论**：其余重域（office / desktop）的工具类都 `extends BaseTool`（57 个文件引用），因此**先**把基类契约下沉，才可能搬动工具类。

| 新包 | 内容 | 留在 app 的部分 |
|---|---|---|
| `packages/tool-base`（`@openliri/tool-base`） | `BaseTool.ts` + `toolEffects.ts`（副作用唯一事实源）+ `toolCapability.ts` + `toolRiskClass.ts` | 四个**转发 shim**（`app/src/tools/{BaseTool,toolEffects,toolCapability,toolRiskClass}.ts`）：57 处 `from '../BaseTool'` 与 `chat/**` / `workspace/**` / `tools/policy/**` 既有引用**零改动** |
| `packages/tool-office`（`@openliri/tool-office`） | `DocGenerateTool`（officecli 管线）/ `PDFTool` / `converter/**`（21 文件）/ `notebook/JupyterNotebookConverter.ts` + `notebook/types/**`（nbformat 数据模型） | `builtinToolRegistry`（构造与登记）、`NotebookManager` / `NotebookToolImpl`（依赖 REPL 工具面）、`NotebookToolAdapter` |

**关键取舍**：`converter/converters/IpynbConverter.ts` 依赖 `JupyterNotebookConverter` 与 nbformat 类型 ⇒ 该 5 个文件随 office 一起迁出（`notebook/` 中依赖 REPL 的两个工具实现仍留 app），避免包内反向依赖 `app/`。

**配套登记**：`app/tsconfig.json` `paths`（3 个新别名 + `cheerio`/`domhandler` 解析）；`modules-to-layers.json` 两包 => `app`；`lint:infra` 新增 **R31 / R32**；ESLint 配置与 `lint:tool-base` / `lint:tool-office`（`ci` + `ci.yml` 同步）；`scripts/state-machine-allowlist.json` 的 `CellExecutionState` 登记路径改指新包；`.trae/architecture/fix-evidence-registry.json` 两条证据路径同步。

**验收（cwd=app）**：`typecheck`（app + client）✅ · `bun test tests/tools tests/permission`（2553 pass / 0 fail）✅ · `lint:infra`（R1–R32 合规）✅ · `lint:arch` / `lint:size` / `lint:refs` / `lint:case` / `lint:unref` / `lint:fix-evidence` / `lint:gate-parity`（84 条 · 缺失 0）✅ · `measure:tool-disclosure`（未超基线）✅ · `export-tool-params --check`（69 工具 / 379 描述一致）✅。工具名录、参数与披露面**均未变化**（纯结构性搬迁）。
