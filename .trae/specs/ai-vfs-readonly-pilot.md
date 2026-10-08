# Spec：AI-VFS 只读试点（P2 · T3 触发）

> 版本 1.1 ｜ 创建 2026-10-08 ｜ 状态：� **已确认 —— 实施中**（用户 2026-10-08 裁定：**落点 A = 新增顶层模块 `vfs`**；**工具面 B = 新增 4 个工具（69 → 73）**）
> 触发：用户 2026-10-08 裁定「**按 T3 执行**（用户自定义挂载点）」⇒ `ai-vfs-driver-contract.md §5` 的 **T3 满足** ⇒ 启动该契约 **§4-D5 = (a) 读取类试点**（§6 验收口径适用）。
> 上游事实源：`ai-vfs-driver-contract.md`（契约 §3 命名空间 / 系统调用 / 驱动接口）· **`scripts/modules-to-layers.json`**（分层唯一事实源）· GR15（SDD）· CS01/CS03/CS04 · `project_rules §1.6`（模型可见 ⇔ 已落盘）/ §1.15-10（工具清单注入全量）/ §1.16（工具注册唯一入口）

---

## 1. 范围与非目标

**试点范围（只读）**

1. `VfsPath` **结构化解析**（`<scheme>://<authority>[/<path>]`；**禁止**用字符串前缀做业务判定，CS02）。
2. `VfsMountRegistry`（`registerMount(scheme, driver)` / `resolve(scheme)`）—— **唯一**注册面，装配在 `entrypoints/`（禁止业务模块内自建 Map）。
3. `IVfsDriver` + **`DevDocsDriver`**（只读；底座 = `core/paths.resolveDocsDir()`）。
4. 4 个系统调用工具：`read_vfs` / `list_vfs` / `stat_vfs` / `write_vfs`（dev_docs 为**只读挂载** ⇒ `write_vfs` 明确拒绝 `VFS_READ_ONLY_MOUNT`）。
5. **复用**（不新建）：`query/PathGuard`（宿主路径门禁）· 权限链（`chat/services/ToolExecutionService` 自动覆盖）· `tools/toolEffects.ts`（幂等声明）· `tools/ToolRegistry`（唯一注册入口）。

**非目标（本次不做）**

- **N1**：不实现 `mcp://` / `channel://` / `file://` 驱动（留待后续；`file://` 与既有文件工具 **100% 重叠**，须先定"谁是事实源"，CS01）。
- **N2**：**不**删除 / 改名 / 改权限档位任何既有工具（69 个）；VFS 为**附加面**（并存，不替换）。
- **N3**：**不**做"用户可配置挂载点"的 UI/配置面（T3 的完整形态属后续增量）；试点只证 **命名空间 + 驱动 + 注册表** 可用。
- **N4**：不新增第二套路径安全 / 权限 / 沙箱（必须复用 §1.3 契约底座）。

---

## 2. 关键设计

### 2.1 落点（分层）

| 件 | 落点 | 层 |
|---|---|---|
| 类型 + 路径解析 + 挂载注册表 + 驱动接口 | `app/src/vfs/`（**新增顶层模块**） | app |
| `DevDocsDriver` | `app/src/vfs/drivers/DevDocsDriver.ts` | app |
| 4 个工具 | `app/src/tools/{ReadVfsTool,ListVfsTool,StatVfsTool,WriteVfsTool}/` | app |
| 装配（注册 `dev_docs` mount） | `entrypoints/`（组合根） | entry |

> ✅ **已定（用户裁定）**：采用**新增顶层模块** `app/src/vfs/`，并同批在 `scripts/modules-to-layers.json` 登记 `vfs: app`（该文件是分层唯一事实源，允许维护）。

### 2.2 契约要点（照 `ai-vfs-driver-contract.md §3`）

- 解析产出结构化 `{scheme, authority, path}`；未注册 `scheme` ⇒ **`VFS_UNKNOWN_MOUNT`**（**不**回退本地 FS，CS03）。
- 路径穿越（`..` / UNC / `~` / 符号链接逃逸）⇒ **拒绝**；归一化与判定**必须**复用 `PathGuard`。
- 错误统一 = `AppError` + 稳定 `errorCode`：`VFS_UNKNOWN_MOUNT` · `VFS_NOT_FOUND` · `VFS_IS_DIR` · `VFS_NOT_DIR` · `VFS_DENIED` · `VFS_READ_ONLY_MOUNT` · `VFS_CONFLICT`。
- `capabilities.write === false` ⇒ `write_vfs` **fail-closed 拒绝**（不静默降级）。
- 驱动**不**自查权限（权限由工具层统一裁决，避免双重裁决漂移）。

### 2.3 工具面 —— ⚠️ **与契约 §6.3 冲突（需你确认）**

契约 §6.3 写「既有 71 工具清单、注入面、权限档位**逐字不变**（`toolNames.generated.ts` diff 为空）」，但 §3.2 又定义 **4 个新工具** —— **二者互斥**。

- **建议解释（本 spec 采用）**：§6.3 的意图是"**既有工具**不变（不删 / 不改名 / 不改档）"；**新增** VFS 工具属**预期增量** ⇒ `toolNames.generated.ts` **会**新增条目（**69 → 73**），**既有 69 条 diff 为空**。
- 需**同批**：`toolCategories.ts` 显式登记新类别（否则落 `misc` 被静默裁剪）· `toolEffects.ts`（`read`/`list`/`stat` **只读**；`write` **非幂等**）· `bun run gen:toolnames` 重生成。
- ✅ **已定（用户裁定）**：**接受"模型可见工具面 69 → 73"**（新增 4 个 VFS 工具；既有 69 条逐条不变）。这是 T3 试点**必然**带来的可见变化，已在 §3.3 订正契约 §6.3。

---

## 3. 验收（= 契约 §6，按 §2.3 订正第 3 条）

1. `dev_docs://` 的 `list_vfs` / `stat_vfs` / `read_vfs` 在**真实文档树**可用；未知 scheme ⇒ `VFS_UNKNOWN_MOUNT`（**不**回退本地 FS）。
2. **安全**：路径穿越用例（`dev_docs://../../~/.pyapp/config.json` 等）**全部拒绝**；只读挂载 `write_vfs` ⇒ `VFS_READ_ONLY_MOUNT`。
3. **零回归（订正）**：既有 **69** 工具清单 / 权限档位**逐条不变**（既有条目不删不改）；**新增 4 条**属预期增量。
4. **分层**：`lint:arch` **违规 0**（新模块已登记分层事实源；跨层经装配）。
5. 单测：注册表（重复 scheme ⇒ 明确失败）· 路径解析（结构化，非字符串匹配）· 未知 / 只读 / 穿越三类失败码。
6. 门槛：`typecheck` 0 · 改动文件 `eslint` 0 · 全量 `bun test` 不回归。

---

## 4. 任务分解

1. `app/src/vfs/`：`types.ts` · `VfsPath.ts` · `VfsMountRegistry.ts` · `drivers/DevDocsDriver.ts`（+ 登记 `modules-to-layers.json`）
2. 4 个工具（含 schemas）+ `ToolFactory` / 加载器 + `toolCategories` + `toolEffects`
3. `bun run gen:toolnames`（**69 → 73**）
4. 装配：`entrypoints/` 注册 `dev_docs` mount
5. 守卫 / 单测（§3.5）
6. 门禁 + 回写（契约 spec §6.3 **订正** · 台账 · 任务计划）

---

## 5. 如实边界（CS06）

- 本 spec **不含**：`mcp://` / `channel://` / `file://` 驱动、用户可配置挂载的 UI/配置面。
- **收益仍未实测**（契约 §7-R1）：本试点只证**可用性**（命名空间 + 驱动 + 注册表 + 安全门禁），**不外推**"认知负荷下降 / 工具数收敛"。
- 试点若上马，`read_vfs`/`list_vfs` 与 `file_read`/`glob` 的**事实源关系**须在文档中显式声明（并存期口径，契约 §3.5），避免 CS01 双轨。

---

## 6. 执行记录（2026-10-08 实施完成）

### 6.1 新增/修改面

| 类别 | 文件 |
|---|---|
| **新增 `vfs` 模块** | `app/src/vfs/{types.ts, VfsPath.ts, VfsMountRegistry.ts, index.ts}` + `drivers/DevDocsDriver.ts` |
| **新增 4 工具** | `app/src/tools/{ReadVfsTool,ListVfsTool,StatVfsTool,WriteVfsTool}/<Name>.ts` |
| **装配** | `app/src/entrypoints/vfsWiring.ts`（`registerVfsMounts()`，由 `main.ts` 的 SPI 回调调用） |
| **注册面** | `tools/ToolFactory.ts`（4 import + 4 creator）· `tools/utils/ToolManagerUtils.ts`（4 loader）· `tools/toolCategories.ts`（`read_vfs`/`list_vfs`/`stat_vfs`→`file_read`；`write_vfs`→`file`）· `tools/toolEffects.ts`（3×`NONE` + `write_vfs=LOCAL`） |
| **生成物** | `constants/toolNames.generated.ts` 重生成（**69 → 73**；既有 69 条**逐条未变**） |
| **事实源/门禁** | `scripts/modules-to-layers.json`（登记 `vfs: app`）· `scripts/lint-architecture.ts`（`src\vfs\` 补入模块入口白名单，与 `src\modules\`/`src\workspaces\` 同列）· `app/tsconfig.json`（`@modules/vfs` 别名） |
| **单测** | `app/tests/vfs/{vfsPath,mountRegistry,devDocsDriver,vfsTools}.test.ts` |

### 6.2 门禁（独立复核）

`typecheck`（app）**0** · 改动文件 `eslint` **0** · `lint:arch` **错误 0 / 警告 4**（基线）·
`tests/vfs`+`tests/tools` **681 pass / 0 fail** · 全量 **4570 pass / 9 skip / 0 fail**（较实现前 +42 = 新增 vfs 用例，**无回归**）。

### 6.3 ⚠️ 未验证 / 已知边界（如实，CS06）

1. **✅ 已单测（2026-10-08 续）**：新增 `tests/vfs/symlinkEscape.test.ts` —— 自建临时 fixture，用 Windows **目录联接**（`fs.symlinkSync(target, link, 'junction')`，**无需管理员权限**）指向 docs 根**之外** ⇒ **真跑 PASS**：`read_vfs` 经联接读外部文件被 `DevDocsDriver.resolveHostPath` 的 `realpathSync` **二次 containment** 拦下（`VFS_DENIED`），且**未读到**外部内容。**平台边界（如实）**：Linux/macOS 下 `type='junction'` 等价普通符号链接（逻辑相同）但**未在非 Windows 实测**；无法创建链接的环境走条件跳过（该分支本机**未触发**）。
2. **✅ 已覆盖（2026-10-08 续）**：`tests/vfs/vfsWiring.test.ts` 用 `configManager` 的**测试注入入口** `setConfigManagerForTest(manager)` + 指向**临时配置文件**的新 `ConfigManager`，注入 `vfs.mounts` 后调 `registerVfsMounts()`，断言 `vfsMountRegistry` 的注册集合 —— 覆盖真实链路「读配置 → `buildMountPlan` → `registerMount`」；用例结束**还原 manager + 清临时目录**（**不碰** `~/.pyapp/config.json`）。已知**无害副作用**：注册表为模块级单例且无 `unregister`，注册项留存至本进程结束（已核：`mountRegistry.test.ts` 用局部实例、`vfsTools.test.ts` 用独立 scheme、e2e 由 `has()` 守卫 ⇒ 无冲突）。
3. **✅ 已补齐（2026-10-08 续）**：`write_vfs` 已加入 `query/tool-constants.ts` 的 `WRITE_TOOL_NAMES`（**共享事实源** ⇒ 同批传导 `PathGuard` / `FileIOLoopDetector` / `promptSuggestion.Speculation` / `tools/orchestration.SERIALIZING_TOOLS`，语义均正确）。**同批修复守卫盲区**：`tests/tools/toolNameLists.test.ts` 的"真实注册名"扫描原只认**类字段** `name = '...'`，漏掉 `static create(): Tool { return { name: '...' } }` 一族（**含 VFS 4 工具与既有 `ReadProjectFileTool`**）⇒ 判据扩宽为 `name[:=]`（只增名 ⇒ ⊆ 检查更严，不放宽既有断言）。
4. **真实模型会话 e2e 仍未实测**；但 **`mcp://` 面已有真实 MCP server e2e**（见 **§7.4**，13 pass：4 个工具在 `mcp://` 上的 list/read/stat/write 均实测通过）—— `dev_docs://` 面的"真实模型会话调用"未跑。
5. **语义假设（契约未明示，按最贴近示例实现）**：① `dev_docs://配置与安全/sandbox.md` 的首段解析为 `authority`，驱动相对路径 = `authority + '/' + path`；② `read_vfs` 的 `offset`/`limit` 按**行**切片（与 `file_read` 同口径），截断 50KB（对齐 `ReadProjectFileTool`）。
6. **✅ 已取证并结案（2026-10-08 续）**：`app/scripts/resolve-module-aliases.ts` 经全仓检索确认**零引用**（仅 `scripts/lint-script-exit.ts:13` 一处**注释**举例提及；无 `package.json#scripts`、无 CI、无 Dockerfile —— `app/docker/Dockerfile:58` 已改用**原生支持 tsconfig paths** 的 `bun build`）⇒ **死文件**，依 `PY_APP §3`（预先存在的可疑死代码**只报告不删**）**未删除、未修改**。**如实登记两项风险**：① 其别名表**系统性滞后**（相对事实源 `app/tsconfig.json#paths` 缺约 **22** 个，且**完全未处理 `@shared/*`**）；② 该脚本若被运行会**原地重写 `src/**/*.ts`**（`writeFileSync`）⇒ 属**破坏性工具**。**是否删除留待另行裁定**。

### 6.4 登记项收口（2026-10-08 续）

上表 **1 / 2 / 6** 三项已收口（**源码零改动**，仅新增测试）：
- 新增 `tests/vfs/symlinkEscape.test.ts`（2 例，**真跑 pass**）· `tests/vfs/vfsWiring.test.ts` 增装配用例（1 例）。
- **门禁**：`typecheck` **0** · 改动文件 `eslint` **0** · `lint:arch` **错误 0 / 警告 4** · `tests/vfs` **75 pass / 0 fail** · 全量 **4610 pass / 24 skip / 0 fail**（+3，**无回归**）。

---

## 7. `mcp://` 扩展（2026-10-08 续，用户裁定「mcp:// 挂载扩展」）

### 7.1 设计

- 新增 `app/src/vfs/drivers/McpResourcesDriver.ts`；装配于 `entrypoints/vfsWiring.registerVfsMounts()`（与 `dev_docs` 同批）。**工具面不变**（仍 73）。
- **路径映射（关键）**：`mcp://<server>/<resource-uri>` ⇒ `authority = <server>`、`path = <resource-uri>` **逐字原文**。MCP 资源 URI **本身可能含 `://`**（如 `mcp://server-filesystem/file:///tmp/a.txt`）⇒ **禁止**对 `path` 做归一化 / 穿越判定（它是**不透明 URI**，交 MCP 服务器解释）。
- **委托（唯一实现链，不复制逻辑）**：`mcpConnectionManager.getSdkClient(server)` → SDK `Client` **顶层方法** `listResources()` / `readResource({ uri })`（**禁止** `.resources.` 子对象；守卫 `tests/mcp/sdkClientApiShape.test.ts`）。
- **只读**：`capabilities.write === false` ⇒ `write` 恒抛 `VFS_READ_ONLY_MOUNT`（fail-closed）。
- **错误码**：`authority` 缺失 / 服务器未连接 ⇒ `VFS_UNKNOWN_MOUNT`；uri 不存在 ⇒ `VFS_NOT_FOUND`；SDK 抛错 ⇒ `VFS_DENIED`。
- **模型缺口如实标注**：`stat` 的 `size`/`mtime` 在 MCP 资源模型**不可得** ⇒ 置 `0` 并注明"未知"；`read` 的 `range` **明确忽略**（待需求）；列举为**扁平**（MCP 资源无目录语义）。

### 7.2 重叠裁定（2026-10-08 用户裁定：**C —— 工具改委托 VFS 驱动**）

- **裁定**：`mcp_resource` 的 `list_resources` / `read_resource` **改为经 `McpResourcesDriver`**（**实现归属翻转为驱动** = `mcp://` 面的**单一实现**）；`list_prompts` / `get_prompt` **仍直连 SDK**（VFS 无提示面）。
- **取驱动方式**：工具内**直接实例化** `new McpResourcesDriver()`（**不经** `vfsMountRegistry`）—— 避免活工具对 entrypoint 装配序产生**硬依赖**（否则未跑 wiring 即失效）。
- **契约扩展（additive）**：`VfsEntry` 增**可选** `mimeType?` / `description?`（源可提供则填；`dev_docs` 不填）—— 用于保住工具向模型展示的字段。
- **两入口仍并存、实现单点**：`mcp_resource` = MCP **资源 + 提示**专用入口；VFS `mcp://` = **统一命名空间读取**面（含 `stat_vfs` 纯增量）。
- ⚠️ **模型可见行为差异（如实，CS06）**：
  1. `list_resources` 条目的 `name` 由"服务器显示名"变为**资源 uri 原文**（`uri` 与 `name` 同值）⇒ 人类可读行显示完整 URI；`description` / `mimeType` 仍透传（源未提供则省略）。
  2. `read_resource` 的 `content` 由"原始 SDK 响应（可多条 + `blob` 字段）"收敛为**单条目** `{uri, mimeType, text}`（多条 contents 拼接；`blob` 以 base64 串入）；`mimeType` 恒有定义。
  3. 错误文案改为驱动口径（`MCP 服务器未连接: "X"` / `读取 MCP 资源失败: "uri"（…）`），仍如实落到结果 `error`（无静默降级）。
  4. 列举加 `limit: 200`（MCP 资源面通常远小于此）。

### 7.3 门禁

- **`mcp://` 扩展批**：`typecheck` **0** · 改动文件 `eslint` **0** · `lint:arch` **错误 0 / 警告 4** · `tests/vfs`+`tests/mcp` **61 pass / 0 fail** · 全量 **4582 pass / 9 skip / 0 fail**（+12 = 新增驱动用例，**无回归**）。
- **重叠裁定 C 批（2026-10-08 续）**：`typecheck` **0** · 改动文件 `eslint` **0** · `lint:arch` **错误 0 / 警告 4** · `tests/vfs`+`tests/mcp`+`tests/tools` **705 pass / 0 fail** · 全量 **4587 pass / 9 skip / 0 fail**（+5 = 新增"工具经驱动"用例，**无回归**）。

### 7.4 真实 MCP 服务器 e2e（2026-10-08 ✅ 已实测）

- **✅ 已实测**：`app/tests/mcp/realServerE2E.test.ts`（**env 门控** `MCP_E2E=1`；默认套件跳过 ⇒ 不引入网络依赖）对**官方参考服务器** `@modelcontextprotocol/server-everything`（stdio）：**13 pass / 0 fail** —— 覆盖 `mcp://` 的 `list_vfs('mcp://')`（scheme-only）/ `list_vfs('mcp://<server>/')` / `read_vfs` / `stat_vfs`(`readOnly=true`) / `write_vfs` ⇒ `VFS_READ_ONLY_MOUNT`，以及 `mcp_resource` 的资源/提示面与 `MCPTool` 的工具面。
- **🔴 该实测抓出并修复 P0 阻断缺陷**：`services/mcp/client.ts` 调用了 SDK `Client` 上**不存在**的 `capabilities.get()` ⇒ 整条 SDK 链（含 `mcp://` 全部面）不可用，且因 `as unknown as` **无编译错误**。已改用 `getServerCapabilities()`。详见台账。
- **仍未自动覆盖**：无允许清单时 `listMountPoints()` 的默认分支（见 `ai-vfs-user-mountable.md §7.4`）—— `vfsWiring` 装配已于 **§6.4** 覆盖。
