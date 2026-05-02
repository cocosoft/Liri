# Context/Query 模块实施方案

**编制日期**: 2026-05-01
**模块范围**: context、query
**对标状态**: 🟡 部分对标（Context约70%、Query约55%）
**对标分析报告**: [07-Context-Query模块对标分析.md](./07-Context-Query模块对标分析.md)

---

## 1. 实施目标

- Context模块对标完成度从 **50%** 提升至 **70%**
- Query模块对标完成度从 **35%** 提升至 **65%**，重点补充查询循环、Token预算和自动压缩

---

## 2. 适用项目规则

### 2.1 模块管理规则（来源：`.trae/rules/module_management_rules.md`）

| 规则 | 要求 | 本模块适用说明 |
|------|------|---------------|
| 别名路径导入 | 必须使用 `@modules/模块名` 格式 | 使用 `@modules/context`、`@modules/query` |
| 模块分类 | 所有模块必须按8个标准分类组织 | context属于其他模块，query属于其他模块 |
| 依赖声明 | 必须明确声明模块依赖关系 | context依赖core，query依赖core和ai |
| 模块注册 | 新模块必须在 `ModuleDefinitions.ts` 中注册 | 确保context和query已正确注册 |

### 2.2 开发规范（来源：`.trae/rules/project_rules.md`）

| 规则 | 要求 | 本模块适用说明 |
|------|------|---------------|
| 严禁重复造轮子 | 先学习CC源码，直接复用成熟方案 | QueryEngine参考CC源码 `QueryEngine.ts` |
| 仅学习CC源码 | 严禁修改 `cc_code/` 下的任何文件 | 所有修改仅限 `backend/src/` 目录 |
| 不删除现有代码 | 仅新增或修改，不删除 | 保持现有架构，保持向后兼容 |
| 代码复用 | 项目中的各种方法严禁出现重复情况 | 确保方法可复用、可继承 |
| 测试要求 | 新功能必须包含相应的测试用例 | 每个任务都要有测试 |

### 2.3 架构哲学（来源：`.trae/rules/project_rules.md` §6）

#### 2.3.1 TAOR循环设计原则
- Orchestrator极其愚蠢：只负责驱动循环、执行工具、感知结果
- 所有推理、决策、何时停止，全部交给模型
- QueryEngine是TAOR循环的核心实现

#### 2.3.2 上下文管理策略（三级压缩 + 熔断器）

| 压缩级别 | 触发条件 | 策略 |
|----------|----------|------|
| Level 1: 轻量压缩 | Token使用率 > 50% | 清理旧工具结果 |
| Level 2: 自动压缩 | Level 1不足 | 用LLM摘要替换历史 |
| Level 3: 强制压缩 | 达到API限制 | 激进裁剪上下文 |
| **熔断器** | 连续失败3次 | 停止压缩，防止死循环 |

#### 2.3.3 核心引擎层定位
- QueryEngine位于核心引擎层（TypeScript）
- 职责：QueryEngine / TAOR Loop / 权限系统 / 会话管理

### 2.4 安全规则（来源：`.trae/rules/project_rules.md` §7）

| 安全检查项 | 说明 |
|------------|------|
| 阻止危险Zsh内置命令 | 防止恶意命令执行 |
| 防御Zsh equals expansion | 防止`=curl`绕过 |
| Unicode零宽字符注入检测 | 防止隐形字符攻击 |
| IFS null-byte注入防护 | 防止环境变量注入 |
| 环境变量污染检测 | 防止PATH等变量被篡改 |
| 阻止`rm -rf /`等破坏性操作 | 保护系统安全 |
| Shell命令转义和引号验证 | 防止命令注入 |

---

## 3. 实施原则

### 3.1 核心原则

1. **学习-执行-测试-标注流程**
   ```
   学习CC源码对应实现 → 理解设计思路 → 执行编码 → 测试验证 → 标注完成
   ```

2. **渐进式增强策略**
   - 保持现有系统正常运行
   - 在现有基础上逐步增强
   - 每个阶段独立可交付
   - 分阶段验证，降低风险

3. **质量原则**
   - 遵循项目现有代码风格
   - 添加必要的函数级注释
   - 保持代码可读性
   - 每个功能都要有测试

### 3.2 模块开发检查清单

- [x] 使用了正确的别名路径导入
- [x] 模块在 `ModuleDefinitions.ts` 中注册
- [x] 选择了正确的模块分类
- [x] 声明了所有依赖关系
- [x] 编写了相应的测试用例
- [x] 更新了模块文档
- [x] 运行了模块系统测试

---

## 4. 任务分解

### 阶段一：QueryEngine核心完善（🔴 高优先级）

#### 任务 1.1：完善查询循环实现

**学习目标**: 阅读 `cc_code/backend/QueryEngine.ts` 完整实现

**实施内容**:
- 增强 `backend/src/query/QueryEngine.ts`
- 实现完整的查询循环：用户输入 → API调用 → 工具执行 → 结果返回
- 支持多种查询模式（交互式、非交互式、SDK模式）
- 实现消息标准化处理

**验证标准**:
- [x] 查询循环可完整执行
- [x] 交互式和非交互式模式均可工作
- [x] 工具调用可正确执行和返回

#### 任务 1.2：实现 Token 预算管理

**学习目标**: 阅读 `cc_code/backend/query/tokenBudget.ts`

**实施内容**:
- 在 `backend/src/query/` 下新增 `TokenBudget.ts`
- 实现Token预算计算和分配
- 实现Token使用追踪
- 实现预算超限预警

**验证标准**:
- [x] Token预算可正确计算
- [x] 使用量可实时追踪
- [x] 预算超限可预警

#### 任务 1.3：实现自动压缩（AutoCompact）✅ 已完成

**学习目标**: 阅读 `cc_code/backend/services/compact/`

**实施内容**:
- 在 `backend/src/query/QueryEngine.ts` 中实现自动压缩
- 实现上下文自动压缩
- 参考三级压缩策略（Level 1/2/3）
- 实现熔断器机制

**验证标准**:
- [x] Token使用率>60%时触发Level 1（轻度压缩）
- [x] Token使用率>75%时触发Level 2（中等压缩）
- [x] Token使用率>90%时触发Level 3（深度压缩）
- [x] 压缩事件已记录到analytics

### 阶段二：Context增强（🔴 高优先级）

#### 任务 2.1：补充 React 上下文 ✅ 已完成

**学习目标**: 阅读 `cc_code/backend/context/` 目录

**实施内容**:
- 在 `backend/src/context/` 下补充React上下文
- 实现 `StatsContext.tsx` - 统计上下文（Token计数、消息数量、工具调用次数等）
- 实现 `MailboxContext.tsx` - 邮箱上下文（通知、消息管理）
- 实现 `FPSMetricsContext.tsx` - FPS指标上下文（帧率性能跟踪）
- 实现 `VoiceContext.tsx` - 语音上下文（语音输入输出状态管理）
- 与Zustand Store集成

**验证标准**:
- [x] React上下文可被组件使用（提供useStats、useMailbox、useFPSMetrics、useVoice钩子）
- [x] 上下文数据可正确传递
- [x] 与现有Zustand Store兼容

#### 任务 2.2：补充 memoize 缓存优化 ✅ 已完成

**学习目标**: 阅读 `cc_code/backend/context.ts` 中memoize使用

**实施内容**:
- 在 `backend/src/context/ContextBuilder.ts` 中添加memoize缓存
- 缓存getUserContext、getSystemContext、buildSystemPrompt计算结果
- 实现缓存破坏机制（cacheBuster）

**验证标准**:
- [x] 重复调用使用缓存结果
- [x] 缓存可通过invalidateCache()失效
- [x] 提供clearCache()方法清理所有缓存

#### 任务 2.3：深化 Claude.md 集成 ✅ 已完成

**学习目标**: 阅读 `cc_code/backend/context.ts` 中Claude.md集成

**实施内容**:
- 在 `backend/src/context/` 下新增 `ClaudeMdIntegration.ts`
- 实现Claude.md文件解析和规则提取
- 支持提取行为准则、编码标准、审查清单、样式偏好等规则
- 支持从项目目录加载Claude.md文件

**验证标准**:
- [x] Claude.md文件可正确加载和解析
- [x] 可提取行为准则、编码标准、审查清单、样式偏好
- [x] 提供`createClaudeMdIntegration`工厂函数

### 阶段三：Query辅助功能（🟡 中优先级）

#### 任务 3.1：实现工具调用摘要 ✅ 已完成

**学习目标**: 阅读 `cc_code/backend/services/toolUseSummary/`

**实施内容**:
- 在 `backend/src/query/` 下新增 `ToolUseSummary.ts`
- 实现工具调用结果的摘要生成
- 在Token预算紧张时自动摘要
- 支持批量摘要生成

**验证标准**:
- [x] 工具调用结果可生成摘要
- [x] 摘要可替代完整结果（保留关键信息）
- [x] 支持配置摘要长度阈值

#### 任务 3.2：实现停止钩子 ✅ 已完成

**学习目标**: 阅读 `cc_code/backend/query/stopHooks.ts`

**实施内容**:
- 在 `backend/src/query/` 下新增 `StopHooks.ts`
- 实现查询停止时的钩子执行
- 支持自定义停止钩子
- 支持多种停止原因（completed、aborted、error、timeout、max_turns）
- 支持钩子优先级排序

**验证标准**:
- [x] 停止钩子可注册和执行
- [x] 钩子执行不阻塞停止流程
- [x] 支持优先级排序和异步钩子
- [x] QueryEngine集成停止钩子，在完成、错误、中止时自动执行

#### 任务 3.3：深化重试机制 ✅ 已完成

**学习目标**: 阅读 `cc_code/backend/services/api/withRetry.ts`

**实施内容**:
- 增强 `backend/src/query/withRetry.ts`
- 实现更完善的重试策略（指数退避、固定间隔）
- 添加可配置的重试条件（retryOn、delayCalculator）
- 添加重试前后回调（onBeforeRetry、onAfterRetry）
- 添加总重试时间限制
- 新增 `withRetryEnhanced` 和 `withRetryWithTimeout`

**验证标准**:
- [x] 重试策略可配置（指数退避、固定间隔）
- [x] 重试条件可自定义（retryOn回调）
- [x] 支持总重试时间限制
- [x] 支持重试回调钩子

### 阶段四：高级压缩功能（🟢 低优先级）✅ 已完成

#### 任务 4.1：实现上下文折叠 ✅ 已完成

**学习目标**: 阅读 `cc_code/backend/` 中ContextCollapse相关实现

**实施内容**:
- 在 `backend/src/query/` 下新增 `ContextCollapse.ts`
- 实现上下文折叠（将长上下文折叠为摘要）
- 保留最近消息，对早期消息生成摘要

**验证标准**:
- [x] 上下文可折叠（超过Token限制时自动触发）
- [x] 折叠后关键信息保留（用户请求、关键点提取）

#### 任务 4.2：实现响应式压缩 ✅ 已完成

**学习目标**: 阅读 `cc_code/backend/services/compact/` 中ReactiveCompact

**实施内容**:
- 在 `backend/src/query/` 下新增 `ReactiveCompact.ts`
- 实现响应式压缩（根据API响应动态压缩）
- 支持四级压缩级别（none/light/medium/heavy）

**验证标准**:
- [x] API返回超限时自动压缩（413错误、context limit错误）
- [x] 压缩后请求可成功
- [x] 支持根据Token使用率动态调整压缩级别

### 阶段五：深度集成（🔴 高优先级）✅ 已完成

#### 任务 5.1：补充FPS指标上下文 ✅ 已完成

**学习目标**: 阅读 `cc_code/context/fpsMetrics.tsx`

**实施内容**:
- 在 `backend/src/context/` 下新增 `FPSMetricsContext.tsx`
- 实现帧率性能指标跟踪
- 支持实时FPS监控、丢帧检测、平滑度判断

**验证标准**:
- [x] 可跟踪实时帧率（FPS）
- [x] 可检测丢帧情况
- [x] 可判断应用是否流畅

#### 任务 5.2：补充语音上下文 ✅ 已完成

**学习目标**: 阅读 `cc_code/context/voice.tsx`

**实施内容**:
- 在 `backend/src/context/` 下新增 `VoiceContext.tsx`
- 实现语音输入/输出状态管理
- 支持静音切换功能

**验证标准**:
- [x] 可管理语音状态（idle/listening/speaking/processing）
- [x] 支持静音切换
- [x] 提供useVoice钩子

#### 任务 5.3：实现Claude.md集成 ✅ 已完成

**学习目标**: 阅读 `cc_code/context.ts` 中Claude.md集成

**实施内容**:
- 在 `backend/src/context/` 下新增 `ClaudeMdIntegration.ts`
- 实现Claude.md文件解析
- 支持提取行为准则、编码标准等规则

**验证标准**:
- [x] 可加载和解析Claude.md文件
- [x] 可提取各类规则信息

#### 任务 5.4：实现Token预算管理 ✅ 已完成

**学习目标**: 阅读 `cc_code/query/tokenBudget.ts`

**实施内容**:
- 在 `backend/src/query/` 下新增 `TokenBudget.ts`
- 实现Token预算管理和警告机制
- 支持预算状态检查和压缩级别建议

**验证标准**:
- [x] 可跟踪Token使用情况
- [x] 可触发警告和临界状态
- [x] 可建议压缩级别

### 阶段六：结构化完善（🟢 低优先级）✅ 已完成

#### 任务 6.1：实现查询配置管理 ✅ 已完成

**学习目标**: 阅读 `cc_code/query/config.ts`

**实施内容**:
- 在 `backend/src/query/` 下新增 `config.ts`
- 定义查询引擎的默认配置和配置选项
- 实现QueryConfigManager配置管理器

**验证标准**:
- [x] 提供默认查询配置
- [x] 支持配置更新和重置
- [x] 提供配置管理器

#### 任务 6.2：实现查询依赖管理 ✅ 已完成

**学习目标**: 阅读 `cc_code/query/deps.ts`

**实施内容**:
- 在 `backend/src/query/` 下新增 `deps.ts`
- 统一管理QueryEngine所需的依赖项
- 支持依赖别名解析

**验证标准**:
- [x] 支持依赖注册和获取
- [x] 支持别名解析
- [x] 提供全局依赖管理器

#### 任务 6.3：完善TokenBudgetManager ✅ 已完成

**实施内容**:
- 更新TokenBudgetState接口，添加status、shouldCompact等字段
- 添加TokenBudgetStatus枚举
- 添加recordUsage方法
- 添加warningMessage提示信息

**验证标准**:
- [x] 支持预算状态检查
- [x] 支持使用量记录
- [x] 支持警告信息提示

---

## 5. 质量保证

### 5.1 代码质量

- QueryEngine遵循TAOR循环设计原则
- 使用 `@modules/context`、`@modules/query` 别名导入
- 压缩策略参考三级压缩+熔断器策略
- 添加必要的函数级注释
- 保持代码可读性

### 5.2 测试要求

| 任务 | 测试方式 |
|------|----------|
| 查询循环 | 验证完整循环执行、多种模式 |
| Token预算 | 验证预算计算、使用追踪、超限预警 |
| 自动压缩 | 验证三级压缩、熔断器 |
| React上下文 | 验证数据传递、组件集成 |
| 工具摘要 | 验证摘要生成、质量 |
| 停止钩子 | 验证钩子执行 |

### 5.3 验证命令

```bash
bun run modules:validate    # 验证依赖关系
bun run modules:check       # 完整检查
bun run modules:test        # 测试模块系统
bun run modules:analyze     # 分析模块状态
```

---

## 6. 风险评估

| 风险 | 影响 | 概率 | 应对方案 |
|------|------|------|----------|
| 查询循环死循环 | 资源耗尽 | 中 | 设置最大循环次数和超时 |
| 压缩丢失关键信息 | AI响应质量下降 | 中 | 熔断器保护，关键信息优先保留 |
| Token预算计算不准 | 压缩时机错误 | 低 | 使用安全系数，提前触发 |
| React上下文性能 | 渲染变慢 | 低 | 使用memoize缓存 |

---

## 7. 里程碑

| 阶段 | 目标 | Context对标提升 | Query对标提升 | 状态 |
|------|------|----------------|---------------|------|
| 阶段一完成 | QueryEngine核心 | 50% | 35% → 50% | ✅ 已完成 |
| 阶段二完成 | Context增强 | 50% → 70% | 50% → 55% | ✅ 已完成 |
| 阶段三完成 | Query辅助 | 70% | 55% → 65% | ✅ 已完成 |
| 阶段四完成 | 高级压缩 | 70% | 65% → 70% | ✅ 已完成 |
| 阶段五完成 | 深度集成 | 70% → 90% | 70% → 90% | ✅ 已完成 |
| 阶段六完成 | 结构化完善 | 90% → 95% | 90% → 95% | ✅ 已完成 |

---

**规则文件版本**: 1.0.0  
**最后更新**: 2026-05-01  
**下次评审**: 2026-06-01