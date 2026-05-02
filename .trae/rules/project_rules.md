# PY_APP 项目规则文档

**文件目的**: 为LLM提供PY_APP项目的统一开发规范和指导原则
**最后更新**: 2026-05-02
**维护者**: PY_APP开发团队

## §1 基础规则

### 1.1 安全与合规
- **敏感信息保护**: 严禁在代码中硬编码敏感信息
- **版权问题**: 禁止出现任何Anthropic相关内容，将默认的CLAUDE改为PY_APP
- **数据保护**: 严禁删除数据及数据库结构，仅允许新增或修改数据库表字段

### 1.2 开发规范
- **技术路线**: 统一使用TypeScript + Rust进行开发
- **数据使用**: 严禁使用模拟数据，请使用真实数据
- **地址配置**: 前后端通信时严禁在代码中使用硬编码地址，使用环境变量
- **代码复用**: 方法严禁重复，归一化调用，要求可复用可继承
- **代码注释**: 添加必要的函数级注释，保持代码可读性
- **版本控制**: 使用Git进行版本控制
- **代码格式化**: 运行 `bun run format` (Prettier) 格式化代码，`bun run lint` (ESLint) 检查代码质量

**环境变量规范**: 所有环境变量按前缀分类——
- `DEEPSEEK_*` — AI模型配置
- `SECURITY_*` — 安全相关配置
- `LOG_*` — 日志配置
- `DATABASE_*` — 数据库配置
- `PERMISSION_*` — 权限配置
- `TOOL_*` — 工具配置
新环境变量必须遵循 `PREFIX_KEY_NAME` 格式，并在 `.env.example` 中添加说明。

**入口文件说明**:
| 入口文件 | 用途 | 启动命令 |
|----------|------|----------|
| `backend/src/index.ts` | 主入口（CLI模式） | `bun run start` |
| `backend/src/entrypoints/cli.tsx` | Ink CLI交互模式 | `bun run dev` |
| `backend/src/entrypoints/mcp.ts` | MCP Server模式 | 直接运行 |
| `backend/src/entrypoints/repl.ts` | REPL交互模式 | 直接运行 |
| `backend/src/healthcheck.ts` | 健康检查 | `bun run health` |
| `backend/src/monitor.ts` | 系统监控 | `bun run monitor` |

### 1.3 文件管理
- **数据库文件**: `backend/data/py_copilot.db`
- **测试文件**: `backend/testing/` 目录下
- **设计文档**: `dev_docs/YYYYMMDD/` 目录下，按日期归档
- **CC源码**: `cc_code/` 文件夹只读参考，**严禁修改**
- **应用配置**: `backend/config.json` + `backend/settings.json` + `backend/configs/`
- **依赖图快照**: `backend/dependency-snapshot.json`，记录已批准的模块依赖结构，**随模块结构变更同步更新**

### 1.4 前端/桌面客户端开发规范
前端项目位于 `py-app-client/`，基于 Tauri 2 + React 18 + Vite + TailwindCSS + Zustand：
- **组件命名**: PascalCase，文件后缀 `.tsx`
- **状态管理**: 使用 Zustand（已集成在 `py-app-client/src/`）
- **样式方案**: 使用 TailwindCSS 工具类，避免手写 CSS
- **类型定义**: 与后端共享的API类型应定义在 `backend/src/types/` 中，前端通过子模块引用
- **前后端通信**: 通过 Tauri IPC (`@tauri-apps/api`) 调用后端命令，禁止直接 HTTP 调用
- **前端构建**: `bun run build` (Vite)；开发模式 `bun run dev`
- **桌面端构建**: `bun run tauri build` (需安装 Rust 工具链)
- **前端测试**: 使用 Vitest + Testing Library，运行 `bun run test`

## §2 模块管理规则

### 2.1 模块管理系统核心组件
| 组件 | 文件 | 职责 |
|------|------|------|
| 模块注册表 | `src/modules/ModuleRegistry.ts` | 模块注册、查找和依赖解析 |
| 导入管理器 | `src/modules/ImportManager.ts` | 统一管理模块导入路径 |
| 模块定义 | `src/modules/ModuleDefinitions.ts` | 统一定义所有模块信息 |
| 模块初始化器 | `src/modules/ModuleInitializer.ts` | 管理模块生命周期 |

### 2.2 8个标准分类

| 分类 | 标识 | 描述 | 模块 |
|------|------|------|------|
| 核心模块 | `core` | 基础架构 | core, infrastructure |
| 功能模块 | `ai` | AI功能 | ai, agent, bridge |
| 界面模块 | `ui` | 用户界面 | ui, cli |
| 工具模块 | `tools` | 工具管理 | tools, commands |
| 数据模块 | `memory` | 数据存储 | memory, cache |
| 系统模块 | `security` | 系统功能 | security, performance, monitoring |
| 其他模块 | `other` | 其他功能 | analytics, buddy, chat等15个 |

### 2.3 模块导入规范
- **必须使用别名路径**: `@modules/模块名` 格式
- **禁止使用相对路径**: 严禁使用 `../../` 等深度相对路径

```typescript
// ✅ 正确
import { Agent } from '@modules/agent';
// ❌ 错误
import { Agent } from '../../agent/agent.ts';
```

### 2.4 依赖声明要求
模块注册时必须列出所有运行时依赖：
1. **核心依赖**: core/infrastructure 必须始终声明
2. **导入依赖**: 所有 `import from '@modules/xxx'` 的模块必须声明在 `dependencies` 中
3. **可选依赖**: 运行时条件加载的模块声明在 `optionalDependencies`
4. **自动验证**: 注册后必须运行 `bun run modules:validate` 验证依赖声明与实际导入的一致性

**主要依赖关系**:
- core → infrastructure → [其他模块]
- agent 依赖: core, ai
- bridge 依赖: core, infrastructure
- chat 依赖: core, ai
- cli 依赖: core, infrastructure
- commands 依赖: core, cli
- sandbox 依赖: core, security

**架构稳定性保障**:
- **核心模块**: `core`、`infrastructure`、`error` 为架构基石，其依赖关系被 `dependency-snapshot.json` 锁定，变更将导致 `modules:validate` 报错
- **依赖图快照**: `backend/dependency-snapshot.json` 记录了当前批准的模块依赖图，每次提交前自动校验一致性
- **模块结构变更流程**: 新增/删除模块或修改核心模块依赖 → 运行 `bun run modules:snapshot` 更新快照 → 提交代码和快照

### 2.5 模块命名规范
- **目录命名**: 小写字母，连字符分隔（如 `memory-management`）
- **文件命名**: PascalCase（如 `MemoryManager.ts`）
- **接口命名**: 以 `I` 开头（如 `IMemoryService.ts`）
- **版本号**: 语义化版本 `主版本号.次版本号.修订号`

### 2.6 模块目录结构
```
模块名称/
├── index.ts           # 模块入口（必须）
├── types/             # 类型定义
├── services/          # 服务层
├── utils/             # 工具函数
├── tests/             # 测试文件
└── README.md          # 模块文档（必须）
```

### 2.7 模块入口文件规范
```typescript
export * from './types';
export * from './services';
export * from './utils';
export { 主类 } from './主类文件';
```

## §3 开发流程规范

### 3.1 先设计原则
新需求先编制设计MD文件到 `dev_docs/` 目录的当前日期文件夹下，用户确认后再实施方案。

### 3.2 严禁重复造轮子
- 先学习CC源码的完整实现，直接复用成熟方案
- 发现重复代码立即整合，不得保留重复实现
- 禁止在不同位置创建功能相同的模块

### 3.3 模块对标开发5步闭环
```
① 对标分析 → ② 实施方案 → ③ 代码实现 → ④ 验证记录 → ⑤ 总览同步
```

| 步骤 | 产出物 | 验收标准 | 存放路径 |
|------|--------|----------|----------|
| ① 对标分析 | 对标分析报告 | 明确差距项、优先级、评级 | `dev_docs/YYYYMMDD/` |
| ② 实施方案 | 实施方案文档（含任务清单） | 任务可量化、有验收标准 | `dev_docs/YYYYMMDD/` |
| ③ 代码实现 | 代码实现 + 测试用例 | 每个任务完成即测试 | `backend/src/` + `backend/testing/` |
| ④ 验证记录 | 实施方案中Section 8验证章节 | 标注完成状态、测试结果 | 附在实施方案文档末尾 |
| ⑤ 总览同步 | 更新 `00-总览对标分析.md` | 数据与验证记录一致 | `dev_docs/YYYYMMDD/00-总览对标分析.md` |

### 3.4 开发任务要求
- 采用小步快跑，快速验证的开发模式
- 完成一个任务，测试一个任务，标注一个任务

### 3.5 规则同步机制
讨论分析过程中产生的约束性结论，须即时同步到规则文件。

**知识分层**:
| 层级 | 位置 | 内容特征 | 更新频率 |
|------|------|----------|----------|
| 讨论区 | `dev_docs/YYYYMMDD/` | 分析报告、方案草稿、讨论记录 | 持续编写 |
| 规则文件 | `.trae/rules/project_rules.md` | 经确认的约束、规范、原则 | 有结论即更新 |

**同步触发条件**（满足任意一条即应更新规则文件）:
1. 对标分析或讨论中确认了一条**全项目需遵循的约束**
2. 发现了一种**反复出现的错误模式**，需要预防
3. 做出了**架构或技术选型决策**，影响后续开发
4. 补充了之前未覆盖的**开发场景规范**

**操作要求**:
- 讨论结论确认后，立即更新 `project_rules.md` 的对应章节
- 如果结论不归属于现有章节，新增章节
- 更新后同步修改版本号和更新说明
- 修改模块结构（新增/删除模块、变更依赖）后，须运行 `bun run modules:snapshot` 更新 `dependency-snapshot.json`
- §10 检查清单中新增的检查项须同步更新

## §4 实施原则

### 4.1 核心实施原则
1. **仅学习CC源码，不修改CC源码** - 严禁修改 `cc_code/` 下的任何文件
2. **先设计后开发** - 设计文档需用户确认后再编码
3. **不删除现有代码** - 仅新增或修改，保持向后兼容

### 4.2 架构深度并重
每个子功能必须有独立实现文件（非空壳或仅接口定义），包含测试用例，与上下游有集成验证。对标评级须从代码实现层面评估，不可仅凭架构设计定级。

### 4.3 内置命令三要素
每个内置命令必须包含：
1. **独立文件/目录**: 不可全部写在同一个文件中
2. **懒加载出口**: 实现 `load()` 或等效按需加载模式
3. **UI组件配套**: local-jsx类型命令必须提供 `.tsx` 组件

### 4.4 错误处理规范
```typescript
import { ModuleError } from '@modules/errors';
try {
  await module.initialize();
} catch (error) {
  throw new ModuleError(`初始化失败: ${error.message}`, moduleId, 'INIT_FAILED');
}
```

### 4.5 测试分层覆盖标准
| 层级 | 类型 | 覆盖率 | 说明 |
|------|------|--------|------|
| 架构层 | 单元测试 | ≥ 80% | 覆盖Registry/Pipeline/Loader/Manager等核心组件 |
| 功能层 | 功能测试 | ≥ 60% | 覆盖每个命令/工具/服务的独立功能验证 |
| 集成层 | 集成测试 | ≥ 40% | 覆盖模块间交互、端到端流程 |

禁止出现"架构测试通过、功能测试为零"的情况，每个内置命令至少有一个功能测试用例。

### 4.6 模块设计原则
- **单一职责**: 每个模块只负责一个明确的功能领域
- **依赖倒置**: 依赖抽象而不是具体实现
- **接口隔离**: 定义专门的接口而不是通用接口
- **开闭原则**: 对扩展开放，对修改关闭

## §5 工具和命令

### 5.1 模块管理命令
```bash
bun run modules:test      # 测试模块系统
bun run modules:analyze   # 分析模块状态
bun run modules:migrate   # 执行模块迁移
bun run modules:validate  # 验证依赖关系（含快照一致性检查）
bun run modules:snapshot  # 导出依赖图快照（模块结构变更后执行）
bun run modules:init      # 模块管理版本启动应用
bun run modules:check     # 完整检查
bun run modules:setup     # 安装 Git pre-commit 钩子（提交前自动验证）
```

### 5.2 迁移工具
```bash
bun run scripts/migrate-modules.ts                      # 分析迁移状态
bun run scripts/migrate-modules.ts --execute            # 执行迁移
bun run scripts/migrate-modules.ts --strategy all-at-once --batch-size 5
```

## §6 故障排除

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 模块找不到 | 未在ModuleDefinitions.ts中注册 | 注册模块；运行 `modules:analyze` |
| 循环依赖 | 模块间相互引用 | 运行 `modules:validate` 分析；提取公共功能 |
| 初始化失败 | 初始化逻辑错误 | 运行 `modules:check`；查看错误详情 |
| 导入路径错误 | 使用了相对路径 | 使用 `@modules/模块名` 格式 |

**调试技巧**:
```typescript
process.env.DEBUG_MODULES = 'true';  // 启用详细日志
await initializeModules();
```

## §7 架构哲学与设计原则

### 7.1 Harness 驱动哲学
真正的难点不在模型，而在模型之外的 Harness。运行时越笨，架构越稳定——把智能下沉到模型，把确定性留给框架。

三代演进: Chatbot → Workflow(DAG) → Autonomous Agent(模型控制循环，运行时只是执行器)

### 7.2 TAOR 循环设计原则
Orchestrator 极其愚蠢——只负责驱动循环、执行工具、感知结果。所有推理、决策、何时停止，全部交给模型。

### 7.3 上下文管理（三级压缩 + 熔断器）
| 级别 | 触发条件 | 策略 |
|------|----------|------|
| Level 1: 轻量压缩 | Token使用率 > 50% | 清理旧工具结果 |
| Level 2: 自动压缩 | Level 1不足 | 用LLM摘要替换历史 |
| Level 3: 强制压缩 | 达到API限制 | 激进裁剪上下文 |
| 熔断器 | 连续失败3次 | 停止压缩，防止死循环 |

### 7.4 工具设计哲学
给模型一个 Shell，而非100个工具：
- **核心工具(5个)**: Bash、Read、Write、Search、ToolSearch——始终加载，永不延迟
- **MCP工具**: 默认延迟加载，模型通过ToolSearchTool发现时才加载

### 7.5 权限五档信任光谱
`plan`(只读) → `default`(操作前询问) → `acceptEdits`(自动批准编辑) → `dontAsk`(白名单自动批准) → `bypass`(跳过所有检查)

### 7.6 记忆系统六层架构
Layer 1 组织策略 → Layer 2 项目配置 → Layer 3 用户偏好 → Layer 4 自动学习 → Layer 5 会话上下文 → Layer 6 子Agent记忆(用完即弃)

### 7.7 Sub-Agent 上下文隔离
核心价值是用完即弃——花几万token做子任务，只把结论返回，中间过程全扔掉。
隔离级别: `process`(最轻量) → `worktree` → `machine` → `sandbox`(最高安全)

### 7.8 TypeScript 与 Rust 边界划分
| 层级 | 语言 | 职责 |
|------|------|------|
| 编排层 | TypeScript | 驱动循环、执行工具、调用API |
| 性能核心 | Rust | Token计算、AST解析、安全分析、上下文压缩 |
| 通信 | FFI(napi-rs) | 直接调用Rust编译的动态库 |

### 7.9 启动时序优化
```
T0: 返回启动进度 → T1: 并行预加载(Keychain+API+Rust核心预热)
→ T2: 解析命令行 → T3: 最多等100ms激活启动界面 → T4: 后台加载剩余模块
```

### 7.10 关键第三方库集成标准
| 库 | 要求 |
|----|------|
| **Zod** | 新模块必须使用Zod定义数据类型和工具Schema，替代纯TS接口 |
| **MCP SDK** | 必须集成官方SDK实现Stdio/SSE/HTTP/WebSocket全协议 |
| **条件编译** | 逐步迁移至 `bun:bundle feature()` 获得编译时死代码消除 |
| **Anthropic SDK** | 保持自实现，但须确保API兼容性 |

## §8 安全必做项

参考 cc_code `bashSecurity.ts` 的23项检查，必须实现：
- [ ] 阻止危险Zsh内置命令
- [ ] 防御Zsh equals expansion（`=curl` 绕过）
- [ ] Unicode零宽字符注入检测
- [ ] IFS null-byte注入防护
- [ ] 环境变量污染检测
- [ ] 阻止 `rm -rf /` 等破坏性操作
- [ ] Shell命令转义和引号验证

## §9 生产化 Checklist

| 能力 | 优先级 | 说明 |
|------|--------|------|
| 会话持久化 | P0 | Checkpoint + Rollback，如git branch |
| 成本追踪 | P0 | 每个请求记录token消耗 |
| 遥测系统 | P1 | OpenTelemetry集成 |
| Hook系统 | P1 | 多个事件节点，支持脚本拦截 |
| MCP协议 | P1 | 支持Stdio/SSE/HTTP/WebSocket |
| 企业级认证 | P2 | OAuth 2.0 + JWT |

## §10 LLM开发检查清单

开发新功能时逐项检查：
- [ ] 使用正确的别名路径导入 `@modules/模块名`
- [ ] 模块在 ModuleDefinitions.ts 中注册
- [ ] 选择了正确的模块分类
- [ ] 声明了所有依赖关系（核心依赖 + 导入依赖 + 可选依赖）
- [ ] 运行了 `modules:validate` 验证依赖一致性
- [ ] 满足架构深度要求（独立实现文件，非空壳）
- [ ] 内置命令实现了懒加载出口 + 独立文件 + UI组件
- [ ] 编写了测试用例（架构层 ≥ 80% + 功能层 ≥ 60%）
- [ ] 运行了模块系统测试
- [ ] 修改模块结构后运行了 `bun run modules:snapshot` 更新依赖图快照
- [ ] 讨论中产生的约束性结论已同步到规则文件（参见§3.5）

## §11 特别说明

### 11.1 KAIROS系统替换
CC源码中的KAIROS系统已被Chronos系统替换，相关模块仅与Chronos系统集成。

### 11.2 实施方案要求
实施方案必须包含：实施原则和策略、详细的任务分解、质量保证措施、风险评估和应对方案。

### 11.3 技术栈选型
| 层级 | 选型 | 理由 |
|------|------|------|
| 编排层 | TypeScript + Bun | 启动极快，生态丰富 |
| 性能核心 | Rust | 代码解析、token计算等性能敏感路径 |
| 终端UI | React + Ink | 组件化终端开发 |
| 校验层 | Zod v4 | 贯穿全链路运行时Schema验证 |
| 认证 | OAuth 2.0 / JWT | Keychain安全令牌管理 |

### 11.4 六层架构全景
用户层(CLI/IDE Extension/SDK) → 界面层(Ink/Commander.js) → 核心引擎层(QueryEngine/TAOR/权限) → 工具能力层(Bash/FileSystem/MCP) → 基础设施层(Rust核心) → 外部层(LLM API/OS Shell)

---

**规则文件版本**: 4.3.0
**最后更新**: 2026-05-02
**下次评审**: 2026-06-02

**V4.3.0 更新说明**:
- **§1.3 补充**: 增加依赖图快照文件管理说明
- **§2.4 补充**: 增加"架构稳定性保障"——核心模块锁定、快照校验、变更流程
- **§3.5 补充**: 增加模块结构变更后须更新快照的操作要求
- **§5.1 补充**: 增加 `modules:snapshot`（导出快照）和 `modules:setup`（安装 pre-commit）命令
- **§10 补充**: 检查清单增加"修改模块结构后更新依赖图快照"检查项
