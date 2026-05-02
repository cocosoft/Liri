# Cost/Error/Hooks 模块对标分析报告

**分析日期**: 2026-05-01
**模块范围**: cost、error、hooks
**对标状态**: 🟢 超越对标（Cost/Error）、🟡 部分对标（Hooks）

---

## 1. Cost 模块

### 1.1 CC源码实现

CC源码的Cost功能分散在少量文件中：

| 文件 | 功能 |
|------|------|
| `costHook.ts` | 成本Hook（useCostSummary） |
| `cost-tracker.ts` | 成本跟踪器（核心） |

CC源码Cost的特点：
- `cost-tracker.ts` 提供核心成本跟踪功能
  - `getTotalCost()` - 获取总成本
  - `getModelUsage()` - 获取模型使用量
  - `getTotalAPIDuration()` - 获取API总时长
  - `saveCurrentSessionCosts()` - 保存会话成本
  - `formatTotalCost()` - 格式化成本显示
  - `accumulateUsage()` / `updateUsage()` - 累计/更新使用量
- `costHook.ts` 提供React Hook
  - `useCostSummary()` - 在进程退出时输出成本摘要
- 账单访问控制（`hasConsoleBillingAccess()`）

### 1.2 PY_APP实现

| 文件 | 功能 |
|------|------|
| `cost/index.ts` | 模块入口 |
| `cost/CostTracker.ts` | 成本跟踪器 |
| `cost/CostCache.ts` | 成本缓存 |
| `cost/CostMonitor.ts` | 成本监控 |
| `cost/CostPredictor.ts` | 成本预测 |
| `cost/CostReporter.ts` | 成本报告 |
| `cost/ModelPricing.ts` | 模型定价 |
| `cost/BillingAccessControl.ts` | 账单访问控制 |
| `cost/PricingManager.ts` | 定价管理 |
| `cost/EnhancedCostManager.ts` | 增强成本管理 |
| `cost/types.ts` | 类型定义 |

### 1.3 对比分析

| 维度 | CC源码 | PY_APP | 差异评估 |
|------|--------|--------|----------|
| 文件数量 | 2个文件 | 10+文件 | PY_APP更丰富 |
| 成本跟踪 | cost-tracker（核心） | CostTracker | 基本对标 |
| 成本缓存 | 无 | CostCache | PY_APP新增 |
| 成本监控 | 无 | CostMonitor | PY_APP新增 |
| 成本预测 | 无 | CostPredictor | PY_APP新增 |
| 成本报告 | formatTotalCost | CostReporter | PY_APP更完善 |
| 模型定价 | 内嵌 | ModelPricing + PricingManager | PY_APP更独立 |
| 账单控制 | hasConsoleBillingAccess | BillingAccessControl | PY_APP更独立 |
| 增强管理 | 无 | EnhancedCostManager | PY_APP新增 |
| React Hook | useCostSummary | 无 | CC源码独有 |

### 1.4 差距与建议

**PY_APP优势**:
1. 成本模块功能远超CC源码
2. 成本预测、监控、报告是创新功能
3. 模型定价和账单控制更独立

**需要改进**:
1. 🟡 中: 补充useCostSummary React Hook
2. 🟢 低: 确保与CC源码的cost-tracker API兼容

---

## 2. Error 模块

### 2.1 CC源码实现

CC源码的错误处理分散在多个位置：

| 文件 | 功能 |
|------|------|
| `utils/errors.ts` | 错误工具函数 |
| `services/api/errors.ts` | API错误 |
| `constants/errorIds.ts` | 错误ID常量 |
| `types/ids.ts` | ID类型定义 |

CC源码Error的特点：
- `errorMessage()` - 提取错误消息
- `ConfigParseError` - 配置解析错误
- `AbortError` - 中止错误
- `APIUserAbortError` - API用户中止错误
- `ImageSizeError` / `ImageResizeError` - 图片错误
- `FallbackTriggeredError` - 回退触发错误
- 错误ID常量集中管理
- API错误分类（`categorizeRetryableAPIError()`）

### 2.2 PY_APP实现

| 文件 | 功能 |
|------|------|
| `error/index.ts` | 模块入口 |
| `error/types.ts` | 错误类型定义 |
| `error/ErrorIds.ts` | 错误ID追踪 |
| `error/formatter.ts` | 错误格式化 |
| `error/safeLog.ts` | 安全日志 |
| `error/utils.ts` | 错误工具 |
| `error/ErrorHandler.ts` | 错误处理器 |
| `error/api/index.ts` | API错误 |
| `error/context/index.ts` | 上下文错误 |
| `error/models/types.ts` | 错误模型类型 |
| `error/network/index.ts` | 网络错误 |
| `error/ErrorManager.ts` | 错误管理器 |
| `error/monitor/ErrorMonitor.ts` | 错误监控 |
| `error/monitor/ExternalErrorMonitor.ts` | 外部错误监控 |
| `error/tracker/ErrorTracker.ts` | 错误追踪 |
| `error/recovery/ErrorRecoverer.ts` | 错误恢复 |
| `error/recovery/RetryStrategies.ts` | 重试策略 |

### 2.3 对比分析

| 维度 | CC源码 | PY_APP | 差异评估 |
|------|--------|--------|----------|
| 架构模式 | 分散在utils/services中 | 独立error模块 | PY_APP更结构化 |
| 错误分类 | 基本分类 | 完整分类体系 | PY_APP更完善 |
| 错误ID | errorIds常量 | ErrorIds追踪系统 | PY_APP更完善 |
| 错误处理 | 分散 | ErrorHandler集中处理 | PY_APP更集中 |
| 错误监控 | 无 | ErrorMonitor + ExternalErrorMonitor | PY_APP新增 |
| 错误追踪 | 无 | ErrorTracker | PY_APP新增 |
| 错误恢复 | 无 | ErrorRecoverer | PY_APP新增 |
| 重试策略 | withRetry | RetryStrategies | PY_APP更独立 |
| API错误 | services/api/errors | error/api/ | PY_APP更独立 |
| 网络错误 | 无 | error/network/ | PY_APP新增 |
| 上下文错误 | 无 | error/context/ | PY_APP新增 |

### 2.4 差距与建议

**PY_APP优势**:
1. 错误处理体系远超CC源码
2. 错误监控、追踪、恢复是创新功能
3. 错误分类更完整

**需要改进**:
1. 🟡 中: 确保与CC源码的错误类型兼容
2. 🟢 低: 补充图片相关错误类型

---

## 3. Hooks 模块

### 3.1 CC源码实现

CC源码的Hooks模块非常丰富，包含25+个Hook文件：

| 文件 | 功能 |
|------|------|
| `hooks/useAwaySummary.ts` | 离开摘要 |
| `hooks/useBlink.ts` | 闪烁效果 |
| `hooks/useCanUseTool.tsx` | 工具使用权限 |
| `hooks/useDiffData.ts` | 差异数据 |
| `hooks/useDiffInIDE.ts` | IDE差异 |
| `hooks/useDoublePress.ts` | 双击检测 |
| `hooks/useElapsedTime.ts` | 计时器 |
| `hooks/useIdeLogging.ts` | IDE日志 |
| `hooks/useInboxPoller.ts` | 收件箱轮询 |
| `hooks/useInputBuffer.ts` | 输入缓冲 |
| `hooks/useLogMessages.ts` | 日志消息 |
| `hooks/useMemoryUsage.ts` | 内存使用 |
| `hooks/useMergedTools.ts` | 合并工具 |
| `hooks/usePrStatus.ts` | PR状态 |
| `hooks/useReplBridge.tsx` | REPL桥接 |
| `hooks/useSSHSession.ts` | SSH会话 |
| `hooks/useSearchInput.ts` | 搜索输入 |
| `hooks/useSettings.ts` | 设置管理 |
| `hooks/useTasksV2.ts` | 任务管理V2 |
| `hooks/useTextInput.ts` | 文本输入 |
| `hooks/useTimeout.ts` | 超时处理 |
| `hooks/useTurnDiffs.ts` | 回合差异 |
| `hooks/useTypeahead.tsx` | 自动补全 |
| `hooks/useVimInput.ts` | Vim输入 |
| `hooks/useVoice.ts` | 语音输入 |

CC源码Hooks的特点：
- 深度集成React Hooks
- `useCanUseTool` 是核心Hook，管理工具使用权限
- `useSettings` 管理应用设置
- `useMergedTools` 合并工具列表
- `useTypeahead` 提供自动补全
- 大量Hook使用 `react/compiler-runtime` 优化

### 3.2 PY_APP实现

| 文件 | 功能 |
|------|------|
| `hooks/index.ts` | 模块入口 |
| `hooks/types/index.ts` | 类型定义 |
| `hooks/HookManager.ts` | Hook管理器 |
| `hooks/CancelRequest.ts` | 取消请求 |
| `hooks/useTimeout.ts` | 超时处理 |
| `hooks/useTerminalSize.ts` | 终端大小 |
| `hooks/useInputBuffer.ts` | 输入缓冲 |
| `hooks/useElapsedTime.ts` | 计时器 |
| `hooks/useHistorySearch.ts` | 历史搜索 |
| `hooks/cli/hooks.ts` | CLI Hooks |
| `hooks/executors/HookExecutor.ts` | Hook执行器 |
| `hooks/executors/CommandHookExecutor.ts` | 命令Hook执行器 |
| `hooks/executors/PromptHookExecutor.ts` | 提示词Hook执行器 |
| `hooks/executors/HttpHookExecutor.ts` | HTTP Hook执行器 |
| `hooks/executors/AgentHookExecutor.ts` | Agent Hook执行器 |
| `hooks/executors/ChatHookExecutor.ts` | 聊天Hook执行器 |
| `hooks/executors/StopHookExecutor.ts` | 停止Hook执行器 |

### 3.3 对比分析

| 维度 | CC源码 | PY_APP | 差异评估 |
|------|--------|--------|----------|
| Hook数量 | 25+ | 10+ | CC源码更丰富 |
| 工具权限 | useCanUseTool（核心） | 无 | CC源码独有 |
| 设置管理 | useSettings | 无 | CC源码独有 |
| 工具合并 | useMergedTools | 无 | CC源码独有 |
| 自动补全 | useTypeahead | 无 | CC源码独有 |
| REPL桥接 | useReplBridge | 无 | CC源码独有 |
| PR状态 | usePrStatus | 无 | CC源码独有 |
| 语音输入 | useVoice | 无 | CC源码独有 |
| Hook执行器 | 无 | 6种执行器 | PY_APP新增 |
| Hook管理器 | 无 | HookManager | PY_APP新增 |
| 历史搜索 | 无 | useHistorySearch | PY_APP新增 |
| React编译优化 | react/compiler-runtime | 无 | CC源码更优 |

### 3.4 差距与建议

**PY_APP优势**:
1. Hook执行器体系是创新点
2. HookManager提供统一管理
3. 历史搜索是新增功能

**需要改进**:
1. 🔴 高: 补充useCanUseTool（工具使用权限核心Hook）
2. 🔴 高: 补充useSettings（设置管理）
3. 🔴 高: 补充useMergedTools（工具合并）
4. 🟡 中: 补充useTypeahead（自动补全）
5. 🟡 中: 补充useReplBridge（REPL桥接）
6. 🟡 中: 补充useTextInput（文本输入）
7. 🟢 低: 补充useVoice、usePrStatus等

---

## 4. 总体评估

### Cost对标完成度: 🟢 超越对标 (约85%)
### Error对标完成度: 🟢 超越对标 (约80%)
### Hooks对标完成度: 🟡 部分对标 (约35%)

### 改进优先级

1. 🔴 高: 补充useCanUseTool Hook
2. 🔴 高: 补充useSettings Hook
3. 🔴 高: 补充useMergedTools Hook
4. 🟡 中: 补充useTypeahead Hook
5. 🟡 中: 补充useReplBridge Hook
6. 🟡 中: Cost补充useCostSummary Hook
7. 🟢 低: 补充其他CC源码Hooks
