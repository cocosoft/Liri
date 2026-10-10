# Spec：MCP 客户端双轨收敛评估（assessment）

> 版本 1.5 ｜ 创建 2026-10-08 ｜ 状态：✅ **已完成 —— C-1 / C-2 / C-3 均已落地（2026-10-08）** ＋ **§11 P2-8 双轨子进程边界复核（2026-10-10）** ＋ **§11.4 端到端补测（真实 server 复核 + 双轨并存回收，2026-10-10）**
> 来源：2026-10-08 治理遍历副产物 —— 复核 `mcp_resource` 协议用法时发现（详见台账「MCP 资源面协议用法复核与修复」节）
> 上游规则：`project_rules §1.11`（MCP 模块架构：标准层 `services/mcp/` / 增强层 `mcp/` **不重复实现** 相同类型）· GR01（基础设施复用）· GR15（Spec-Driven）· CS01（归一化）· CS03（回退最小化）
> 口径（CS06）：下列 file:line 均 **2026-10-08 静态实测**；**凡未经运行验证者一律标注"未实测"**，不写成结论。

---

## 1. 目的

`mcp_resource` 的协议用法复核（见台账）暴露出：本仓 MCP 的**连接与调用存在多套并存实现**，导致
①同一服务器被连接两次 ②"模型调用 MCP"有两条路 ③资源/提示面缺少标准 API 而只能手写非标请求。
本 spec 只做**现状取证 + 收敛方案对比**，供裁定；**不实施**。

---

## 2. 现状取证

### 2.1 三套"客户端"实现

| # | 实现 | 载体 | 协议层 | 消费者 |
|---|---|---|---|---|
| **C1** | **SDK `Client`**（官方） | `services/mcp/client.ts`（`getMcpToolsCommandsAndResources` → SDK `Client`）；缓存于 `MCPConnectionManager.clientCache` | `@modelcontextprotocol/sdk` | ✅ **主路径**：`MCPToolBridge.ts:121,131` → `McpToolWrapper`（动态注册给模型的 `mcp__<server>__<tool>`）；`services/mcp/client.ts:57` `prompts.list()` |
| **C2** | **自定义连接**（自研协议对象） | `MCPServerManager` + `MCPConnection` + `TransportFactory` + `transports/*`（Stdio/SSE/WebSocket/HTTP） | 自研 `MCPRequest`（`services/mcp/types/index.ts:151`） | ⚠️ **两个专职工具**：`mcp_tool`（`mcp/MCPTool.ts:330`）· `mcp_resource`（`tools/MCPResourceTool/MCPResourceTool.ts:483,569`） |
| **C3** | **增强层客户端** | `mcp/client/MCPClient.ts:25`（`MCPClientImpl implements MCPClient`） | 自研 `MCPRequest` | ❌ **零消费者**（仅 `mcp/index.ts:79` 转出） |

### 2.2 **同一服务器被连接两次**（启动即发生）

链路（全部静态可核）：

```
modules/ModuleDefinitions.ts:435        mcpSystem.initialize(toolPort)        ← 模块 onReady（生产启动路径）
  → services/mcp/index.ts:107           mcpConnectionManager.initialize(configs)
      → services/mcp/client.ts          getMcpToolsCommandsAndResources(...)   ← 建 SDK Client（连接 ①）
      → MCPConnectionManager.ts:93      manager.addServer(name, config)
          → MCPServerManager.ts:61-63   new MCPConnection(name, config); servers.set(...)  ← 建自定义连接对象
      → MCPConnectionManager.ts:99      manager.connectAll()                   ← 连接 ②（自定义 transport）
    → services/mcp/index.ts:112         mcpToolBridge.initialize(toolPort)     ← 注册 mcp__* 工具（走 ①）
```

⇒ 同一 MCP server 在启动后同时持有 **SDK 连接**与**自定义 transport 连接**。
**⚠️ 未实测**：本条为**静态链路**成立的结论；"两条 transport 是否都真正建立、是否互相干扰"**未做运行验证**。

### 2.3 **能力重复**：模型有两条路调同一个 MCP 工具

| 路 | 工具名 | 底层 |
|---|---|---|
| R1 | `mcp__<server>__<tool>`（动态注册） | C1（SDK） |
| R2 | `mcp_tool`（通用工具，参数传 `tool_name`） | C2（自定义） |

⇒ 同一能力两条路、底层连接不同 ⇒ **CS01 双轨**（同 steering / D7 家族）。

### 2.4 资源/提示面：**四处实现**，且自定义链缺标准 API

| 实现 | 位置 | 说明 |
|---|---|---|
| `resourceManager`（SDK 向） | `services/mcp/resourceManager.ts:318`（引用 SDK `Client` 类型）| 资源**类型处理**（text/image/binary/json）+ 集合管理；经 `services/mcp/index.ts:185 getResources()` 暴露 |
| `mcp_resource`（自定义向） | `tools/MCPResourceTool/MCPResourceTool.ts` | 模型可见工具；四个操作 |
| `MCPClientImpl`（C3） | `mcp/client/MCPClient.ts:211,251` | `listResources`/`listPrompts`；**零消费者** |
| 增强层 `MCPManager` | `mcp/managers/MCPManager.ts:343,382` | `listResources`/`readResource` **包在 C2 上**（`getMCPServerManager()` + `callTool('resources/list')`） |

**为什么自定义链上没有干净写法**：`MCPRequest` 类型联合（`types/index.ts:151`）只含
`'call' | 'list_tools' | 'list_resources' | 'list_prompts' | 'ping'` —— **没有 `read_resource` / `get_prompt`**；
且 **没有任何 transport 把 `type` 映射为 JSON-RPC method**（`transports/StdioTransport.ts:203-219` 把内部对象
`JSON.stringify` **原样写出**）。⇒ 自定义链上的资源/提示调用**天生只能"绕"**（把协议方法当 `tool_name` 发 `type:'call'`）。

**SDK 侧则完备**（`app/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.d.ts`）：
`listTools:539` · `callTool:431` · `listPrompts:292` · `getPrompt:207` · `listResources:322` · `readResource:387`
⇒ 资源/提示在 C1 上有**标准 API**。

---

## 3. 定性（与 `§1.11` 的关系）

- `§1.11` 规定：标准层 `services/mcp/`（**核心类型、客户端、传输层**）· 增强层 `mcp/`（**引用标准层、不重复实现**）。
- ⇒ 现状**两处偏离**：
  1. **标准层内部两套客户端**（C1 SDK vs C2 自研）+ **两条传输**（SDK transport vs 自研 `transports/*`）—— 违反"不重复实现"的**精神**（规则字面只写"禁止两套实现重复定义**相同类型**"，但两条连接的重复程度更重）。
  2. **增强层自建客户端** C3（`mcp/client/MCPClient.ts`）—— 直接违反"增强层不重复实现"。
- 另：**能力重复** R1/R2（§2.3）与**同服务器双连接**（§2.2）是两份**独立**于规则的实害。

---

## 4. 收敛方案

### 方案 A（激进）：**SDK 唯一权威**

- 内容：删除 C2 全链（`MCPConnection` / `transports/*` / `TransportFactory` / `MCPServerManager` 的连接职责）；`mcp_tool` / `mcp_resource` / 增强层 `MCPManager` 全改走 C1；删 C3。
- 改动面：≥8 文件（含 `MCPServerManager.ts` **590 行**）+ `cli/handlers/mcpHandler.ts` + `commands/builtin/mcp/MCP.ts` + `services/mcp/marketplace/MCPMarketplace.ts:214`。
- **前置缺口**：`MCPServerManager` 还承担 **统计 / 健康检查（`startHealthChecks`）/ 自动重连（`startAutoReconnect`）/ 连接池 / 负载均衡** —— C1 侧**无现成对应物**，需先设计迁移。
- 风险：**高**（面广 + 能力缺口 + 必须实测）。

### 方案 B（反向）：**自定义链唯一权威** —— ❌ 不推荐

放弃官方 SDK（主路径 `McpToolWrapper` 要重写）；且自研 transport **不把 `type` 映射为 JSON-RPC method**，
与真实 MCP 服务器互通性存疑 ⇒ 与"标准协议"方向相悖。

### 方案 C（推荐·渐进）：**IO 归 SDK，`MCPServerManager` 降为状态投影**

分 3 步，**每步独立可验证**：

| 步 | 内容 | 独立价值 |
|---|---|---|
| **C-1** ✅ **已实施（2026-10-08）** | `mcp_tool` 的 `list_tools`/`call` 与 `mcp_resource` 的 `list_resources`/`read_resource`/`list_prompts`/`get_prompt` 改走 `mcpConnectionManager.getSdkClient(name)` → SDK `Client` 顶层方法（`listTools`/`callTool`/`listResources`/`readResource`/`listPrompts`/`getPrompt`）。**`mcp_tool` 的 `list_servers`/`connect` 两个状态动作不动**（依赖自研链的 `addServer`，属 C-3）。另**连带订正 SDK 链既有错误调用**（见 §8） | 消除 §2.3 的 R1/R2 双轨；**顺带解决**上轮遗留的 `read_resource`/`get_prompt` 无标准类型问题 |
| **C-2** ✅ **已实施（2026-10-08）** | 取证确认增强层 `MCPManager`（528 行）为**全仓零外部消费者**的 C2 重实现；其唯一消费者 `MCPCommandLoader` 的产物还属**类型说谎 + 从不派发**（`type:'mcp'` ∉ `CommandType`）。⇒ 按「**删全类 + 删其消费者**」处置（见 §9），非「改 C1」 | 增强层**回归"无重实现"**（`§1.11`）—— 比"引用标准层"更彻底 |
| **C-3** ✅ **已实施（2026-10-08）** | `MCPConnectionManager.initialize` **去掉**急切的 `manager.connectAll()`（消除 §2.2 双连接）；`MCPServerManager` **投影化**（`getServerInfos`/`getServerTools` 数据源改为 C1，由 `MCPConnectionManager` 推送）；删 C3（`mcp/client/MCPClient.ts`，零消费者）。**保留** `MCPTool.connect` / CLI `mcp call` 的**按需** C2 连接（见 §10） | 消除 §2.2 的双连接；且**不回归** marketplace / CLI 的状态与工具列表 |

- 改动面：C-1 ≈ 2 文件；C-2 ≈ 1–2 文件；C-3 ≈ 3–4 文件。
- 风险：**中**。C-1/C-2 低风险（两个工具当前在自定义链上**功能可疑**，改到标准 API 是净改进）；C-3 需先确认 `MCPServerManager` 的统计/健康检查**有无外部消费者**（CLI / 命令 / 市场页）。
- 验收（每步）：`typecheck` 0 · 改动文件 `eslint` 0 · `lint:arch` 错误 0/警告 4 · 全量测试不回归 · **真实 MCP server 端到端**（`tools/list`+`resources/list`+`prompts/list` 各一次）。

---

## 5. 建议与触发条件

- **建议：从 C-1 起步**（面最小、独立可验证、且直接消除模型侧双轨；同时补齐上轮那个"只对齐了同行、没解决标准 API"的遗留）。
- **C-3 单独立项**：它触及 `MCPServerManager` 的统计/健康检查面，须先做消费者盘点 + 实测。
- **不启动的条件**：若无"资源/提示面必须可用"的实际需求，C-1 亦可**暂缓** —— 现状的两个专职工具**已基本不可用**（详见台账：`list_resources` 曾发错类型、`read_resource` 编造过内容），因此**不存在"更好的可用性被破坏"的风险**，只是把一个可疑实现换成标准实现。

---

## 6. 如实边界（未做 / 未验证）

1. **未实测**：本文全部为**静态取证**。以下**均未运行验证** ——
   §2.2 的"双连接是否真建立/是否互相干扰"、C1 `Client` 在本仓封装下的**实际可用性**（`client.ts` 用 `(client as any).tools.list()` 等 `as any` 访问，说明 SDK 版本 API 面与代码预期**可能不一致**）、自定义 transport 与真实 MCP server 的**互通性**。
2. **未盘全**：`MCPServerManager` 的统计/健康检查/连接池/负载均衡的**完整消费者集**未逐项盘（C-3 的前置）；`resourceManager`（§2.4 第一行）的**写入方**未核（只核了读出方 `getResources()`）。
3. **未判**：`mcp__*`（R1）与 `mcp_tool`（R2）是否应在收敛后**二选一**（当前是能力重复，但 R2 允许"按名调用任意工具"的语义，R1 是固定注册）—— 属产品面裁定。

---

## 7. 合规检查清单（本评估自身）

| 规则 | 落点 | 状态 |
|---|---|---|
| GR15 Spec-Driven | 本文件为评估 spec，**不含实施** | ✅ |
| GR01 基础设施复用 | §4 全部方案均以"复用 SDK `Client`"为方向，未新增第三套 | ✅ |
| CS01 归一化 | §2.3/§2.4 即"同一能力多处实现"的清点 | ✅ |
| CS03 回退最小化 | §5 明确"不启动的条件"，不硬上 | ✅ |
| CS06 证据驱动 | §2 全 file:line；§6 如实列出未实测项**不写成结论** | ✅ |
| `§1.11` MCP 模块架构 | §3 指出两处偏离（含增强层自建客户端 C3） | ✅ |

---

## 8. C-1 执行记录（2026-10-08）

### 8.1 实施中发现并**必须同批修复**的前置缺陷

C-1 的初稿是"把两个工具改走 SDK `.client`"。取证时发现：**SDK 链自身的调用形态也是错的** ——
`Client` 被当成"有 `.tools` / `.prompts` / `.resources` 子对象"来用，但**已装**
`@modelcontextprotocol/sdk@^1.29.0` 的 `Client` **只有顶层方法**
（`.d.ts:207,292,322,387,431,539`；编译产物 `index.js:464,467,476,490,565`）。

⇒ 那些调用**每次都抛 `TypeError`**，又都被上层 `catch` 吞成 `[]` / `success:false` ⇒ **静默降级**：

| 现场 | 影响 |
|---|---|
| `services/mcp/client.ts:32`（原 `.tools.list()`） | `fetchToolsForClient` 恒返 `[]` ⇒ **MCP 工具注册不上**（模型看不到 `mcp__*`） |
| `services/mcp/client.ts:57`（原 `.prompts.list()`） | MCP 命令恒空 |
| `services/mcp/client.ts:85`（原 `.resources.list()`） | 资源面恒空 |
| `services/mcp/McpToolWrapper.ts:103`（原 `mcpClient.tools.call()`） | **`mcp__*` 工具每次调用必失败** |
| `services/mcp/commandManager.ts:38`（原 `.prompts.list()`）· `:47`（原 `.prompts.execute()`） | 命令加载/执行恒失败（`execute` 亦非 SDK 方法，正解 `getPrompt`） |
| `services/mcp/resourceManager.ts:253`（原 `.resources.list()`） | 资源集合恒空 |

⇒ **若只搬两个工具而不修这些，等于从一条坏链搬到另一条坏链** ⇒ 本批**同批订正**（6 处）。

### 8.2 改动清单

| 文件 | 改动 |
|---|---|
| `services/mcp/MCPConnectionManager.ts` | **新增 `getSdkClient(serverName): Client \| undefined`** —— "取 SDK 客户端"的**单一入口**（判据只有一处：`clientCache` 中 `type === 'connected'`）。此前该判据在 3 处各写一遍且用裸 cast（`(server as any).client`），掩盖了"后备项不含 `.client`"的事实 |
| `services/mcp/client.ts` | 3 处 `(client as any).tools/prompts/resources.list()` → `listTools()` / `listPrompts()` / `listResources()` |
| `services/mcp/McpToolWrapper.ts` | `.tools.call({...})` → `callTool({name, arguments})` |
| `services/mcp/commandManager.ts` | `.prompts.list()` → `listPrompts()`；`.prompts.execute()` → `getPrompt()` |
| `services/mcp/resourceManager.ts` | `.resources.list()` → `listResources()` |
| `services/mcp/MCPToolBridge.ts` | 删**未使用**的 `const client = (server as any).client;`；wrapper 的 client getter 改走 `getSdkClient()` |
| `mcp/MCPTool.ts` | `list_tools` → `sdk.listTools()`；`call` → `sdk.callTool()`（并把 SDK 的 `isError` **如实**承载到 `ToolResult.error`）。`list_servers`/`connect` 不动 |
| `tools/MCPResourceTool/MCPResourceTool.ts` | 4 个操作改走 SDK；新增私有 `requireSdkClient()`（未连接**如实抛错**，CS03）+ `connectedServerNames()`；"列出全部"不再读自研链注册表 |
| `tests/mcp/sdkClientApiShape.test.ts` | **新增防回流守卫**（扫源码禁止"把 SDK 客户端当子对象"）—— 守卫落地**当即又抓出 2 处**同类真违规（`commandManager.ts` / `resourceManager.ts`），即 §8.1 后两行 |

### 8.3 门禁

`typecheck`（app）**0** · 改动文件 `eslint` **0** · `lint:arch` **错误 0 / 警告 4**（基线）·
全量 **4563 pass / 9 skip / 0 fail**（较基线 +2 = 新守卫 2 例）

### 8.4 ⚠️ 仍未验证（如实边界，CS06）

- **端到端仍未实测**：本环境无真实 MCP server ⇒ **"改后 MCP 工具/资源/命令是否真能工作"未验证**。
  本轮做到的是：**调用形态与 SDK 1.29 的真实 API 对齐**（依据是**已装包的 .d.ts 与编译产物**，
  非推测）+ **类型层与源码层双守卫**。
- **C-2 / C-3 未动**；同服务器**双连接**（§2.2）**依然存在** —— C-1 只消除了"模型两条路走两个连接"，
  未消除 `initialize` 里的 `addServer + connectAll`。
- 建议下一步：若有可用的 MCP server，做一次**端到端实测**（`tools/list` / `resources/list` / `prompts/list`）
  验证 C-1 的真实效果，再决定 C-2/C-3。

> **2026-10-10 更新**：上述端到端实测**已实跑完成** —— `tests/mcp/realServerE2E.test.ts`（官方
> `@modelcontextprotocol/server-everything`，`MCP_E2E=1` 门控）**13 pass / 0 fail**，覆盖工具/资源/提示/VFS 面。
> 详见 §11.4 / §11.5（该缺口**就此关闭**）。

---

## 9. C-2 执行记录（2026-10-08）

### 9.1 取证结论（决定处置的根据）

| # | 证据（静态实测） | 结论 |
|---|---|---|
| 1 | `MCPManager` 类全仓**零外部消费者**（仅经 barrel `mcp/index.ts:82` 转出；barrel 的消费者只取 `readMcpConfig` / 懒加载 mcp 模块） | 类本体基本是死面 |
| 2 | 单例 `mcpManager` **唯一消费者** = `commands/loader/CommandLoader.ts:434` → `getCommands()` | 唯一活路径 |
| 3 | `getCommands()` 产物 `{type:'mcp', serverName, load}` 经 `as Command[]` 强转，但 `'mcp'` ∉ `CommandType`（`prompt/action/tool/chat/local/local-jsx`，`commands/types/index.ts:28`），且全仓无 `case 'mcp'` 派发 | 产物**类型说谎 + 从不派发**（inert） |
| 4 | `listResources`/`readResource` 用 `callTool('resources/list'｜'resources/read')` 包装 C2；**零消费者** | 破损重实现（CS01） |
| 5 | 其余成员（通道通知 / 命令历史 / 资源缓存 / 状态查询 / 工具检索 …）**零消费者** | 死面 |

### 9.2 处置（用户裁定：**删全类 + 删其消费者**）

| 文件 | 改动 |
|---|---|
| `mcp/managers/MCPManager.ts` | **整文件删除**（528 行：类 + 单例 + `MCPServerChangeType`/`MCPServerChangeEvent`） |
| `commands/loader/CommandLoader.ts` | 删 `MCPCommandLoader` 类 + 注册行（`:519`）；原位留注释说明 |
| `commands/index.ts` / `commands/unified.ts` | 删 `MCPCommandLoader` 再导出 |
| `mcp/index.ts` | 删 `MCPManager` 与 `MCPServerChange*` 导出；原位留注释 |

### 9.3 连带（已登记，**未删**）

- `services/mcp/transports/ChildProcessTracker.ts` 的 `killOrphanedProcesses` 唯一调用点是 `MCPManager.shutdown()`；
  而 `shutdown()` **本身零消费者**（从未被调用）⇒ 该函数**在删除前即不可达**（属**既有**死面，非本次引入）。
  按 `PY_APP §3`（不删预先存在的死代码）**仅登记**，留待 **C-3** 决定：接线到标准层 shutdown，或删除。
  同文件 `getActiveProcessCount`/`getOrphanPids`/`clearAllTracking` 亦零消费者（既有）。
- `services/mcp/index.ts:177 getCommands()`（标准层 prompts→命令，C1/SDK）**仍零消费者** —— MCP 命令面当前无消费者，属 **C-3** 一并处置。

### 9.4 门禁

`typecheck` **0** · 改动文件 `eslint` **0** · `lint:arch` **错误 0 / 警告 4**（基线）·
全量 **4563 pass / 9 skip / 0 fail**（与 C-1 后持平 —— 删除面无测试覆盖）

### 9.5 ⚠️ 仍未验证（CS06）

- **未做端到端实测**（同 §8.4）。
- **行为面影响**：`CommandLoaderRegistry` 的加载器由 **4 → 3**（`'mcp'` 来源消失）。因该来源产物
  **从不派发**，预期**无用户可见行为变化**（仅静态推断，未实测）。

---

## 10. C-3 执行记录（2026-10-08）

### 10.1 取证（决定口径：去双连接**必须耦合投影化**）

- **目标**：`MCPConnectionManager.initialize` 去掉急切的 `manager.connectAll()` —— 消除 §2.2 的**同服务器双连接**。
- **盘到的实害（3 处回归）**：`MCPServerManager` 的 `status`/`tools` 原本由**它自己的连接**填充
  （`connectAll → refreshServerTools`）；一旦不再急切连接则：
  1. `GET /v1/mcp/tools`（`mcp-marketplace-handlers.ts:490` 遍历 `serverInfos[].tools`）→ 工具列表恒空
  2. `MCPMarketplace.getInstalledServerDetail`（`:220-223` `connected = status===CONNECTED`）→ 恒 `false`
  3. CLI `mcp tool list`（`mcpCommand.ts:182-186`）→ 恒空
- **消费者盘点（关键）**：`MCPServerManager` 仅 **CLI `mcp call`**（`mcpCommand.ts:202`）真正用它**调用**；
  其余（DocModule officecli / marketplace / handlers / skills / `MCPTool.list_servers`）都只当
  **注册表 / 状态投影**用。⇒ 去急切双连接可行，但须**投影化**。
- **保留**：`MCPTool.connect`（`MCPTool.ts:230-234`）与 CLI `mcp call`（`callTool` 内懒连接）的
  **按需** C2 连接 —— 仍用 `MCPServerManager`/`MCPConnection`。

### 10.2 处置（用户裁定「实现投影化」）

| 文件 | 改动 |
|---|---|
| `services/mcp/MCPServerManager.ts` | 新增投影：`projections` Map + `setProjection`/`clearProjection`/`clearProjections`；`getServerInfos()`/`getServerTools()` **投影优先**（无投影回退自研连接）；`removeServer()`/`closeAll()` 清理投影 |
| `services/mcp/MCPConnectionManager.ts` | **去掉** `await manager.connectAll()`；新增 `toServerStatus`/`toToolDefinition` 映射 + `pushProjection()`，在 `flushPendingUpdates`（C1 唯一汇入点）、`reconnectServer`、`toggleServer` 推送 |
| `mcp/client/MCPClient.ts` | **整文件删除**（C3：`MCPClientImpl`，零消费者，仅 barrel 转出） |
| `mcp/index.ts` | 删 `export { MCPClientImpl }`（原位留注释） |
| `tests/mcp/serverManagerProjection.test.ts` | **新增**：投影优先 / 回退 / `removeServer` + `closeAll` 清理（5 例，用独立实例不污染单例） |

### 10.3 门禁

`typecheck` **0** · 改动文件 `eslint` **0** · `lint:arch` **错误 0 / 警告 4**（基线）·
全量 **4568 pass / 9 skip / 0 fail**（较 C-2 后 +5 = 新增投影守卫）

### 10.4 ⚠️ 仍未验证（CS06）

- **端到端仍未实测**：本环境无真实 MCP server ⇒「去急切双连接后，真实服务器在 marketplace / CLI
  的状态与工具列表是否与 C1 一致」**未验证**。
- 本轮做到的是：**投影优先的单元级证据**（`tests/mcp/serverManagerProjection.test.ts` 5 例）+
  3 处回归面**静态封闭**（投影优先分支覆盖其数据来源）。
- **按需**路径（`MCPTool.connect` / CLI `mcp call`）**未改**；**未做**「把这两处也改走 SDK」
  （属方案 A 激进面）。`MCPServerManager` 的统计/健康检查/自动重连/连接池**均保留**（未删）。

> **2026-10-10 更新**：上述"真实服务器下 marketplace / CLI 状态与工具列表是否与 C1 一致"**仍未端到端实测**——
> `realServerE2E.test.ts` 覆盖的是**工具/资源/提示/VFS 面**（C-1 面），**未**覆盖投影化后的 marketplace/CLI 面。
> 如实边界见 §11.5。

---

## 11. P2-8 执行记录（2026-10-10）—— **双轨子进程**边界复核与裁定

> 来源：`dev_docs/20261010/升级优化方案-20261010.md` §3 **P2-8**（外部核验项 M-15）。
> 目标（原表述）：评估把 **SDK 轨**（`StdioClientTransport`）也纳入 `ChildProcessTracker`
> （当前仅自研轨被兜底回收），消除"双轨并存"；或**明确登记** SDK 轨由 `closeAll()` 承接的边界与残留风险。
> 口径（CS06）：下列结论均以**已装包源码/编译产物 + 本仓源码**为据；凡未经运行验证者标注"未实测"。

### 11.1 取证（决定「纳入 / 不纳入」的根据）

| # | 事实 | 证据 |
|:-:|---|---|
| 1 | SDK 轨的子进程由 `StdioClientTransport` **内部** `cross-spawn` 拉起 | `@modelcontextprotocol/sdk/dist/esm/client/stdio.js:65` |
| 2 | SDK 只公开 `pid` / `stderr`，**不公开子进程句柄**（`_process` 为 TS-private） | `.../client/stdio.d.ts:47,66,72`；`stdio.js:109-122` |
| 3 | `ChildProcessTracker` 的设计**基于持有 `ChildProcess` 引用**（两阶段终止 + `exit` 监听），并**刻意避免 PID 快照** | `transports/ChildProcessTracker.ts:1-13`（"我们持有 ChildProcess 引用，不需要 PID 快照"） |
| 4 | SDK `Client.connect()` 在 initialize 失败时**自带 `void this.close()`** ⇒ 连接失败**不留孤儿** | `.../client/index.js:323-327` |
| 5 | SDK 子进程 `close` ⇒ 清 `_process` + 触发 `onclose` ⇒ `Protocol._onclose()` 拒绝在途请求 | `stdio.js:83-86`；`shared/protocol.js:221-224,248-268` |
| 6 | SDK 轨子进程可被 `transport.close()` 回收（2s → SIGTERM → 2s → SIGKILL） | `stdio.js:137-172` |
| 7 | `MCPServerManager`/`MCPConnectionManager.closeAll()` **逐个** `client.close()`（真实 e2e 修过的进程泄漏） | `MCPConnectionManager.ts:539-558` |
| 8 | `cleanup()` 中 **SDK 轨关闭先于** `killOrphanedProcesses(true)`（自研轨兜底） | `services/mcp/index.ts:372-386` |
| 9 | `mcpSystem.toggleServer` / `mcpConnectionManager.toggleServer` **全仓无调用者**（真实启用走 market 的配置写入） | `index.ts:163`（无外部调用）；`MCPMarketplace.ts:236-239` 为真实路径 |

### 11.2 裁定：**不把 SDK 轨并入 `ChildProcessTracker`**（维持现状，CS03）

理由（两步都走不通 ⇒ 现机制更优）：

1. 要把 SDK 子进程喂给追踪器，只有两条路，**均劣于现状**：
   - **(a) 访问私有 `_process`**：跨 SDK 版本脆弱（无编译期保护，与 C-1 已修的 `as any` 同类风险）；
   - **(b) 新增 PID 快照机制**：追踪器**刻意规避**（事实 #3）；且子进程**自行退出后 PID 可被复用**
     ⇒ 回收时会**误杀无辜进程**（比"不追踪"更危险）。
2. SDK 轨的**回收路径已完备**（事实 #4–#8）：连接失败自带关闭、`closeAll()` 逐个 `client.close()`
   ⇒ `transport.close()` 真回收；`cleanup()` 顺序正确（SDK 先、自研兜底后）。
3. **残余风险 = 硬崩溃场景**（父进程被 SIGKILL / 崩溃）：此时**两轨的 JS 回收都不运行**
   （自研轨的 `exit` 监听与 `killOrphanedProcesses` 亦在 `cleanup()` 内）⇒ **两轨同等**残留，
   **非 SDK 轨独有** ⇒ 不值得为此引入 pid 快照的误杀风险。

⇒ 结论：**保留双轨现状**，但把边界从"注释"升级为**可执行断言**（§11.3）。

### 11.3 交付物（把边界变成机器守卫）

| 文件 | 内容 |
|---|---|
| `app/tests/mcp/sdkStdioTrackBoundary.test.ts` | **4 例**：① **前提** — SDK `StdioClientTransport` **不公开**子进程句柄（仅 `pid`/`stderr`）⇒ 若未来 SDK 暴露公开句柄则**测试失败**（触发重评"是否并入追踪器"）；② **行为** — SDK 子进程存活时 `ChildProcessTracker` **计数为 0**（双轨边界的可执行证据）+ `transport.close()`（`closeAll()` 所用机制）**真回收**该子进程（轮询等待退出）；③ **边界登记** — `cleanup()` 中 SDK 轨关闭（`closeAll`）**先于**自研轨兜底（`killOrphanedProcesses`）；④ **端到端**（2026-10-10 第二轮补） — 两轨子进程**并存**（SDK `StdioClientTransport` + 自研 `StdioTransport.connect()`）时，追踪器**只认自研轨**（计数 = 1），按**生产回收顺序**（SDK `close()` → `killOrphanedProcesses(true)`）两个 PID **均被回收**、断言 `killed === 1` 且计数归 0 |
| `app/tests/mcp/fixtures/mcpIdleChild.js` | 保持存活的 stdio 夹具（stdin `end` 即退出），供 ②④ 用真实子进程验证回收 |
| `app/tests/mcp/realServerE2E.test.ts` | **既有**（非本轮新增，`describe.skipIf(MCP_E2E !== '1')`）：官方 `@modelcontextprotocol/server-everything` 走**生产链** `mcpConnectionManager.initialize` 的真实 SDK 轨端到端（13 例，覆盖工具/资源/提示/VFS 面）。本轮**实跑复核**以关闭 §11.5 的真实 server 缺口（见 §11.4） |

### 11.4 门禁（2026-10-10 实测 · 第二轮补 e2e 后）

`tests/mcp/sdkStdioTrackBoundary.test.ts` **4 pass / 0 fail**（真实子进程：两轨 PID 在 `transport.close()` /
`killOrphanedProcesses(true)` 后**均已不可探活**，追踪计数归 0）·
`typecheck`（3 tsconfig）**0** · 改动文件 `eslint` **0** · `lint:arch` **错误 0 / 警告 4**（基线）·
全量 `bun run ci` **exit 0｜5707 pass / 0 fail / 17311 expect**（基线 5706 ⇒ **+1** = 新增第 ④ 例；`lint:fix-evidence` ✅）

真实 server 复核（门控 `MCP_E2E=1`，**非**默认套件）：`tests/mcp/realServerE2E.test.ts`
**13 pass / 0 fail / 34 expect**（`@modelcontextprotocol/server-everything`，生产链 `mcpConnectionManager.initialize`；
`afterAll` 仅调 `closeAll()` 且进程能干净退出 ⇒ 兼作 SDK 轨泄漏 e2e）。

### 11.5 已关闭 / 仍未验证（CS06）

**已关闭**：
- ✅ **SDK 轨真实 server 端到端**：由**既有** `tests/mcp/realServerE2E.test.ts` **实跑复核**关闭（**13 pass**，见 §11.4）——
  生产链 `mcpConnectionManager.initialize` + 官方参考 server，覆盖工具/资源/提示/VFS 面，且 `closeAll()` 后进程干净退出。
  ⇒ §8.4 / §10.4 遗留的"本环境无真实 server 可测"缺口**就此关闭**（该文件为既有资产，本轮**未新增**同类 e2e，CS01）。

**仍未验证（如实边界）**：
- **"真实协议 server 下双轨并存是否互相干扰"未实测**：第 ④ 例证明了**两轨子进程并存时的回收边界**，但两轨进程均为
  **本地免网络夹具**（`mcpIdleChild.js`，**非**协议 server）；**同一真实协议 server 上同时挂两轨**的场景**未跑**。
  判据：该场景须先证"自研 transport 与真实协议 server 互通"（§6.1 已明确标注**未验证**），属独立风险面，**不阻塞** P2-8 验收口径。
- **硬崩溃场景两轨同等残留**：父进程被 SIGKILL / 崩溃时两轨 JS 回收**均不运行**（§11.2 理由 3），非 SDK 轨独有 ⇒ 不引入 pid 快照误杀风险。
- 事实 #9 的 `toggleServer` 路径**无调用者**（死面）⇒ 其上"翻 `clientCache` 类型但不关 SDK client"的
  隐患**不可达**；按 `PY_APP §3`（不删预先存在的死代码）**仅登记**（如需清理，先摘调用入口再删实现，CD05）。

### 11.6 重开触发条件

- SDK 升级后 `StdioClientTransport` **暴露公开子进程句柄**（§11.3 用例 ① 变红）；
- `cleanup()` 中 SDK 轨关闭**不再先于**自研轨兜底（§11.3 用例 ③ 变红）；
- 出现**真实事件**：SDK 轨 stdio 子进程在**非硬崩溃**场景下残留（含 `toggleServer` 等路径被接线）。
