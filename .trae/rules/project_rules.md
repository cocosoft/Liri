# PY_APP 项目规则文档

**文件目的**: 为开发团队提供统一开发规范和指导原则
**最后更新**: 2026-05-05
**维护者**: PY_APP开发团队
**版本**: 5.0.0

---

## §1 基础规则

### 1.1 安全与合规
- 严禁硬编码敏感信息，使用环境变量
- 禁止出现 Anthropic 相关内容，将默认 CLAUDE 改为 PY_APP
- 严禁删除数据及数据库结构，仅允许新增或修改字段

### 1.2 开发规范
- **技术栈**: TypeScript + Rust
- **数据**: 禁止使用模拟数据，使用真实数据
- **代码复用**: 方法禁止重复，要求可复用可继承
- **注释**: 添加必要的函数级注释
- **格式化**: 运行 `bun run format` 和 `bun run lint`

### 1.3 环境变量规范
按前缀分类：`DEEPSEEK_*`(AI模型)、`SECURITY_*`(安全)、`LOG_*`(日志)、`DATABASE_*`(数据库)、`PERMISSION_*`(权限)、`TOOL_*`(工具)

### 1.4 文件管理
- **数据库**: `backend/data/py_copilot.db`
- **测试**: `backend/testing/`
- **设计文档**: `dev_docs/YYYYMMDD/`（按日期归档）
- **CC源码**: `reference/cc_code/`（只读参考）
- **配置**: `backend/config.json` + `backend/settings.json` + `backend/configs/`
- **依赖快照**: `backend/dependency-snapshot.json`（模块结构变更时同步更新）

### 1.5 前端规范（Tauri 2 + React 18）
- 组件命名：PascalCase + `.tsx`
- 状态管理：Zustand
- 样式：TailwindCSS 工具类
- 类型定义：后端 `backend/src/types/`，前端通过子模块引用
- 通信：Tauri IPC，禁止直接 HTTP 调用

---

## §2 模块管理规则

### 2.1 核心组件
| 组件 | 文件 | 职责 |
|------|------|------|
| 模块注册表 | `src/modules/ModuleRegistry.ts` | 注册、查找、依赖解析 |
| 导入管理器 | `src/modules/ImportManager.ts` | 统一管理导入路径 |
| 模块定义 | `src/modules/ModuleDefinitions.ts` | 统一定义模块信息 |
| 模块初始化器 | `src/modules/ModuleInitializer.ts` | 生命周期管理 |

### 2.2 标准分类
| 分类 | 标识 | 模块 |
|------|------|------|
| 核心模块 | `core` | core, infrastructure |
| 功能模块 | `ai` | ai, agent, bridge |
| 界面模块 | `ui` | ui, cli |
| 工具模块 | `tools` | tools, commands |
| 数据模块 | `memory` | memory, cache |
| 系统模块 | `security` | security, performance, monitoring |
| 其他模块 | `other` | analytics, buddy, chat等 |

### 2.3 导入规范
- **必须使用**: `@modules/模块名` 格式
- **禁止使用**: `../../` 等相对路径

### 2.4 依赖声明
1. **核心依赖**: core/infrastructure 必须声明
2. **导入依赖**: `@modules/xxx` 必须声明在 `dependencies`
3. **可选依赖**: 条件加载的模块声明在 `optionalDependencies`
4. **验证**: 运行 `bun run modules:validate` 验证一致性

### 2.5 命名规范
- 目录: 小写连字符（如 `memory-management`）
- 文件: PascalCase（如 `MemoryManager.ts`）
- 接口: 以 `I` 开头（如 `IMemoryService.ts`）

### 2.6 目录结构
```
模块名称/
├── index.ts      # 入口（必须）
├── types/        # 类型定义
├── services/     # 服务层
├── utils/        # 工具函数
├── tests/        # 测试文件
└── README.md     # 文档（必须）
```

---

## §3 开发流程

### 3.1 先设计原则
新需求先编制设计文档到 `dev_docs/YYYYMMDD/`，用户确认后再实施。

### 3.2 禁止重复造轮子
- 先学习 CC 源码，复用成熟方案
- 发现重复代码立即整合

### 3.3 对标开发5步闭环
① 对标分析 → ② 实施方案 → ③ 代码实现 → ④ 验证记录 → ⑤ 总览同步

### 3.4 对标完整性原则（强制）
 对标CC源码时，必须**先完整实现所有CC已有功能**，再评估修剪。禁止在对标分析过程中提前裁剪。
 - **正确做法**: 完整列表CC功能 → 全部实现 → 作为独立步骤评估修剪
 - **错误做法**: 分析时说"这个功能用不上"直接跳过实现
 - **例外**: 只有当某个功能依赖PY_APP不存在的底层依赖（如特定云服务API）时方可跳过，但须在注释中注明原因
 
 ### 3.5 规则同步机制
讨论中确认的约束性结论须即时同步到本规则文件。

---

## §4 实施原则

### 4.1 核心原则
1. 仅学习 CC 源码，不修改
2. 先设计后开发
3. 不删除现有代码，仅新增或修改

### 4.2 内置命令三要素
1. 独立文件/目录
2. 懒加载出口（`load()`）
3. UI组件配套（`.tsx`）

### 4.3 测试分层覆盖
| 层级 | 类型 | 覆盖率 |
|------|------|--------|
| 架构层 | 单元测试 | ≥ 80% |
| 功能层 | 功能测试 | ≥ 60% |
| 集成层 | 集成测试 | ≥ 40% |

### 4.4 设计原则
- 单一职责、依赖倒置、接口隔离、开闭原则

---

## §5 工具验收标准

### 5.1 功能要求
- **execute()**: 必须实现真实执行逻辑，禁止模拟
- **参数验证**: 必须正确处理输入参数
- **错误处理**: 必须返回标准错误格式
- **进度回调**: 支持 `onProgress`
- **取消操作**: 响应 `AbortController`

### 5.2 代码质量
- 禁止使用 `@ts-nocheck`
- 类和方法必须有 JSDoc 注释

### 5.3 注册规范
- 在 `ToolFactory` 中定义 `createXxxTool()` 方法
- 注册到 `builtinToolLoaders`
- 条件工具使用 `conditionalTool()` 包装

### 5.4 验收检查清单
```markdown
- [ ] execute() 实现真实逻辑
- [ ] 参数验证已实现
- [ ] 错误处理已实现
- [ ] 进度回调已支持
- [ ] 取消操作已支持
- [ ] TypeScript 检查通过
- [ ] ESLint 检查通过
- [ ] 单元测试已编写
- [ ] ToolFactory 方法已添加
- [ ] builtinToolLoaders 已注册
```

---

## §6 工具命令

```bash
bun run modules:test      # 测试模块系统
bun run modules:analyze   # 分析模块状态
bun run modules:validate  # 验证依赖关系
bun run modules:snapshot  # 导出依赖图快照
bun run modules:check     # 完整检查
bun run modules:setup     # 安装 pre-commit 钩子
```

---

## §7 故障排除

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 模块找不到 | 未在 ModuleDefinitions.ts 注册 | 注册模块；运行 `modules:analyze` |
| 循环依赖 | 模块间相互引用 | 运行 `modules:validate`；提取公共功能 |
| 导入路径错误 | 使用相对路径 | 使用 `@modules/模块名` 格式 |

---

## §8 架构设计原则

### 8.1 Harness 驱动哲学
把智能下沉到模型，把确定性留给框架。

### 8.2 TAOR 循环设计
Orchestrator 只负责驱动循环、执行工具、感知结果，推理决策交给模型。

### 8.3 工具设计哲学
- **核心工具(5个)**: Bash、Read、Write、Search、ToolSearch（始终加载）
- **MCP工具**: 默认延迟加载，模型发现时才加载

### 8.4 权限五档信任光谱
`plan`(只读) → `default`(询问) → `acceptEdits`(自动批准) → `dontAsk`(白名单) → `bypass`(跳过检查)

### 8.5 模型数据唯一源
- `ModelConfigs.ts` 是唯一数据源
- `ModelManager.ts` 提供统一查询 API
- 禁止硬编码模型 ID

---

## §9 安全必做项

参考 `cc_code/bashSecurity.ts` 的检查：
- 阻止危险 Zsh 内置命令
- 防御 Zsh equals expansion
- Unicode 零宽字符注入检测
- IFS null-byte 注入防护
- 阻止 `rm -rf /` 等破坏性操作

---

## §10 生产化 Checklist

| 能力 | 优先级 | 说明 |
|------|--------|------|
| 会话持久化 | P0 | Checkpoint + Rollback |
| 成本追踪 | P0 | 记录 token 消耗 |
| 遥测系统 | P1 | OpenTelemetry 集成 |
| Hook 系统 | P1 | 事件节点支持脚本拦截 |
| MCP 协议 | P1 | 支持全协议 |

---

## §11 LLM 开发检查清单

- [ ] 使用 `@modules/模块名` 导入
- [ ] 模块在 ModuleDefinitions.ts 注册
- [ ] 声明所有依赖关系
- [ ] 运行 `modules:validate`
- [ ] 满足架构深度要求（独立实现文件）
- [ ] 内置命令实现懒加载 + 独立文件 + UI 组件
- [ ] 编写测试用例
- [ ] 修改模块结构后运行 `modules:snapshot`

---

## §12 特别说明

### 12.1 KAIROS 替换
CC 源码中的 KAIROS 系统已被 Chronos 系统替换。

### 12.2 实施方案要求
必须包含：实施原则、任务分解、质量保证、风险评估。

### 12.3 技术栈选型
| 层级 | 选型 |
|------|------|
| 编排层 | TypeScript + Bun |
| 性能核心 | Rust |
| 终端 UI | React + Ink |
| 校验层 | Zod v4 |
| 认证 | OAuth 2.0 / JWT |

---

**版本历史**:
- **v5.1.0**: 新增§3.4对标完整性原则，禁止对标分析过程中提前裁剪
- **v5.0.0**: 精简重构，修复章节编号，移除重复内容
- **v4.4.0**: 新增模型数据唯一源架构
- **v4.3.0**: 增加依赖图快照管理