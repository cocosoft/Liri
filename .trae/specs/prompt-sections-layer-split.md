# Spec：`systemPromptSections` 分层拆分（框架留 infra / 内置段落迁 app）

> 状态：**待批准**（设计已取证，未动代码）
> 归属：`infra -> app` 倒挂收官 · constants 组（余 5 处）
> 上游：台账 D-152（constants 组已消除 1 处）· spec `architecture-benchmark-20260928.md` §5.7

---

## 1. 问题（已取证）

`app/src/constants/systemPromptSections.ts`（**~851 行**，模块 `constants` = **infra**）同时承担两件事：

| 职责 | 依赖层 | 用例 |
|---|---|---|
| **A. 提示词段落框架** | 仅 core/infra | `SystemPromptSection` / `CACHE_BOUNDARY` / `systemPromptSection()` / `DANGEROUS_uncachedSystemPromptSection()` / `sectionCache` / `registerSections` / `getRegisteredSections` / `resolveSystemPromptSections` / `resetToDefaultSections` |
| **B. 内置段落定义**（`DEFAULT_SECTIONS`，第 173-776 行） | **app + service** | `identity` / `toolUse` / `toolIntegrity` / `shellDeclaration` / `taskNegotiation` / `pdcaThinking` / `userProfile` / `personality` / `projectRules` / `memory`(×n) / `sessionContext` / `gitContext` / `projectMeta` / `knowledgeDigest` / `fewShotExamples` / `knowledgeSaveGuide` / `outputArtifactBoundary` |
| **C. 缓存清理** | **service** | `clearSystemPromptSections()` → `clearSoulCache` / `clearUserCache` / `clearWorkspaceCache` |

**实测倒挂**（门禁探针，D-152 后）：`constants (infra) → app` **5 处**（`context` / `knowledge` / `skills` / `tools` / `workspace`）＋ `constants → services` 1 处。

**关键约束（决定设计）**：
1. **消费面跨层**：`services/prompt/PromptAssembler.ts`、`ProviderPromptPlugin.ts`、`promptSectionLayers.ts`、`SystemPromptReport.ts`（**service**）只消费 **A（框架）**；`infrastructure/http/handlers/skills-handlers.ts`（service）动态导入。
2. **整体上移会反向制造 `service -> app`**（4~5 处）⇒ 只是搬运，已据此否掉。
3. **`registerSections()` 全仓零调用方** ⇒ 当前唯一活路径是 `getRegisteredSections()` 回退到 `DEFAULT_SECTIONS`（**拆分必须解决"注册时序"**，否则提示词为空）。
4. `StaticPromptSectionName` 由 `DEFAULT_SECTIONS` **推导**（刻意非手工清单），被 `services/prompt/promptSectionLayers.ts` 的 `satisfies Record<StaticPromptSectionName, PromptSectionMeta>` **穷尽登记校验**依赖。

---

## 2. 目标

- `constants` 组 `infra -> app` **5 处归零**、`constants -> services` **1 处归零**；
- **不新增**任何跨层边（尤其不得把边搬去 `service -> app`）；
- 保留既有两道守卫的**语义**：① 静态段名穷尽（`promptSectionLayers` 的 `Record` 校验）；② 段名/构建器不漂移。

---

## 3. 设计

### 3.1 分层归属

```
app/src/constants/systemPromptSections.ts        ← A（框架）+ 段名清单（infra，零 app/service 依赖）
app/src/context/promptSections/index.ts          ← B（内置段落构建器）+ C（缓存清理注册）
```

### 3.2 段名清单留在 infra（保住"推导"守卫，不改为手工联合）

infra 侧保留**有序**段名元组，`StaticPromptSectionName` 仍由其**推导**：

```ts
// constants/systemPromptSections.ts（infra）
const SECTION_NAMES = ['identity', 'toolUse', /* … */] as const;
export type StaticPromptSectionName = (typeof SECTION_NAMES)[number];
```

### 3.3 用"构建器注册"替代 `DEFAULT_SECTIONS` 内联

infra 侧新增两个**注入槽**（app 侧注册，避免 infra → app）：

```ts
export interface SectionSpec { compute: ComputeFn; cacheBreak: boolean; }
let _builtinSpecs: Record<StaticPromptSectionName, SectionSpec> | null = null;
let _cacheClearers: Array<() => void> = [];

export function registerBuiltinSectionSpecs(specs: Record<StaticPromptSectionName, SectionSpec>): void
export function registerSectionCacheClearers(clearers: Array<() => void>): void
```

- `getRegisteredSections()`：`registeredSections`（显式注册）→ `_builtinSpecs` 按 `SECTION_NAMES` 顺序组装 → 空数组。
- `clearSystemPromptSections()`：清 `sectionCache`/`memoryContentHash` 后，依次调用 `_cacheClearers`。
- **`systemPromptSection(name, compute)` / `DANGEROUS_uncachedSystemPromptSection(name, compute, reason)` 保留**（`cacheBreak` 由后者置 true），app 侧构建器用它产出 `SectionSpec`。

### 3.4 app 侧（`context/promptSections/`）

- `index.ts`：`export const SECTION_SPECS = { identity: systemPromptSection('identity', () => …), … } satisfies Record<StaticPromptSectionName, SectionSpec>;`（**穷尽校验**：漏一段 / 多一段 ⇒ 编译失败）；并导出 `registerPromptSections()`（内部调 `registerBuiltinSectionSpecs` + `registerSectionCacheClearers([clearSoulCache, clearUserCache, clearWorkspaceCache])`）。
- `context/index.ts` 转出 `registerPromptSections`（避免子路径导入触发 R03-002）。

### 3.5 注册时序（**本方案唯一新增风险**）

在 `entrypoints/init.ts`（entry，已动态导入 `systemPromptSections`）**同处**调用 `registerPromptSections()`；并保证在 `PromptAssembler.assembleSystemPrompt()` 首次调用前完成。

**兜底**：`getRegisteredSections()` 在未注册时返回**空数组**（而非抛错）—— 与现状"回退默认段"不同 ⇒ **必须**用测试锁定（见 §5 T4）。

---

## 4. 实施步骤

| # | 步骤 | 验证 |
|---|---|---|
| T1 | infra 侧：抽出 `SECTION_NAMES` + 注入槽 + 改写 `getRegisteredSections`/`clearSystemPromptSections`；删掉 A 部分之外的 import | `bun run typecheck` |
| T2 | app 侧新建 `context/promptSections/`，把 `DEFAULT_SECTIONS` 逐段搬为 `SECTION_SPECS`（`satisfies` 穷尽） | `bun run typecheck`（漏段 ⇒ 报错，即守卫生效） |
| T3 | `context/index.ts` 转出 `registerPromptSections`；`entrypoints/init.ts` 调用注册 | `bun run typecheck` |
| T4 | 测试：新增/改造用例锁定 ① 注册后段集合与顺序 = 原 `DEFAULT_SECTIONS`；② 未注册时 `resolveSystemPromptSections()` 行为 | `bun test` |
| T5 | 回归：`lint:arch` + 门禁探针（`constants (infra) → app` 应为 **0**、违规 **32 → 27**）| `lint:arch` / 探针 |
| T6 | 全量 `bun test`；落台账 D-153 + 更新 spec §5.7 | 全量 |

---

## 5. 风险与回滚

| 风险 | 缓解 |
|---|---|
| **注册时序**（未注册 ⇒ 提示词缺段，静默） | T4 用例锁定；`init.ts` 与既有 `systemPromptSections` 导入同处注册；评估是否加**一次性告警日志**（未注册即 `resolve` 时 warn） |
| `StaticPromptSectionName` 语义变化（数组推导 → 仍推导，但数组从 `DEFAULT_SECTIONS` 变为 `SECTION_NAMES`） | 保留 `satisfies Record<StaticPromptSectionName, SectionSpec>` 穷尽校验（比原守卫更严：原来只校验**段名登记**，现在同时校验**构建器齐备**） |
| `clearSystemPromptSections` 语义变化（service 缓存改为注册回调） | 回调注册与构建器同批（T2/T3），T4 覆盖 |
| 提示词内容回归 | 若 `tests/**` 有提示词快照用例则自动覆盖；否则 T4 加"段顺序与计数"断言 |
| 回滚 | 单次提交内完成；`git revert` 即可（不动数据库/配置） |

---

## 6. 备选方案（与已选方案的对比，记录以备复核）

| 方案 | infra→app | service→app | 评价 |
|---|---|---|---|
| **本方案（拆分）** | **−5（+−1 service 边）** | 0 | 唯一"真消除"；代价是注册时序改造 |
| 整体上移到 `context/`（已否） | −5 | **+4~5** | 只是搬运，净收益≈0 |
| 整体移动到 `services/prompt/`（未评估过） | −5（+ −1 service） | **+5** | 把 5 处边从「infra→app」改成「service→app」；**目标桶净减 6**，但属搬运，且 `service→app` 是下一个大桶（≈102）⇒ 不推荐 |

---

## 7. 合规检查清单

| 规则 | 检查点 | 结论 |
|---|---|---|
| R00-001 分层依赖 | `constants` 不得依赖 app/service；`context/`(app) 可依赖 service/infra | ✅ 本方案即为此设计 |
| R00-003 动态导入盲区 | `init.ts` 对 `constants/systemPromptSections` 的**动态**导入保持；不得改为静态跨层 | ✅ 维持现状 |
| R03-002 模块出口单一 | 不得以 `@modules/context/promptSections` 子路径直连 ⇒ 经 `context/index.ts` 转出；`constants` 侧 `systemPromptSections` 已是**既有**规范子入口（沿用） | ⚠️ T3 必须走 barrel |
| R04-001 文件大小 | 拆分后两文件均 < 上限（原 851 行拆分） | ✅ |
| R06-005 文件命名规范（GR02） | `context/promptSections/index.ts` 命名合规 | ✅ |
| R06-006 文件职责单一（GR03） | 框架 / 内置段落 / 缓存清理**三权分立**，本拆分的直接动机 | ✅ |
| R06-007 模块目录规范（GR04） | 归入既有 app 模块 `context/`（不新增顶层模块） | ✅ |
| R06-008 分层架构（GR07） | 见 R00-001 | ✅ |
| R06-010 模块公共 API（GR05） | `context/index.ts` 显式转出 `registerPromptSections` | ⚠️ T3 |
| R06-011 模块依赖规则（GR06） | 框架零出向依赖（仅 core/infra 类型） | ✅ |
| CS01 归一化 | 复用既有 `systemPromptSection`/`DANGEROUS_…` 工厂，不新建抽象 | ✅ |
| CS03 回退最小化 | 仅保留"未注册 ⇒ 空段"这一条真实降级（并有日志/测试锁定），不加多余兜底 | ✅ |
| CS05 根因优先 | 根因 = 文件承载两类职责跨层混装 ⇒ 拆分而非加豁免 | ✅ |

---

## 8. 未决（需批准时确认）

1. 是否同意 §3.5 的**注册时序**方案（`init.ts` 注册 + 未注册返回空段 + 告警日志）？
2. app 侧落位：`context/promptSections/`（本 spec 方案） 还是 新建顶层模块 `promptSections/`？
3. 若你更想先拿到"目标桶净减 6"而不做时序改造，可选 §6 第三行（搬运方案）——请明示。
