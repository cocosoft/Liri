# 时间管理模块 (chronos)

## 概述

任务调度和定时功能模块，提供 Cron 表达式兼容的定时任务能力。

## 职责

- **CronTasks** — Cron 任务持久化存储（JSON / SQLite）
- **cron** — Cron 表达式解析和执行
- **autoDream** — 自动记忆整合系统（做梦机制）
- ⚠️ **`CronScheduler` / `InMemoryScheduler` 已下线**（T-③05 遗留，2026-10-03）：本目录的
  `CronScheduler.ts` 三导出（`createCronScheduler` / `createInMemoryScheduler` /
  `buildMissedTaskNotification`）**全仓零消费者**、文件自述 `@deprecated` ⇒ 已删除（连同
  仅其使用的 4 个类型）。**在用的调度器在 `tasks/cron/`**（`GlobalCronScheduler` /
  `CronScheduler`），做梦定时由 `dream/DreamScheduler`（setInterval + cron 校验）承担。
- **engine/** — 调度引擎
- **types** — 时间任务类型定义

## 依赖

- core, infrastructure

## 用户级定时任务

通过 `/cron` 命令或 HTTP API 管理：

```bash
# 添加定时任务
/cron add "0 9 * * *" 每天早上9点检查待办事项

# 列出所有任务
/cron list

# 删除任务
/cron remove <task-id>
```

## 自动做梦（记忆整合）

系统内置了 **自动记忆整合** 机制（称为"做梦"），后台定期扫描新会话自动生成洞察。

### 默认定时任务

每天 **凌晨 2:00** 自动执行一次完整的记忆整合：

```bash
# 启动时自动注册（日志输出）
[Chronos] 梦境定时任务已注册: 0 2 * * *，每天凌晨 2:00 执行记忆整合
```

### 配置项

通过环境变量控制：

| 变量                      | 默认值 | 说明                     |
| ------------------------- | ------ | ------------------------ |
| `AUTO_DREAM_ENABLED`      | `true` | 是否启用自动做梦         |
| `AUTO_DREAM_MIN_HOURS`    | `24`   | 两次做梦最小间隔（小时） |
| `AUTO_DREAM_MIN_SESSIONS` | `5`    | 触发做梦的最少新会话数   |

### 相关文件

- [autoDream/AutoDream.ts](autoDream/AutoDream.ts) — 做梦核心逻辑，`executeAutoDream()` 是触发入口
- [autoDream/AutoDreamConfig.ts](autoDream/AutoDreamConfig.ts) — 配置定义
- [maintenance/ChronosBackgroundHousekeeping.ts](maintenance/ChronosBackgroundHousekeeping.ts) — 定时任务注册，`setupDreamCronScheduler()` 注册凌晨2点调度

### 架构图

```
startBackgroundHousekeeping()
 ├── initAutoDream()          ← 初始化做梦 Runner
 ├── setupDreamCronScheduler() ← 注册凌晨 2:00 定时任务
 │    └── dream/DreamScheduler（setInterval + computeNextCronRunMs 校验）
 │         └── 到达 2:00 → executeAutoDream()
 │（原 `InMemoryScheduler` 已随 T-③05 遗留下线）
 │
 └── ... 其他后台维护
```

## 系统级 cron 任务

除了用户级任务，系统也内置了一些预定义 cron 任务：

| 任务                 | 时间       | 说明                                           |
| -------------------- | ---------- | ---------------------------------------------- |
| 自动记忆整合（做梦） | 每天 02:00 | 扫描新会话并生成洞察                           |
| 日志清理             | 每天 03:00 | 清理过期日志和缓存（由 archivalCronTask 实现） |

系统级任务由 `dream/DreamScheduler`（做梦）与 `monitoring/archival`（日志清理）承担，无需用户干预。

## 集成

守护进程模块可选依赖 chronos，实现定时任务调度。

## 使用

```typescript
import { CronTasks } from '@modules/chronos';
import { addCronTask, listAllCronTasks } from '@modules/chronos/CronTasks';
import { executeAutoDream } from '@modules/chronos/autoDream';

// 持久化添加 cron 任务
await addCronTask('0 2 * * *', '每天2点执行', true, true);

// 手动触发做梦
await executeAutoDream();
```
