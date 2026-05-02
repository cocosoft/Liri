# Cost/Error/Hooks 模块实施方案

**编制日期**: 2026-05-01
**模块范围**: cost、error、hooks
**对标状态**: 🟢 超越对标（Cost约85%、Error约80%）、🟡 部分对标（Hooks约35%）
**对标分析报告**: [08-Cost-Error-Hooks模块对标分析.md](./08-Cost-Error-Hooks模块对标分析.md)

---

## 1. 实施目标

- Cost模块对标完成度从 **85%** 提升至 **90%**，补充React Hook
- Error模块对标完成度从 **80%** 提升至 **85%**，补充兼容性
- Hooks模块对标完成度从 **35%** 提升至 **65%**，补充核心React Hooks

---

## 2. 适用项目规则

### 2.1 模块管理规则（来源：`.trae/rules/module_management_rules.md`）

| 规则 | 要求 | 本模块适用说明 |
|------|------|---------------|
| 别名路径导入 | 必须使用 `@modules/模块名` 格式 | 使用 `@modules/cost`、`@modules/error`、`@modules/hooks` |
| 模块分类 | cost属于其他模块，error属于其他模块，hooks属于其他模块 | 分类正确 |

### 2.2 开发规范（来源：`.trae/rules/project_rules.md`）

| 规则 | 要求 | 本模块适用说明 |
|------|------|---------------|
| 严禁重复造轮子 | 先学习CC源码，直接复用成熟方案 | Hooks参考CC源码 `hooks/` 目录 |
| 仅学习CC源码 | 严禁修改 `cc_code/` 下的任何文件 | 所有修改仅限 `backend/src/` 目录 |
| 不删除现有代码 | 仅新增或修改 | 保持现有架构 |

### 2.3 架构哲学（来源：`.trae/rules/project_rules.md` §6）

| 原则 | 适用说明 |
|------|----------|
| 成本追踪（P0） | Cost模块是生产化必做项 |
| Hook系统（P1） | Hooks模块是生产化必做项 |

---

## 3. 实施原则

### 3.1 学习-执行-测试-标注流程

```
学习CC源码对应实现 → 理解设计思路 → 执行编码 → 测试验证 → 标注完成
```

---

## 4. 任务分解

### 阶段一：核心React Hooks补充（🔴 高优先级）

#### 任务 1.1：实现 useCanUseTool Hook

**学习目标**: 阅读 `cc_code/backend/hooks/useCanUseTool.tsx`

**实施内容**:
- 在 `backend/src/hooks/` 下新增 `useCanUseTool.ts`
- 实现工具使用权限检查Hook
- 集成Permission模块的权限规则
- 支持权限决策原因追踪

**验证标准**:
- [ ] 工具权限可正确检查
- [ ] 权限拒绝原因可追踪
- [ ] 与Permission模块集成正确

#### 任务 1.2：实现 useSettings Hook

**学习目标**: 阅读 `cc_code/backend/hooks/useSettings.ts`

**实施内容**:
- 在 `backend/src/hooks/` 下新增 `useSettings.ts`
- 实现应用设置管理Hook
- 支持设置的读取、修改、持久化
- 支持设置变更通知

**验证标准**:
- [ ] 设置可读取和修改
- [ ] 设置变更可持久化
- [ ] 设置变更可通知订阅者

#### 任务 1.3：实现 useMergedTools Hook

**学习目标**: 阅读 `cc_code/backend/hooks/useMergedTools.ts`

**实施内容**:
- 在 `backend/src/hooks/` 下新增 `useMergedTools.ts`
- 实现工具列表合并Hook
- 合并内置工具、MCP工具、插件工具
- 处理工具名称冲突

**验证标准**:
- [ ] 多来源工具可正确合并
- [ ] 名称冲突可处理
- [ ] 合并结果可被UI使用

### 阶段二：交互增强Hooks（🟡 中优先级）

#### 任务 2.1：实现 useTypeahead Hook

**学习目标**: 阅读 `cc_code/backend/hooks/useTypeahead.tsx`

**实施内容**:
- 在 `backend/src/hooks/` 下新增 `useTypeahead.ts`
- 实现自动补全Hook
- 支持命令补全、文件补全、参数补全
- 支持补全项过滤和排序

**验证标准**:
- [ ] 输入时可触发补全
- [ ] 补全项可过滤和排序
- [ ] 补全项可选择

#### 任务 2.2：实现 useReplBridge Hook

**学习目标**: 阅读 `cc_code/backend/hooks/useReplBridge.tsx`

**实施内容**:
- 在 `backend/src/hooks/` 下新增 `useReplBridge.ts`
- 实现REPL桥接Hook
- 与Bridge模块集成
- 支持远程会话的输入输出

**验证标准**:
- [ ] REPL桥接可工作
- [ ] 远程会话IO可正确处理

#### 任务 2.3：实现 useTextInput Hook

**学习目标**: 阅读 `cc_code/backend/hooks/useTextInput.ts`

**实施内容**:
- 在 `backend/src/hooks/` 下新增 `useTextInput.ts`
- 实现文本输入管理Hook
- 支持多行输入、历史记录、自动补全

**验证标准**:
- [ ] 文本输入可正确捕获
- [ ] 历史记录可浏览
- [ ] 自动补全可触发

#### 任务 2.4：实现 useCostSummary Hook

**学习目标**: 阅读 `cc_code/backend/costHook.ts`

**实施内容**:
- 在 `backend/src/cost/` 下新增 `useCostSummary.ts`
- 实现成本摘要Hook
- 在进程退出时输出成本摘要
- 集成CostTracker

**验证标准**:
- [ ] 成本摘要可在退出时输出
- [ ] 摘要内容准确

### 阶段三：Error兼容性（🟡 中优先级）

#### 任务 3.1：确保与CC源码错误类型兼容

**学习目标**: 阅读 `cc_code/backend/utils/errors.ts`、`services/api/errors.ts`

**实施内容**:
- 在 `backend/src/error/` 中补充兼容的错误类型
- 补充 `ConfigParseError`、`AbortError`、`FallbackTriggeredError`
- 确保错误ID与CC源码兼容

**验证标准**:
- [ ] CC源码错误类型在PY_APP中有对应
- [ ] 错误处理逻辑兼容

### 阶段四：其他Hooks补充（🟢 低优先级）

#### 任务 4.1：补充其他CC源码Hooks

**学习目标**: 阅读 `cc_code/backend/hooks/` 中其他Hook文件

**实施内容**:
- 补充 `useVoice.ts` - 语音输入Hook
- 补充 `usePrStatus.ts` - PR状态Hook
- 补充 `useDiffData.ts` - 差异数据Hook
- 补充 `useMemoryUsage.ts` - 内存使用Hook

**验证标准**:
- [ ] 各Hook可正确工作
- [ ] 与对应模块集成正确

---

## 5. 质量保证

### 5.1 代码质量

- React Hooks遵循Hooks规则（顶层调用、不条件调用）
- 使用 `@modules/cost`、`@modules/error`、`@modules/hooks` 别名导入
- Hooks与Zustand Store兼容

### 5.2 测试要求

| 任务 | 测试方式 |
|------|----------|
| useCanUseTool | 验证权限检查、拒绝追踪 |
| useSettings | 验证设置读写、持久化、通知 |
| useMergedTools | 验证工具合并、冲突处理 |
| useTypeahead | 验证补全触发、过滤、选择 |
| useReplBridge | 验证桥接IO |
| useCostSummary | 验证成本摘要输出 |

### 5.3 验证命令

```bash
bun run modules:validate    # 验证依赖关系
bun run modules:check       # 完整检查
```

---

## 6. 风险评估

| 风险 | 影响 | 概率 | 应对方案 |
|------|------|------|----------|
| Hooks与Zustand冲突 | 状态管理异常 | 中 | 充分测试兼容性 |
| useCanUseTool权限判断错误 | 安全风险 | 低 | 参考CC源码权限逻辑 |
| 工具合并性能 | UI卡顿 | 低 | 使用memoize缓存合并结果 |
| 设置持久化失败 | 设置丢失 | 低 | 实现备份和恢复机制 |

---

## 7. 里程碑

| 阶段 | 目标 | Cost | Error | Hooks |
|------|------|------|-------|-------|
| 阶段一完成 | 核心Hooks | 85% | 80% | 35% → 50% |
| 阶段二完成 | 交互Hooks+Cost | 85% → 90% | 80% | 50% → 58% |
| 阶段三完成 | Error兼容 | 90% | 80% → 85% | 58% |
| 阶段四完成 | 其他Hooks | 90% | 85% | 58% → 65% |

---

## 附录：项目规则参考

### A.1 模块管理规则

#### A.1.1 模块管理系统架构

PY_APP采用统一的模块管理系统，包含以下核心组件：

- **模块注册表** (`src/modules/ModuleRegistry.ts`) - 管理模块注册、查找和依赖解析
- **导入管理器** (`src/modules/ImportManager.ts`) - 统一管理模块导入路径
- **模块定义** (`src/modules/ModuleDefinitions.ts`) - 统一定义所有模块信息
- **模块初始化器** (`src/modules/ModuleInitializer.ts`) - 管理模块生命周期

#### A.1.2 核心设计原则

1. **统一管理**: 所有模块必须通过模块管理系统进行管理
2. **标准分类**: 模块按功能分为8个标准类别
3. **依赖管理**: 自动解析模块依赖关系，避免循环依赖
4. **别名路径**: 统一使用 `@modules/模块名` 格式的别名路径

#### A.1.3 模块分类标准

| 分类 | 标识 | 描述 | 示例模块 |
|------|------|------|----------|
| 核心模块 | `core` | 核心功能模块 | core, infrastructure |
| 功能模块 | `ai` | AI相关功能 | ai, agent, bridge |
| 界面模块 | `ui` | 用户界面相关 | ui, cli |
| 工具模块 | `tools` | 工具管理 | tools, commands |
| 数据模块 | `memory` | 数据存储管理 | memory, cache |
| 系统模块 | `security` | 系统功能 | security, performance, monitoring |
| 其他模块 | `other` | 其他功能模块 | analytics, buddy, chat等 |

#### A.1.4 模块命名规范

- **目录命名**: 使用小写字母，连字符分隔（如：`memory-management`）
- **文件命名**: 使用PascalCase（如：`MemoryManager.ts`）
- **接口命名**: 以`I`开头（如：`IMemoryService.ts`）

#### A.1.5 模块导入规范

**必须使用别名路径**:
```typescript
// ✅ 正确
import { Agent } from '@modules/agent';
import { AI } from '@modules/ai';

// ❌ 错误
import { Agent } from '../../agent/agent.ts';
import { AI } from '@/ai/AIModelManager.ts';
```

#### A.1.6 错误处理规范

```typescript
import { ModuleError } from '@modules/errors';

try {
  await module.initialize();
} catch (error) {
  throw new ModuleError(
    `初始化失败: ${error.message}`,
    moduleId,
    'INIT_FAILED'
  );
}
```

### A.2 模块开发快速参考

#### A.2.1 创建新模块步骤

1. **确定模块分类**
   ```typescript
   // 在ModuleDefinitions.ts中添加
   'my-new-module': {
     id: 'my-new-module',
     name: 'my-new-module',
     displayName: '我的新模块',
     version: '1.0.0',
     category: ModuleCategory.OTHER,
     description: '模块功能描述',
     dependencies: ['core', 'infrastructure'],
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

#### A.2.2 常用命令

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

#### A.2.3 LLM开发必须遵守的规则

1. **导入路径**: 必须使用 `@modules/模块名` 格式
2. **模块注册**: 新模块必须在 `ModuleDefinitions.ts` 中定义
3. **分类标准**: 必须按照8个标准分类选择
4. **依赖声明**: 必须明确声明所有依赖关系
5. **测试要求**: 新功能必须包含测试用例

#### A.2.4 开发检查清单

- [ ] 使用了正确的别名路径导入
- [ ] 模块在 ModuleDefinitions.ts 中注册
- [ ] 选择了正确的模块分类
- [ ] 声明了所有依赖关系
- [ ] 编写了相应的测试用例
- [ ] 更新了模块文档
- [ ] 运行了模块系统测试

### A.3 常见问题解决方案

#### 错误1: 模块找不到
```
Error: Module xxx not found
```
**解决方案**: 
- 检查模块是否在 `ModuleDefinitions.ts` 中注册
- 运行 `bun run modules:analyze` 分析问题

#### 错误2: 循环依赖
```
Error: Circular dependency detected
```
**解决方案**:
- 运行 `bun run modules:validate` 分析依赖
- 重构模块设计，提取公共功能

#### 错误3: 导入路径错误
```
Error: Cannot find module
```
**解决方案**:
- 确保使用 `@modules/模块名` 格式
- 检查别名路径映射是否正确
