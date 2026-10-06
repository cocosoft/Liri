# 记忆管理模块 (memory)

> 本 README 的**主要目的**：固化「记忆分层 + 端口边界」，防止**同名类 / 职责重叠**以子模块形式复发
> （来源：`任务计划-20261004.md` §15.5-3「记忆分层文档化」；取证日期 2026-10-06，file:line 均为实测）。

## 概述

`memory/` 是**记忆条目域**（infra 层）：记忆条目的持久化、检索、遗忘与固化。

## 一、分层与域边界

记忆相关代码**跨多个模块与层**，职责互不相同 —— 下表是"谁是谁"的单一参照（层归属取自 `scripts/modules-to-layers.json`）：

| 域 | 层 | 载体（入口） | 职责 | ⚠️ 不是 |
|---|---|---|---|---|
| **记忆条目域** | infra | `memory/`（`MemoryManagerImpl` + 4 窄端口） | 记忆条目的 CRUD / 检索 / 遗忘 / 固化 | — |
| **会话记忆域** | service | `session/memory/`（`SessionMemoryPort` + `SessionMemoryManager`） | 逐轮累计 → 阈值判断 → 提炼落盘 → 注入提示词 | ✗ **不是**记忆条目（与方法面零交集，故**另立端口**而非并入四端口） |
| **RAM / 堆域** | infra | `performance/MemoryManager.ts` → `HeapMemoryManager` | 进程内存采样 / 优化 / 启动剖析 | ✗ **与"记忆"同音不同物**（最易混点） |
| **知识库** | app | `knowledge/` | RAG 文档索引 / 语义检索 | ✗ 不是记忆条目 |
| **梦境 / 固化** | app + infra | `dream/`（周期）+ `memory/consolidation/`（`MemoryConsolidator` / `MemoryConflictDetector`） | 记忆固化、冲突检测 | — |
| **Agent 私有记忆** | — | `agent/memory/agentMemory.ts` → `AgentMemoryImpl`；`tools/AgentTool/agentMemory.ts` → `AgentToolMemory` | 子代理 / 工具侧私有记忆 | ✗ 非全局记忆条目域 |

### 关系图

```
                        ┌──────────────── 记忆条目域 (infra: memory/) ────────────────┐
                        │  MemoryManagerImpl  ──implements──▶  4 窄端口 (Read/Write/  │
                        │        ▲                              Search/Forget)       │
                        │        │                                                   │
   写入/读取/检索/遗忘 ◀──┼────────┘                                                   │
                        │  consolidation/ (固化)   indexer/ (索引)   adapters/ (适配) │
                        └────────────▲───────────────────────────────▲───────────────┘
                                     │                               │
                     索引/固化调用 ──┘                               └── 提示词/工具调用
                                     │                               │
   ┌───────────── 会话记忆域 (service: session/memory/) ─────────────┴──────┐
   │  SessionMemoryPort ◀──implements── SessionMemoryManager                 │
   │         ▲                                                               │
   │         └── consumers: chat/services/SessionMemoryManager.ts (编排)      │
   │                        chat/ChatManager.ts (getMemoryContext)            │
   └─────────────────────────────────────────────────────────────────────────┘

   ⚠️ 域外同名易混（**均非记忆条目**）：
      performance/MemoryManager.ts → HeapMemoryManager   （RAM / 堆域）
      cache/CacheSystem.ts        → MemoryStorage        （内存缓存存储）
      session/storage/MemoryStorage.ts / MemoryUnifiedStorage.ts（会话内存存储）
      query/TAORLoop.ts           → MemoryCheckpointStorage（检查点内存存储）
```

## 二、端口边界（`MemoryPort`）

记忆条目对外的能力面**不是**一个全能接口，而是**按能力切分的四个窄端口**
（`memory/ports/MemoryPort.ts`；实现者 `memory/MemoryManager.ts:239 MemoryManagerImpl`）：

| 端口 | 能力 | 实现者（`MemoryManagerImpl` 行号，**2026-10-06 实测**） |
|---|---|---|
| `MemoryReadPort` | `getMemory` / `getAllMemories` / `getMemoryStats` | `:559` / `:765` / `:788` |
| `MemoryWritePort` | `createMemory` / `updateMemory` / `deleteMemory` / `deleteAllMemories` / `setMemoryExpiry` | `:395` / `:570` / `:617` / `:638` / `:986` |
| `MemorySearchPort` | `getRelevantMemories`（hybrid + 关联图扩展 + LLM 精选） | `:669` |
| `MemoryForgetPort` | `cleanupExpiredMemories` | `:872` |

> **历史背景（防复发）**：原 `memory/MemoryManager.ts` 曾声明一个 ~40 方法的
> `interface MemoryManager`（现位于 `:72`）—— **无任何 implement**，且近半方法在实现类中并不存在（"全能型死契约"）。
> 收敛为上述四端口时**只收实现类真实具备的能力**，**不制造空桩**。
> 详见 `.trae/specs/memory-port-unification.md`。
>
> ⚠️ **行号维护**：`ports/MemoryPort.ts` 注释内的行号曾整体陈旧（约 +14 行偏移），已于 2026-10-06 复核订正；
> 后续改动 `MemoryManager.ts` 时请同步（或改用方法名定位）。

**会话记忆域另立端口**（`session/memory/SessionMemoryPort.ts`）：其方法面（`loadMemory` / `initMemory` /
`accumulateTurn` / `appendToMemory` / `getMemoryContext` / `searchMemory` / `indexMemoryItems` /
`readRawMemory` / `writeRawMemory`）与上表四端口**零交集** ⇒ **不得**硬塞进 `MemoryPort`。

## 三、命名消歧约定（**防止同名/职责重叠复发**）

1. **`MemoryManager` 这个名字已被占用过两次、且两次都因歧义而改名**：
   `memory/MemoryManager.ts` → **`MemoryManagerImpl`**；`performance/MemoryManager.ts` → **`HeapMemoryManager`**。
   ⇒ **新类不得再命名 `MemoryManager`**（全仓 `class MemoryManager` 实测 **0 处**，保持为 0）。
2. **按域选端口**：记忆**条目**能力 → 四窄端口；**会话**记忆能力 → `SessionMemoryPort`；**不要**为跨层便利另起同名类。
3. **`*Storage` 是"内存存储"语义**（`MemoryStorage` / `MemoryUnifiedStorage` / `MemoryCheckpointStorage` / `MemoryStorage`(cache)），
   **不是**记忆条目域 ⇒ 命名时避免与记忆条目混淆。
4. **`memory/MemoryHookDispatcher.ts` 当前 0 引用**（用户裁定**保留**，未删除）⇒ 引用它前先确认意图，勿视为既有能力。

## 依赖

- core, infrastructure, error

## 使用

```typescript
import { AutoMemory } from '@modules/memory';
```

## 相关文档

- `.trae/specs/memory-port-unification.md` —— 端口收敛（四窄端口的由来）
- `.trae/specs/layer-inversion-memory-chronos-system.md` —— 记忆/时序域的分层倒挂收口
- `dev_docs/任务计划-20261004.md` §14.1-M3 / §15.1 —— "记忆三套实现并存"的复核（**已不成立**）
