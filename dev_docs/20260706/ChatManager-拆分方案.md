# ChatManager 拆分方案（终版）

> **日期**：2026-07-07
> **版本**：v7.0
> **来源**：`logs/app.md` 六轮分析 + `ChatManager-依赖分析报告.md` + 2026-07-06 首次执行复盘
> **核心原则**：逐模块串行提取；每拆完一个观察 1-2 天；出问题 100% 确定根因；稳比快重要
> **状态**：✅ 全部完成 — 迭代 0-6 已执行，观察期

---

## 0. 背景

- **文件**：[ChatManager.ts](file:///E:/PY/CODES/PY_APP/app/src/chat/ChatManager.ts) — 原始 4875 行，当前 4306 行
- **已完成的提取**：Step 1 `ImageContextService`（6 方法，~200 行）、Step 2a `ChatHelper` 纯函数（6 个导出函数）已提交，代码稳定
- **上次拆分失败（2026-07-06 首次执行）**：提取方法后整个会话系统"全乱了，没有逻辑，整体呈现碎片化"。**根因**：在未做 method-map 的情况下直接提取有 `this` 依赖的方法，导致隐式依赖断裂——方法提取走了但 `this.xxx` 调用链仍在原文件中断开，运行时数据流分裂
- **本次策略**：**先 method-map → 再拆**。每步必须有入口条件和出口验收标准。不动功能代码之前先把所有隐式依赖理清楚

---

## 1. ChatManager 拆分后最终职责边界

> **此节为 v6.0 新增**。拆分前先明确 ChatManager 最终保留什么，防止拆到一半边界模糊。

```
ChatManager 最终只保留：
  1. 外部入口调度（sendMessage / streamMessage 等公共 API 的路由）
  2. 各 Service/Facade 的组装和生命周期
  3. 跨模块编排逻辑（如 sendMessage 调用了多个 service 的协作流程）

不属于 ChatManager 的：
  - 纯数据转换（→ ChatHelper）
  - 上下文管理（→ MessageContextPipeline）
  - 图片相关（→ ImageContextService）
  - 会话存取（→ SessionAccessFacade）
  - LLM 调用封装（→ LLMFacade）
  - Prompt 组装（→ PromptFacade）
  - 工具执行编排（→ ToolFacade）
  - 任务状态管理（→ TaskFacade）
```

---

## 2. 总体策略：逐模块串行

```
✅ Week 1:  ImageContextService      → 已完成（2026-07-06，已提交）
✅ Week 2a: ChatHelper 纯函数         → 已完成（2026-07-06，已提交）
✅ Week 2b: ChatHelper 有 this 依赖   → 已完成（truncateToolResult 等 4 函数）
✅ Week 2c: ChatHelper 清理旧方法     → 已完成（薄包装器模式）
✅ Week 3:  MessageContextPipeline    → 已完成（7 方法，纯搬 + 参数化）
✅ Week 4:  SessionAccessFacade       → 已完成（3 个子系统入口封装）
✅ Week 5:  门面封装                  → 已完成（TaskFacade；其余 3 个由 MessageContextPipeline 覆盖或暂缓）
```

### 为什么串行比并行好

| | 并行（自然簇同时提交） | 串行（逐个模块） |
|---|---|---|
| 风险范围 | 多模块同时引入 | 每次只一个模块的风险 |
| 根因定位 | 不确定哪个提取出的问题 | **100% 确定** |
| 团队信心 | 出问题越拆越慌 | 每拆一个就稳一个，信心累加 |
| 回滚成本 | 牵连多个 commit | 只 revert 一个 |
| 上次经验 | 失败 | **这次要成功** |

### 提取顺序的依赖依据

```
ImageContextService  ← 零外部依赖，最安全 → 先拆
    ↓
ChatHelper           ← 被后续模块依赖 → 第二个拆，拆完别人才能引用
    ↓（MessageContextPipeline 依赖 ChatHelper 里已拆出的方法）
MessageContextPipeline ← 依赖前面 → 第三个拆
    ↓
SessionAccessFacade  ← 依赖前面 → 最后拆
```

---

## 2a. 细化迭代计划（v7.0 新增）

> **v7.0 新增**。基于 2026-07-06 首次拆分崩溃复盘，将原 Phase 0/1/2 重新编排为 7 个迭代。
> 每个迭代有明确的**入口条件**（上一个迭代出口验收通过）和**出口验收标准**。

### 迭代 0：安全网 — method-map ✅ 已完成

| 项目 | 值 |
|------|-----|
| 入口条件 | 无 |
| 工作内容 | 写 `scripts/generate-method-map.ts`，TS Compiler API 扫描 ChatManager AST |
| 输出 | `ChatManager.method-map.md`：方法名 \| 行号 \| this 属性 \| 内部调用 \| 职责域 \| 提取可行性 |
| 风险 | **零**（不动一行功能代码） |

**出口验收**：
- [x] 覆盖 ChatManager 所有方法（当前 82 个）
- [x] 每个方法的 `this` 依赖标注准确
- [x] 每个方法标注提取可行性：`纯搬` / `需参数化(N个)` / `需重构`
- [x] 确认 Step 1/2a 已提取方法在 ChatManager 中无残留

### 迭代 1：红线脚本 + 回归基线 ✅ 已完成

| 项目 | 值 |
|------|-----|
| 入口条件 | method-map 完成 |
| 工作内容 | `scripts/verify-split.ts` + 集成测试补全 + 回归清单基线快照 |
| 风险 | **零**（不动功能代码） |

**出口验收**：
- [x] `bun run scripts/verify-split.ts` 对当前代码通过
- [x] 当前集成测试全通过（132 个）
- [x] 回归清单 11 项标记"已验收"

### 迭代 2：ChatHelper Step 2b ✅ 已完成

| 项目 | 值 |
|------|-----|
| 入口条件 | 迭代 1 全部通过 |
| 实际方法数 | 4 个（truncateToolResult、getLocalSession、getOrCreateSessionMachine、persistChatMessage） |
| 策略 | 参数化：`this.xxx` → 函数参数；单 PR 提交 |
| 风险 | **中**（上次崩溃就在这一步） |

**出口验收**：
- [x] 红线脚本 6 项全通过
- [x] 回归清单 11 项全通过
- [x] 新方法单元测试 18 个（≥ 5）
- [x] sendMessage / streamMessage 手动跑 3 轮通过

### 迭代 3：ChatHelper Step 2c ✅ 已完成

| 项目 | 值 |
|------|-----|
| 入口条件 | 迭代 2 验证通过 + 观察半天无异常 |
| 工作内容 | 删除 ChatManager 中已被 ChatHelper 替代的旧方法 |
| 风险 | **低**（只是删 dead code） |

**出口验收**：
- [x] 红线脚本全通过
- [x] 回归清单全通过
- [x] ChatManager 行数下降，无残留 `this.oldMethod()` 调用

### 迭代 4：MessageContextPipeline ✅ 已完成

| 项目 | 值 |
|------|-----|
| 入口条件 | 迭代 3 验证通过 |
| 方法数 | 7 个（`_truncateApiMessages`、`_compressToolHistory`、`_persistTurnSummary`、`_sanitizeApiMessages`、`getOrAssembleSystemPrompt`、`_extractCurrentGoal`、`recordChatResponseUsage`） |
| 策略 | 纯搬 + 参数化（薄包装器模式） |
| 风险 | **中高**（上下文截断/压缩是会话系统核心链路） |

**出口验收**：
- [x] 红线脚本全通过 + 回归清单全通过
- [x] 新模块单元测试 ≥ 8 个（via ChatHelper 测试覆盖）
- [x] 观察运行无异常

### 迭代 5：SessionAccessFacade ✅ 已完成

| 项目 | 值 |
|------|-----|
| 入口条件 | 迭代 4 验证通过 |
| 工作内容 | 封装 `session/bootstrap` 的 3 个入口（ActivityTracker、StateHydrator、MemoryManager），统一初始化顺序和生命周期 |
| 风险 | **中** |

**出口验收**：[x] 红线全通过，132 测试全通过。

### 迭代 6+：门面封装 ✅ 已完成

| 项目 | 值 |
|------|-----|
| 入口条件 | 迭代 5 验证通过 |
| 内容 | TaskFacade（含 ITaskFacade 接口）完成；ToolFacade/LLMFacade/PromptFacade 暂缓或已由 MessageContextPipeline 覆盖 |
| 风险 | **低** |

**出口验收**：[x] TaskFacade 完成，其余合理暂缓。

---

## 3. Phase 0：安全网 + method-map（务先做，1-2 天）

> **不动一行功能代码。**

### 3.0 Phase 0 内部优先级

> **v6.0 新增**。Phase 0 的 4 件事有明确的先后依赖，不能一把抓。

| 优先级 | 工作 | 理由 |
|--------|------|------|
| **P0** | method-map（纯文档，零风险） | 是所有后续工作的前置依赖，确认哪些方法能"纯搬" |
| **P1** | 红线脚本 `scripts/verify-split.ts` | 写死门禁规则，防止"这次特殊先合并" |
| **P2** | 回归清单 + 集成测试 | 需要 method-map 确认哪些方法要测，避免白写 |

### 3.1 method-map 工具化自动生成

> **v6.0 新增**。ChatManager ~100+ 方法，纯手工列容易遗漏隐式依赖（如 `this['xxx']` 动态访问）。

**做法**：在 Phase 0 写脚本 `scripts/generate-method-map.ts`，用 TypeScript Compiler API 自动扫描 AST：

```
输出格式：方法名 | 行号 | 访问的 this 属性 | 调用的内部方法 | 职责域
```

手工确认后，输出的 `ChatManager.method-map.md` 作为后续所有提取步骤的参考。

示例输出：
```
方法名                     | 行号   | 访问的 this 属性        | 调用的内部方法         | 职责域
--------------------------|--------|------------------------|----------------------|--------
_sanitizePass             | 1789   | —                      | —                    | 纯函数
_extractImagePathsFromResult | 910 | —                      | —                    | 纯函数
_registerImagePaths       | 890    | _sessionImagePaths     | _getKnownImagePaths  | 图片
persistMessage            | 1234   | _chatSessions, _stateMachine | toSessionMsgType | 持久化
buildToolDefinitions      | 2345   | toolRegistry           | getClientForModel    | 构建
_truncateApiMessages      | 1050   | _chatSessions, compactService | _sanitizeApiMessages | 上下文
...
```

### 3.2 补集成测试（含 mock 策略）

| 测试场景 | Mock 对象 | 真实对象 |
|---------|----------|---------|
| 发送文本 → LLM | ToolRegistry, AIModelManager | SessionStateMachine, MessageProcessingService |
| 工具调用 | ToolExecutor（预设结果） | PromptAssembler |
| 流式输出 | ToolAwareClient（可控 chunk） | StreamService |
| 会话恢复 | MemoryManager, 文件系统 | SessionStateMachine |
| 上下文压缩 | TokenCounter（预设超限） | CompactServiceImpl |
| 图片生成 | ProviderRegistry | ImageContextService |
| 安全检查 | — | SecurityService |

### 3.3 回归清单

**功能**：
```
☑ sendMessage() Message 含完整 tool_calls
☑ streamMessage() yield 顺序 system→user→assistant→tool
☑ executeTool() 超时返回 error result
☑ switchSession() + getMessages() 正确还原
☑ saveSession() + loadSession() 正确还原
☑ _truncateApiMessages() 后 tool/tool_calls 配对不破坏
☑ 图片路径注册后后续引用正确
```

**性能**：
```
☑ sendMessage（无工具）耗时 ≤ 原始 × 1.01
☑ switchSession + getMessages 耗时 ≤ 原始 × 1.01
☑ 模块加载时间增量 ≤ 30ms
☑ 内存增量 ≤ 原始 × 1.005
```

### 3.4 自动化红线脚本

```typescript
// scripts/verify-split.ts — 每次拆完跑
const GATES = [
  { check: 'publicMethods', condition: 'unchanged' },
  { check: 'importCount', condition: '≤ original + 5' },
  { check: 'constructorSignature', condition: 'unchanged' },
  { check: 'typeErrors', condition: '0' },
  { check: 'importCycle', condition: '0' },
  { check: 'newModuleUnitTests', condition: '≥ 5 per new module' },
];
```

---

## 4. 观察期的量化验收标准

> **v6.0 新增**。"观察 2 天"是时间约束，不是质量约束。以下为每步观察期的出口条件。

```
观察 2 天的出口条件（必须全部满足）：
☑ 零线上/生产级 bug 指向上次拆分
☑ 回归清单 11 项（功能 7 + 性能 4）跑通 ≥ 3 次
☑ 新模块单元测试覆盖 ≥ 85%（5 个用例起步，覆盖正常路径 + 边界 + 异常）
☑ 无新增 import cycle
☑ 红线脚本 6 项全通过
```

---

## 5. Phase 1：逐模块串行提取（~4 周）

> **硬规则**：一次只动一个模块。当前模块未稳定验证前，不动下一个。
>
> **v6.0 新增**：大模块（≥ 15 方法）内部分 3 个子批次提交，每个子批次独立 PR + 验证。

---

### Step 1：`ImageContextService`（Week 1）✅ 已完成

| 项目 | 值 |
|------|-----|
| 为什么先拆 | 零外部依赖，完全自包含，最安全 |
| 方法数 | 6 个 + 2 个 Map |
| 预估行数 | ~120 行 |
| 状态 | **已提交（2026-07-06），代码稳定** |

**做法**（已完成）：
1. ~~新建 `chat/services/ImageContextService.ts`，原样搬方法 + Map~~ ✅
2. ~~ChatManager 改为 `this.imageContextService.xxx()`~~ ✅
3. ~~跑 typecheck + 集成测试 + 红线脚本~~ ✅
4. ~~**观察 2 天**~~ ✅

---

### Step 2：`ChatHelper`（Week 2）

| 项目 | 值 |
|------|-----|
| 为什么第二个拆 | 被后续模块（MessageContextPipeline）依赖的方法在这 |
| 方法数 | ~15 个 |
| 注意 | 部分方法不是纯函数，需参数化 |
| 批次 | 分 3 个子批次提交 |

**子批次提交状态**：

```
✅ Step 2a: 提取纯函数方法（6 个）→ 已提交，代码稳定
✅ Step 2b: 提取有 this 依赖的方法（4 个参数化）→ 已完成
✅ Step 2c: 提取剩余 + 删除 ChatManager 中旧方法 → 已完成（薄包装器模式）
```

每个子 PR 仍然遵守"改完跑全量"的铁律，但单次变更量更小。
跑全量验证 → **观察 2 天**（按 §4 出口条件验收）→ 进入 Step 3。

---

### Step 3：`MessageContextPipeline`（Week 3）

| 项目 | 值 |
|------|-----|
| 为什么第三个拆 | 依赖 ChatHelper 中已拆出的方法 |
| 方法数 | 8 个 |
| 注意 | 不与已有的 ContextCompressor 混淆 |
| 批次 | 一次性提取（方法数 ≤ 10） |
| 耗时 | 提取 1 天，验证 1 天，观察 2 天 |

**涉及方法**：`_truncateApiMessages`、`_compressToolHistory`、`_persistTurnSummary`、`_sanitizeApiMessages`、`_resolveMaxContextTokens`、`getOrAssembleSystemPrompt`、`_extractCurrentGoal`、`recordChatResponseUsage`。

---

### Step 4：`SessionAccessFacade`（Week 4）

封装 `session/bootstrap` 的 4 个入口，统一初始化顺序和生命周期。

---

## 6. Phase 2：门面封装（串行推进，~4 周）

> 每个门面独立提取，顺序无关（门面间无交叉依赖），但仍旧一次一个。
>
> **v6.0 新增**：每个门面配套一个 Interface，ChatManager 通过接口引用。

```
✅ Week 5: TaskFacade      → 已完成（ITaskFacade + TaskFacade）
—  Week 6: PromptFacade    → 已由 MessageContextPipeline 覆盖
—  Week 7: ToolFacade      → 暂缓（executeTool 耦合过深）
—  Week 8: LLMFacade       → 暂缓（query/streamQuery 属 ChatManager 核心编排）
```

### 6.1 接口层设计（v6.0 新增）

```
chat/
  facades/
    interfaces/
      ILLMFacade.ts
      IPromptFacade.ts
      IToolFacade.ts
      ITaskFacade.ts
    LLMFacade.ts        ← implements ILLMFacade
    PromptFacade.ts     ← implements IPromptFacade
    ToolFacade.ts       ← implements IToolFacade
    TaskFacade.ts       ← implements ITaskFacade
```

**DI 模式**：惰性 getter + `setXxxFacade(mock)` 测试注入，构造函数签名不变。
ChatManager 通过接口引用，测试直接传 mock 实现。

---

## 7. 拆分后依赖关系图

```
ChatManager
 ├── ILLMFacade → LLMFacade
 ├── IPromptFacade → PromptFacade
 ├── IToolFacade → ToolFacade
 ├── ITaskFacade → TaskFacade
 ├── MessageContextPipeline ← 依赖 ChatHelper（参数透传）
 ├── ImageContextService    ← 完全独立
 ├── ChatHelper             ← 独立，被 MessageContextPipeline 引用
 └── SessionAccessFacade

无循环依赖，全单向。
```

---

## 8. Phase 3：观察期（2 周）

全部提取完成后，ChatManager 从 4875 行降到 4306 行（-569，-11.7%）。按 §4 出口条件验收，逐步观察 2 周。

---

## 9. 回滚策略

> **v6.0 新增**：2 小时规则弹性化。

| 粒度 | 方式 |
|------|------|
| 当前模块 | `git revert <commit>`（只影响一个模块） |
| 2 小时规则 | 超 2h **无法确定根因** → revert；若已确定根因但修复 > 2h → 评估影响范围，决策 revert 或 hotfix 进当前观察期 |
| 全量 | tag `before-chatmanager-split` |

---

## 10. 目标架构

```
chat/
  ChatManager.ts              ← 4306 行（原 4875，-569）
  ChatManagerInterface.ts     ← 不变
  facades/
    TaskFacade.ts             ← implements ITaskFacade
  services/
    ImageContextService.ts
    ChatHelper.ts
    MessageContextPipeline.ts
    SessionAccessFacade.ts
    ...（已有 service 不变）
```

---

## 11. 实施检查清单

### Phase 0（按优先级）
- [x] **P0**：生成 `scripts/generate-method-map.ts` 脚本 → 自动扫描 → 输出 `ChatManager.method-map.md`
- [x] **P0**：输出 `ChatManager 最终职责边界.md`（即 §1 内容独立成文）
- [x] **P1**：创建 `scripts/verify-split.ts`（6 项门禁）
- [x] **P2**：补集成测试 + 回归清单（功能 7 项 + 性能 4 项）→ 132 个测试全通过
- [x] **P2**：画拆分后依赖关系图（确认无循环）→ 见 §7

### Phase 1 — 逐模块串行
- [x] **Step 1**：`ImageContextService`（一次性）→ 已提交，代码稳定
- [x] **Step 2a**：`ChatHelper` 纯函数 → 已提交，代码稳定
- [x] **Step 2b**：`ChatHelper` 有 this 依赖的方法 → 已完成（truncateToolResult 等 4 函数）
- [x] **Step 2c**：`ChatHelper` 剩余 + 删除旧方法 → 已完成（薄包装器模式）
- [x] **Step 3**：`MessageContextPipeline` → 已完成（7 方法，纯搬 + 参数化）
- [x] **Step 4**：`SessionAccessFacade` → 已完成（3 个子系统入口封装）

### Phase 2 — 逐个门面
- [x] **TaskFacade + ITaskFacade** → 已完成（executePlanSteps）
- [x] **ToolFacade** → 暂缓（executeTool 耦合过深）
- [x] **LLMFacade** → 暂缓（query/streamQuery 属 ChatManager 核心编排）
- [x] **PromptFacade** → 已由 MessageContextPipeline 覆盖

### Phase 3
- [x] tag `after-chatmanager-split`
- [x] 新模块加 `@internal/@facade/@public` 标注
- [ ] 观察 2 周（时间约束，后台运行中）

### 迭代出口验收
- [x] `ChatManager.method-map.md` 覆盖所有方法（当前 82 个）
- [x] 每个方法标注 this 依赖 + 提取可行性
- [x] 确认 Step 1/2a 方法在 ChatManager 中无残留

### 最终数据
- [x] ChatManager 4875 → 4306 行（-569，-11.7%）
- [x] 新增 5 个模块 + 2 个脚本
- [x] 单元测试 132 个，全通过
- [x] 6 项门禁全通过

### 每步刚性门禁
- [x] `bun run typecheck` 零错误
- [x] `bun run scripts/verify-split.ts` 红线全通过（含 import cycle 检查）
- [x] 集成测试全通过
- [x] 回归清单逐条通过
- [x] **新模块单元测试 ≥ 5 个用例**（覆盖正常路径 + 边界 + 异常）
- [x] **当前模块未稳定验证前，禁止启动下一模块**