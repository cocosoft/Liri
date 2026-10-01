# Spec：研究编排装配点冻结（A7 / T-①03）

> 版本 1.0 ｜ 创建 2026-10-01 ｜ 状态：**已实施（2026-10-01，见 §6.5）**
> 来源：`pending-tasks-consolidated-20261001.md` §1 ① **T-①03（A7）**——「`new CompetitiveStrategyOrchestrator` 实点 1 处 → **2 处**，入口未统一；建议尽早**冻结该装配点**」（原始出处：会话导出 L4791 / L4895-4800）
> 关联规则：GR15（Spec-Driven）/ **CS01（归一化）** / CS03（回退最小化）/ **CS05（根因优先）** / §1.2（MIT 头）/ §1.3（无兼容包袱）
> 用户裁定：**先出 spec，经批准后实施**（本仓既有口径）

---

## 1. Problem Statement（已回仓复核，`file:line` 为实测）

| # | 事实 | 证据 |
|---|---|---|
| 1 | **构造点 2 处**：chat 侧自动分流 | [PdcaLauncher.ts#L489-L500](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/launchers/PdcaLauncher.ts#L489-L500) |
| 2 | **构造点 2 处**：runtime 侧端口（服务 `POST /v1/research/start`） | [CoreAPIImpl.ts#L2513-L2524](file:///e:/PY/Documents/CODES/PY_APP/app/src/runtime/api/CoreAPIImpl.ts#L2513-L2524) |
| 3 | **端口以 `Record<string, unknown>` 透传 + `as never` 收窄** ⇒ 调用点失去编译期 config 校验 | [queryOpsPorts.ts#L109-L118](file:///e:/PY/Documents/CODES/PY_APP/app/src/runtime/api/queryOpsPorts.ts#L109-L118)；台账自述见 `dev_docs/error_repairs/预存错误与待处理问题.md:7254` |
| 4 | **配置各自内联拼装**：两处都重复写 `perspectiveCount: 2`（且构造器本身已默认 2 ⇒ 二次声明） | [CompetitiveStrategyOrchestrator.ts#L183-L192](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/CompetitiveStrategyOrchestrator.ts#L183-L192) vs 事实 1/2 |
| 5 | 两处配置**并不同构**：chat 侧不注入角色模型，HTTP 侧注入 `generatorCallModel` / `verifierCallModel` | [research-handlers.ts#L138-L172](file:///e:/PY/Documents/CODES/PY_APP/app/src/infrastructure/http/handlers/research-handlers.ts#L138-L172)（P3 role 路由） |

### 1.1 根因（CS05）

**装配点（构造 + 配置形状 + 默认值）没有被任何单一模块拥有**：
- 构造散落在 chat 与 runtime 两处 ⇒ 契约变更需追多处；
- 配置形状只存在于"调用方脑子里"（端口退化为 `Record<string, unknown>`）⇒ 编译器无法守住；
- 默认值（`perspectiveCount`）同时在构造器与两个调用点出现 ⇒ 三处声明、一处事实源。

事实 5 是**设计差异而非重复**（两个入口的 LLM 上下文不同），**不在本项消除范围**（见 §2 N2）。

---

## 2. 目标 / 非目标

**目标**

- **G1（单一装配点）**：生产代码中 `new CompetitiveStrategyOrchestrator` 收敛为 **1 处**，位于 `query/`（该类的属主模块）。
- **G2（配置形状可被编译器守住）**：`queryOpsPorts` 的配置参数从 `Record<string, unknown>` 改为**类型化最小投影 DTO**，`CoreAPIImpl` 去掉 `as never`。
- **G3（默认值单一事实源）**：`perspectiveCount` 默认值只在构造器声明；两个调用点不再重复给同值。

**非目标（明确不做）**

- **N1**：不统一两个入口的**业务语义**（chat 侧结果以 assistant 消息回写 + 注入 pitfall 注册表；HTTP 侧结果以 `pdca:*` SSE 事件推送 + 经 `taskOps.recordPitfall` 落盘）。二者差异属产品行为，收敛属**独立议题**。
- **N2**：不消除事实 5 —— chat 侧不注入 `generatorCallModel` / `verifierCallModel`（该侧 callModel 来自 TAOR deps，角色模型接线属 T-①04 编排装配范围）。本项**如实登记该差异**，不做"顺手补齐"。
- **N3**：不改判定规则 / 不改 `PatternSelector` / 不改 PDL。
- **N4**：不新增 HTTP/IPC 端点、不新增事件类型、不新增配置项；**不改端口方法名与签名形态**（仅把 `config` 参数类型化）。
- **N5**：不改 `CompetitiveStrategyOrchestrator` 的类契约（构造签名 / `run` 语义逐字不变）。

---

## 3. 设计

### 3.1 G1 —— 唯一装配入口（`query/CompetitiveStrategyOrchestrator.ts`）

```ts
/**
 * 研究编排**装配点**（A7）—— 生产代码中本编排器只在此处构造。
 *
 * 为什么冻结：构造此前散落在 chat（PdcaLauncher 自动分流）与 runtime 端口（CoreAPIImpl，
 * 服务 POST /v1/research/start）两处，配置各自内联、默认值多处重复，且端口以
 * `Record<string, unknown>` 透传 ⇒ 契约变更需追多处且编译器守不住。
 *
 * 现在调用方只供**上下文相关件**（callModel + 角色模型 + pitfall 落点），
 * 构造 / 默认值 / 执行收在本函数内。
 * 默认 `perspectiveCount = 2` 为成本护栏（每 +1 = +1 次生成 +1 次批评），单一事实源在构造器。
 */
export async function runResearchOrchestration(
  description: string,
  signal: AbortSignal,
  config: CompetitiveOrchestratorConfig
): Promise<CompetitiveOrchestrationResult> {
  return new CompetitiveStrategyOrchestrator(config).run(description, signal);
}
```

- 出口：`query/index.ts` 增补 `export { runResearchOrchestration }`。
- 形态选择（D1）：取**函数**而非工厂 —— 两个调用点均为「构造即用、用完即弃」，函数形态使调用方**无法持有未装配实例**，且与端口既有方法名 `runCompetitiveOrchestration` 同形。

### 3.2 G2 —— 端口配置类型化（`runtime/api/queryOpsPorts.ts`）

```ts
/**
 * 研究编排装配配置（**最小投影**：两个调用方实际传入并集；逐字镜像
 * `CompetitiveOrchestratorConfig` 子集。`perspectiveCount` 不再收 —— 默认值属装配点/构造器）。
 */
export interface ResearchOrchestrationConfigDto {
  callModel: ResearchCallModelDto;
  generatorCallModel?: ResearchCallModelDto;
  verifierCallModel?: ResearchCallModelDto;
  recordPitfall?: (rec: {
    description: string;
    error: string;
    source: 'verifier';
    contextSig?: string;
  }) => void;
}
```

- `runCompetitiveOrchestration(description, signal, config: ResearchOrchestrationConfigDto)`。
- `CoreAPIImpl` 侧：`const { runResearchOrchestration } = await queryModule(); return runResearchOrchestration(description, signal, config);` —— **删除 `as never`**。
- 返回值仍为 `CompetitiveOrchestrationResultDto`：app 侧结果类型**结构上满足**该 DTO（既有代码已通过 typecheck 佐证），**无需 cast**。

### 3.3 G3 —— 调用点去重

| 文件 | 改动 |
|---|---|
| `chat/launchers/PdcaLauncher.ts` | `new CompetitiveStrategyOrchestrator({...})` + `orchestrator.run(...)` → **一次** `runResearchOrchestration(description, signal, { callModel, recordPitfall })`；删除 `perspectiveCount: 2` |
| `infrastructure/http/handlers/research-handlers.ts` | 端口调用对象删除 `perspectiveCount: 2` |

---

## 4. 影响文件（预计）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `app/src/query/CompetitiveStrategyOrchestrator.ts` | **改**：新增 `runResearchOrchestration`（装配点） |
| 2 | `app/src/query/index.ts` | **改**：增补 1 个值出口 |
| 3 | `app/src/runtime/api/queryOpsPorts.ts` | **改**：新增 `ResearchOrchestrationConfigDto`；`config` 参数类型化 |
| 4 | `app/src/runtime/api/CoreAPIImpl.ts` | **改**：改调装配点函数，删 `as never` |
| 5 | `app/src/chat/launchers/PdcaLauncher.ts` | **改**：改调装配点函数（−实例局部量） |
| 6 | `app/src/infrastructure/http/handlers/research-handlers.ts` | **改**：删重复 `perspectiveCount` |
| 7 | `app/tests/query/CompetitiveStrategyOrchestrator.test.ts` | **改**：新增装配点用例（默认视角数 = 2；配置透传 callModel） |

> **不改**：`client/`；`api-spec.md`（端点与请求体不变）；PDL / PatternSelector。

---

## 5. 决策点（请评审确认）

| ID | 决策（建议） | 理由 |
|---|---|---|
| D1 | 装配入口取**函数** `runResearchOrchestration(description, signal, config)`，不取工厂 | 两个调用点均构造即用 ⇒ 函数让"未装配实例"不可能出现；且与端口方法同名同形，调用点改动最小 |
| D2 | 端口配置取**最小投影 DTO**（不引 app 类型） | 与既有 4 个镜像（`ResearchCallModelDto` 等）同法；端口禁引 app 类型是 `R00-001` 硬约束 |
| D3 | 删除两处重复的 `perspectiveCount: 2` | 构造器已默认 2 ⇒ 三处声明同一默认值属 CS01；护栏说明移到装配点注释（单一事实源） |
| D4 | **不**统一两个入口的结果交付与 callModel 构造（N1/N2） | 属产品行为差异，收敛会改变 chat/HTTP 两侧表现 ⇒ 需独立裁定 |
| D5 | 保留 `CompetitiveStrategyOrchestrator` 类的公开导出 | 测试 harness 与既有消费者的进口不动（§3 影响面最小化） |

---

## 6. 验收方案

| 项 | 通过标准 |
|---|---|
| G1 | `grep "new CompetitiveStrategyOrchestrator"` 在 `app/src/**` = **1 命中**（装配点内）；测试目录不限 |
| G2 | `queryOpsPorts` 无 `Record<string, unknown>` 配置参；`CoreAPIImpl` 该处无 `as never`；`typecheck` 0 |
| G3 | 两个调用点均无 `perspectiveCount`（`grep` 0 命中）；装配点注释声明默认值来源 |
| 零回归 | `bun run typecheck` 0 · 改动文件 `eslint` 0/0 · `bun run lint:arch` 0 错（警告数与基线一致）· 全量 `bun test` 0 fail（基线 **4255 pass / 21 skip**） |
| 突变验证 | ① 在装配点把 `config` 丢弃改为 `new CompetitiveStrategyOrchestrator({ callModel: config.callModel })` ⇒ 装配点用例（配置透传）必 red；② 把 DTO 的 `callModel` 改为可选 ⇒ `typecheck` 必红（调用点未传入） |
| 未做（明确） | 两个入口的业务语义统一（N1）、chat 侧角色模型接线（N2）、类契约变更（N5） |

---

## 6.5 实施结果（2026-10-01）

| 项 | 结果 |
|---|---|
| G1 单一装配点 | ✅ [CompetitiveStrategyOrchestrator.ts#L434-L458](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/CompetitiveStrategyOrchestrator.ts#L434-L458)：新增 `runResearchOrchestration(description, signal, config)`；[query/index.ts#L160-L164](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/index.ts#L160-L164) 增补出口 |
| G2 端口配置类型化 | ✅ [queryOpsPorts.ts#L101-L121](file:///e:/PY/Documents/CODES/PY_APP/app/src/runtime/api/queryOpsPorts.ts#L101-L121)：新增 `ResearchOrchestrationConfigDto`；`runCompetitiveOrchestration` 的 `config` 由 `Record<string, unknown>` 改为该 DTO；[CoreAPIImpl.ts#L2515-L2525](file:///e:/PY/Documents/CODES/PY_APP/app/src/runtime/api/CoreAPIImpl.ts#L2515-L2525) 改调装配点，**`as never` 已删除** |
| G3 调用点去重 | ✅ [PdcaLauncher.ts#L490-L506](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/launchers/PdcaLauncher.ts#L490-L506)（`new`+`run` 两行 → 一次装配点调用）、[research-handlers.ts#L140-L148](file:///e:/PY/Documents/CODES/PY_APP/app/src/infrastructure/http/handlers/research-handlers.ts#L140-L148)（删 `perspectiveCount: 2`） |
| D5 类导出保留 | ✅ `CompetitiveStrategyOrchestrator` 仍从 `query/index.ts` 导出（测试 harness 与既有消费者进口未动） |

**验证实测**

| 项 | 结果 |
|---|---|
| G1 实测 grep | `new CompetitiveStrategyOrchestrator` 在 `app/src/**` = **代码 1 处**（装配点内）+ **注释 1 处**（`queryOpsPorts.ts:132` 引述原调用形态，用于溯源，非可执行代码）；`app/tests/**` 2 处（测试 harness，按 spec 不限） |
| G3 实测 grep | `perspectiveCount` 在两个调用点 **0 处实参**（仅注释说明）；该标识的其余命中全在编排器自身（定义/默认/归一） |
| `bun run typecheck` | **0**；**突变验证 ②**：把 DTO 的 `callModel` 改可选 ⇒ `CoreAPIImpl.ts(2524,62) TS2345` **必红** ⇒ 边界类型检查确实生效 |
| 改动文件 `eslint` | **0 error / 0 warning** |
| `bun run lint:arch` | **0 错 / 2 警**（与基线一致：R07-004 `REF` + R00-003 动态导入仅上报；未新增违规） |
| 定向 `tests/query/CompetitiveStrategyOrchestrator.test.ts` | **7 pass / 0 fail**（原 4 + 新增装配点 3） |
| 全量 `bun test` | **4258 pass / 21 skip / 0 fail**（4279 tests；较上批 4255 净 +3 = 本项新增用例） |
| 突变验证 ×2 | ① 装配点丢弃 `config`（只传 `callModel`）⇒ **2 例 red**（`recordPitfall` / `generatorCallModel` 透传用例）；② 见上（typecheck 红）。还原后全绿 |

**与 spec 的偏离（如实，含理由）**

1. **装配点用例由 2 例扩为 3 例**：除"默认视角数=2"外，补了 `recordPitfall` 与 `generatorCallModel` 两条**透传**用例 —— 它们是突变验证 ① 的判别力来源（仅测默认值无法发现"配置被丢弃"）。
2. **G1 的 grep 残留 1 处注释**：`queryOpsPorts.ts` 的方法注释引述了原调用形态 `new CompetitiveStrategyOrchestrator(config).run(...)`；保留是为溯源（该行本就标注"原 …"），非可执行代码。

**如实登记（未处理，见 §2 N1/N2）**

- 两个入口的**结果交付**（chat 侧 assistant 消息 / HTTP 侧 `pdca:*` SSE）与 **callModel 构造**（chat 侧 TAOR deps / HTTP 侧 AIService + 角色模型）仍不同构；chat 侧研究编排**未注入** `generatorCallModel` / `verifierCallModel`。本项只收敛装配点，该差异留待独立议题（涉及 chat 侧 TAOR deps 能否解析角色模型）。

---

## 7. 合规检查清单

| 规则 | 结论 |
|---|---|
| GR15 Spec-Driven | ✅ 本 spec 先行，批准后实施 |
| **CS01 归一化** | ✅ 本项即"消除重复造轮子"：构造点 2 → 1、默认值 3 处声明 → 1 处；不新增第二套装配路径 |
| CS03 回退最小化 | ✅ 无新增分支/兜底；`as never` 是**删除**而非替换 |
| CS05 根因优先 | ✅ 根因＝"装配点无人拥有"，修复＝指定属主模块并经端口类型化 |
| §1.2 MIT 头 | ✅ 改动文件均已有头；新增代码在既有文件内 |
| §1.3 简洁优先 | ✅ 净增约 20 行（含注释），调用点各减去内联拼装 |
| §1.6 模型可见 ⇔ 已落盘 | ✅ 不新增模型可见输入、不新增事件类型 |
| 文件行数 ≤1000 | ✅ 改动文件均远低于上限 |

---

## 8. 风险与边界（如实）

1. **收益偏"防御性"**：两个入口的**当前行为逐字不变**（含 `perspectiveCount` 默认值仍为 2）⇒ 本项收益集中在"契约变更只需改一处 + 编译器重新守住端口边界"，**不产生可感知的功能变化**。若评审认为收益不足，可只做 G2（类型恢复，风险近零）或整体暂缓。
2. **G2 的类型化是"最小投影"**：DTO 只列两个调用方**实际传入**的字段 ⇒ 若未来调用方要传 `maxConcurrency` / `timeoutMs`，需同步扩 DTO（编译器会拦住，属预期行为而非缺陷）。
3. **事实 5 未消除（如实）**：chat 侧研究编排**不注入角色模型**，与 HTTP 侧不一致 —— 本项**只登记不修改**；是否补齐需产品裁定（涉及 chat 侧 TAOR deps 能否解析 `generator`/`verifier` 角色模型）。
4. **`CompetitiveStrategyOrchestrator` 仍被导出**：单一装配点约束靠 **grep + 评审**维持，未加门禁规则（新加 lint 规则属 T-③01/T-①09 门禁批次，不在本项）。
