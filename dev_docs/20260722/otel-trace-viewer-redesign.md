# OTEL 追踪视图美化设计方案 (v4)

> 状态: 设计阶段 | 日期: 2026-07-22 | 审阅: R1+R2+R3 已整合

---

## 1. 现状分析

### 1.1 当前实现

`OTELSpanViewer` 从 `SpanCollector` 环形缓冲区（上限 200 条）读取数据，以**平铺列表**展示。

数据模型（[SpanCollector.ts#L15-L25](file:///e:/PY/Documents/CODES/PY_APP/client/src/monitoring/otel/SpanCollector.ts#L15-L25)）：

```typescript
interface SpanRecord {
  id: string;
  traceId: string;
  name: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  status: "ok" | "error" | "unset";
  attributes: Record<string, unknown>;
  errorMessage?: string;
}
```

### 1.2 当前问题

| # | 问题 | 用户感知 |
|---|------|---------|
| 1 | 纯线性列表 | 看不出 Trace 边界 |
| 2 | 无模块分组 | 不同来源 Span 混在一起 |
| 3 | 无搜索/过滤/时间范围 | 无法快速定位 |
| 4 | 无瀑布图/时间线 | 无法感知耗时占比 |
| 5 | 无父子层级 | 看不到调用链嵌套 |
| 6 | 折叠粒度粗 | 全展开/全折叠，不便 |
| 7 | 错误 Span 无自动定位 | 错误淹没在列表中 |

### 1.3 SpanRecord 数据模型前置修改（P0 前置）

**Phase 1 启动前**需在 `toSpanRecord()` 中补充：

| 字段 | 来源 | 用途 |
|------|------|------|
| `parentSpanId?: string` | `span.parentSpanId` | 树形视图/瀑布图嵌套 |
| `spanKind?: "internal" \| "server" \| "client" \| "producer" \| "consumer"` | `span.kind` | 区分入口/出口 Span |
| `links?: { traceId: string; spanId: string }[]` | `span.links` | 跨 Trace 关联 |

修改点：[SpanCollector.ts](file:///e:/PY/Documents/CODES/PY_APP/client/src/monitoring/otel/SpanCollector.ts) `toSpanRecord()`。

---

## 2. 设计方案

### 2.1 总体布局：三段式视图

```
┌──────────────────────────────────────────────────────────────┐
│  统计摘要栏                                                    │
│  Span: 147  │  Trace: 8  │  Error: 3                           │
│  Avg Span: 12ms  │  Avg Trace: 245ms                          │
│  Buffer: [████████████░░░░░░░░] 147/200 (74%)  ⏸ 暂停         │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│  工具栏                                                       │
│  [最近 5 分钟 ▾] [搜索...] [模块 ▾] [状态 ▾] [排序 ▾]         │
│  [Tree | Waterfall] [全部展开/折叠] [▶ 下一个错误]             │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  🟢 Trace abc123  HTTP·认证  (4 spans, 245ms)                │
│  ├─ ✅ http.request       120ms  server      ██████████       │
│  │  ├─ ✅ auth.verify      15ms  internal      ██             │
│  │  └─ ✅ db.query         80ms  client        ██████         │
│  └─ ✅ tool.execute        30ms  internal       ███            │
│                                                              │
│  🔴 Trace def456  工具调用  (3 spans, 1.2s)  ⚠ 1 error       │
│  ├─ ✅ task.create         50ms  server        █              │
│  ├─ ❌ tool.execute       1.1s  internal  ████████████████    │
│  │     Error: timeout exceeded                                │
│  └─ ✅ task.complete        5ms  server                      │
│                                                              │
│  🟡 Trace ghi789  数据库  ❗不完全（父 Span 已淘汰）           │
│  │  ┆ auth.verify    15ms  (orphan)                           │
│  └─ ...                                                      │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 颜色编码

| 颜色 | 含义 |
|------|------|
| 🟢 绿色 | Trace 内所有 Span 状态为 `ok` |
| 🟡 黄色 | 有 `unset` 状态 Span（无 error） |
| 🔴 红色 | 有 `error` 状态 Span |
| ⚪ 灰色 | Trace 内无 Span（容错） |

### 2.3 高亮叠加规则

当同一 Span 行同时触发多种高亮时，优先级：

```
错误高亮（红色左边框 + 浅红背景）
  > 搜索命中高亮（黄色下划线，非背景色，避免背景冲突）
  > 孤儿标记（虚线缩进 + ⚠ 图标）
```

### 2.4 视觉层级

- Trace 卡片间距：8px（折叠/展开状态在视觉上快速区分）
- 折叠卡片：`opacity: 0.6` 表示未展开
- 展开卡片：全亮（`opacity: 1`）
- 暗色模式：所有颜色通过 CSS Variables 映射，不复用硬编码色值

---

## 3. 核心功能点

### Phase 1a（最小可用版本）

**3.1 按 TraceId 分组折叠**

每个 Trace 一个可折叠卡片，默认展开最近 3 个。卡片标题栏：
- TraceId（截断前 12 位）+ 颜色指示圆点 + **点击复制 TraceId**（tooltip 反馈"已复制"）
- 模块标签（按 Span name 前缀推断）
- Span 数量 + 总耗时 + 错误角标 + ❗不完全角标

展开状态用 `Set<traceId>` 持久化，切换视图不丢失。

**3.2 搜索与状态过滤**

- 100ms 防抖 + `useMemo` 缓存 + `useTransition` 包裹搜索变更（保持输入框响应）
- 搜索命中高亮：黄色下划线
- 状态过滤：All / OK / Error / Unset

**3.3 树形缩进 + 父子连线**

基于 `parentSpanId` 构建调用树。无 `parentSpanId` 的 Span 按根节点处理。

**3.4 加载骨架屏 & 空状态**

首次 callback 到达前显示骨架屏（3-4 行 shimmer）。

`TraceEmpty` 组件接受 `reason` prop 区分三种空场景：

| reason | 展示内容 |
|--------|---------|
| `"pending"` | 骨架屏："等待追踪数据..." |
| `"no-match"` | "无匹配结果" + [重置过滤器] 按钮 |
| `"cleared"` | "数据已清空" + 上次有数据的时间戳 |

状态机：`loading → empty(pending) → data | no-match | cleared`

**3.5 订阅中断处理**

reducer 增加 `RESET` action，订阅失败/断连时展示 banner："数据源已断开，最后更新：09:32:15" + 重试按钮。

### Phase 1b（功能增强）

**3.6 错误高亮与快速定位**

- "下一个错误"始终可见，无错误时 disabled + tooltip
- 仅在当前过滤后的可见集合中导航

**3.7 模块标签推断**

最长前缀优先匹配。例：`http.tool.call` → `HTTP`（`http.*` 2 段 > `tool.*` 1 段）。

**3.8 时间范围选择器**

默认"最近 5 分钟"。选项：1 / 5 / 15 分钟 / 全部。

**3.9 Trace 排序**

默认时间降序。支持耗时降序、错误优先、Span 数量降序。

**3.10 虚拟滚动**

`SpanList` 使用 `@tanstack/virtual`。

### Phase 2（视觉增强）

**3.11 瀑布图（Waterfall 视图）**

CSS `transform: translateX(%)` + `width: %` 渲染。时间轴基准为 Trace 内最早 Span 的 `startTime`。dev 模式显示调试面板（输出 left%/width% 原始值）。

**3.12 Span 详情抽屉**

右侧抽屉：全部 attributes、parentSpanId/spanKind/links、errorMessage。一键复制为 JSON。

### Phase 3（体验优化）

**3.13 自动刷新与智能锚定**

缓冲区进度条（<60% 绿 / 60-85% 黄 / >85% 红）。用户在底部→自动追加；在上方→不移动。

**3.14 键盘导航**

| 按键 | 行为 |
|------|------|
| `↑` / `↓` | 可见 Span 行间移动 |
| `Enter` | 展开/收起当前 Trace |
| `Escape` | 关闭详情抽屉 |
| `F3` | 下一个错误 |
| `Ctrl+F` | 聚焦搜索框 |

**3.15 导出**

导出过滤后的 Span 数据为 JSON。

---

## 4. 边界情况处理

### 4.1 孤儿 Span

环形缓冲区淘汰父 Span 后，子 Span 以虚线缩进 + ⚠ 图标显示。Trace 卡片标题栏 ❗不完全角标。

### 4.2 展开的 Trace 被淘汰

组内 Span 数为 0 → 自动收起，显示 `(已淘汰)`。

### 4.3 数据清洗

```typescript
const sanitized = spans.map(s => ({
  ...s,
  durationMs: Math.max(s.durationMs ?? 0, 1),
  _suspicious: s.endTime < s.startTime,
}));
```

### 4.4 多子树分隔线

同一 traceId 下不相连子树间插入 `─ ─ ─ 子树断开 ─ ─ ─`。

### 4.5 traceMap 内存淘汰

reducer `sync` action 中清理不在当前数据中的旧 traceId key：

```typescript
case "sync":
  const incoming = new Map(/* groupBy(spans) */);
  for (const key of state.traceMap.keys()) {
    if (!incoming.has(key)) state.traceMap.delete(key);
  }
  for (const [key, spans] of incoming) {
    state.traceMap.set(key, spans);
  }
```

traceMap 大小始终 ≤ 环形缓冲区真实 traceId 数量。

---

## 5. 性能设计

### 5.1 性能预算

| 指标 | 目标 | 测量方式 |
|------|------|---------|
| 初始渲染（200 Span） | < 100ms | Chrome Performance tab |
| 搜索键入到可见结果 | < 50ms | `performance.mark()` |
| 瀑布图帧率（滚动） | 60fps | DevTools FPS meter |
| 内存峰值 | < 50MB | Chrome Memory tab |
| Tree ↔ Waterfall 切换 | < 16ms | `useTransition` / `requestAnimationFrame` |

超出预算 → 告警或自动回退到简化模式。

### 5.2 useTransition 降级渲染

搜索/过滤变更时使用 `useTransition` 标记为非紧急更新，保持输入框响应：

```typescript
const [isPending, startTransition] = useTransition();
const handleSearch = (value: string) => {
  startTransition(() => setSearchQuery(value));
};
// isPending → 搜索框右侧显示 loading spinner
```

### 5.3 虚拟滚动

`SpanList` 使用 `@tanstack/virtual`。

### 5.4 计算策略

| 操作 | 策略 |
|------|------|
| 原始数据持有 | `useReducer`（避免 useRef + setState 并发竞态） |
| 回调契约 | `subscribeSpanCollector` 传递**全量** `SpanRecord[]` 快照 |
| reducer | full replace + 旧 traceId 淘汰清理 |
| `groupBy(traceId)` | `useMemo`，仅 SpanRecord[] 变化时重算 |
| 模块推断 | `useMemo`，在分组结果上计算 |
| 搜索过滤 | 100ms 防抖 + `useTransition` + 在已分组数据上 filter |
| 瀑布图定位 | CSS `transform: translateX(%)` + `width: %` |

> **CSP 备注**：瀑布图 CSS 通过 `style` prop 赋值（inline style 在 CSP nonce 策略下通常被允许），不通过动态 `<style>` 标签。

### 5.5 状态分层

```
数据层（useReducer）
  → traceMap: Map<traceId, SanitizedSpan[]>
  → reducer: 全量 sync / RESET / PAUSE
  → sync 时同步清理旧 traceId key

计算层（useMemo）
  → filteredTraces: 搜索 + 状态 + 时间范围
  → sortedTraces: 排序
  → moduleLabels: 模块推断
  → treeStructure: 调用树构建

UI 层（useState）
  → expandedSet: Set<traceId>
  → viewMode / searchQuery / statusFilter / timeRange / sortBy
  → selectedSpan | null
  → subscriptionState: "loading" | "active" | "disconnected"

交互层（useRef / useCallback）
  → errorNavIndex / scrollAnchor
```

---

## 6. 组件拆分

```
OTELTraceViewer/          ← 独立目录
├── index.tsx             → 顶层（状态管理 + 布局编排）
├── TraceStatsBar.tsx     → 统计摘要 + 缓冲区进度条
├── TraceFilterBar.tsx    → 搜索·过滤·排序·时间范围·视图切换
├── TraceList.tsx         → Tree 视图容器
│   └── TraceCard.tsx     → Trace 卡片（标题栏 + SpanList）
├── SpanList.tsx          → 虚拟滚动容器
├── SpanRow.tsx           → Span 行（纯展示，Tree & Waterfall 复用）
├── TraceWaterfall.tsx    → Waterfall 视图容器
│   └── WaterfallTimeline.tsx
├── SpanDetailDrawer.tsx  → Span 详情抽屉 (P2)
├── Skeleton.tsx          → 加载骨架屏
├── TraceEmpty.tsx        → 多态空状态（reason: pending | no-match | cleared）
├── DisconnectBanner.tsx  → 订阅断连提示 + 重试
└── utils.ts              → groupBy、buildTree、inferModule、waterfallCSS、detectOrphans、sanitizeSpan
```

### 核心 Props 接口

```typescript
// OTELTraceViewer/index.tsx
interface OTELTraceViewerProps {
  compact?: boolean;
}

// TraceList.tsx
interface TraceListProps {
  traces: GroupedTrace[];
  expandedSet: Set<string>;
  onToggleExpand: (traceId: string) => void;
  searchQuery: string;
  filterStatus: "all" | "ok" | "error" | "unset";
}

// SpanRow.tsx
interface SpanRowProps {
  span: SanitizedSpan;
  depth: number;
  isOrphan: boolean;
  isHighlighted: boolean;   // 错误/导航高亮
  isSearchHit: boolean;     // 搜索命中高亮
  viewMode: "tree" | "waterfall";
  waterfallStyle?: { left: string; width: string };
  onClick: (span: SanitizedSpan) => void;
}
```

### 现有文件处理

| 文件 | 处理方式 |
|------|---------|
| `OTELSpanViewer.tsx` | 保留，标记 `@deprecated` |

---

## 7. 数据流

```
subscribeSpanCollector(callback)   ← 回调推送全量 SpanRecord[] 快照
  → dispatch({ type: "sync", spans })
    → reducer: 数据清洗 → groupBy → 孤儿检测 → 淘汰旧 traceId
      → traceMap (useReducer state)
        → useMemo: 时间+状态+搜索过滤
        → useMemo: 排序
        → useMemo: 模块推断 + 树结构构建
          → TraceList / TraceWaterfall 渲染
```

无后端 API 变更。

---

## 8. 测试策略

### 8.1 纯逻辑单元测试（`utils.ts`）

| 测试项 | 输入 | 预期 |
|--------|------|------|
| `groupBy(traceId)` | 10 Span，3 traceId | 3 组 |
| `groupBy([])` | 空数组 | 空 Map（不报错） |
| `groupBy(duplicate id)` | 同一 id 出现两次 | 按 id 去重 |
| `buildTree()` | 6 Span，2 层嵌套 | 正确缩进层级 |
| `inferModule()` | `"http.request"` → `"HTTP"` | 最长前缀优先 |
| `inferModule("")` | 空字符串 | `"unknown"` |
| `waterfallCSS()` | 偏移 25ms，总时长 100ms | `{ left: "25%", ... }` |
| `detectOrphans()` | 子 Span 指向不存在的父 | 标记为孤儿 |
| `detectOrphans([])` | 空分组 | 空数组 |
| `sanitizeSpan()` | durationMs=-5 | durationMs→1, _suspicious=true |

### 8.2 集成测试

- 工具栏搜索过滤联动
- Error 导航仅在过滤结果内跳转
- 折叠状态在 Tree ↔ Waterfall 切换时持久化
- 孤儿 Trace 标题栏 ❗不完全角标
- 订阅断连 → DisconnectBanner 显示 → 重试恢复

---

## 9. 兼容与回退

### 9.1 接口隔离检查（Prerequisite）

替换旧组件前执行：
1. `grep` 所有 `import OTELSpanViewer` 位置
2. 检查调用方是否传递非标准 props（除 `compact` 外）
3. 存在 → 提取到新 Props 接口
4. 新旧接口确认一致后，再开关切换

### 9.2 回退策略

```typescript
const ENABLE_TRACE_REDESIGN = false; // Phase 1a 完成后改为 true

const TraceViewer = ENABLE_TRACE_REDESIGN ? OTELTraceViewer : OTELSpanViewer;
```

---

## 10. 实施计划

| 阶段 | 内容 | 交付物 | 验收标准 |
|------|------|--------|---------|
| **Prerequisite** | SpanRecord 补充字段 + 接口隔离检查 | 修改后的 SpanCollector.ts + 检查报告 | typecheck 通过 + 无额外 props |
| **Phase 1a** | 组件基础设施 + 分组折叠 + 搜索过滤 + 树形连线 + useReducer + 骨架屏 + 3 态空状态 + 订阅断连处理 | `OTELTraceViewer/` 目录约 14 文件 + 开关常量 | 展开/折叠/搜索/过滤正常；loading→empty/data 状态机正确；断连 banner 显示 |
| **Phase 1b** | 虚拟滚动 + 错误导航 + 模块推断 + 时间范围 + 排序 | 更新 SpanList 为虚拟滚动 | 展开全部 Trace 时 DOM < 200 节点 |
| **Phase 2** | 瀑布图 + 调试面板 + 数据清洗 + 详情抽屉 | 更新 TraceWaterfall + SpanDetailDrawer | CSS 定位正确（调试面板验证） |
| **Phase 3** | 键盘导航 + 智能锚定 + 缓冲区进度条 + 导出 | 更新 TraceStatsBar + 键盘 hook | 所有键盘快捷键有效 |
| **Go Live** | `ENABLE_TRACE_REDESIGN = true` | — | 性能预算全部达标 |

---

## 11. 优先级总结

| 事项 | 紧急度 | 原因 |
|------|:---:|------|
| SpanRecord 补充 parentSpanId | 🔴 | 树形视图和瀑布图前置条件 |
| 回调契约明确（全量 vs 增量） | 🔴 | 决定 reducer 架构，改了就大改 |
| 虚拟滚动 | 🔴 | 展开多个 Trace 时 DOM 爆炸 |
| 孤儿 Span 检测 | 🔴 | 环形缓冲区必然产生的UI断裂 |
| 加载/空/异常三态 | 🔴 | 用户第一眼看到的体验 |
| traceMap 内存淘汰 | 🟡 | 长期泄漏导致性能退化 |
| 数据清洗（负 durationMs） | 🟡 | 瀑布图可能渲染异常 |
| 状态分层 + useReducer | 🟡 | 避免并发竞态 |
| Props 接口定义 | 🟡 | 并行开发依赖 |
| 性能预算 | 🟡 | 上线回退决策依据 |
| useTransition 降级渲染 | 🟢 | 搜索框流畅度 |
| 高亮叠加规则 | 🟢 | 视觉一致性 |
| 键盘导航 | 🟢 | 调试效率 |
| 复制 TraceId | 🟢 | 高频操作 |
| 回退 feature flag | 🟢 | 一键回退 |

---

## 12. Future（当前范围外）

- 多 Trace 批量选择/对比/导出
- Trace 持久化收藏/标记
- URL 深链（`#trace-abc123`）共享视图
- 用户偏好持久化（排序方式、视图模式、时间范围）
- 与后端聚合 API 联动（按时间窗口查询历史 Trace）
