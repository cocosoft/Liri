# Spec：AI-VFS 用户可配置挂载面（T3 完整体）

> 版本 1.2 ｜ 创建 2026-10-08 ｜ 状态：🟢 **已实施**（用户 2026-10-08 裁定 ①②③ 均取推荐项：**仅 dev_docs+mcp** / **仅 config.json** / **扩 `list_vfs` scheme-only**）。**2026-10-08 晚：裁定 ② 重开 ⇒ 增补「前端管理面」（HTTP API + 管理页；**不含热更新**）** —— 见 **§8**
> 触发：T3「需要**用户可挂载自定义数据源**的产品能力」⇒ 契约 `ai-vfs-driver-contract.md §5` 已满足（2026-10-08 用户声明）；本 spec 是 T3 的**完整体**（前序只读试点见 `ai-vfs-readonly-pilot.md`）。
> 上游：契约 §3（命名空间/系统调用/驱动/权限映射）· `scripts/modules-to-layers.json`（分层事实源）· `project_rules §1.6`（模型可见 ⇔ 已落盘）/ §1.13（路径注册表）/ §1.4（环境变量前缀）· CS01/CS03/CS04

---

## 1. 目标与非目标

**目标**：让**用户**（经配置面）决定 VFS 里有哪些挂载点，而非由代码硬编码 —— 挂载点即**用户面契约**。

**非目标**
- N1：**不**替换既有工具（`file_read`/`mcp_resource` 等）；VFS 仍是**附加面**。
- N2：**不**新建第二套路径安全/权限（复用 `PathGuard` + 工具权限链）。
- N3：**不**把挂载点清单注入系统提示词（见 §4 决策 ③；契约 §3.1 明确"工具调用期解析 ⇒ 不涉及"）。

---

## 2. 配置面设计（草案）

### 2.1 配置位置与 schema

`~/.pyapp/config.json` 新增一段（**唯一事实源**＝配置文件；运行时经既有 `configManager` 读）：

```jsonc
{
  "vfs": {
    "mounts": [
      { "scheme": "dev_docs", "enabled": true },
      { "scheme": "mcp", "server": "server-filesystem", "enabled": true }
    ]
  }
}
```

- `scheme` ∈ {`dev_docs`, `mcp`}（**草案**：见 §4 决策 ①）。
- `mcp` 必带 `server`（MCP 服务器名；不存在/未连接 ⇒ 该挂载点**不注册**并记 WARN）。
- 缺省（无 `vfs` 段）＝ **内置默认**：`dev_docs` 启用、`mcp` 不自动挂（保持当前试点行为：`mcp` 面按已连接服务器可用）。
  ⇒ ⚠️ 需与"当前试点已注册 `mcp` 挂载点"的行为**对齐**（见 §4 决策 ②）。

### 2.2 加载与装配

- 装配点：`entrypoints/vfsWiring.registerVfsMounts()`（现注册 `dev_docs`+`mcp`）改为**按配置**注册。
- 校验（**fail-closed**）：`scheme` 未知 / 必填项缺失 / `server` 不可用 ⇒ **不注册该挂载点** + `logger.warn`（**不**静默降级为"可读"）。
- 配置变更（运行时）：**首版不支持热更新**（改配置需重启）；若做热更新须走既有 config 变更通道（另行 spec）。

### 2.3 模型如何"发现"挂载点（**关键缺口**）

契约 §3.2 的 4 个系统调用**没有**"列挂载点"语义 ⇒ 模型不知道有哪些 scheme 可挂。三选一（**见 §4 决策 ③**）：

| 方案 | 做法 | 代价 |
|---|---|---|
| **P-a** | 挂载点清单**进系统提示词** | 触碰 **§1.6 红线**：须**同批**新增 session 事件（三处同步） |
| **P-b** | 扩 `list_vfs` 支持 **scheme-only**（如 `list_vfs('mcp://')` ⇒ 列已挂 server；`list_vfs('')`? 需扩语法） | 需扩契约 §3.1/§3.2（**契约变更**） |
| **P-c** | **不提供**发现：模型试错（方案名见工具描述） | 零改动；可用性差 |

---

## 3. 安全（复用既有底座，不新建）

| 面 | 复用 |
|---|---|
| 工具级授权 | `ToolExecutionService` → `PermissionManager.checkPermissionForTool`（与普通工具同链） |
| 路径级 | `query/PathGuard`（宿主真实路径；`file://` 若上马**必须**过它 + 根白名单） |
| 写类 | `toolEffects` + `write_vfs` 已在 `WRITE_TOOL_NAMES` |
| 审计 | 既有工具结果/错误通道；不另开 |

---

## 4. 决策点（**需用户裁定后才实施**）

| # | 决策 | 选项 | 建议 |
|---|---|---|---|
| **①** | **用户可挂载哪些源类型** | (a) 仅 `dev_docs` + `mcp`（选 server） / (b) **(a) + `file://`**（受**根白名单**限制） / (c) 再加 `channel://` | **(a) 起步** —— 契约 §4-D2/(a) 即"仅 dev_docs+mcp+channel"；**`file://` 与 `file_read`/`file_write` 100% 重叠**（契约 §9.3），上马须先定"谁是事实源"（同 `mcp_resource` 那样裁定）。⚠️ 但"自定义数据源"若理解为**本机目录**，则必须做 (b) —— **请明确你的意图** |
| **②** | **配置面形态** | (a) 仅 `config.json`（无 UI） / (b) config + **管理页**（client 端） | **(a) 起步**（最小闭环；UI 另立 spec） |
| **③** | **模型如何发现挂载点**（§2.3） | (a) 进提示词 + session 事件 / (b) 扩 `list_vfs` scheme-only（改契约） / (c) 不提供（试错） | **(b)** —— 不改红线、属"工具调用期解析"（契约 §3.1），但需**契约变更**（新增"scheme-only 列举"语义）；若你倾向 (a)，须同批做事件三处同步 |

---

## 5. 验收（实施时适用）

1. 配置 `dev_docs` 停用 ⇒ `read_vfs('dev_docs://…')` ⇒ `VFS_UNKNOWN_MOUNT`（**不回退**）。
2. 配置 `mcp` 指某 server 且该 server 已连接 ⇒ `list_vfs` 可用；`server` 不可用 ⇒ 该点不注册 + WARN。
3. 未知 `scheme` / 缺必填项 ⇒ **不注册** + WARN（不静默降级）。
4. 权限/路径门禁与普通工具**同链**；`write_vfs` 仍 fail-closed（只读挂载）。
5. `lint:arch` 违规 0 · `typecheck` 0 · 改动文件 `eslint` 0 · 全量 `bun test` 不回归。
6. 若采决策 ③=(a)：**同批**新增 session 事件（三处同步，编译期强制）。

---

## 6. 如实边界（CS06）

- 本 spec 为**设计**；未实施前 T3 仅"只读试点已落地"，**用户可配置面未落地**。
- 未定：热更新、UI、`file://` 事实源、`channel://`。

---

## 7. 执行记录（2026-10-08 实施完成）

### 7.1 决策（用户裁定）

| # | 决策 | 结果 |
|---|---|---|
| ① | 可挂载源类型 | **(a) 仅 `dev_docs` + `mcp`**（**不引入 `file://`** —— 与 `file_read`/`file_write` 100% 重叠，契约 §9.3） |
| ② | 配置面 | **(a) 仅 `config.json`**（无 UI、无热更新） |
| ③ | 模型发现挂载点 | **(b) 扩 `list_vfs` scheme-only**（⇒ **契约变更**，已写入契约 **v1.5 §3.2/§3.3**；属"工具调用期解析" ⇒ **不触发** §1.6 提示词红线） |

### 7.2 改动面

| 件 | 改动 |
|---|---|
| `app/src/config/types.ts` + `index.ts` | 新增 `VfsMountConfigEntry` / `VfsConfig`；`GlobalConfig` 增**可选** `vfs?: VfsConfig`（infra 层**仅纯类型**，不 import `vfs`） |
| `app/src/entrypoints/vfsWiring.ts` | 抽出**纯函数** `buildMountPlan(vfs)`；`registerVfsMounts()` 改为读 `configManager.getValue<VfsConfig>('vfs')` → 计划 → 逐条 WARN → 注册 |
| `app/src/vfs/types.ts` | `IVfsDriver` 增**可选** `listMountPoints?()` |
| `app/src/vfs/VfsMountRegistry.ts` | 新增 `listMountPoints(scheme)`（未注册 ⇒ `VFS_UNKNOWN_MOUNT`；有实现 ⇒ 委托；否则兜底 `[{name:'<scheme>://',kind:'dir'}]`） |
| `app/src/vfs/drivers/McpResourcesDriver.ts` | 构造追加可选 `allowedServers?: readonly string[]`（清单外 server ⇒ `VFS_UNKNOWN_MOUNT`）；新增 `listMountPoints()`（仅列"允许且已连接"） |
| `app/src/tools/ListVfsTool/ListVfsTool.ts` | `authority === ''`（scheme-only）⇒ 走注册表 `listMountPoints`；**描述文案同步**（模型可见） |
| 测试 | 新增 `tests/vfs/vfsWiring.test.ts`(9) + `mountRegistry.test.ts`(+3) + `mcpResourcesDriver.test.ts`(+4)；`vfsTools.test.ts` 按新契约改 `list_vfs` 断言 |

### 7.3 门禁

`typecheck` **0** · 改动文件 `eslint` **0** · `lint:arch` **错误 0 / 警告 4** · `tests/vfs`+`tests/tools` **715 pass / 0 fail** · 全量 **4604 pass / 9 skip / 0 fail**（+17，**无回归**）。

### 7.4 ⚠️ 未验证 / 已知边界（如实，CS06）

1. **未配置时默认装配逐字不变**（`buildMountPlan(undefined)` ⇒ 仍注册 `dev_docs` + 不限制的 `mcp`）—— 已由单测锁住。
2. `registerVfsMounts()` 的**真实 config.json → 真实注册表**端到端**未实测**（仅其纯函数 `buildMountPlan` 有单测）。
3. **`list_vfs('<scheme>://')` 语义变更**：由"列挂载根目录"改为"**列挂载点**"（契约 v1.5 §3.2 已明载）；根目录列举须用子路径，`stat_vfs('<scheme>://')` 仍可查挂载本身。
4. 无允许清单时 `listMountPoints()` 走真实单例 `mcpConnectionManager.getServers()` ⇒ 该分支**无单测**。
5. ✅ **真实 MCP server e2e 已实测**（2026-10-08，`MCP_E2E=1`，官方 `@modelcontextprotocol/server-everything`，**13 pass / 0 fail**；见 `ai-vfs-readonly-pilot.md §7.4`）——该实测**抓出并修复**一个 P0 阻断缺陷（`services/mcp/client.ts` 的 `client.capabilities.get()`）。
6. **未做**（按裁定）：`file://`、`channel://`、**热更新**。（**管理页 UI** 已于 **2026-10-08 晚重开裁定 ②** ⇒ 见 **§8**）

---

## 8. 前端管理面（2026-10-08 晚新增，裁定 ② 重开）

### 8.1 裁定变更

| # | 原裁定 | 变更后 |
|---|---|---|
| ② | (a) **仅 `config.json`**（无 UI） | **(a)+UI** —— 增补 **HTTP API + 管理页**；**热更新仍不做**（保存后**重启生效**，页面须明示） |

**范围（不得扩张）**：可挂载源仍**仅 `dev_docs` + `mcp`**（①不变）；不做 `file://`/`channel://`；不做热更新。

### 8.2 冻结的 HTTP 契约（前后端并行实施的**唯一接口口径**）

**`GET /v1/vfs/mounts`** ⇒ `200`
```jsonc
{
  "mounts": [                        // 由 `buildMountPlan` 推导的**生效**计划（未配置时 = 默认：dev_docs + 不限 mcp）
    { "scheme": "dev_docs", "enabled": true,  "registered": true,  "readOnly": true },
    { "scheme": "mcp", "server": "srv-a", "enabled": true, "registered": true, "readOnly": true }
  ],
  "availableSchemes": ["dev_docs", "mcp"],
  "mcpServers": [ { "name": "srv-a", "connected": true } ],   // 供 UI 选择；来源 `mcpConnectionManager.getServers()`
  "requiresRestart": true            // 固定 true：改配置需重启生效（无热更新）
}
```

**`PUT /v1/vfs/mounts`** —— body `{ "mounts": [ { "scheme": "dev_docs"|"mcp", "server"?: string, "enabled"?: boolean } ] }`
- **校验（fail-closed）**：`scheme` 必须 ∈ {`dev_docs`,`mcp`}；`mcp` 条目 `server` 必填非空；未知字段忽略。
  - 不合法 ⇒ `400` + `{ "error": { "code": "INVALID_MOUNTS", "message": "<逐条原因>" } }`，**不写盘**。
- 合法 ⇒ 经 `configManager` 写 `vfs.mounts`（**唯一事实源**），返回 `200`：
```jsonc
{ "success": true, "warnings": ["<跳过项的 WARN 文案>"], "requiresRestart": true }
```
- **不改**既有 `vfsWiring` 行为（仍只在启动时装配）；**不做**热更新/动态挂卸。

### 8.3 前端范围

- **入口**：**复用既有「设置」模块**的子页形态（与「日志查看」同族）—— 新增一个 **VFS 挂载管理** 区域（**不新建顶层页面/路由**，避免动导航结构）。
- **能力**：列出当前挂载（scheme/authority/是否生效/只读）· 启停 `enabled` · 选择 MCP server（数据取 `mcpServers`）· 保存（调 `PUT`）· 校验失败**原位展示逐条原因** · 保存成功后**明示"需重启生效"**。
- **约束**：`client/src` 新增 **service + 类型 + i18n（zh/en 全量，过 `i18n:check`）**；**禁止**直接读 `config.json`；**禁止**绕过后端 API 自行推导挂载计划。

### 8.4 ⚠️ 边界（实施时须如实回写）

1. **无热更新** ⇒ 保存后 UI 必须提示重启；**不**承诺"立即生效"。
2. `GET` 的 `registered` 反映**当前进程**的注册表（重启前可能与配置不一致 —— 这正是 `requiresRestart` 的语义）。
3. **未做**：挂载点增删以外的能力（如挂载内浏览/上传）不在本批。

---

## 9. 执行记录（§8 前端管理面，2026-10-08 晚完成）

### 9.1 交付

| 端 | 内容 |
|---|---|
| **后端** | `infrastructure/http/handlers/vfs-mounts-handlers.ts`（`GET`/`PUT` 逻辑 + 纯函数 `parseMountsInput` fail-closed 校验）· `handlers/routes/vfs-mounts-routes.ts` · 挂载入口 `handlers/route-table.ts`（**路由注册唯一入口**）· `tests/http/vfs-mounts.test.ts`（7 例） |
| **前端** | `client/src/types/vfs.ts` · `client/src/services/vfsService.ts` · `client/src/components/settings/VfsMountsPanel.tsx`（**复用「设置」模块**子页；注册三点：`NAV_GROUPS` → 描述键 → `renderContent` 分支）· `client/src/tests/vfs-mounts.test.tsx`（9 例）· i18n `zh`/`en` **各 +22 键**（对称，过 `i18nKeyParity`） |
| **接口清单** | `.trae/docs/api-spec.md` → **2.11.0**（§3.33 路由表 + §4 `vfsService` 映射） |

### 9.2 🔴 顺带抓出并修复 P0（**这是本批最重要的产出**）

实施中实证 **`@modules/vfs` 桶循环依赖 TDZ** ⇒ **冷启动 `registerVfsMounts()`（生产装配入口）直接抛错** ⇒ **全部 VFS 挂载点注册不上**（此前 `listed as "端到端未实测"` 的风险点，本轮探针**必现**）。**根因**：`tools/MCPResourceTool` 的**模块作用域 `new McpResourcesDriver()`** 在环中求值期读桶绑定。**修复**：改**惰性单例**（求值期不读绑定）。**验证**：同一冷探针 before→`TDZ Error` / after→**`OK`**。详见台账。

### 9.3 门禁

- **app**：`typecheck` **0** · 改动文件 `eslint` **0** · `lint:arch` **错误 0 / 警告 4**（曾因"改叶入口"触发 `R03-002`，**已回退**）· 全量 **4617 pass / 24 skip / 0 fail**
- **client**：`typecheck` **0** · 改动文件 `eslint` **0** · vitest **535 passed**
- **冷进程探针**：`registerVfsMounts()` ⇒ **OK**（P0 修复的直接证据）

### 9.4 ⚠️ 未验证（如实，CS06）

1. **未做真实前后端联调**：client 侧 `GET/PUT` 全经 `vi.mock(httpClient)` 桩验证；**真实网络 + 真实 400 报文**端到端未跑。
2. 未跑真实 Tauri/浏览器渲染冒烟（仅单测 + typecheck/lint）。
3. **无热更新**（按裁定）：保存后需重启，UI 已明示。
