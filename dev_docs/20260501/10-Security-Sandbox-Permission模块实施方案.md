# Security-Sandbox-Permission 模块实施方案

**文件目的**: 为Security、Sandbox、Permission模块提供完整的实施方案
**最后更新**: 2026-05-01
**维护者**: PY_APP开发团队

---

## 目录
1. [行为准则（CLAUDE.md）](#1-行为准则-claudemd)
2. [项目规则（project_rules.md）](#2-项目规则-project_rulesmd)
3. [模块开发快速参考（module_development_quick_reference.md）](#3-模块开发快速参考-module_development_quick_referencemd)
4. [模块管理规则（module_management_rules.md）](#4-模块管理规则-module_management_rulesmd)

---

## 1. 行为准则（CLAUDE.md）

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1.1 Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 1.2 Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 1.3 Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 1.4 Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## 2. 项目规则（project_rules.md）

### 2.1 基础规则

#### 2.1.1 安全与合规
- **敏感信息保护**: 严禁在代码中硬编码敏感信息
- **版权问题**: 当前应用中禁止出现任何Anthropic相关内容，例如CLAUDE这类的，请将默认的CLAUDE，改为PY_APP
- **数据保护**: 严禁删除数据及数据库结构，仅允许新增或修改数据库表字段

#### 2.1.2 开发规范
- **版本控制**: 请使用Git进行版本控制
- **数据使用**: 项目中，严禁使用模拟数据，请使用真实数据
- **地址配置**: 前后端通信时，严禁在代码文件中使用硬编码地址，请使用环境变量
- **代码复用**: 项目中的各种方法严禁出现重复情况，尽量归一化调用，要求可复用、可继承
- **技术路线**: 统一使用TypeScript + Rust进行开发

#### 2.1.3 文件管理
- **数据库文件**: 位于 `backend/data/py_copilot.db`
- **测试文件**: 请保存在 `backend/testing/` 目录下

### 2.2 模块管理规则

#### 2.2.1 模块导入规范
- **必须使用别名路径**: 所有模块导入必须使用 `@modules/模块名` 格式
- **禁止使用相对路径**: 严禁在代码中使用 `../../` 等深度相对路径
- **模块注册要求**: 新模块必须在 `ModuleDefinitions.ts` 中注册

#### 2.2.2 模块分类标准
- **8个标准分类**: 所有模块必须按照以下分类组织：
  - 核心模块 (core, infrastructure)
  - 功能模块 (ai, agent, bridge)
  - 界面模块 (ui, cli)
  - 工具模块 (tools, commands)
  - 数据模块 (memory, cache)
  - 系统模块 (security, performance, monitoring)
  - 其他模块 (analytics, buddy, chat等)

#### 2.2.3 开发检查清单
开发新功能时，必须检查以下事项：
- [ ] 使用了正确的别名路径导入
- [ ] 模块在 ModuleDefinitions.ts 中注册
- [ ] 选择了正确的模块分类
- [ ] 声明了所有依赖关系
- [ ] 编写了相应的测试用例

### 2.3 开发流程规范

#### 2.3.1 严禁重复造轮子
- 新功能开发前必须检查是否已有类似实现
- 发现重复代码必须立即整合，不得保留重复实现
- 禁止在不同位置创建功能相同的模块
- 代码审查时必须检查是否存在重复实现
- 定期进行代码重复检测和清理

#### 2.3.2 先设计原则
- 要求在用户提出新需求时，先编制设计MD文件到 `dev_docs/` 目录的当前日期文件夹下
- 在用户确认设计文档后，再编制实施方案

#### 2.3.3 开发任务要求
- 要求完成一个任务，测试一个任务，标注一个任务
- 采用小步快跑，快速验证的开发模式

### 2.4 实施原则

#### 2.4.1 核心原则

##### 2.4.1.1 严禁重复造轮子
- 先学习CC源码的完整实现
- 直接复用CC源码中的成熟方案
- 不自行设计已有的功能模块
- 仅在CC源码基础上做适配性修改

##### 2.4.1.2 仅学习CC源码，不修改CC源码
- **严禁修改 `cc_code/` 文件夹下的任何文件**
- CC源码仅作为学习参考和设计参考
- 所有代码修改仅限 `backend/src/` 目录

##### 2.4.1.3 先设计后开发
- 每个阶段先完成详细设计
- 设计文档需用户确认后再编码
- 确保方向正确再执行

##### 2.4.1.4 小步快跑，快速验证
- 分解为可独立验证的小任务
- 完成一个任务，测试一个任务
- 及时发现问题，及时调整

##### 2.4.1.5 不删除现有代码
- 仅新增或修改，不删除
- 保持向后兼容
- 确保现有功能正常运行

##### 2.4.1.6 学习-执行-测试-标注
- 每个任务先学习CC源码对应部分
- 理解透彻后再执行编码
- 完成后立即测试验证
- 标注完成状态和遇到的问题

#### 2.4.2 质量原则

##### 2.4.2.1 代码质量
- 遵循项目现有代码风格
- 添加必要的函数级注释
- 保持代码可读性

##### 2.4.2.2 测试覆盖
- 每个功能都要有测试
- 确保核心路径覆盖
- 异常情况测试

##### 2.4.2.3 文档完善
- 关键设计决策要有记录
- API文档完整
- 使用示例清晰

### 2.5 实施策略

#### 2.5.1 整体策略
采用**渐进式增强**策略：
1. 保持现有系统正常运行
2. 在现有基础上逐步增强
3. 每个阶段独立可交付
4. 分阶段验证，降低风险

#### 2.5.2 学习策略
每个任务执行前，必须完成CC源码学习：

**重要提醒**:
- ⚠️ **仅阅读和学习CC源码，绝对不要修改 `cc_code/` 文件夹下的任何文件**
- ⚠️ 建议将 `cc_code/` 文件夹设置为只读属性，防止误修改
- ⚠️ 所有代码实现都在 `backend/src/` 目录下完成

**学习步骤**:
1. 阅读CC源码对应文件（只读）
2. 理解设计思路和实现细节
3. 记录关键知识点
4. 确认理解后再开始编码

#### 2.5.3 任务管理策略
采用**学习-执行-测试-标注**四步流程：

```
学习CC源码 → 执行编码 → 测试验证 → 标注完成
    ↓           ↓          ↓          ↓
  理解透彻     实现功能   确保正确   记录状态
```

每个任务都要：
1. ✅ 先学习CC源码
2. ✅ 再执行编码
3. ✅ 然后测试验证
4. ✅ 最后标注完成状态

### 2.6 架构哲学与设计原则

#### 2.6.1 Harness 驱动哲学

**真正的难点不在模型，而在模型之外的 Harness**。Harness 是包裹 LLM 的本地运行时外壳，让 AI 拥有在真实世界行动的"躯体"。

架构演进三代路径：
1. **第一代 Chatbot**：无状态问答
2. **第二代 Workflow**：代码驱动的 DAG 流
3. **第三代 Autonomous Agent**：**模型控制循环，运行时只是执行器**

核心原则：**运行时越笨，架构越稳定**——把智能下沉到模型，把确定性留给框架。

#### 2.6.2 TAOR 循环设计原则

TAOR (Think-Act-Observe-Repeat) 是执行引擎的核心，遵循以下原则：
- Orchestrator 极其愚蠢：只负责驱动循环、执行工具、感知结果
- 所有推理、决策、何时停止，全部交给模型
- 运行时不知道代码逻辑、不知道文件在哪，只是跑循环

#### 2.6.3 上下文管理策略（三级压缩 + 熔断器）

| 压缩级别 | 触发条件 | 策略 |
|----------|----------|------|
| Level 1: 轻量压缩 | Token 使用率 > 50% | 清理旧工具结果 |
| Level 2: 自动压缩 | Level 1 不足 | 用 LLM 摘要替换历史 |
| Level 3: 强制压缩 | 达到 API 限制 | 激进裁剪上下文 |
| **熔断器** | 连续失败 3 次 | 停止压缩，防止死循环 |

#### 2.6.4 工具设计哲学

**给模型一个 Shell，而非 100 个工具**——让模型自己组合：

- 核心工具（5个）：Bash、Read、Write、Search、ToolSearch——**始终加载，永不延迟**
- MCP 工具：**默认延迟加载**——模型通过 ToolSearchTool 发现时才加载完整定义
- ToolSearchTool 自身永不延迟——保证工具发现链不中断

#### 2.6.5 权限五档信任光谱

| 级别 | 说明 | 适用场景 |
|------|------|----------|
| `plan` | 只读，完全不能写入 | 需求分析阶段 |
| `default` | 编辑和 shell 操作前需询问 | 日常开发 |
| `acceptEdits` | 自动批准编辑，shell 需询问 | 信任的文件编辑 |
| `dontAsk` | 自动批准白名单内操作 | 高信任环境 |
| `bypass` | 跳过所有检查 | 仅托管组织 |

**提前决策机制**：分类器在弹窗前判断——高置信度直接决定，低置信度弹窗询问——消除用户等待。

#### 2.6.6 记忆系统六层架构

| 层级 | 内容 | 说明 |
|------|------|------|
| Layer 1 | 组织级策略 | 企业规范，ManagedPolicy |
| Layer 2 | 项目配置 | PY_APP.md 项目规则文件 |
| Layer 3 | 用户偏好 | 用户个人配置和习惯 |
| Layer 4 | 自动学习模式 | Auto-Memory：从历史交互学习 |
| Layer 5 | 会话上下文 | 当前对话的上下文 |
| Layer 6 | 子Agent记忆 | 独立的子任务记忆（用完即弃） |

#### 2.6.7 Sub-Agent 上下文隔离

Sub-Agent 的核心价值是**用完即弃**——花几万 token 做子任务，只把结论返回主 Agent，中间过程全扔掉。

四种隔离级别：
- `process`：独立进程，最轻量
- `worktree`：Git worktree 隔离，文件系统独立
- `machine`：跨机器执行，最高安全
- `sandbox`：形式化沙箱抽象（backend 领先能力）

#### 2.6.8 TypeScript 与 Rust 的边界划分

| 层级 | 语言 | 职责 |
|------|------|------|
| **编排层** | TypeScript | 驱动循环、执行工具、调用 API（I/O 密集，生态优势） |
| **性能核心** | Rust | Token 计算、AST 解析、安全分析、上下文压缩、终端渲染 |
| 通信机制 | FFI (napi-rs) | 直接调用 Rust 编译的动态库，性能最高 |

#### 2.6.9 启动时序优化策略（并行预加载）

```
T0: 立即返回启动进度
T1: 并行预加载：Keychain 预取 + API 预连接 + Rust 核心预热
T2: 解析命令行（依赖轻量模块）
T3: 最多等 100ms，激活备用屏幕渲染启动界面
T4: 后台加载剩余模块（不阻塞用户输入）
```

### 2.7 安全必做项

> 参考 cc_code `bashSecurity.ts` 的 23 项检查，以下为必须实现的安全检查：

- [ ] 阻止危险 Zsh 内置命令
- [ ] 防御 Zsh equals expansion（`=curl` 绕过）
- [ ] Unicode 零宽字符注入检测
- [ ] IFS null-byte 注入防护
- [ ] 环境变量污染检测
- [ ] 阻止 `rm -rf /` 等破坏性操作
- [ ] Shell 命令转义和引号验证

### 2.8 生产化 Checklist

#### 2.8.1 必须实现的能力

| 能力 | 优先级 | 说明 |
|------|--------|------|
| 会话持久化 | P0 | Checkpoint + Rollback，如 git branch |
| 成本追踪 | P0 | 每个请求记录 token 消耗 |
| 遥测系统 | P1 | OpenTelemetry 集成 |
| Hook 系统 | P1 | 多个事件节点，支持脚本拦截 |
| MCP 协议 | P1 | 支持 Stdio/SSE/HTTP/WebSocket |
| 企业级认证 | P2 | OAuth 2.0 + JWT |

#### 2.8.2 六层架构全景图

```
┌─────────────────────────────────────────────────────────────┐
│                        用户层                                │
│  CLI / IDE Extension / SDK / Headless Mode                 │
├─────────────────────────────────────────────────────────────┤
│                        界面层                                │
│  Ink Renderer / Commander.js / REPL / Slash Commands       │
├─────────────────────────────────────────────────────────────┤
│                   核心引擎层 (TypeScript)                    │
│  QueryEngine / TAOR Loop / 权限系统 / 会话管理              │
├─────────────────────────────────────────────────────────────┤
│                   工具能力层 (TypeScript + Rust)             │
│  Bash / FileSystem / Search / MCP / SubAgent               │
├─────────────────────────────────────────────────────────────┤
│                   基础设施层 (Rust 核心)                     │
│  Token Counter / KV Cache / Context Compression / Auth     │
├─────────────────────────────────────────────────────────────┤
│                        外部层                                │
│  LLM API / MCP Servers / OS Shell / Git                    │
└─────────────────────────────────────────────────────────────┘
```

#### 2.8.3 技术栈选型理由

| 层级 | 技术选型 | 选型理由 |
|------|----------|----------|
| **编排层** | TypeScript + Bun | 50万行规模验证，启动极快，生态丰富 |
| **性能核心** | Rust | 代码解析、token计算、终端渲染等性能敏感路径 |
| **终端UI** | React + Ink | 组件化终端开发，行业标准方案 |
| **校验层** | Zod v4 | 贯穿全链路，为每个工具定义运行时Schema |
| **协议层** | MCP + LSP | 行业标准，支持动态扩展 |
| **认证** | OAuth 2.0 / JWT | Keychain安全令牌管理 |

### 2.9 相关文档

#### 2.9.1 模块管理相关
- [模块管理规则](./module_management_rules.md) - 完整模块管理规范
- [模块开发快速参考](./module_development_quick_reference.md) - LLM开发指南

#### 2.9.2 开发规范相关
- [模块开发规范](../backend/docs/模块开发规范.md)
- [模块管理使用指南](../backend/docs/模块管理使用指南.md)

#### 2.9.3 架构设计相关
- [从零构建生产级 AI Agent 架构指南](../dev_docs/20260416/01%20初始化.md) - 完整架构设计文档

### 2.10 特别说明

#### 2.10.1 系统集成说明
CC源码中的KAIROS系统已被Chronos系统替换，相关模块仅与Chronos系统集成。KAIROS系统已从系统中移除，仅保留了Chronos系统。

#### 2.10.2 实施方案要求
在编制实施方案时，必须包含以下内容：
- 实施原则和策略
- 详细的任务分解
- 质量保证措施
- 风险评估和应对方案

---

## 3. 模块开发快速参考（module_development_quick_reference.md）

### 3.1 快速开始

#### 3.1.1 核心原则（必须遵守）

1. **模块导入必须使用别名路径**
   ```typescript
   // ✅ 正确
   import { Agent } from '@modules/agent';
   import { AI } from '@modules/ai';
   
   // ❌ 错误
   import { Agent } from '../../agent/agent.ts';
   ```

2. **新模块必须在ModuleDefinitions.ts中注册**
3. **必须按照8个标准分类组织模块**
4. **必须明确声明模块依赖关系**

### 3.2 模块分类标准

#### 3.2.1 8个标准分类

| 分类 | 标识 | 描述 | 关键模块 |
|------|------|------|----------|
| 核心模块 | `core` | 基础架构 | core, infrastructure |
| 功能模块 | `ai` | AI功能 | ai, agent, bridge |
| 界面模块 | `ui` | 用户界面 | ui, cli |
| 工具模块 | `tools` | 工具管理 | tools, commands |
| 数据模块 | `memory` | 数据存储 | memory, cache |
| 系统模块 | `security` | 系统功能 | security, performance |
| 其他模块 | `other` | 其他功能 | 剩余15个模块 |

### 3.3 开发流程

#### 3.3.1 创建新模块步骤

1. **确定模块分类**
   ```typescript
   // 在ModuleDefinitions.ts中添加
   'my-new-module': {
     id: 'my-new-module',
     name: 'my-new-module',
     displayName: '我的新模块',
     version: '1.0.0',
     category: ModuleCategory.OTHER, // 选择合适的分类
     description: '模块功能描述',
     dependencies: ['core', 'infrastructure'], // 声明依赖
     optionalDependencies: []
   }
   ```

2. **创建模块目录结构**
   ```
   src/my-new-module/
   ├── index.ts           # 模块入口
   ├── types/             # 类型定义
   ├── services/          # 服务实现
   ├── utils/             # 工具函数
   └── README.md          # 模块文档
   ```

3. **实现模块入口**
   ```typescript
   // src/my-new-module/index.ts
   export * from './types';
   export * from './services';
   export * from './utils';
   export { MyService } from './services/MyService';
   ```

4. **使用别名路径导入**
   ```typescript
   // 在其他模块中使用
   import { MyService } from '@modules/my-new-module';
   ```

### 3.4 代码规范

#### 3.4.1 导入规范

**必须使用别名路径**:
```typescript
// ✅ 正确示例
import { Agent } from '@modules/agent';
import { AI } from '@modules/ai';
import { importModule } from '@modules/modules';

// 批量导入
import { importManager } from '@modules/modules';
const modules = await importManager.importMultiple([
  '@modules/core',
  '@modules/ai',
  '@modules/agent'
]);
```

#### 3.4.2 错误处理规范

```typescript
import { ModuleError } from '@modules/errors';

try {
  await module.initialize();
} catch (error) {
  throw new ModuleError(
    `初始化失败: ${error.message}`,
    'module-id',
    'INIT_FAILED'
  );
}
```

### 3.5 开发工具

#### 3.5.1 常用命令

```bash
# 测试模块系统
bun run modules:test

# 分析模块状态
bun run modules:analyze

# 执行模块迁移
bun run modules:migrate

# 验证依赖关系
bun run modules:validate

# 完整检查
bun run modules:check
```

#### 3.5.2 迁移工具使用

```bash
# 分析迁移状态
bun run scripts/migrate-modules.ts

# 执行迁移（谨慎使用）
bun run scripts/migrate-modules.ts --execute
```

### 3.6 常见错误和解决方案

#### 3.6.1 错误1: 模块找不到
```
Error: Module xxx not found
```
**解决方案**: 
- 检查模块是否在 `ModuleDefinitions.ts` 中注册
- 运行 `bun run modules:analyze` 分析问题

#### 3.6.2 错误2: 循环依赖
```
Error: Circular dependency detected
```
**解决方案**:
- 运行 `bun run modules:validate` 分析依赖
- 重构模块设计，提取公共功能

#### 3.6.3 错误3: 导入路径错误
```
Error: Cannot find module
```
**解决方案**:
- 确保使用 `@modules/模块名` 格式
- 检查别名路径映射是否正确

### 3.7 模块统计信息

#### 3.7.1 当前模块状态
- **总模块数**: 25个标准模块
- **核心模块**: 2个 (core, infrastructure)
- **功能模块**: 3个 (ai, agent, bridge)
- **界面模块**: 2个 (ui, cli)
- **工具模块**: 2个 (tools, commands)
- **数据模块**: 2个 (memory, cache)
- **系统模块**: 3个 (security, performance, monitoring)
- **其他模块**: 11个 (analytics, buddy, chat等)

#### 3.7.2 依赖关系关键信息
- **核心依赖**: 所有模块都依赖 core 模块
- **重要依赖链**: core → infrastructure → 其他模块
- **复杂模块**: agent 依赖 ai, chat 依赖 ai 和 memory

### 3.8 LLM开发重点提醒

#### 3.8.1 必须遵守的规则

1. **导入路径**: 必须使用 `@modules/模块名` 格式
2. **模块注册**: 新模块必须在 `ModuleDefinitions.ts` 中定义
3. **分类标准**: 必须按照8个标准分类选择
4. **依赖声明**: 必须明确声明所有依赖关系
5. **测试要求**: 新功能必须包含测试用例

#### 3.8.2 开发检查清单

开发新功能时，请检查以下事项：

- [ ] 使用了正确的别名路径导入
- [ ] 模块在 ModuleDefinitions.ts 中注册
- [ ] 选择了正确的模块分类
- [ ] 声明了所有依赖关系
- [ ] 编写了相应的测试用例
- [ ] 更新了模块文档
- [ ] 运行了模块系统测试

### 3.9 相关文档

- [完整模块管理规则](./module_management_rules.md)
- [模块开发规范](../backend/docs/模块开发规范.md)
- [模块使用指南](../backend/docs/模块管理使用指南.md)

---

**重要**: 在开发过程中遇到任何问题，请优先参考此快速参考指南和完整的模块管理规则文档。

---

## 4. 模块管理规则（module_management_rules.md）

### 4.1 模块管理概述

#### 4.1.1 模块管理系统架构

PY_APP采用统一的模块管理系统，包含以下核心组件：

- **模块注册表** (`src/modules/ModuleRegistry.ts`) - 管理模块注册、查找和依赖解析
- **导入管理器** (`src/modules/ImportManager.ts`) - 统一管理模块导入路径
- **模块定义** (`src/modules/ModuleDefinitions.ts`) - 统一定义所有模块信息
- **模块初始化器** (`src/modules/ModuleInitializer.ts`) - 管理模块生命周期

#### 4.1.2 核心设计原则

1. **统一管理**: 所有模块必须通过模块管理系统进行管理
2. **标准分类**: 模块按功能分为8个标准类别
3. **依赖管理**: 自动解析模块依赖关系，避免循环依赖
4. **别名路径**: 统一使用 `@modules/模块名` 格式的别名路径

### 4.2 模块分类标准

#### 4.2.1 模块分类定义

所有模块必须按照以下分类进行组织：

| 分类 | 标识 | 描述 | 示例模块 |
|------|------|------|----------|
| 核心模块 | `core` | 核心功能模块 | core, infrastructure |
| 功能模块 | `ai` | AI相关功能 | ai, agent, bridge |
| 界面模块 | `ui` | 用户界面相关 | ui, cli |
| 工具模块 | `tools` | 工具管理 | tools, commands |
| 数据模块 | `memory` | 数据存储管理 | memory, cache |
| 系统模块 | `security` | 系统功能 | security, performance, monitoring |
| 其他模块 | `other` | 其他功能模块 | analytics, buddy, chat等 |

#### 4.2.2 模块命名规范

- **目录命名**: 使用小写字母，连字符分隔（如：`memory-management`）
- **文件命名**: 使用PascalCase（如：`MemoryManager.ts`）
- **接口命名**: 以`I`开头（如：`IMemoryService.ts`）

### 4.3 模块定义信息

#### 4.3.1 已定义的模块列表

PY_APP项目目前定义了25个标准模块：

##### 核心模块 (2个)
- **core** - 核心功能模块，提供基础架构和生命周期管理
- **infrastructure** - 基础设施模块，提供通用工具和基础服务

##### 功能模块 (3个)
- **ai** - AI相关功能模块，提供模型管理和AI服务
- **agent** - 代理模块，提供代理管理和执行功能
- **bridge** - 桥接模块，提供会话管理和远程控制

##### 界面模块 (2个)
- **ui** - 用户界面模块，提供React组件和界面交互
- **cli** - 命令行界面模块，提供命令行交互功能

##### 工具模块 (2个)
- **tools** - 工具管理模块，提供工具注册和执行功能
- **commands** - 命令模块，提供命令注册和执行功能

##### 数据模块 (2个)
- **memory** - 记忆管理模块，提供记忆存储和检索功能
- **cache** - 缓存模块，提供数据缓存和性能优化功能

##### 系统模块 (3个)
- **security** - 安全模块，提供安全防护和审计功能
- **performance** - 性能模块，提供性能监控和优化功能
- **monitoring** - 监控模块，提供系统监控和告警功能

##### 其他模块 (11个)
- **analytics** - 分析模块，提供数据分析和统计功能
- **buddy** - 伙伴模块，提供虚拟伙伴生成和交互功能
- **chat** - 聊天模块，提供聊天会话管理功能
- **chronos** - 时间管理模块，提供任务调度和定时功能
- **config** - 配置模块，提供配置管理和验证功能
- **context** - 上下文模块，提供上下文管理和注入功能
- **cost** - 成本模块，提供成本监控和分析功能
- **docs** - 文档模块，提供文档管理和帮助功能
- **error** - 错误处理模块，提供错误分类和处理功能
- **hooks** - 钩子模块，提供事件处理和扩展点功能
- **lsp** - LSP模块，提供语言服务器协议支持
- **mcp** - MCP模块，提供模型控制协议支持
- **plugins** - 插件模块，提供插件管理和扩展功能
- **query** - 查询模块，提供查询引擎和用户输入处理
- **sandbox** - 沙箱模块，提供代码执行隔离环境
- **services** - 服务模块，提供各种系统服务功能

#### 4.3.2 模块依赖关系

##### 核心依赖链
```
core → infrastructure → [其他模块]
```

##### 主要依赖关系
- **agent** 依赖: core, ai
- **bridge** 依赖: core, infrastructure
- **chat** 依赖: core, ai
- **cli** 依赖: core, infrastructure
- **commands** 依赖: core, cli
- **sandbox** 依赖: core, security

### 4.4 开发规范

#### 4.4.1 模块导入规范

##### 必须使用别名路径
```typescript
// ✅ 正确
import { Agent } from '@modules/agent';
import { AI } from '@modules/ai';

// ❌ 错误
import { Agent } from '../../agent/agent.ts';
import { AI } from '@/ai/AIModelManager.ts';
```

##### 导入管理器配置
别名路径映射关系：
- `@modules/core` → `./core`
- `@modules/ai` → `./ai`
- `@modules/agent` → `./agent`
- ...（所有25个模块都有对应的别名）

#### 4.4.2 模块开发流程

##### 新模块开发步骤
1. **设计阶段**: 编写设计文档，确定模块分类和依赖关系
2. **实现阶段**: 创建模块目录结构，实现核心功能
3. **注册阶段**: 在 `ModuleDefinitions.ts` 中添加模块定义
4. **测试阶段**: 编写单元测试和集成测试
5. **文档阶段**: 更新模块文档和使用指南

##### 模块目录结构
```
模块名称/
├── index.ts              # 模块入口文件（必须）
├── types/                # 类型定义
├── services/             # 服务层
├── utils/                # 工具函数
├── tests/                # 测试文件
└── README.md