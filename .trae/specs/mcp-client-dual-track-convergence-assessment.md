# Spec：MCP 客户端双轨收敛评估（assessment）

> 版本 1.1 ｜ 创建 2026-10-08 ｜ 状态：🟡 **部分实施 —— C-1 已落地（2026-10-08）；C-2 / C-3 待裁定**
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
| **C-2** ⏳ 待裁定 | `mcp/managers/MCPManager` 的资源/命令方法同步改 C1（或整体降级为薄门面） | 让增强层回归"引用标准层"（`§1.11`） |
| **C-3** ⏳ 待裁定 | `MCPConnectionManager.initialize` **不再** `addServer + connectAll`；`MCPServerManager` 保留 `getServerInfos`/统计等**投影**能力（数据源改为 C1 的连接与工具缓存）；删 C3（零消费者） | 消除 §2.2 的双连接 |

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
