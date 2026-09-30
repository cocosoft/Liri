# PathGuard 路径入参解析改由「运行时注册表」驱动（MCP 动态工具覆盖）

> **状态**：✅ **已实施（2026-09-29，用户批准；含 8 例离线守卫）** —— 实现记录与验收见 **§7**
> **来源**：[`liri-optimization-plan-20260926.md`](./liri-optimization-plan-20260926.md) **P2-2**（对照其 §1-#4 引申）/ [`liri-upgrade-plan-20260928.md`](./liri-upgrade-plan-20260928.md) **C2** / [`architecture-benchmark-20260928.md`](./architecture-benchmark-20260928.md) §四 根因类 ④
> **关联规则**：GR01（基础设施复用）/ GR02（实现唯一性）/ GR03（证据驱动）/ CS01（新增前先查已有）/ CS03（回退最小化）/ CS05（根因优先）/ R03（模块边界）/ §1.8（日志）
> **最后更新**：2026-09-29

---

## 1. 问题（先证现状，再谈改法）

### 1.1 现状：`PathGuard` 靠**静态工具名清单**决定"哪个入参是路径"

[`query/PathGuard.ts`](../../app/src/query/PathGuard.ts) 的路径提取是**按工具名分支**的：

- 三份静态名单：`READ_FILE_TOOL_NAMES`（[:154](../../app/src/query/PathGuard.ts#L154)）、`SEARCH_TOOL_NAMES`（[:157-166](../../app/src/query/PathGuard.ts#L157-L166)）、`WRITE_TOOL_NAMES`（[:169](../../app/src/query/PathGuard.ts#L169)）；真实名取自单一事实源 [`query/tool-constants.ts`](../../app/src/query/tool-constants.ts)（`FILE_READ_TOOLS`/`SEARCH_TOOLS`/`WRITE_TOOLS`），其余为**别名硬编码**。
- `_extractPath()`（[:265-292](../../app/src/query/PathGuard.ts#L265-L292)）：**不在三份名单里 ⇒ 返回 `null`**。
- `checkToolCall()`（[:212-233](../../app/src/query/PathGuard.ts#L212-L233)）：`if (!path) return { allowed: true }` ⇒ **直接放行（fail-open）**。

### 1.2 缺口：名单之外的工具，其路径入参**完全不受拒绝列表约束**

- 名单只覆盖 7 个内置名（`file_read` / `glob` / `grep` / `file_search` / `file_write` / `file_edit` / `notebook`）+ 若干别名。
- **运行时动态注册的工具**（外部 MCP，`mcp__<server>__<tool>` 形态，见 `services/mcp/normalization.ts`）**不在名单内** ⇒ 若其入参含 `path` / `file_path`，`_extractPath()` 返回 `null` ⇒ **拒绝列表（`**/.env`、`**/secrets/**`、`**/*.pem` …）对它不生效**。
- `PathGuard` 是**活的**：构造与调用在 [`chat/ReActToolLoop.ts:313`](../../app/src/chat/ReActToolLoop.ts#L313) / [`:1301`](../../app/src/chat/ReActToolLoop.ts#L1301) 与 [`query/TAORLoop.ts:498`](../../app/src/query/TAORLoop.ts#L498) / [`:949`](../../app/src/query/TAORLoop.ts#L949)。

### 1.3 ⚠️ 对原方案表述的**两处纠正**（取证后如实更正，避免照错的要求开工）

| 原方案表述 | 实测 | 更正 |
|---|---|---|
| 「让 `pathShield` / **`PathGuard`** 读运行时注册表」 | [`tools/pathShield.ts`](../../app/src/tools/pathShield.ts) 的 `findShieldedHit()`（[:198-216](../../app/src/tools/pathShield.ts#L198-L216)）**把整个入参 `JSON.stringify` 后做子串匹配**，**完全不看工具名** | ⇒ `pathShield` **本就与工具名无关，天然覆盖 MCP 动态工具**，**无需改动** |
| 「…而非静态清单，**避免误拦合法外部工具**」 | 现状是**漏拦**（fail-open），不是误拦 | ⇒ **缺口方向相反**：现在的问题是**名单外工具不被检查**。"误拦"是**改法本身**的引入风险（见 §3.2），必须在设计里防住 |

---

## 2. 目标与验收（可证伪）

- **G1（主目标）**：路径入参的判定**不再依赖静态工具名清单** —— 改为在 `checkToolCall()` 时**从运行时工具注册表读取该工具的入参声明**（`ToolInfo.params`，见 [`tools/types/Tool.ts:73-76`](../../app/src/tools/types/Tool.ts#L73-L76)），据此决定"哪些键是路径"，从而**自然覆盖 MCP 动态工具**。
- **G2（零误拦）**：**不得**把"未声明的字符串入参"当路径 —— 仅当注册表**声明**了该入参名（或该名在既定"路径键"集合内）时才做提取。**验收**：构造"非路径入参的值恰好形似 `**/.env`"（如 `web_fetch` 的 URL 以 `/.env` 结尾）⇒ **必须放行**（现状亦放行）。
- **G3（向后兼容 / 零回归）**：对**未提供注册表**或**注册表中查不到**的工具，行为**与现状逐字段一致**（沿用既有静态名单）。
- **G4（可观测）**：提取失败 / 注册表查不到时的**降级路径**必须留痕（`logger` 门面，module 沿用 `query:pathGuard`），不得静默。
- **验收判据（离线可证）**：
  1. 新增"名单外工具（模拟 MCP 名 `mcp__fs__read_file`）声明 `path` 入参"的用例 ⇒ `checkToolCall` **拦截**命中拒绝列表的路径；
  2. G2 的"形似但不该拦"用例 ⇒ **放行**；
  3. **既有 PathGuard 相关测试全绿**（G3 的机械证明）。

---

## 3. 设计要点

### 3.1 关键决策：**端口注入**，而不是让 `query` 直接依赖 `tools`

- **根因**：`PathGuard` 属 `query` 层，而注册表在 `tools`（`getToolRegistry()`）；直接 import 会引入一条**新的跨层依赖**（R03 关注点），且会让 `PathGuard`（纯判定逻辑）耦合全局单例 ⇒ **不可测**。
- **做法（GR01：不新造框架，端口即契约）**：`PathGuard` 增加**可选注入**的解析器（形如 `resolvePathArgKeys(toolName) => string[] | null`），默认 `null` ⇒ 走 §3.3 的既有静态名单（G3）。**调用方**（`chat/ReActToolLoop`、`query/TAORLoop`）注入一个**由 `getToolRegistry()` 派生**的实现。
  - 与既有先例一致：`createPathGuard()` 已是工厂函数（[:305-307](../../app/src/query/PathGuard.ts#L305-L307)），扩展其**可选参数**即可，**不新增第二套工厂**。

### 3.2 保守提取规则（G2 的落点）

从 `ToolInfo.params` 取键名，**只认**"路径语义键"这一集合（与现有 `_extractPath` 的候选键**同源**，不另立第二份）：

```
file_path · notebook_path · path · searchPath · directory · target_directory · filePath
```

- **为什么不能"所有字符串入参都当路径"**：那会把 URL / 正则 / 提示词一并送进 `**/.env` 这类**锚定 glob** 判定 ⇒ 真产生误拦（G2）。**这是 §1.3 纠正过的那个风险点**。
- 判定方向仍是 `否 ⇒ 放行`（fail-open 于"非路径"），与现状一致；本 spec **不改变** `PathGuard` 的 fail-open 策略（那是另一议题，见 §6）。

### 3.3 数据流

```
ReActToolLoop / TAORLoop
  └─ createPathGuard({ resolvePathArgKeys })        // 由调用方注入
       └─ resolvePathArgKeys(name) = getToolRegistry().getTool(name)?.params
                                     .map(p => p.name)
                                     .filter(k => PATH_ARG_KEYS.has(k)) ?? null
  └─ checkToolCall(name, args)
       ├─ keys = resolvePathArgKeys?.(name)  → 命中 ⇒ 按 keys 提取路径
       └─ keys 为 null ⇒ 回退既有静态名单（READ/SEARCH/WRITE_TOOL_NAMES）
```

---

## 4. 任务清单（**已全部完成**，见 §7）

| 编号 | 任务 | 状态 | 验证方式 |
|---|---|:--:|---|
| T1 | `PathGuard` 增**可选注入** `resolvePathArgKeys`（**纯契约，零行为变化**） | ✅ 已完成 | `typecheck` + 新增用例对"未注入 ⇒ 静态名单"逐项断言 |
| T2 | 定义**路径语义键**集合（与 `_extractPath` 候选键同源，单一事实源） | ✅ 已完成 | `PATH_ARG_KEYS` 置于 `tool-constants.ts`（唯一来源），PathGuard 侧派生只读 `Set` |
| T3 | 两个调用方（`ReActToolLoop` / `TAORLoop`）注入 **registry 派生**实现 | ✅ 已完成 | 新增用例：模拟 MCP 工具名 ⇒ 提取生效（G1） |
| T4 | **G2 反例守卫**：非路径键的值形似拒绝模式 ⇒ **必须放行** | ✅ 已完成 | 用例：`url='https://example.com/.env'` ⇒ `allowed === true`；混合键用例 |
| T5 | 降级留痕（注册表查不到 ⇒ 回退静态名单 + `logger.debug`） | ✅ 已完成 | 用例（G3）+ 代码路径 `PathGuard.ts` 的 `logger.debug` |

**依赖顺序**：T1 → T2 →（T3 ∥ T4 ∥ T5）。**全部可离线完成**（注入假解析器）。

---

## 5. 合规检查表

| 规则 | 落实 |
|---|---|
| GR01（基础设施复用） | 复用既有 `createPathGuard()` 工厂 + `getToolRegistry()`；**不新造**注册表/第二工厂 |
| GR02（实现唯一性） | `pathShield` **不动**（它已名字无关）；路径键集合**只保留一份**（T2） |
| GR03（证据驱动） | §1 每条附 `文件:行`；§1.3 对原方案的两处纠正**先取证再改** |
| CS01（新增前先查已有） | 已核 `pathShield` 无需改、无重复 spec（`.trae/specs` grep） |
| CS03（回退最小化） | 仅一处回退（注册表查不到 ⇒ 静态名单），**必须**留 `logger.debug`；不新增"以防万一"分支 |
| CS05（根因优先） | 根因是"路径入参判定绑死了静态名" ⇒ 改为**注册表驱动**，而非给 MCP 工具逐个加名 |
| R03（模块边界） | 用**端口注入**避免 `query → tools` 新跨层依赖 |
| §1.8（日志） | 新增日志一律 `logger.debug/warn`，module 沿用 `query:pathGuard` |

---

## 6. 不在范围 / 未验（如实）

- ❌ **不改** `pathShield`（§1.3：它已覆盖 MCP；且仅在 `PERMISSION_SHIELDED_PATHS` 设置时生效，属评测专线）。
- ❌ **不改** `PathGuard` 的 **fail-open 策略本身**（"名单外工具无路径参数就放行"是既有语义）；本 spec 只让"名单外工具**若有路径参数则被检查**"。
- ❌ **不做**"所有字符串入参都当路径"（会引入误拦，见 §3.2）。
- ❌ **不覆盖** `bash` / `powershell` 的命令内路径（`command` 是字符串，按 [tool-constants.ts:40-41](../../app/src/query/tool-constants.ts#L40-L41) 的既有裁定**本就不入名单**）。
- ⚠️ **未验（待实施期补）**：① MCP 工具的 `ToolInfo.params` 是否**确实**填入了其远端 schema（需起一个真实 MCP server 观察；本轮仅静态确认 `ToolInfo.params` 字段存在）；② 运行时 `/v1/tools` 的 **60 vs 建议 81** 口径差异（属 `liri-upgrade-plan-20260928.md` §5-#9，与本 spec 同域，**未查**）。

---

## 7. 实施记录（2026-09-29，用户批准）

| 编号 | 落点 | 状态 |
|---|---|:--:|
| T1 | [`PathGuardOptions.resolvePathArgKeys`](../../app/src/query/PathGuard.ts#L187-L189) + 构造函数注入（[:208-216](../../app/src/query/PathGuard.ts#L208-L216)） | ✅ |
| T2 | `PATH_ARG_KEYS` 单一事实源置于 [`query/tool-constants.ts:70-78`](../../app/src/query/tool-constants.ts#L70-L78)；PathGuard 侧派生 `PATH_ARG_KEY_SET` 并用于**求交** | ✅ |
| T3 | 注册表派生解析器 [`ToolRegistry.resolveToolParamNames()`](../../app/src/tools/ToolRegistry.ts#L817-L821)（经 [`tools/index.ts`](../../app/src/tools/index.ts#L50-L55) 导出）；两个调用方注入：[`ReActToolLoop.ts:319-321`](../../app/src/chat/ReActToolLoop.ts#L319-L321) / [`TAORLoop.ts:500-502`](../../app/src/query/TAORLoop.ts#L500-L502) | ✅ |
| T4 | G2 反例守卫写入 [`tests/query/PathGuard.test.ts`](../../app/tests/query/PathGuard.test.ts)（"非路径键 / 混合键 ⇒ 放行"） | ✅ |
| T5 | 注册表未命中 ⇒ `logger.debug` 留痕 + 回退静态名单（[`PathGuard.ts:301-305`](../../app/src/query/PathGuard.ts#L301-L305)） | ✅ |

**改动面（7 文件）**：`query/PathGuard.ts`（契约 + 分支）、`query/tool-constants.ts`（键集合）、`tools/ToolRegistry.ts`（解析器）、`tools/index.ts`（导出）、`chat/ReActToolLoop.ts` + `query/TAORLoop.ts`（注入）、`tests/query/PathGuard.test.ts`（**新建**，8 例）。

**验收（实测）**：
- 新增守卫 **8 pass / 0 fail**（`bun test tests/query/PathGuard.test.ts`）
- 回归 `bun test tests/query` **119 pass / 0 fail**（17 文件）
- `bun run typecheck` **0**
- `lint:arch` **0 错 1 警**（唯一告警为**预存** R07-004 `REF/`，与本次改动无关；检查 3972 文件 / 豁免 461）
- 改动文件 `eslint` **0**、`prettier` ✓

**实施期两处如实记录**：
1. **踩坑并修正**：首版把 `**/.env` 字面写进 `tool-constants.ts` 的**块注释** ⇒ 其中的 `*/` **提前终止注释**，后续文字被当代码解析 ⇒ `bun test` 当场报 `Unexpected .`。已改写为"`.env` 通配模式"。**教训**：块注释内禁用 glob 星号写法。
2. **已知边界（保留）**：写判定仍用静态名单 ⇒ 名单外工具（含 MCP）按**读**处理（只套 `denyRead`）。这是**保守**选择（修复前对它们**完全不检查**）；若要覆盖 `denyWrite`，需注册表额外声明读写语义（本 spec 未涉及）。已就地注释于 [`_isWriteTool`](../../app/src/query/PathGuard.ts#L332-L341)。

**未验（如实）**：① 真实 MCP server 的 `ToolInfo.params` 是否确实填入远端 schema（需起服务观察）；② 真实会话中经 MCP 工具触发拦截的端到端观测。
