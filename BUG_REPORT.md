# Liri 代码检查报告

> 生成时间: 2026-07-30  
> 检查范围: 后端 app/src (3648+ 个 .ts 文件) + 前端 client/src  
> 扫描深度: 启动流程 → 核心引擎 → 工具系统 → AI 模块 → DI 容器 → 前端

---

## 严重级别说明

| 级别 | 定义 |
|------|------|
| 🔴 **严重** | 运行时必定触发异常或逻辑错误 |
| 🟡 **警告** | 特定条件下引发问题，或设计缺陷 |
| 🔵 **建议** | 代码质量/可维护性改进 |

---

## 🔴 严重

### B1. Semaphore 并发计数器逻辑缺陷

**位置**: `app/src/agent/moa/ParallelAgentScheduler.ts` 第 14-47 行  
**文件**: [ParallelAgentScheduler.ts:14-47](E:\PY\Documents\CODES\PY_APP\app\src\agent\moa\ParallelAgentScheduler.ts)

**代码片段**:
```typescript
class Semaphore {
  private current = 0;
  private queue: Array<() => void> = [];

  async acquire(): Promise<void> {
    if (this.current < this.maxConcurrency) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();        // 唤醒等待者 —— 但不增加 current
    } else {
      this.current = Math.max(0, this.current - 1);
    }
  }
}
```

**问题描述**:
当任务被队列阻塞后通过 `next()` 唤醒时，`acquire()` 中 `this.current++` 不会执行（函数已在 `return new Promise` 处结束）。被唤醒的任务直接执行 `fn()`，但 `current` 计数没有增加。

**触发场景**:
假设 `maxConcurrency=2`，按以下顺序执行：
1. A 获取槽位 → `current=1`
2. B 获取槽位 → `current=2`
3. C 进入队列
4. A 完成 → `release()` 调用 `next()` 唤醒 C（`current` 保持 2）
5. B 完成 → `release()`：队列空，`current=Math.max(0,2-1)=1`
6. C 正在运行但 `current=1` ← **计数不一致**
7. D 到来 → `current=1 < 2` → `current=2` ← C+D 都在运行，计数正确但过程有偏

**风险**: 当前 JS 单线程模型下功能行为正确，但 `current` 计数会持续偏移，若未来有代码依赖 `current` 做资源管控（如内存限制），将引发并发失控。

**修复建议**: 在 `release()` 的 `next()` 分支中也同步 `current`。

---

### B2. sqlite3 包装器异常处理被吞

**位置**: `app/src/core/external/sqlite3.ts` 第 78-87 行  
****: [sqlite3.ts:78-87](E:\PY\Documents\CODES\PY_APP\app\src\core\external\sqlite3.ts)

**代码片段**:
```typescript
try {
  mkdirSync(dirname(path), { recursive: true });
} catch (err) {
  // 忽略
  handleError(err, {
    module: 'core:external',
    action: 'mkdirSync',
  });
}
```

**问题描述**:
1. 注释说"忽略"但实际调用了 `handleError(err)` — 注释与代码矛盾
2. `mkdirSync` 失败（如权限不足、路径非法）时 `handleError` 会记录错误到日志，但后续代码继续使用 `this._db` 访问 `BunDB` 构造函数，而构造函数没有 try-catch，可能抛出"数据库无法打开"的未捕获异常
3. `handleError` 本身也是异步错误处理，在同步构造函数中调用可能引发竞态

**触发场景**: 数据库路径不可写时，`mkdirSync` 失败 → 日志记录错误 → 继续执行 → `new BunDB` 可能也失败 → 双重错误。

**修复建议**: 
- 删除 `// 忽略` 注释，或改用 `logger.warn` 
- `mkdirSync` 失败后应决定是 throw 终止还是继续尝试

---

### B3. 硬编码用户绝对路径（调试脚本）

**位置**: 
- `app/check_ai_config.ts` 第 3 行
- `app/check_log_state.ts` 第 4 行  
- `app/check_user_db.ts` 第 3 行

**代码**:
```typescript
// check_ai_config.ts
const db = new Database('C:/Users/Administrator/.pyapp/data/app.db');
```

**问题描述**: 调试脚本硬编码了作者机器的绝对路径，其他开发者运行时会直接报错"数据库不存在"。这些脚本提交到代码库后会污染运行环境。

**修复建议**: 使用 `resolveDbPath()` 或环境变量，与主应用路径解析逻辑保持一致。

---

### B4. DI 容器存在两套实现

**位置**:
- `app/src/core/DIContainer.ts — 重导出层
- `app/src/core/di/DIContainer.ts` — 实际实现
- `app/src/core/di/index.ts` — 汇总导出

**问题描述**:
两套 DI 容器实现并存：旧的 `core/ModuleDependencyManager.ts` 和新版的 `core/di/DIContainer.ts`。`core/index.ts` 中同时导出了新旧两套。虽然旧版标记了 `@deprecated`，但 `main.ts` 中的启动逻辑部分仍可能引用旧版模块管理器。

**风险**: 模块 A 注册到旧容器，模块 B 从新容器获取 — 两个容器不互通，导致服务获取失败。`main.ts` 中如果同时引用两套，在运行时可能出现"服务未注册"错误。

**修复建议 统一使用新版 DI 容器，彻底移除旧版导出。

---

## 🟡 警告

### W1. TAORLoop 废弃代码残留

**位置**: `app/src/core/loop/TAORLoop.ts`  
**文件**: [TAORLoop.ts:1-8](E:\PY\Documents\CODES\PY_APP\app\src\core\loop\TAORLoop.ts)

**代码**:
```typescript
/**
 * @deprecated 自 2026-07-13 起废弃，Phase 4 完成后删除。
 * 简单原型，已被 query/TAORLoop 子模块取代。
 * 保留作为 Phase 4 制造者/检查者分离设计的参考。
 */
```

**问题描述**: 标注废弃已 17 天，代码仍留存在主仓库中。`core/index.ts` 仍导出 `TAORLoop`，新代码可能意外引用旧实现。

**风险**: 新开发者接手时可能基于废弃类开发，浪费工时。废弃代码增加了代码库体积和编译时间。

**修复建议**: 尽快删除或移入 `_archive` 目录。

---

### W2. tsconfig.json `rootDir: ".."` 路径泄露

**位置**: `app/tsconfig.json` 第 23 行

**代码**:
```json
"rootDir": "..",
```

**问题描述**: `rootDir` 设置为 `..`（项目根目录），意味着 TypeScript 编译器会扫描 `PY_APP/` 下的所有子目录（包括 `client/`、`scripts/`、`docker/` 等）。实际只需编译 `app/src`。

**风险**: 
- 编译速度下降
- 类型检查范围扩大，可能引入意外错误
- `bun build` 时可能打包多余文件

**修复建议**: 改为 `"rootDir": "./src"`。

---

### W3. `AgentRunner` 模块路径分隔符不统一

**位置**: `app/src/agent/AgentRunner.ts` 第 13 行

**代码**:
```typescript
module: 'agent\AgentRunner',
```

**问题描述**: 使用 `\`（Windows 反斜杠）作为模块路径分隔符，其他所有模块都使用 `/`。虽然 Bun 能正确处理，但日志输出不统一，且如果日志被送到 Linux 日志系统解析会有问题。

**修复建议**: 统一为 `'agent/AgentRunner'`。

---

### W4. governance 配置禁用但核心代码仍引用

**位置**: 
- `app/config/governance.json`: `"enabled": false`
- `app/deps-report.md`: governance 依赖 7 个模块，被 1 个模块依赖

**问题描述**: governance 治理系统已完全禁用，但相关代码和基础设施仍被 `app/src` 引用。`eslint.config.js` 中可能还在加载 governance 规则。

**风险**: 启动时 governance 模块初始化无实际作用，但增加启动时间和内存占用。

---

### W5. main.ts 中多处 try-catch 静默吞异常

**位置**: `app/src/main.ts` 各初始化阶段  
**举例**:
- 第 1051 行: `logger.warning('加载模型配置失败（非致命）', e as Error);` 
- 第 1062 行: `logger.warning('NotificationPersistence 初始化失败（非致命）', e as Error);`
- 第 1138 行: `logger.warning('SmartRouter 初始化失败（非致命）', e as Error);`
- 第 1150 行: `logger.warning('ConnectionRegistry 验证失败（非致命）', e as Error);`

**问题描述**: 启动流程中 10+ 个模块初始化失败时仅记 warning 不阻止启动。单个模块失败可能不会影响全局，但**多个连续失败**会导致应用处于"半初始化"状态 — 服务跑起来了但核心功能异常。

**风险**: 用户看到 Liri 启动了，但 AI 功能、数据库查询、通道连接等可能不可用，且无明显错误提示。

---

### W6. BunDB `run` 方法类型签名与实际返回不匹配

**位置**: `app/src/core/external/sqlite3.ts` 第 87-144 行

**问题描述**: `BunDB.prepare(sql).run(...)` 返回 `{ changes: number, lastInsertRowid: number | bigint }`。但在 `run` 方法的回调调用中：

```typescript
callback.call(
  { lastID: Number(result.lastInsertRowid), changes: result.changes },
  null
);
```

 `result.lastInsertRowid` 可能是 `bigint` 类型，强制 `Number()` 转换可能导致大整数精度丢失。`sqlite3` npm 包中 `lastInsertRowid` 预期的就是 `number` 类型，但 Bun 返回 `number | bigint`。

**风险**: 当插入大量数据超过 `Number.MAX_SAFE_INTEGER`（9007199254740991）时精度丢失。正常情况下不会触发，但属于类型安全边界问题。

---

## 🔵 建议

### S1. 前端 HTTP 客户端缺少重试机制

**位置**: `client/src/services/httpClient.ts`  
**文件**: [httpClient.ts](E:\PY\Documents\CODES\PY_APP\client\src\services\httpClient.ts)

**问题**: 前端 HTTP 客户端只有超时控制，没有重试逻辑。后端 `BaseAIProvider` 中有完善的指数退避重试，但前端与后端通信、与外部 API 通信都没有重试。

**建议**: 增加指数退避重试（状态码 429/503 等可重试，400/401 等非重试）。

---

### S2. agent/index.ts 中大量冗余导入导出

**位置**: `app/src/agent/index.ts`

**问题**: `index.ts` 中有多处重复 import 和 re-export：
- `StrategySelector` 第一块和末尾各 import 一次
- `ToolCallBatch`、`ContextCompressor`、`AgentRegistry` 同理

**影响**: 代码阅读困难、IDE 自动补全可能出现歧义。不影响运行时性能（Bun 会缓存模块），但维护成本增加。

---

### S3. StartupProfiler 启动性能埋点只记不告警

**位置**: `app/src/performance/StartupProfiler.js`

**问题**: 启动流程有完善的 `profileCheckpoint`/`profilePhaseStart`/`profilePhaseEnd` 埋点（共 20+ 个），但仅在 `logger.info` 中输出耗时信息，没有阈值告警机制。如果某个阶段异常缓慢（如 `T1_module_init` 超过 10 秒），无任何告警。

**建议**: 增加阈值告警和性能回归检测。

---

## 总结

| 级别 | 数量 | 关键项 |
|------|------|--------|
| 🔴 严重 | 4 | Semaphore 计数偏移、sqlite3 异常被吞、硬编码路径、双 DI 容器 |
| 🟡 警告 | 6 | 废弃代码残留、rootDir 路径泄露、路径分隔符、governance 死代码、静默吞异常、bigint 精度 |
| 🔵 建议 | 3 | HTTP 重试、冗余导入、性能告警 |

**最需要优先修复的 3 项**:
1. **B2** — sqlite3 包装器异常处理：修复注释矛盾 + `mkdirSync` 失败后不继续构造
2. **B4** — DI 容器两套实现：统一后可能导致模块互相找不到的运行时问题
3. **W2** — tsconfig 的 `rootDir: ".."`：影响编译范围和构建产物大小
