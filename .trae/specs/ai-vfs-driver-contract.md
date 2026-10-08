# Spec：AI-VFS 驱动契约（智能体虚拟文件系统）

> 版本 1.4 ｜ 创建 2026-10-06 ｜ 更新 2026-10-08 ｜ 状态：🟡 **契约已立 + P2 只读试点已实施**（v1.1 §9 重叠面评估；v1.2 按 69 基数重算；v1.3 §10 触发条件评估；**v1.4：用户裁定 T3 满足 ⇒ 启动 §4-D5=(a) 读取类试点并实施完成** —— 见 `.trae/specs/ai-vfs-readonly-pilot.md`）
> 来源：`dev_docs/任务计划-20261004.md` §12 **T-1**（外部 `dev_docs/20261005/google ai 建议.md` §二·优化一「重构系统工具栈为标准 VFS 驱动契约」）
> 关联规则：GR15（Spec-Driven）· GR01（基础设施复用）· CS01（归一化）· CS03（回退最小化）· CS04（零 Mock）· R06-008（分层）· §1.6「模型可见 ⇔ 已落盘」· `model-usage.md`（工具/模型契约）
> 口径（CS06）：下列 file:line / 命中数 / 计数均 **2026-10-06 实测**；外部数字与实测不符者**如实订正**。

---

## 1. 背景与取证

### 1.1 外部主张（原文要点）

- 在 `app/src/core/storage` 之上构建 **AI-VFS 驱动网关**，把"一切皆文件"落到工具层；
- 设**挂载点**：`dev_docs://`（本地知识库）· `mcp://server-filesystem/`（MCP 外挂）· `channel://telegram/session_123`（社交上下文）…；
- 模型接口收敛为 **4 个标准系统调用**：`read_vfs` / `write_vfs` / `list_vfs` / `stat_vfs`；
- 收益主张：模型需记的工具契约由「81 个」降到 4 个，认知负荷降 95%+。

### 1.2 回仓实测（**约 3 处与外部描述不符**）

| # | 外部描述 | 实测 | 结论 |
|---|---|---|---|
| M1 | 「81 个内置工具」 | 编译期枚举源 `app/src/constants/toolNames.generated.ts`（事实源 `getAllBuiltinToolLoaders()`，**全量**含条件工具）实测 **71** 条 | ⚠️ **数字订正为 71**（外部 81 无出处） |
| M2 | 「在 `app/src/core/storage` 层上构建」 | `app/src/core/storage/` **仅 1 个文件** `SecureStorage.ts`（密钥存储），**并非**通用存储抽象层 | ⚠️ **前提不成立**：无现成"存储层"可"之上"构建；须先定义驱动边界（本 spec §3） |
| M3 | VFS / 挂载点 | `grep 'vfs\|VFS\|mountPoint\|MountPoint'`（`app/src` 全域）⇒ **0 命中** | ✅ 概念**完全未落地**（T-1 确为未实施） |

### 1.3 本仓**必须复用**的既有底座（GR01；这些是契约的约束，不是可选项）

| 关注点 | 既有载体（实测） | 对 AI-VFS 的强制约束 |
|---|---|---|
| **工具注册与可见性** | `tools/ToolRegistry.ts` 唯一写入口 `getToolRegistry()`；wire 名生成物 `constants/toolNames.generated.ts`（`bun run gen:toolnames`） | 4 个 VFS 工具**必须**经同一注册表登记；**禁止**自建第二注册表（§1.16） |
| **路径安全** | `query/PathGuard.ts`（`PATH_ARG_KEYS` / `WRITE_TOOL_NAMES` / `tool-constants.ts` 单一来源） | VFS 路径**必须**在进入驱动前过 `PathGuard`；**禁止**驱动自行拼路径（PathGuard 仍是唯一门禁） |
| **权限裁决链** | `chat/services/ToolExecutionService.ts:536-598` → `permission/PermissionManager.ts:1129-1183`（见 `app/docs/配置与安全/工具调用安全检查链路.md`） | VFS 调用**必须**与普通工具走**同一条**权限链；**不得**新开旁路 |
| **沙箱** | `sandbox/landlock/*` + `tools/bash/bashLandlockExec.ts`（`refuse` fail-closed） | 经 VFS **写盘/落文件**时须复用既有沙箱策略，不得绕过 |
| **模型可见输入红线** | `project_rules §1.6`（三处同批：`LiriEventType` / `LiriEventMap` / `ALL_SESSION_EVENT_TYPES`，编译期强制） | 若 VFS 引入**新的模型可见输入面**（如挂载点清单注入提示词）⇒ 同批新增 session 事件 |
| **工具清单注入** | `skills`/`tools` 清单注入为**全量**（§1.15-10 口径：禁止按数量截断） | 「收敛到 4 个工具」会改变注入面 ⇒ 属**契约破坏性变更**（见 §4-D1） |
| **分层** | `scripts/modules-to-layers.json`（事实源）· 门禁 `lint:arch` | 驱动网关落点须满足 `core` 不自建对上层（`app`/`service`）的依赖；端口/实现在 `entrypoints/spiWiring.ts` 装配（照 `ISessionQualityPort` 先例） |

### 1.4 已存在的"窄化"先例（说明收益是**渐进**的，不是一次性 81 → 4）

- `core/spi/`（`IKnowledgeGraphPort` D-148 · `ITaskRegistryPort` D-147 · `ISessionQualityPort`）已把**跨层依赖**收窄为窄端口；
- `CoreApiAppDeps.router`（`runtime/api/CoreAPIImpl.ts:158-164`）已把"模型路由"角色收窄为 3 方法内联端口；
- `tools/policy/*` 与 `tools/security/ToolPermissionManager` 表明**工具面**已有策略层，但**尚无统一资源命名空间**。

⇒ AI-VFS 的真正增量是 **② 命名空间（挂载点）**，而非"减少工具数"本身。

---

## 2. 目标 / 非目标

**本次（v1.0）唯一交付** = **契约草案**（命名空间 + 4 系统调用 + 驱动接口 + 权限映射 + 触发条件 + 验收口径）。**不写任何代码。**

**非目标（本次明确不做）**
- N1：不实现任何 VFS 驱动、不新增任何工具（含 4 个 `*_vfs`）。
- N2：**不删除、不改名**任何既有工具；不改变模型当前可见工具清单（破坏性变更，须独立版本与裁定）。
- N3：不新建第二套路径安全/权限/沙箱机制（必须复用 §1.3 底座，否则即双轨）。
- N4：不定义 MCP 侧协议（`mcp://` 挂载点的驱动由 MCP 既有链路提供，本契约只规定**如何挂载与转发**）。
- N5：不承诺"一次性收敛到 4 工具"——只承诺**可并存 + 可增量挂载**（见 §3.5）。

---

## 3. 契约草案

### 3.1 命名空间（挂载点）

```
<scheme>://<authority>[/<path>]
```

| 形态 | 示例 | 语义 | 可由谁挂载 |
|---|---|---|---|
| `dev_docs://` | `dev_docs://配置与安全/sandbox.md` | 第一层知识库（`resolveDocsDir()`） | 内置驱动 |
| `file://` | `file:///abs/path`（**可选**；刻意**不**默认开放，见 D3） | 授权工作区文件 | 内置驱动（须过 PathGuard） |
| `mcp://<server>/` | `mcp://server-filesystem/tmp/a.txt` | MCP 外挂工具暴露的资源 | MCP 桥接（`list_mcp_resources` 既有面） |
| `channel://<platform>/<conversation>` | `channel://telegram/session_123` | 社交上下文（既有通道抽象） | 通道侧驱动 |

**硬性约定**
- 解析**必须**产出结构化 `{scheme, authority, path}`；**禁止**用字符串前缀匹配做业务判定（CS02）。
- 未注册的 `scheme` ⇒ **明确失败**（`VFS_UNKNOWN_MOUNT`），**不**回退到本地文件系统（CS03）。
- 路径穿越（`..`、UNC、`~`、符号链接逃逸）⇒ **拒绝**；归一化与判定**必须**复用 `PathGuard`（§1.3），不得自建第二套。
- 挂载点**清单**若进入提示词（"模型可见输入"）⇒ 同批新增 session 事件（§1.3 红线）；若仅由工具在调用期解析 ⇒ 不涉及。

### 3.2 四个系统调用（**唯一**标准面）

| 工具名（wire） | 入参 | 出参（成功） | 主要失败码 |
|---|---|---|---|
| `read_vfs` | `path: string`，`offset?: number`，`limit?: number` | `{ data: string \| base64, mimeType, size }` | `VFS_UNKNOWN_MOUNT` · `VFS_NOT_FOUND` · `VFS_IS_DIR` · `VFS_DENIED`（权限/沙箱拒绝） |
| `write_vfs` | `path: string`，`content?: string`（本地大文件走既有 `source_file` 口径，**禁**大正文内联，见 §7-R3），`mode: 'create'\|'overwrite'\|'append'` | `{ written: number, path }` | 同上 + `VFS_READ_ONLY_MOUNT` · `VFS_CONFLICT`（`create` 命中已存在） |
| `list_vfs` | `path: string`，`recursive?: boolean`，`limit?: number` | `{ entries: Array<{ name, kind: 'file'\|'dir', size?, mtime? }> }` | `VFS_UNKNOWN_MOUNT` · `VFS_NOT_FOUND` · `VFS_NOT_DIR` |
| `stat_vfs` | `path: string` | `{ kind, size, mtime, mimeType?, mount, readOnly }` | `VFS_UNKNOWN_MOUNT` · `VFS_NOT_FOUND` |

**统一约定**
- 4 者**同构返回错误**（`AppError` + 稳定 `errorCode`，禁止裸字符串/`any`）。
- 幂等性声明进 `tools/toolEffects.ts`（13-P1-2 既有机制）：`read`/`list`/`stat` **只读**；`write` **非幂等**（禁盲重试）。
- 进度/耗时遵循既有工具结果通道；**不得**为 VFS 另开结果投影。

### 3.3 驱动接口（Driver）

```ts
/** 挂载点驱动：一个 scheme（或 authority 子集）一个实现 */
export interface IVfsDriver {
  /** 运行时能力声明：决定 4 系统调用中哪些可达（如只读挂载） */
  readonly capabilities: { read: boolean; write: boolean; list: boolean };
  list(path: VfsPath, opts: { recursive: boolean; limit: number }): Promise<VfsEntry[]>;
  stat(path: VfsPath): Promise<VfsStat>;
  read(path: VfsPath, range?: { offset: number; limit: number }): Promise<VfsReadResult>;
  write(path: VfsPath, data: VfsWriteInput): Promise<VfsWriteResult>;
}
```

- **驱动注册唯一入口**：新增 `VfsMountRegistry`（`registerMount(scheme, driver)` / `resolve(scheme)`），并在 `entrypoints/` 装配；**禁止**在业务模块内自建 Map。
- `capabilities.write === false` ⇒ `write_vfs` **明确拒绝**（fail-closed），**不**静默降级。
- 驱动内部**禁止**直接调用 `PermissionManager`（权限由工具层统一裁决，避免双重裁决漂移）。

### 3.4 权限 / 沙箱映射（**不新增第三套**）

| 阶段 | 复用 | 说明 |
|---|---|---|
| 工具级授权 | `PermissionManager.checkPermissionForTool()` | 与普通工具**同一条链**；`write_vfs` 应落在需审批档（与 `file_write` 同档） |
| 路径级 | `query/PathGuard.ts` | VFS 解析后的**真实宿主路径**仍须过 PathGuard（`file://` 与 `dev_docs://` 均适用） |
| 进程级 | `sandbox/landlock/*` | 经 VFS 落到 bash/exec 的间接路径不得绕过既有 Landlock 策略 |
| 审计 | `CompleteSecuritySystem.auditAction` | 写类操作须留审计（与 `BashTool` 同口径） |

### 3.5 并存期（渐进，不破契约）

- 4 个 VFS 工具与 71 个既有工具**并存**；VFS 先作为**附加面**（模型可选用），**不**立即替换。
- 任一既有工具迁移到 VFS 驱动 ⇒ 属**该工具**的契约变更，须单独 spec + 灰度（不得批量切换）。
- "模型可见工具清单"的收敛（71 → 4）**留待** §5 触发条件满足后独立裁定。

---

## 4. 关键决策（**待裁定**）

| # | 决策 | 选项 | 建议 |
|---|---|---|---|
| **D1** | 是否把"71 工具 → 4 syscalls"作为**目标** | (a) 作为终局目标（破坏性变更） / (b) 仅作**附加面**、不追求替换 | **(b)** —— (a) 会同时改动工具清单注入、`toolNames.generated.ts`、wire 名契约、权限档位与既有测试；本仓 v0.x 无用户迁移压力，且**§9.2 已量化证伪**：4 syscalls 覆盖上限仅 **8/71 ≈ 11%**，`71→4` 算术上不可能 |
| **D2** | 挂载点 scheme 集合 | (a) 仅 `dev_docs://`+`mcp://`+`channel://` / (b) 加 `file://` / (c) 加 `session://`（会话消息） | **(a)** 起步：三者**已有现成底座**（docs 路径 / MCP 资源面 / 通道抽象）；`file://` 与既有 `file_read`/`file_write` **功能重叠** ⇒ 引入双轨风险（CS01） |
| **D3** | `file://` 是否默认开放 | (a) 默认开放 / (b) 需显式配置 + 工作区白名单 | **(b)** —— 默认开放等于把 71 工具里最敏感的文件面再暴露一次 |
| **D4** | 驱动与权限的职责边界 | (a) 驱动内自查 / (b) 全部由工具层统一裁决（驱动只做 IO） | **(b)** —— 避免双重裁决；（a）会造成"有的驱动查、有的不查"的静默漏洞 |
| **D5** | 是否本轮即立"读取类试点" | (a) 立（只读 3 系统调用 + 1 个 `dev_docs://` 驱动） / (b) 暂不立 | **(b) 待触发**：见 §5；若上马，试点范围见 §6 |

---

## 5. 触发条件（满足**任一**才启动实施）

- **T1 能力触发**：出现"**新数据源接入**"需求（第三方存储/远端仓库/新通道），且该源**不适合**再增加一个独立工具（即：新增工具的成本 > 新增一个 VFS 驱动）。
- **T2 认知触发**：有**实测证据**表明模型在工具选择上因工具数（当前 71）而系统性出错（例如错误工具选择率与工具数正相关，可由轨迹/评测量化）。
- **T3 产品触发**：需要"**用户可挂载自定义数据源**"的产品能力（此时挂载点即用户面契约）。

> 触发前**不做**任何实现（本条即 T-1 当前"未实施"的依据）。

---

## 6. 验收口径（**未来**实施时适用，本 spec 不执行）

若按 D5=(a) 上马读取类试点，最小验收：
1. `dev_docs://` 驱动：`list_vfs` / `stat_vfs` / `read_vfs` 三调用在真实文档树可用；未知 scheme ⇒ `VFS_UNKNOWN_MOUNT`（**不**回退本地 FS）。
2. **安全**：路径穿越用例（`dev_docs://..%2F..%2F~/.pyapp/config.json` 等）**全部拒绝**；`write_vfs` 在只读挂载 ⇒ `VFS_READ_ONLY_MOUNT`。
3. **零回归（⚠️ 2026-10-08 订正）**：原写「既有 71 工具清单、注入面、权限档位**逐字不变**（`toolNames.generated.ts` diff 为空）」—— 与 §3.2「4 个新工具」**互斥**，属**失实**表述。**正确口径**：**既有工具**清单/权限档位**逐条不变**（不删 / 不改名 / 不改档）；**新增** VFS 工具属**预期增量** ⇒ `toolNames.generated.ts` **会**新增条目（实施后 **69 → 73**），既有 **69** 条 diff 为空。
4. **分层**：`lint:arch` 违规 0（新代码落点符合 `modules-to-layers.json`；跨层经 SPI）。
5. 单测覆盖：注册表（重复 scheme ⇒ 明确失败）、路径解析（结构化，非字符串匹配）、未知/只读/穿越三类失败码。
6. 门槛：`typecheck` 0 · 改动文件 `eslint` 0 · 全量 `bun test` 不回归。

---

## 7. 风险与如实边界

| # | 风险 / 边界 | 说明 |
|---|---|---|
| **R1** | **收益未证实（工具数口径已部分证伪）** | 「认知负荷降 95%」是外部**主张**，本仓**无实测**支撑；且 §9.2 已量化：4 syscalls 覆盖上限仅 **8/71 ≈ 11%** ⇒ 「71→4」不成立。**但**「统一命名空间」的收益**仍未实测**（§9.4 列为真实净值，不据未证实收益直接改造工具面，CS06） |
| **R2** | **破坏性面** | 收敛工具数会动 `toolNames.generated.ts`（编译期枚举源）+ 注入面 + wire 名 + 权限档位 + 既有测试 ⇒ 属主版本级变更 |
| **R3** | **大正文风险（既有教训）** | 写类工具**禁止**内联大正文（须走 `source_file`/`content_file` 口径），否则触发输出 token 爆炸与 JSON 截断（本仓已有三次同类修复） |
| **R4** | **双轨风险** | `file://` 与既有文件工具、`mcp://` 与 `list_mcp_resources`/MCP 桥接**功能重叠** ⇒ 必须明确"谁是事实源"，否则即 CS01 双轨 |
| **R5** | **degrade 模式未实现** | 与 `topoBatches` 的 `dependsOnMode` 同族问题：VFS 若引入"部分挂载不可用"语义，须显式标注（`[DEPENDENCY_DEGRADED]` 口径），**禁**静默降级 |
| **R6** | **本 spec 不实施** | 本文件仅固定契约；未落地前，T-1 在台账中维持「**未实施（已立契约）**」 |

---

## 8. 与既有 spec / 文档的关系

- `app/docs/配置与安全/工具调用安全检查链路.md`（2026-10-06）：AI-VFS 的权限/沙箱落点**必须**与其中逐跳链一致（§3.4 即其映射）。
- `.trae/specs/dsh-plugin-shim-contract.md`：同类"**先立契约、不实施**"先例（形态参照）。
- `.trae/specs/kernel-style-architecture-governance.md`（2026-10-08 新增）：把 VFS 的**命名空间/驱动 ops** 纳入"Linux 内核式"治理目标；本 spec 是该目标的**子项材料**。
- `dev_docs/任务计划-20261004.md` §12 T-1 / §14.5：本 spec 为其交付物。

---

## 9. VFS 与现有工具**重叠面评估**（2026-10-08 实测，用户裁定补做）

> 目的：用**真实签名**回答"4 个系统调用到底能吸收多少现有工具"，为 §4-D1 提供**算术依据**。
> 口径（CS06）：下表入参/出参均取自真实 schema 与类型定义；**未实测到的字段不写**。

**实测来源**：`FileReadTool.ts:17-30`（`file_read`）· `FileWriteTool.ts:61-70`（`file_write`）· `FileEditTool/types.ts:27-49`（`file_edit`）· `GlobTool.ts:13-23`（`glob`）· `GrepTool/schemas.ts:20-63`（`grep`）· `ReadMcpResourceTool/schemas.ts:3-17` · `ListMcpResourcesTool/schemas.ts:3-19` · `MCPResourceTool/schemas.ts:6-40` · `KnowledgeSaveTool.ts:112-134` · `ReadProjectFileTool.ts:47-60`。

### 9.1 映射矩阵（4 syscall × 现状）

| VFS 系统调用 | 现有承载工具（真实） | 覆盖判定 | 差异点（VFS 无法表达 / 需新增） |
|---|---|---|---|
| `read_vfs` | `file_read`（`filePath, offset?, limit?` → `content,totalLines,lineCount,offset,sizeBytes,truncated`） | 🟢 **完全覆盖** | VFS 出参 `{data,mimeType,size}` **少** `lineCount/truncated`（分段语义需补） |
| | `read_project_file`（`projectId, relativePath`） | 🟡 部分 | 独立命名空间；`projectId` 前置 ⇒ 需 `project://` 挂载点，非 `file://` |
| | `mcp_resource{action:read_resource}`（`server_name, uri`） | 🟡 部分 | 映射到 `mcp://<server>/`（2026-10-08 起为 MCP 资源面**唯一**入口） |
| | `file_convert` | 🔴 **不可表达** | 格式转换（PDF/DOCX/XLSX→MD 等）**不是**文件系统原语 |
| `write_vfs` | `file_write`（`filePath, content` → `type:create\|update,sizeBytes,linesWritten`） | 🟢 **完全覆盖** | VFS 增 `mode:create\|overwrite\|append`；需补 `create` 冲突语义 |
| | `write_project_file` | 🟡 部分 | 同 `read_project_file` 命名空间问题 |
| | `file_edit`（`EditCommand{insert\|delete\|replace\|append\|prepend, range, searchText, replaceText, insertAtLine}`） | 🔴 **不可表达** | **增量/定点编辑**；`write_vfs` 是全量覆盖 ⇒ 强行收敛会丢语义 |
| | `knowledge_save`（`title, content, category?, tags?`） | 🔴 **不可表达** | 结构化写入 + frontmatter + 去重 + `knowledge:changed` 事件联动 |
| `list_vfs` | `glob`（`pattern, searchPath?` → `filenames[],numFiles,truncated,invalidPattern`） | 🟡 部分 | `glob` 是**模式匹配**，`list_vfs` 是**目录列举**；语义**不等价**（须并存或明确二选一） |
| | `mcp_resource{action:list_resources}`（`server_name?`） | 🟡 部分 | 映射到 `mcp://`（2026-10-08 起为 MCP 资源面**唯一**入口） |
| `stat_vfs` | **无任何工具** | 🔴 **完全缺口** | **唯一纯增量**：`kind/size/mtime/mimeType/mount/readOnly` 当前不可直接查询 |

### 9.2 算术结论：`71 → 4` **不可能**（量化反证 §1.1 的"降 95%"）

> **2026-10-08 更新**：`read_mcp_resource` / `list_mcp_resources` **已删除**（占位/伪造实现 + 与 `mcp_resource` 重复，见 §9.3），故**工具基数 71 → 69**、可吸收数 8 → 6。下列数字按**当前**口径重算。

- **可被 4 syscall 完全/部分吸收的现有工具 = 6 个**（`file_read`·`file_write`·`glob`·`read_project_file`·`write_project_file`·`mcp_resource`）。
- **明确不可表达 = 4 个**（`file_edit`·`file_convert`·`knowledge_save`·`grep`）——`grep` 是内容检索，不是文件系统原语。
- **与"文件"无关 = 59 个**（媒体生成/任务管理/通道/调度/技能/时间/计划/子代理…）。
- ⇒ 覆盖上限 **6 / 69 ≈ 8.7%**；**63 个工具（4 不可表达 + 59 无关）无法被 4 syscalls 吸收**。
- ⇒ §1.1「81→4、认知负荷降 95%+」在本仓**算术上不成立**；§7-R1「收益未证实」由此**升级为已证伪的部分**（工具数口径）。

### 9.3 双轨风险量化（CS01）——**既有内部双轨已收敛**

| 重叠对 | 重叠度 | 处置要求 |
|---|---|---|
| `read_vfs` ↔ `file_read` | **100%** | 二者**不可同时**进模型可见清单，否则即双轨 |
| `write_vfs` ↔ `file_write` | **100%** | 同上 |
| `list_vfs` ↔ `glob` | **部分**（语义不等价） | 需明确"列举"与"模式匹配"谁是事实源 |
| `read_vfs`/`list_vfs` ↔ `mcp_resource` | **部分** | `mcp_resource` 为 MCP 资源面的**唯一**入口（2026-10-08 起） |
| `stat_vfs` ↔ 无 | **0%** | 唯一无冲突增量 |

> **既有内部双轨 —— ✅ 已收敛（2026-10-08）**：原 `read_mcp_resource` + `list_mcp_resources` 与 `mcp_resource` 三表并存。取证后判定后两者为**占位/伪造实现**（`list_mcp_resources` 的 `fetchResourcesForClient()` 恒返回 `[]`；`read_mcp_resource` 直接编造 `Content of <uri> from <server>` 文本）⇒ **属 CS04（Mock 零容忍）违规**，且功能被 `mcp_resource`（真实现，走 `MCPServerManager.sendRequest`）**完全覆盖**（后者另含 `prompts/list`·`prompts/get`）。**已删除两个假实现**，MCP 资源面**唯一入口 = `mcp_resource`**；工具注册面 **71 → 69**。

### 9.4 对 §4-D1 的结论修正

- D1 的建议 **(b) 仅作附加面、不追求替换** **得到算术支持**（§9.2：`71→4` 覆盖上限仅 **8.7%**）。
- 但要**加强一句**：即便"仅作附加面"，`read_vfs`/`write_vfs` 与 `file_read`/`file_write` 是 **100% 重叠** ⇒ 若上马，**必须先解决"谁是事实源"**，否则违反 CS01。`stat_vfs` 是唯一可直接新增、零冲突的增量。
- ⇒ AI-VFS 在本仓的**真实净值 = `stat_vfs`（纯增量）+ 跨命名空间统一（`mcp://`/`channel://` 挂载）**；"统一命名空间"是增量，"减少工具数"是伪命题。

---

## 10. P2 触发条件评估（2026-10-08 实测；**零代码改动**）

> 依据：§5「满足**任一**才启动实施；触发前**不做**任何实现」。本节只做**证据评估**，给出"是否触发"的可复核判据。
> 口径（CS06）：判据均为**仓库内实测**（Grep / Read / 度量盘点）；**无实测支撑即判"未触发"**，不把产品意图当成已发生的事实。

| 触发条件 | 要求满足的证据 | 2026-10-08 实测 | 判定 |
|---|---|---|---|
| **T1 能力触发** | 出现"**新数据源接入**"需求，且该源**不适合**再加独立工具 | 全仓 grep `新数据源` / `数据源接入` ⇒ **0 命中**；无登记的"新数据源接入"待办 | ❌ **未触发** |
| **T2 认知触发** | **实测证据**表明模型因工具数系统性选错工具（错误率与工具数正相关） | `app/src/evals/` 现有度量 = 行为指标（探索度 / 草稿比 / 反作弊 / 断言审计），**无"工具选择错误率 vs 工具数"口径**；且 §9.2 已证"工具数不是主因" | ❌ **未触发** |
| **T3 产品触发** | 需要"**用户可挂载自定义数据源**"的产品能力 | 仓库内**无**该产品需求登记（属**产品意图**，仅用户可声明） | ❌ **未触发**（就仓库证据而言） |

**结论**：**T1 / T2 / T3 均未满足** ⇒ 维持 §2「不实施」与 §7-R6「未落地前 T-1 保持**未实施（已立契约）**」。

**重估观测点（何时应重新评估）**
- **T1**：出现"面向**新资源源**的**独立工具**提案"（而不是加挂载点）时；
- **T2**：引入"工具选择正确率"评测口径（可由轨迹量化）时；
- **T3**：产品侧提出"**用户自定义挂载点**"需求时。

**若未来触发**：按 §6 验收口径执行 `dev_docs://` **只读试点**（§4-D5 = (a)）。⚠️ `stat_vfs` 虽为**唯一零重叠纯增量**（§9.1/§9.4），但**不脱离命名空间独立落地** —— 它仍需驱动与挂载注册表（§3.1/§3.3）方有意义。

**✅ 2026-10-08 续（T3 实施）**：`dev_docs://` 只读试点已落地（见 `ai-vfs-readonly-pilot.md`）；**`mcp://` 挂载点亦已落地**（`McpResourcesDriver`，**委托同一条 SDK 链**、不复制逻辑；`mcp_resource` 仍为工具面事实源 —— 并存期口径见该 spec **§7.2**）。⚠️ **仍待裁定**：`mcp_resource` 与 `read_vfs('mcp://…')` 是否**二选一**（§9.3 已量化该重叠）。
