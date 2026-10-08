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

1. **符号链接逃逸拒绝未单测**：驱动已实现 `realpath` 二次 containment（`DevDocsDriver.resolveHostPath`），但 Windows 建符号链接需特权 ⇒ 仅 `..`/`~`/反斜杠三类穿越有自动化用例。
2. **entrypoint 装配无自动化测试**：`main.ts → vfsWiring.registerVfsMounts()` 仅真实启动路径生效；测试用独立 scheme 注册驱动。
3. **✅ 已补齐（2026-10-08 续）**：`write_vfs` 已加入 `query/tool-constants.ts` 的 `WRITE_TOOL_NAMES`（**共享事实源** ⇒ 同批传导 `PathGuard` / `FileIOLoopDetector` / `promptSuggestion.Speculation` / `tools/orchestration.SERIALIZING_TOOLS`，语义均正确）。**同批修复守卫盲区**：`tests/tools/toolNameLists.test.ts` 的"真实注册名"扫描原只认**类字段** `name = '...'`，漏掉 `static create(): Tool { return { name: '...' } }` 一族（**含 VFS 4 工具与既有 `ReadProjectFileTool`**）⇒ 判据扩宽为 `name[:=]`（只增名 ⇒ ⊆ 检查更严，不放宽既有断言）。
4. **端到端（真实模型调用 4 工具）未实测**：单测覆盖驱动/注册表/路径解析，未跑真实会话。
5. **语义假设（契约未明示，按最贴近示例实现）**：① `dev_docs://配置与安全/sandbox.md` 的首段解析为 `authority`，驱动相对路径 = `authority + '/' + path`；② `read_vfs` 的 `offset`/`limit` 按**行**切片（与 `file_read` 同口径），截断 50KB（对齐 `ReadProjectFileTool`）。
6. **`app/scripts/resolve-module-aliases.ts`**（Docker 别名展开表，无 script/CI 引用、且本就缺多个别名）**未同步** `@modules/vfs`。
