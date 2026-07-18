# Logger / OTel / HandlerError 全量覆盖分析报告

> 日期: 2026-07-18 | 扫描范围: `app/src/` 全部 `.ts` / `.tsx`（约 850 个文件）
>
> 排除: `__tests__/`, `node_modules/`, `dist/`

---

## 目录

1. [执行摘要](#1-执行摘要)
2. [Logger 覆盖](#2-logger-覆盖)
3. [OTel 覆盖](#3-otel-覆盖)
4. [HandlerError 覆盖](#4-handlererror-覆盖)
5. [空 catch 清单](#5-空-catch-清单)
6. [模块交叉分析](#6-模块交叉分析)
7. [修复建议与优先级](#7-修复建议与优先级)

---

## 1. 执行摘要

| 指标 | 当前值 | 目标值 | 差距 |
|------|:---:|:---:|:---:|
| Logger 接入率 | ~38% | 80% | 需接入 360+ 文件 |
| OTel 接入率 | 2-10%（核心路径 100%） | 核心路径已完成 | 低优先级 |
| HandlerError 接入率 | ~23% | 90% | 需修改 280+ 个 catch 块 |
| **空 catch 块** | **25 处** | 0 | P0 安全风险 |
| console 违规 | 91 个文件 | <5（CLI 除外） | 需清理 70+ 文件 |

### 总体评估

- **OTel** 基础设施完整，核心调用链路已全面 Span 化。当前覆盖策略正确（选择性埋点，核心路径优先），无需全量展开。
- **Logger** 分布极不均：`services/mcp/` 100%，`utils/` 仅 10%。CLI 层大量使用 console 做终端交互是设计选择而非缺陷。
- **HandlerError** 接入率过低（23%），25 处空 catch 是最大风险。`chat/ChatManager.ts` 独占 17 处无注释空 catch。
- **本次 OAuth/MCP 模块修复后**：OAuth Logger 接入率从 29%→67%，MCP 增强层从 38%→69%，所有已知空 catch 已消除。

---

## 2. Logger 覆盖

### 2.1 按模块统计

| 模块 | 文件数 | 已接入 | 接入率 | console 违规 |
|------|:---:|:---:|:---:|:---:|
| `services/mcp/` | 52 | 52 | **100%** | 0 |
| `infrastructure/` | 40 | 22 | **55%** | 2 |
| `mcp/`（增强层） | 16 | 6→11 | **38%→69%** ⬆️ | 2 |
| `ai/` | 160 | 51 | **32%** | 0 |
| `config/` | 54 | 17 | **31%** | 1 |
| `core/` | 160 | 49 | **31%** | 1 |
| `session/` | 115 | 35 | **30%** | 0 |
| `tools/` | 220 | 64 | **29%** | 4 |
| `oauth/` | 28 | 8→15 | **29%→67%** ⬆️ | 0 |
| `chat/` | 48 | 13 | **27%** | 1 |
| `monitoring/` | 60 | 14 | **23%** | 3* |
| `commands/` | 150 | 24 | **16%** | 8 |
| `error/` | 20 | 3 | **15%** | 0 |
| `channels/` | 140 | 16 | **11%** | 5 |
| `utils/` | 89 | 9 | **10%** | 3 |

> ⬆️ 标记为本次修复后的提升值。`services/mcp/` 接入率 100% 说明标准层规范执行良好。
> `*` monitoring 的 console 在 Logger 自身实现中是合法 fallback。

### 2.2 console 违规 Top 10

| 文件 | 行数 | 类型 | 说明 |
|------|:---:|------|------|
| `cli/handlers/*` (~7文件) | 16 | CLI | 使用 chalk + console 做终端输出 |
| `commands/builtin/onboard/Onboard.ts` | 231 | CLI | 登录/配置向导 |
| `commands/builtin/init/Init.ts` | ~50 | CLI | 项目初始化向导 |
| `entrypoints/repl.ts` | 1077 | CLI | REPL 入口 |
| `mcp/cli/mcpCommand.ts` | 41 | MCP CLI | MCP 命令交互 |
| `channels/wechat/cli-manager.ts` | ~5 | 通道 CLI | 微信通道管理 |
| `tools/ImageGenerateTool/contract/live-test-helpers.ts` | ~3 | 测试 | 实时测试辅助 |
| `docs/HelpSystem.ts` | 4 | 文档 | 帮助系统输出 |
| `monitoring/logs/Logger.ts` | ~3 | 合法 | Logger 自身的 fallback 输出 |
| `ui/TerminalUIIntegration.ts` | ~5 | UI | 终端 UI 渲染 |

> CLI 层 console 是设计选择：终端用户需要看到输出。规范上应统一到 Logger 或 `process.stdout.write`，当前已按此方向修复了 `OAuthCliHelper.ts`。

---

## 3. OTel 覆盖

### 3.1 三层架构

```
业务层（Span 创建）
  ├── ai/router/*         100%（4 个 Router 均有 Span）
  ├── session/*            6 文件（核心操作 Span 化）
  ├── tools/*              6 文件（image.generate, tts 等）
  ├── chat/ChatManager     3 处 Span
  └── acp/                 1 文件
      ↓ getOTelTracing()
桥接层（事件→Span 映射）
  ├── EventBusOTelBridge    编排事件→Span
  ├── TraceBridge           Trace→OTel Span
  ├── MetricsBridge         指标→OTel Metrics
  └── CostMetricsBridge     cost→OTel
      ↓
基础设施层（SDK 封装）
  ├── OTelTracing           startSpan/endSpan/addEvent
  ├── OTelMetrics           Counter/Histogram/UpDownCounter
  └── OTelLoggerAdapter     Span 上下文注入日志
```

### 3.2 按模块接入率

| 模块 | 文件数 | OTel 接入 | 接入率 | 评估 |
|------|:---:|:---:|:---:|------|
| `monitoring/otel/` | 9 | 9 | **100%** | OTel 核心实现 |
| `cost/` | 18 | 4 | **22%** | 成本指标桥接 |
| `core/events/` | — | 1 | — | EventBusOTelBridge |
| `ai/router/` | 4 | 4 | **100%** | 每个 Router 路径 |
| `session/` | 115 | 6 | **5%** | 核心操作已覆盖 |
| `tools/` | 220 | 6 | **3%** | 生图/分析/TTS |
| `error/` | 20 | 1 | **5%** | handleError 关联 Span |
| `chat/` | 48 | 2 | **4%** | ChatManager + PathGuard |
| `infrastructure/` | 40 | 3 | **8%** | HTTP / ws |
| `channels/` | 140 | 0 | **0%** | 仅应用级 telemetry |
| `mcp/`（全部） | 68 | 0 | **0%** | 无 OTel 接入 |
| `oauth/` | 28 | 0 | **0%** | 无 OTel 接入 |

### 3.3 结论

**OTel 采用选择性埋点策略，核心路径优先 — 策略正确。** Channels、MCP、OAuth 模块没有 OTel 接入，但这不是紧急问题：这些模块的核心调用链路已通过 EventBusOTelBridge 间接进入 OTel 管道。全量展开需评估 ROI。

---

## 4. HandlerError 覆盖

### 4.1 整体统计

| 指标 | 当前值 |
|------|:---:|
| 全量文件数（含 catch 块） | ~850 |
| 已接入 handleError 的文件数 | ~195 |
| 接入率 | **~23%** |
| 手写 logger.error 的 catch 块 | ~110 个 |
| 空 catch 块（无声吞错） | **25 处** |
| 仅 throw 无日志的 catch 块 | ~60 个 |

### 4.2 按模块 HandlerError 接入率

| 模块 | catch 总数 | handleError | 接入率 | 空 catch |
|------|:---:|:---:|:---:|:---:|
| `infrastructure/http/handlers/` | ~30 | 17 | **55%** | 0 |
| `infrastructure/http/` | ~50 | 8 | **16%** | 0 |
| `services/mcp/` | ~60 | 13 | **22%** | 0（已修复） |
| `channels/` | ~35 | 6 | **17%** | 0 |
| `chat/` | ~40 | 5 | **13%** | **17** |
| `ai/` | ~55 | 8 | **15%** | 3 |
| `tools/` | ~70 | 12 | **17%** | 1 |
| `session/` | ~40 | 3 | **8%** | 0 |
| `core/` | ~30 | 5 | **17%** | 0 |
| `oauth/` | 26 | 1→3 | **4%→12%** ⬆️ | 0（已修复） |
| `mcp/`（增强层） | ~30 | 1→4 | **3%→13%** ⬆️ | 0（已修复） |

### 4.3 合规的 catch 模式（handleError + logger）

```typescript
// ✅ 合规：handleError 统一处理
catch (err) {
  await handleError(err, { module: 'xxx', action: 'yyy' });
}

// ✅ 合规：预期内的业务错误 + logger
catch (error) {
  if (error instanceof OAuthError && error.code === 'OAUTH_AUTHORIZATION_PENDING') {
    continue;
  }
  await handleError(error, { module: 'oauth:flows', action: 'poll' });
  throw error;
}
```

### 4.4 半合规的 catch 模式（有 logger 但无 handleError）

```typescript
// ⚠️ 半合规：有日志但未调 handleError（违反 §1.9）
catch (error) {
  logger.error('Token refresh failed', error);
  throw error;
}
```

---

## 5. 空 catch 清单

### 5.1 已修复（本次）

| 文件 | 行号 | 修复前 | 修复后 |
|------|:---:|------|------|
| `oauth/providers/BaseOAuthProvider.ts` | 120 | `catch {}` 空 | `logger.warn('Token revocation failed...')` |
| `oauth/utils/OAuthCliHelper.ts` | 27-28 | `console.log` 违规 | `process.stdout.write` |
| `services/mcp/auth/MCPOAuthProvider.ts` | 81 | `catch {}` 空 | `logger.warn('MCP OAuth token revocation failed...')` |
| `services/mcp/normalization.ts` | 69 | `catch { return uri }` 无声降级 | `logger.debug(...)` + return |
| `mcp/MCPAutoDiscovery.ts` | 108/158/188 | 3 处空 catch | 均添加 `logger.debug(...)` |

### 5.2 尚未修复（严重）

| # | 文件 | 行号 | 内容 | 风险 |
|:---:|------|:---:|------|:---:|
| 1 | `chat/ChatManager.ts` | 多处 | **17 处** 无注释空 catch | 🔴 最高 |
| 2 | `core/extensibility/ExtensionRegistry.ts` | 2 处 | 加载失败无声跳过 | 🔴 |
| 3 | `ai/ToolCallQueueManager.ts` | 1 处 | 空 catch | 🟡 |
| 4 | `ai/chat/hooks/ChatHookSystem.ts` | 1 处 | 空 catch | 🟡 |
| 5 | `agent/agents/LocalAgentManager.ts` | 1 处 | 空 catch | 🟡 |
| 6 | `agent/AgentRunner.ts` | 1 处 | `catch {}` 空 | 🟡 |
| 7 | `tools/ExecutorTool/ExecutorTool.ts` | 1 处 | 空 catch | 🟡 |

> **注意**：ChatManager.ts 的 17 处空 catch 是存量问题，需专项修复。其余 8 处分散在不同模块。

---

## 6. 模块交叉分析

### 6.1 三维覆盖热力图

| 模块 | Logger | OTel | handleError | 综合评级 |
|------|:---:|:---:|:---:|:---:|
| `services/mcp/` | 🟢 100% | 🔴 0% | 🟡 22% | B+ |
| `infrastructure/` | 🟡 55% | 🟡 8% | 🟢 55% | B+ |
| `ai/router/` | 🟡 32% | 🟢 100% | 🟡 15% | B |
| `session/` | 🟡 30% | 🟡 5% | 🟡 8% | C+ |
| `tools/` | 🟡 29% | 🟡 3% | 🟡 17% | C+ |
| `oauth/` | 🟡 67% | 🔴 0% | 🟡 12% | C+ ⬆️ |
| `mcp/`（增强层） | 🟡 69% | 🔴 0% | 🟡 13% | C+ ⬆️ |
| `chat/` | 🟡 27% | 🟡 4% | 🟡 13% | C- |
| `channels/` | 🔴 11% | 🔴 0% | 🟡 17% | D- |
| `error/` | 🟡 15% | 🟡 5% | N/A | C |
| `utils/` | 🔴 10% | N/A | N/A | D |

> 🟢 ≥60% 🟡 20-59% 🔴 <20%

### 6.2 模式发现

1. **Logger 先行，handleError 滞后**：Logger 接入率（38%）高于 handleError（23%），说明项目先统一了日志，再逐步统一错误处理。

2. **基础设施模块表现最好**：`services/mcp/`（100%/100%/22%）和 `infrastructure/`（55%/8%/55%）在 Logger 和 handleError 上都是标杆。

3. **OTel 是设计选择而非缺失**：0% 接入率不代表缺陷 — OTel 通过桥接层间接覆盖，选择性埋点是正确的。

4. **CLI 层是特殊场景**：`cli/`、`commands/`、`entrypoints/` 使用 console 做用户交互是合理的，但应与 Logger 日志分离。

---

## 7. 修复建议与优先级

### P0 — 立即修复（安全风险）

| # | 项目 | 说明 |
|:---:|------|------|
| 1 | **空 catch 修复** | 25 处 → 0，ChatManager.ts 17 处优先 |
| 2 | **handleError 全量接入** | catch 块中 110 处手写 logger.error → handleError |

### P1 — 短期（1-2周）

| # | 项目 | 说明 |
|:---:|------|------|
| 3 | **Logger 补齐** | 优先 channels（11%）、utils（10%）、error（15%） |
| 4 | **console 统一** | CLI 层 console → process.stdout.write 或 Logger |
| 5 | **MCP/OAuth OTel 埋点** | 对关键的 OAuth token 交换、MCP 工具调用路径 |

### P2 — 中期（2-4周）

| # | 项目 | 说明 |
|:---:|------|------|
| 6 | **channels OTel** | 通道消息入站/出站 Span 化 |
| 7 | **agent 模块 handleError** | agent 93 个文件中仅 1 个接入 |

### 模块修复优先级排序

```
Priority 1: chat/ChatManager.ts (17 空 catch)
Priority 2: channels/ (Logger 11% + handleError 17%)
Priority 3: utils/ (Logger 10%)
Priority 4: agent/ (handleError 0)
Priority 5: core/extensibility/ (空 catch)
Priority 6: 其余分散空 catch
```

---

> 报告生成时间: 2026-07-18 | 扫描引擎: Grep + SearchCodebase
