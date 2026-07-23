# Cost/Token 模块对标分析报告

> 生成日期: 2026-07-23 | 基于代码实测 | 参考项目: cc_code、PilotDeck、hermes-agent、cc-switch、claude-tap

---

## 一、对标概述

### 1.1 对标范围

| 项目 | 语言 | Cost/Tracker 架构 | Token 来源 | 定价模型 | 定位 |
|------|------|-----------------|-------------|---------|------|
| **PY_APP** | TS + Rust | 3 套 CostTracker + 3 套 TokenBudget | 4 种估算算法 | ModelPricing + PricingManager | Agent 平台 |
| **cc_code** | TS | 1 套 STATE + cost-tracker | API 优先 + chars/4 fallback | MODEL_COSTS | IDE Agent |
| **PilotDeck** | TS | 1 套 TokenStatsCollector | tiktoken o200k_base（BPE） | nativeCost → config → 硬编码 | Agent 框架 |
| **hermes-agent** | Python | 1 套 session counter + SQLite | chars/4（统一入口） | 硬编码 30+ → API → subscription | CLI Agent |
| **cc-switch** | **Rust + TS** | **1 套 Parser→Calculator→Logger→SQLite** | **API 响应直接提取（非估算）** | model_pricing + cost_multiplier | AI 代理转发 |
| **claude-tap** | Python | 1 套 TraceWriter | API 响应直接提取（非估算） | **无成本计算** | API 追踪可观测 |

### 1.2 对标方法

逐维对比 8 个维度：

1. CostTracker/Tracker 架构（套数、写入点、管线清晰度）
2. Token 获取方式（估算 vs API 响应提取）
3. Token 估算精度（算法类型、CJK 支持）
4. 定价模型管理（查找优先级、覆盖率、倍率系统）
5. 成本持久化方案（存储格式、查询能力、前端可视化）
6. 与上下文压缩的集成紧密度
7. 类型定义一致性
8. 多提供商/多 API 格式兼容性

---

## 二、逐维对标

### 维度 1：CostTracker/Tracker 架构

| 项目 | 套数 | 管线 | 写入点 | 数据同步 |
|------|:---:|------|------|------|
| **PY_APP** | **3 套** | 各自独立 | 各自独立写入 | EventBus（已实现 subscribeToCostEvents 但未切换） |
| **cc_code** | 1 套 | STATE → cost-tracker → project config | 唯一 addToTotalSessionCost() | STATE 全局共享 |
| **PilotDeck** | 1 套 | TokenStatsCollector → JSONL | 唯一 observe() | JSONL append-only + 内存 LRU |
| **hermes-agent** | 1 套 | session_* counters → SessionDB | 唯一 Agent 主循环累加 | SQLite |
| **cc-switch** | **1 套（最完整）** | **Parser → Calculator → Logger → SQLite → Dashboard** | 唯一 log_with_calculation() | **SQLite + usage_events 事件通知前端** |
| **claude-tap** | 1 套（最简） | SSEReassembler → TraceWriter | 唯一 _update_stats() | JSONL trace file |

**关键差异**：

- cc-switch 拥有**最清晰的独立管线**：Parser（4 种 API 格式） → Calculator（rust_decimal 精度） → Logger（SQLite） → usage_events（事件驱动前端刷新）。每个环节职责分明，无重复。
- claude-tap 是**最低限度的实现**：纯 Token 计数，无成本。证明"不需要成本追踪"也是一个有效的设计选择。
- cc_code/PilotDeck/hermes-agent 都是单一写入点
- PY_APP 三套 Tracker 各自维护 `modelCosts` Map，但迁移路径已铺好

---

### 维度 2：Token 获取方式

| 项目 | 获取方式 | 是否估算 | 缓存语义处理 | 流式支持 |
|------|------|:---:|------|:---:|
| **PY_APP** | 4 种算法估算 | ✅（全部估算） | ❌ | 部分 |
| **cc_code** | API 优先 + 估算 fallback | 混合 | ✅ | ✅ |
| **PilotDeck** | tiktoken 估算 | ✅（BPE 高精度） | ❌ | ✅ |
| **hermes-agent** | char/4 估算 | ✅（粗估） | ✅（normalize_usage） | ✅ |
| **cc-switch** | **API 响应直接提取** | ❌（零估算，100% 精确） | **✅（按 app_type 自动扣除缓存）** | **✅（4 种流式格式）** |
| **claude-tap** | **API 响应直接提取** | ❌（零估算） | ❌（仅记录） | **✅（SSE + WebSocket）** |

**关键差异**：

- cc-switch 和 claude-tap 是唯二**不依赖估算**的项目——Token 数据直接从 API 的 `usage` 对象提取
- cc-switch 额外支持 Gemini 的 `usageMetadata` 格式——这需要跨提供商 mapping（promptTokensCount → input_tokens）
- PY_APP 是唯一**全部依赖估算**的项目（无 API 响应直接提取路径）

---

### 维度 3：Token 估算精度（仅估算型项目）

| 项目 | 算法 | 精度 | CJK 感知 |
|------|------|:---:|:---:|
| **PY_APP** `roughTokenCountEstimation` | `text.length / 4` | 最粗 | ❌ |
| **PY_APP** `estimateTokensForText` | `charsPerToken` 按模型族 | 中等 | ❌ |
| **PY_APP** `estimateTokenCount` | Rust native → chars/4 | 依赖 native | 取决于 native |
| **PY_APP** `heuristicEstimate` | Rust native + 自身 | 与上重复 | 取决于 native |
| **cc_code** | API 优先 + `roughTokenCountEstimation` fallback | 精确(API) / 粗(fallback) | ❌ |
| **PilotDeck** | **tiktoken o200k_base** | **最高** | ✅（BPE） |
| **hermes-agent** | `(len+3)//4` | 粗 | ❌ |
| **cc-switch** | **N/A（API 响应）** | **精确** | N/A |
| **claude-tap** | **N/A（API 响应）** | **精确** | N/A |

---

### 维度 4：定价模型管理

| 项目 | 层级 | 覆盖模型 | 查找优先级 | 特色 |
|------|:---:|:--------:|------|------|
| **PY_APP** | 2 层 | ~20 | ModelPricing → PricingManager | 两层存在冗余 |
| **cc_code** | 1 层 | ~15（Anthropic） | MODEL_COSTS 常量表 | COST_TIER 分层定价 |
| **PilotDeck** | 3 层 | ~30 条正则 | nativeCost → config → DEFAULT_PRICING | provider nativeCost 优先 |
| **hermes-agent** | 3 层 | 30+ | _OFFICIAL_DOCS_PRICING → API → subscription | 带来源 URL + 版本号 |
| **cc-switch** | **2 层 + 倍率** | **可配置** | **model_pricing 表 + cost_multiplier（Provider 优先）** | **cost_multiplier 倍率系统 + UI 可编辑** |
| **claude-tap** | 无 | 无 | 无 | 纯可观测，无成本 |

**关键差异**：

- cc-switch 的 **cost_multiplier（成本倍率）系统**是独有的——每个 Provider 可以设置自定义倍率，基础成本 × 倍率 = 最终成本。这解决了"供应商加价"场景。
- cc-switch 的定价通过 **PricingConfigPanel UI 直接编辑**，无需修改代码或 YAML
- cc-switch 支持**定价更新后自动回填历史成本**（`update_model_pricing` 触发），这在其他项目中均未见到
- hermes-agent 的 `_OFFICIAL_DOCS_PRICING` 带 `pricing_version` + `fetched_at` + 来源 URL，治理最佳

---

### 维度 5：成本持久化与前段可视化

| 项目 | 存储 | 查询能力 | 前端 | 实时刷新 |
|------|------|------|------|:---:|
| **PY_APP** | CostRecordRepository → SQLite | SQL 查询 | `/cost` 命令 | ❌ |
| **cc_code** | project config JSON | JS 读取 | `/cost` + TokenWarning 组件 | ❌ |
| **PilotDeck** | JSONL append-only | 启动重放 | 无（仅统计） | ❌ |
| **hermes-agent** | SQLite + FTS5 | 全文搜索 + SQL 聚合 | `/insights` + Web 仪表板 | ❌ |
| **cc-switch** | **SQLite + 写穿缓存** | **SQL 查询 + 内存 UsageCache** | **完整仪表盘（Hero + 趋势图 + 多个标签页）** | **✅ 30s 轮询 + usage_events 即时 invalidate** |
| **claude-tap** | JSONL trace file | 无 | **HTML Viewer（token 条形图）** | ✅（LiveViewer SSE） |

**关键差异**：

- cc-switch 的**前端可视化**是所有项目中最完整的：Hero 卡片（真实消耗/缓存命中率/成本） + Recharts 面积图（双 Y 轴） + 请求日志表 + Provider/Model 统计表 + 定价配置面板
- cc-switch 的**实时刷新机制**（30s 轮询 + 后端事件即时 invalidate）是独有的
- Claude-tap 的 HTML Viewer 提供了 token 消耗的**逐轮可视化**（蓝色 input / 绿色 output / 青色 cache_read / 琥珀色 cache_write）
- PY_APP 仅有 `/cost` CLI 命令，无实时仪表盘

---

### 维度 6：与上下文压缩的集成

| 项目 | 集成方式 | 触发判定 |
|------|---------|------|
| **PY_APP** | 松散 | 各自判断 |
| **cc_code** | 紧密 | autoCompact 统一 |
| **PilotDeck** | 紧密 | AutoCompactionPolicy 分级 |
| **hermes-agent** | 紧密 | ContextCompressor 内置 |
| **cc-switch** | **N/A**（代理工具，非 Agent） | — |
| **claude-tap** | **N/A**（观测工具，非 Agent） | — |

---

### 维度 7：类型定义一致性

| 项目 | TokenUsage 版本 | 统一？ |
|------|:---:|:---:|
| **PY_APP** | 4 版 | ❌ |
| **cc_code** | 1 版 | ✅ |
| **PilotDeck** | 1 版（CanonicalUsage） | ✅ |
| **hermes-agent** | 1 版（CanonicalUsage） | ✅ |
| **cc-switch** | **1 版（TokenUsage struct）** | ✅（Rust 类型系统天然保证） |
| **claude-tap** | 无显式类型（Python dict） | — |

---

### 维度 8：多提供商/多 API 格式兼容性

| 项目 | 支持格式数 | 支持的 API | 缓存语义区分 |
|------|:---:|------|:---:|
| **PY_APP** | N/A（估算不区分 API） | — | ❌ |
| **cc_code** | 3 种 | Anthropic / Bedrock / Vertex | ✅（Haiku fallback） |
| **PilotDeck** | 2 种 | Anthropic / OpenAI | ✅（normalizeUsage） |
| **hermes-agent** | **4 种** | Anthropic / Codex / OpenAI / 代理（OpenRouter） | ✅（normalize_usage 处理缓存包含型） |
| **cc-switch** | **4 种** | **Claude / OpenAI / Codex / Gemini** | **✅（calculate_for_app 自动扣除缓存）** |
| **claude-tap** | 2 种 | Claude（SSE+WS） / OpenAI（SSE） | ❌（仅记录） |

**关键差异**：

- cc-switch 和 hermes-agent 在 API 格式兼容性上并列第一（4 种），但 cc-switch 的 Gemini 支持是独有的
- cc-switch 的**缓存语义自动处理**（Codex/Gemini 的 input_tokens 包含缓存命中，需扣除后再计费）是最细致的
- cc-switch 额外支持**会话日志同步模式**（从 `~/.claude/projects/*/*.jsonl` 增量解析），实现无代理模式下的用量追踪

---

## 三、综合评分

| 维度 | PY_APP | cc_code | PilotDeck | hermes-agent | cc-switch | claude-tap |
|------|:------:|:------:|:------:|:------:|:------:|:------:|
| CostTracker 架构 | ★★ | ★★★★ | ★★★★ | ★★★★ | ★★★★★ | ★★★ |
| Token 获取方式 | ★★ | ★★★★ | ★★★★ | ★★ | ★★★★★ | ★★★★ |
| Token 估算精度 | ★★ | ★★★★ | ★★★★★ | ★★ | N/A（精确） | N/A（精确） |
| 定价模型 | ★★★ | ★★★ | ★★★★ | ★★★★★ | ★★★★ | N/A |
| 持久化+可视化 | ★★ | ★★★ | ★★★ | ★★★★ | ★★★★★ | ★★★ |
| 压缩集成 | ★★ | ★★★★ | ★★★★★ | ★★★★ | N/A | N/A |
| 类型一致性 | ★ | ★★★★ | ★★★★ | ★★★★ | ★★★★★ | ★★ |
| 多 API 兼容 | ★ | ★★★ | ★★ | ★★★★ | ★★★★★ | ★★ |
| **综合** | **1.9** | **3.7** | **4.1** | **3.8** | **4.8** | **2.8** |

> cc-switch 和 claude-tap 在"压缩集成"维度不参与评分（N/A），综合评分为有评分维度的算术平均。

---

## 四、关键发现

### 4.1 cc-switch — 架构最完整的参考实现

cc-switch 在 Cost/Token 领域的架构是所有参考项目中最完善的：

1. **纯粹的单管线**：Parser（4 格式） → Calculator（rust_decimal） → Logger（SQLite） → Dashboard（React），无重复
2. **成本倍率系统（独有）**：`cost_multiplier` 支持供应商加价，UI 可编辑
3. **缓存语义自动处理**：`calculate_for_app()` 区分缓存包含型/不包含型 API
4. **实时前端**：30s 轮询 + usage_events 事件即时 invalidate
5. **定价更新自动回填历史**：更新价格后自动重新计算所有关联请求的成本
6. **Rust 类型安全**：TokenUsage struct 统一全项目，无碎片化
7. **多数据源合并**：代理模式 + 会话日志同步模式，`data_source` 字段区分来源

### 4.2 claude-tap — 最低限度的有效设计

claude-tap 证明了"不需要成本"也是一个合法的架构选择：

1. **零成本计算**：纯 Token 计数，无定价表、无成本公式
2. **API 响应直接提取**：永远不需要估算
3. **HTML Viewer 逐轮可视化**：token 条形图 + 跨语言支持（10 种）
4. **LiveViewer SSE 实时推流**：浏览器即时看到每轮的 token 消耗

### 4.3 PY_APP 的优势确认

1. **CostTracker 写入管线已铺好**（与 cc-switch 的单管线方向一致）
2. **SQLite 持久化已就绪**（与 cc-switch 技术选型相同）
3. **迁移路径已有共识**（`subscribeToCostEvents` 已实现）

### 4.4 PY_APP 的差距扩展

| 差距 | 严重度 | 标杆 |
|------|:---:|------|
| 3 套 CostTracker 并存 | 🔴 | cc-switch 单管线 |
| Token 全部靠估算 | 🔴 | cc-switch/claude-tap 全从 API 取 |
| 无实时前端仪表盘 | 🟡 | cc-switch 完整 Dashboard |
| 无多 API 格式缓存语义处理 | 🟡 | cc-switch calculate_for_app |
| Token 估算无 CJK 感知 | 🟡 | PilotDeck tiktoken BPE |
| 定价无法 UI 编辑 | 🟢 | cc-switch PricingConfigPanel |
| 定价更新不自动回填历史 | 🟢 | cc-switch 更新即回填 |

---

## 五、优化建议（扩展）

### P0：架构收敛
1. **执行 CostTracker 合并**（对标 cc-switch 单管线）
2. **执行 TokenBudget 合并**

### P1：精度与数据
3. **引入 API 响应直接提取路径**（对标 cc-switch/claude-tap）—— 当 API 返回 usage 时，优先使用 API 数据
4. **引入 tiktoken**（对标 PilotDeck）
5. **统一 TokenUsage 类型**

### P2：可视化与体验
6. **前端仪表盘**（对标 cc-switch UsageDashboard）—— Hero 卡片 + 趋势图 + 请求日志
7. **实时刷新**（对标 cc-switch usage_events + 30s 轮询）
8. **定价 UI 可编辑**（对标 cc-switch PricingConfigPanel）
9. **定价更新自动回填历史成本**

### P3：扩展
10. **多 API 格式缓存语义处理**（对标 cc-switch calculate_for_app）
11. **cost_multiplier 倍率系统**（对标 cc-switch）


## 附录：参考项目核心文件索引

| 项目 | 语言 | 核心文件 |
|------|------|---------|
| cc_code | TS | `cost-tracker.ts`, `utils/tokens.ts`, `utils/modelCost.ts`, `services/tokenEstimation.ts`, `services/compact/autoCompact.ts` |
| PilotDeck | TS | `context/budget/TokenBudgetManager.ts`, `context/budget/tokenizer.ts`, `router/stats/TokenStatsCollector.ts`, `context/compaction/AutoCompactionPolicy.ts` |
| hermes-agent | Python | `agent/usage_pricing.py`, `agent/model_metadata.py`, `agent/context_compressor.py`, `hermes_state.py` |
| **cc-switch** | **Rust + TS** | **`proxy/usage/parser.rs`**, **`proxy/usage/calculator.rs`**, **`proxy/usage/logger.rs`**, `commands/usage.rs`, `services/session_usage*.rs`, `components/usage/UsageDashboard.tsx`, `components/usage/UsageHero.tsx`, `components/usage/PricingConfigPanel.tsx` |
| **claude-tap** | Python | **`claude_tap/proxy.py`**, **`claude_tap/trace.py`**, `claude_tap/sse.py`, `claude_tap/viewer.py`, `claude_tap/export.py` |
