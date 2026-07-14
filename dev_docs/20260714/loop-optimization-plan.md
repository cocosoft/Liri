# Loop 模块优化完善方案

> 基于 [loop-benchmark-analysis-20260714.md](file:///E:/PY/CODES/PY_APP/dev_docs/20260714/loop-benchmark-analysis-20260714.md) 对标分析结果
> 日期：2026-07-14 | 版本：v1.0

---

## 一、方案总览

### 1.1 优化目标

| 阶段 | 时间 | 目标 | 改动量 |
|------|------|------|:---:|
| Phase 1: 安全加固 | 本周 | 消除硬伤：类型绕过、单次守卫、路径拒绝 | 小（3 文件） |
| Phase 2: 检测增强 | 下周 | 补齐循环检测短板 + 测试 | 中（4-5 文件） |
| Phase 3: 预算优化 | 两周内 | 收益递减、优雅最后一调、删除废弃代码 | 中（3 文件） |
| Phase 3.5: 记忆保持 | 两周内 | Compact 保留 12 轮、逐轮提取、检查点启用、分层记忆注入 | 中（4 文件） |
| Phase 4: 架构演进 | 远期 | 制造者/检查者分离、文档、流式工具执行 | 大（规划期） |

### 1.2 设计原则

- **外科手术式修改**：只改必须改的，不碰无关代码
- **新增前归一化检查**（CS01）：所有新增代码先查已有实现
- **回退最小化**（CS03）：不加"以防万一"的代码
- **Mock 零容忍**（CS04）：测试用真实逻辑，不用假数据

---

## 二、Phase 1：安全加固（本周，预计 4-6h）

### 2.1 消除 `as unknown as TAORLoopDeps` 类型绕过

**文件**：`app/src/query/ChatManagerTAORAdapter.ts`（第 176 行）

**问题**：`as unknown as TAORLoopDeps` 绕过了品牌类型（brand type）检查，编译期无法捕获接口不匹配。

**方案**：将 `TAORLoopDeps` 的 `[TAOR_LOOP_DEPS_BRAND]` 品牌符号改为可赋值模拟值，移除强制转换。

**修改步骤**：

1. 在 `TAORLoop.ts` 中新增工厂函数 `createTAORLoopDeps`，接受一个普通对象并返回带品牌的 `TAORLoopDeps`：

```typescript
// TAORLoop.ts 新增
const TAOR_LOOP_DEPS_BRAND_VALUE = Symbol('TAORLoopDeps') as unknown as typeof TAOR_LOOP_DEPS_BRAND;

/**
 * 工厂函数：创建 TAORLoopDeps
 * 替代 as unknown as TAORLoopDeps 绕过，提供类型安全的构造方式
 */
export function createTAORLoopDeps(impl: Omit<TAORLoopDeps, typeof TAOR_LOOP_DEPS_BRAND>): TAORLoopDeps {
  return { ...impl, [TAOR_LOOP_DEPS_BRAND]: TAOR_LOOP_DEPS_BRAND_VALUE } as TAORLoopDeps;
}
```

2. 修改 `ChatManagerTAORAdapter.ts` 第 176 行：

```typescript
// 旧代码（第 69-176 行）
export function createChatManagerTAORDeps(ctx: ChatManagerTAORContext): TAORLoopDeps {
  return { ... } as unknown as TAORLoopDeps;
}

// 新代码
import { createTAORLoopDeps } from './TAORLoop.js';

export function createChatManagerTAORDeps(ctx: ChatManagerTAORContext): TAORLoopDeps {
  return createTAORLoopDeps({ ... });
}
```

3. 同步更新 `LongRunningTaskOrchestrator.ts` 中的同类型绕过。

4. `index.ts` 新增导出：

```typescript
export { createTAORLoopDeps } from './TAORLoop.js';
```

**验证**：`bun run typecheck` 通过，无新增 type error。

---

### 2.2 新增单次尝试守卫（防止压缩-重试死循环）

**对标**：cc_code `hasAttemptiveReactiveCompact`

**文件**：`app/src/query/ErrorRecoveryManager.ts`

**新增逻辑**：在 `ErrorRecoveryManager` 中新增 `_compactAttempted: boolean` 字段，`context_overflow` 恢复仅允许一次压缩尝试。

**修改**：

```typescript
// ErrorRecoveryManager.ts 新增字段与方法

export class ErrorRecoveryManager {
  private attempts: Map<RecoveryType, RecoveryAttempt> = new Map();
  private _compactAttempted: boolean = false; // ← 新增

  /**
   * 评估错误并返回恢复策略
   */
  assess(error: Error, context: RecoveryContext): RecoveryResult {
    const type = classifyError(error);

    if (!type) {
      return { recovered: false, action: 'abort' };
    }

    const attempt = this.attempts.get(type);
    if (!attempt) {
      return { recovered: false, action: 'abort' };
    }

    // 单次尝试守卫：压缩只能尝试一次
    if (type === 'context_overflow' && this._compactAttempted) {
      return {
        recovered: false,
        action: 'abort',
        message: '上下文压缩已尝试过，放弃重试（防止压缩-重试死循环）',
      };
    }

    attempt.lastError = error;
    attempt.retryCount++;

    if (attempt.retryCount > attempt.maxRetries) {
      return {
        recovered: false,
        action: 'abort',
        message: `恢复尝试已超过最大次数 (${attempt.maxRetries})`,
      };
    }

    switch (type) {
      case 'context_overflow':
        this._compactAttempted = true; // ← 标记压缩已尝试
        return {
          recovered: true,
          action: 'compact_and_retry',
          message: '上下文溢出，压缩后重试',
        };
      // ... 其余不变
    }
  }

  /**
   * 重置所有重试计数（新一轮对话开始时调用）
   */
  resetAll(): void {
    for (const attempt of this.attempts.values()) {
      attempt.retryCount = 0;
      attempt.lastError = undefined;
    }
    this._compactAttempted = false; // ← 新增重置
  }

  /**
   * 序列化恢复状态（用于 Checkpoint 持久化）
   */
  serialize(): RecoveryState {
    const entries: Array<[string, { type: RecoveryType; retryCount: number }]> = [];
    for (const [key, attempt] of this.attempts) {
      entries.push([key, { type: attempt.type, retryCount: attempt.retryCount }]);
    }
    return { attempts: entries, compactAttempted: this._compactAttempted };
  }

  /**
   * 从序列化状态恢复
   */
  restore(state: RecoveryState): void {
    this.attempts = new Map();
    for (const [key, data] of state.attempts) {
      this.attempts.set(key as RecoveryType, {
        type: data.type,
        maxRetries: DEFAULT_MAX_RETRIES[data.type] ?? 3,
        retryCount: data.retryCount,
      });
    }
    this._compactAttempted = state.compactAttempted ?? false;
  }
}
```

同步更新 `RecoveryState` 接口：

```typescript
interface RecoveryState {
  attempts: Array<[string, { type: RecoveryType; retryCount: number }]>;
  compactAttempted?: boolean; // ← 新增
}
```

---

### 2.3 新增路径拒绝列表

**对标**：loop-engineering `loop-constraints.md`（`.env`、`auth/`、`payments/`、`secrets/`）

**新增文件**：`app/src/query/PathGuard.ts`

**设计**：在 Loop 启动时检查工具调用目标路径是否命中拒绝列表，命中则直接拒绝执行。

```typescript
// app/src/query/PathGuard.ts（新文件）

/**
 * PathGuard — 路径安全守卫
 *
 * Phase 1 新增。对标 loop-engineering 的路径拒绝列表机制。
 * 防止 Agent 循环触碰敏感文件路径（.env、auth/、payments/、secrets/ 等）。
 *
 * 配置来源：
 *   - 默认拒绝列表（内置）
 *   - 环境变量 LOOP_PATH_DENY_LIST（JSON 数组，追加到默认列表）
 */

/** 默认拒绝的路径模式（glob） */
const DEFAULT_DENY_PATTERNS: string[] = [
  '**/.env',
  '**/.env.*',
  '**/auth/**',
  '**/payments/**',
  '**/secrets/**',
  '**/credentials/**',
  '**/*.pem',
  '**/*.key',
  '**/id_rsa*',
];

/** 默认拒绝的写入路径（更严格） */
const DEFAULT_DENY_WRITE_PATTERNS: string[] = [
  ...DEFAULT_DENY_PATTERNS,
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/bun.lockb',
  '**/Cargo.lock',
];

interface PathGuardConfig {
  /** 只读操作拒绝的路径模式 */
  denyRead: string[];
  /** 写入操作拒绝的路径模式（继承 denyRead） */
  denyWrite: string[];
}

interface PathCheckResult {
  allowed: boolean;
  reason?: string;
}

/** 加载环境变量追加配置 */
function loadEnvDenyPatterns(): string[] {
  try {
    const raw = process.env.LOOP_PATH_DENY_LIST;
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is string => typeof p === 'string');
  } catch {
    return [];
  }
}

export class PathGuard {
  private config: PathGuardConfig;

  constructor() {
    const envPatterns = loadEnvDenyPatterns();

    this.config = {
      denyRead: [...DEFAULT_DENY_PATTERNS, ...envPatterns],
      denyWrite: [...DEFAULT_DENY_WRITE_PATTERNS, ...envPatterns],
    };
  }

  /**
   * 检查读取操作的目标路径是否允许
   */
  checkRead(targetPath: string): PathCheckResult {
    return this._check(targetPath, this.config.denyRead, 'read');
  }

  /**
   * 检查写入操作的目标路径是否允许
   */
  checkWrite(targetPath: string): PathCheckResult {
    return this._check(targetPath, this.config.denyWrite, 'write');
  }

  /**
   * 检查工具调用是否允许（根据 toolName 判断读/写）
   */
  checkToolCall(toolName: string, args: Record<string, unknown>): PathCheckResult {
    const path = this._extractPath(toolName, args);
    if (!path) return { allowed: true }; // 没有路径参数，放行

    const isWrite = this._isWriteTool(toolName);
    return isWrite ? this.checkWrite(path) : this.checkRead(path);
  }

  /**
   * 归一化路径后做 glob 匹配
   */
  private _check(targetPath: string, patterns: string[], operation: string): PathCheckResult {
    const normalized = targetPath.replace(/\\/g, '/').toLowerCase();

    for (const pattern of patterns) {
      if (this._matchGlob(normalized, pattern)) {
        return {
          allowed: false,
          reason: `路径 "${targetPath}" 命中拒绝列表 (${operation}: ${pattern})`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * 从工具调用 args 中提取路径参数
   */
  private _extractPath(toolName: string, args: Record<string, unknown>): string | null {
    // 读文件类工具
    if (['read_file', 'read', 'cat'].includes(toolName)) {
      return typeof args.path === 'string' ? args.path
        : typeof args.filePath === 'string' ? args.filePath
        : null;
    }
    // 写文件类工具
    if (['write_file', 'write', 'edit_file', 'replace_in_file'].includes(toolName)) {
      return typeof args.path === 'string' ? args.path
        : typeof args.filePath === 'string' ? args.filePath
        : null;
    }
    // 搜索/glob 类
    if (['glob', 'grep', 'search_files', 'search_content'].includes(toolName)) {
      return typeof args.path === 'string' ? args.path
        : typeof args.directory === 'string' ? args.directory
        : typeof args.target_directory === 'string' ? args.target_directory
        : null;
    }
    return null;
  }

  /**
   * 判断是否写操作工具
   */
  private _isWriteTool(toolName: string): boolean {
    const writeTools = [
      'write_file', 'write', 'edit_file', 'replace_in_file',
      'create_file', 'delete_file', 'delete_files',
      'execute_command', 'run_command', 'bash',
    ];
    return writeTools.includes(toolName);
  }

  /**
   * 简化的 glob 匹配（支持 ** 和 * 通配符）
   */
  private _matchGlob(path: string, pattern: string): boolean {
    // 转为正则
    const regexStr = pattern
      .toLowerCase()
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '___DOUBLESTAR___') // 临时占位
      .replace(/\*/g, '[^/]*')
      .replace(/___DOUBLESTAR___/g, '.*');

    return new RegExp(`^${regexStr}$`).test(path);
  }
}

/** 工厂函数 */
export function createPathGuard(): PathGuard {
  return new PathGuard();
}
```

**集成点**：在 `TAORLoop.ts` 的 `_runModern()` 中，工具执行前调用 `pathGuard.checkToolCall()`：

```typescript
// TAORLoop.ts _runModern() 中工具执行处新增
import { createPathGuard } from './PathGuard.js';

// constructor 中初始化
this.pathGuard = createPathGuard();

// 工具执行前检查
for (const tc of toolCallsToExecute) {
  const pathCheck = this.pathGuard.checkToolCall(tc.name, tc.arguments);
  if (!pathCheck.allowed) {
    this.logger.warn('路径守卫拦截工具调用', {
      tool: tc.name,
      path: tc.arguments,
      reason: pathCheck.reason,
    });
    results.push({
      toolCallId: tc.id,
      toolName: tc.name,
      error: `[PATH_GUARD] ${pathCheck.reason}`,
    });
    continue;
  }
  // ... 继续执行工具
}
```

**验证**：`bun run typecheck` 通过。

---

### 2.4 Phase 1 验证清单

- [ ] `bun run typecheck` 零错误
- [ ] ChatManagerTAORAdapter 不再使用 `as unknown as`
- [ ] 压缩重试超过 1 次后直接 abort（不再死循环）
- [ ] 读取 `.env` 文件被 PathGuard 拒绝
- [ ] 写入 `auth/` 目录被 PathGuard 拒绝
- [ ] 环境变量 `LOOP_PATH_DENY_LIST` 可追加自定义规则

---

## 三、Phase 2：检测增强（下周，预计 8-12h）

### 3.1 新增 `unknown_tool_repeat` 循环检测器

**对标**：openclaw `tool-loop-detection.ts` 的 `unknown_tool_repeat` 检测

**文件**：`app/src/query/LoopDetector.ts`（修改现有文件）

**新增逻辑**：在 `LoopDetector` 中新增 `unknown_tool_repeat` 检测器。跟踪对不存在工具的调用，当同一不存在的工具连续被调用超过阈值时阻断。

**修改**：

1. 更新 `DetectorKind` 类型：

```typescript
type DetectorKind = 'generic_repeat' | 'ping_pong' | 'unknown_tool_repeat';
```

2. 新增 `unknown_tool_repeat` 配置：

```typescript
interface LoopDetectorConfig {
  // ... 现有字段
  detectors: {
    genericRepeat: boolean;
    pingPong: boolean;
    unknownToolRepeat: boolean; // ← 新增
  };
  /** 未知工具警告阈值，默认 5 */
  unknownToolWarningThreshold: number; // ← 新增
  /** 未知工具阻断阈值，默认 10 */
  unknownToolCriticalThreshold: number; // ← 新增
}

const DEFAULT_CONFIG: LoopDetectorConfig = {
  // ... 现有字段
  detectors: {
    genericRepeat: true,
    pingPong: true,
    unknownToolRepeat: true, // ← 新增
  },
  unknownToolWarningThreshold: 5,
  unknownToolCriticalThreshold: 10,
};
```

3. `ToolCallRecord` 新增字段：

```typescript
interface ToolCallRecord {
  // ... 现有字段
  /** 工具是否存在（false = 模型调用了不存在的工具） */
  toolExists?: boolean; // ← 新增
}
```

4. 新增 `recordUnknownTool()` 方法：

```typescript
/**
 * 记录模型调用了不存在的工具（工具注册表中未找到）
 * 这通常是模型幻觉或循环退化的信号
 */
recordUnknownTool(toolName: string, params: unknown): void {
  if (!this.config.enabled) return;

  const argsHash = hashToolCall(toolName, params, this.config.hashMaxInputLength);

  this.history.push({
    toolName,
    argsHash,
    timestamp: Date.now(),
    toolExists: false,
  });

  while (this.history.length > this.config.historySize) {
    this.history.shift();
  }
}
```

5. 在 `detect()` 方法中新增检测：

```typescript
detect(toolName: string, params: unknown): LoopDetectionResult {
  // ... 现有预检逻辑

  // 0. Unknown Tool Repeat Detection（优先级最高）
  if (this.config.detectors.unknownToolRepeat) {
    const result = this._detectUnknownToolRepeat(toolName);
    if (result.stuck) return result;
  }

  // 1. Generic Repeat Detection
  // ...

  // 2. Ping-Pong Detection
  // ...
}
```

6. 新增 `_detectUnknownToolRepeat()` 方法：

```typescript
/**
 * 未知工具重复检测：对不存在的工具连续调用
 * 模型反复调用同一个不存在的工具 → 无限死循环信号
 */
private _detectUnknownToolRepeat(toolName: string): LoopDetectionResult {
  // 只检测标记为 toolExists=false 的记录
  let count = 0;
  const unknownOnly = this.history.filter(
    (h) => h.toolName === toolName && h.toolExists === false
  );

  // 从尾部统计连续
  for (let i = this.history.length - 1; i >= 0; i--) {
    const record = this.history[i];
    if (record.toolName === toolName && record.toolExists === false) {
      count++;
    } else if (record.toolName !== toolName) {
      break; // 被其他工具调用打断，停止统计
    }
    // toolExists === true 的同名工具，继续统计（可能是先成功再失败）
  }

  if (count >= this.config.unknownToolCriticalThreshold) {
    return {
      stuck: true,
      level: 'critical',
      detector: 'unknown_tool_repeat',
      count,
      message: `工具 "${toolName}" 不存在，但被连续调用 ${count} 次（临界阈值 ${this.config.unknownToolCriticalThreshold}），已阻断`,
    };
  }

  if (count >= this.config.unknownToolWarningThreshold) {
    return {
      stuck: true,
      level: 'warning',
      detector: 'unknown_tool_repeat',
      count,
      message: `工具 "${toolName}" 不存在，连续调用 ${count} 次（警告阈值 ${this.config.unknownToolWarningThreshold}）`,
    };
  }

  return { stuck: false };
}
```

**集成点**：在 `TAORLoop.ts` 的 `_runModern()` 中，工具执行前调用 `loopDetector.recordToolCall()` 时，如果工具在注册表中找不到则调用 `recordUnknownTool()` 而非 `recordToolCall()`。

**验证**：新增单元测试，覆盖 unknown_tool_repeat 的 warning/critical 阈值。

---

### 3.2 新增全局断路器

**对标**：openclaw `global_circuit_breaker`（同参数+同结果 ≥ 30 次无条件阻止）

**文件**：`app/src/query/CircuitBreaker.ts`（修改现有文件）

**新增逻辑**：在 `CircuitBreaker` 中新增 `sameCallSameResultCount` 计数，当同一工具调用（相同 toolName + argsHash）产生相同结果（相同 resultHash）达到阈值时，无条件 OPEN。

**修改**：

```typescript
// CircuitBreaker.ts — 新增配置和字段

interface CircuitBreakerConfig {
  // ... 现有字段
  /** 同调用同结果触发熔断的阈值，默认 30 */
  sameCallSameResultThreshold: number; // ← 新增
  /** 全局断路器提示消息 */
  globalBreakerMessage?: string; // ← 新增
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  // ... 现有字段
  sameCallSameResultThreshold: 30,
  globalBreakerMessage: '同一工具调用产生完全相同结果超过阈值，已触发全局断路器',
};

export class CircuitBreaker {
  // ... 现有字段
  /** 同调用同结果追踪（全局断路器） */
  private sameCallSameResultCount: Map<string, number> = new Map(); // ← 新增

  /**
   * 记录工具调用结果（用于全局断路器判断）
   * @returns 是否触发全局断路器
   */
  recordSameCallResult(
    toolName: string,
    argsHash: string,
    resultHash: string,
  ): BreakerCheckResult {
    if (!this.config.enabled) return { break: false };

    const key = `${toolName}:${argsHash}:${resultHash}`;
    const count = (this.sameCallSameResultCount.get(key) ?? 0) + 1;
    this.sameCallSameResultCount.set(key, count);

    if (count >= this.config.sameCallSameResultThreshold) {
      this._transitionToOpen(
        `${this.config.globalBreakerMessage} (${toolName}, 同一调用+同一结果 ${count} 次)`
      );
      return {
        break: true,
        reason: `全局断路器触发: ${toolName} 同一调用+同一结果 ${count} 次`,
      };
    }

    return { break: false };
  }

  /**
   * 重置全局断路器计数
   */
  resetSameCallCounts(): void {
    this.sameCallSameResultCount.clear();
  }

  /**
   * 重置所有状态（包含全局断路器计数）
   */
  reset(): void {
    // ... 现有重置逻辑
    this.sameCallSameResultCount.clear(); // ← 新增
  }
}
```

**集成点**：在 `TAORLoop.ts` 的 `_runModern()` 中，每次工具执行完成后调用 `circuitBreaker.recordSameCallResult()`。

---

### 3.3 新增文件读写循环检测

**对标**：hermes `file_tools.py`（按 task_id 追踪连续读写同一文件）

**新增文件**：`app/src/query/FileIOLoopDetector.ts`

```typescript
// app/src/query/FileIOLoopDetector.ts（新文件）

/**
 * FileIOLoopDetector — 文件读写循环检测器
 *
 * Phase 2 新增。对标 hermes file_tools.py 的按 task_id 文件循环检测。
 * 追踪对同一文件/同一区域的连续读写操作，达到阈值后阻止并告警。
 *
 * 检测逻辑（参考 hermes）：
 *   同一文件/区域连续读取第 3 次 → 警告（仍返回内容）
 *   同一文件/区域连续读取第 4+ 次 → 阻止（返回 BLOCKED 错误）
 *   任何其他工具调用（或读取不同文件/不同区域）→ 重置计数器
 *   分页（offset/limit 变化）不计为重复
 */

interface FileIOConfig {
  enabled: boolean;
  /** 警告阈值，默认 3 */
  warningThreshold: number;
  /** 阻止阈值，默认 4 */
  blockThreshold: number;
}

interface FileAccessRecord {
  filePath: string;
  /** 读取区域（offset + limit 组合） */
  region: string;
  toolName: string;
  consecutiveCount: number;
  lastAccessAt: number;
}

interface FileIOBlockResult {
  blocked: boolean;
  warning: boolean;
  message?: string;
}

const DEFAULT_CONFIG: FileIOConfig = {
  enabled: true,
  warningThreshold: 3,
  blockThreshold: 4,
};

/** 读类工具名称集合 */
const READ_TOOLS = new Set([
  'read_file', 'read', 'cat',
  'search_files', 'search_content',
  'glob', 'grep',
  'list_files', 'ls',
]);

export class FileIOLoopDetector {
  private config: FileIOConfig;
  /** 当前追踪的连续文件访问（同一文件+区域） */
  private current: FileAccessRecord | null = null;

  constructor(config?: Partial<FileIOConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 在执行文件操作前检查
   * @param toolName 工具名称
   * @param filePath 目标文件路径
   * @param offset 分页偏移（search_files/grep 等）
   * @param limit 分页大小
   */
  checkBeforeAccess(
    toolName: string,
    filePath: string,
    offset?: number,
    limit?: number,
  ): FileIOBlockResult {
    if (!this.config.enabled) return { blocked: false, warning: false };
    if (!READ_TOOLS.has(toolName)) {
      // 非读类工具 → 重置追踪
      this.current = null;
      return { blocked: false, warning: false };
    }

    const normalizedPath = filePath.replace(/\\/g, '/');
    const region = offset !== undefined && limit !== undefined
      ? `offset=${offset},limit=${limit}`
      : 'full';

    // 检查是否与上一次访问为同一文件+区域
    if (
      this.current &&
      this.current.filePath === normalizedPath &&
      this.current.region === region
    ) {
      this.current.consecutiveCount++;
      this.current.lastAccessAt = Date.now();

      if (this.current.consecutiveCount >= this.config.blockThreshold) {
        return {
          blocked: true,
          warning: false,
          message: `[FILE_IO_GUARD] 文件 "${filePath}" 同一区域连续读取 ${this.current.consecutiveCount} 次，已阻止（阈值 ${this.config.blockThreshold}）`,
        };
      }

      if (this.current.consecutiveCount >= this.config.warningThreshold) {
        return {
          blocked: false,
          warning: true,
          message: `[FILE_IO_GUARD] 文件 "${filePath}" 同一区域连续读取 ${this.current.consecutiveCount} 次（警告阈值 ${this.config.warningThreshold}）`,
        };
      }
    } else {
      // 不同文件/区域 → 重置为新追踪
      this.current = {
        filePath: normalizedPath,
        region,
        toolName,
        consecutiveCount: 1,
        lastAccessAt: Date.now(),
      };
    }

    return { blocked: false, warning: false };
  }

  /**
   * 在任何非读操作发生后重置追踪（由调用方在非读工具执行后调用）
   */
  resetOnNonRead(): void {
    this.current = null;
  }

  /**
   * 完全重置
   */
  reset(): void {
    this.current = null;
  }
}

/** 工厂函数 */
export function createFileIOLoopDetector(config?: Partial<FileIOConfig>): FileIOLoopDetector {
  return new FileIOLoopDetector(config);
}
```

**集成点**：在 `TAORLoop.ts` 的 `_runModern()` 中，工具执行前调用 `fileIOLoopDetector.checkBeforeAccess()`，若 `blocked` 则返回错误结果不入真实执行。

```typescript
// TAORLoop.ts 构造函数中新增
this.fileIOLoopDetector = createFileIOLoopDetector();

// 工具执行循环中
for (const tc of toolCallsToExecute) {
  // 文件 IO 循环检测
  const args = tc.arguments as Record<string, unknown>;
  const filePath = (args.path ?? args.filePath ?? args.directory) as string | undefined;

  if (filePath) {
    const ioCheck = this.fileIOLoopDetector.checkBeforeAccess(
      tc.name,
      filePath,
      args.offset as number | undefined,
      args.limit as number | undefined,
    );

    if (ioCheck.blocked) {
      this.logger.warn('文件IO循环已被阻止', { tool: tc.name, path: filePath });
      results.push({
        toolCallId: tc.id,
        toolName: tc.name,
        error: ioCheck.message,
      });
      continue;
    }

    if (ioCheck.warning) {
      this.logger.warn('文件IO循环警告', { tool: tc.name, path: filePath });
    }
  }

  // ... 继续执行工具
}
```

---

### 3.4 补充单元测试

**新增文件**：

| 文件 | 覆盖模块 | 预计行数 |
|------|---------|:---:|
| `app/src/query/LoopDetector.test.ts` | LoopDetector 全部 3 种检测器 | ~250 行 |
| `app/src/query/CircuitBreaker.test.ts` | CircuitBreaker 三态 + 全局断路器 | ~200 行 |
| `app/src/query/FileIOLoopDetector.test.ts` | FileIOLoopDetector 警告/阻止阈值 | ~150 行 |

**LoopDetector.test.ts 核心用例**：

```typescript
describe('LoopDetector', () => {
  describe('generic_repeat', () => {
    it('相同工具+相同参数连续 10 次应触发 warning', () => { /* ... */ });
    it('相同工具+相同参数连续 20 次应触发 critical', () => { /* ... */ });
    it('中间穿插不同调用应重置计数', () => { /* ... */ });
  });

  describe('ping_pong', () => {
    it('两个工具交替各 10 次且无进展应触发 critical', () => { /* ... */ });
    it('交替但有 resultHash 变化不计为无进展', () => { /* ... */ });
  });

  describe('unknown_tool_repeat', () => {
    it('不存在的工具连续 5 次应触发 warning', () => { /* ... */ });
    it('不存在的工具连续 10 次应触发 critical', () => { /* ... */ });
    it('被其他工具调用打断后应重置', () => { /* ... */ });
  });
});
```

**CircuitBreaker.test.ts 核心用例**：

```typescript
describe('CircuitBreaker', () => {
  describe('三态状态机', () => {
    it('连续相同错误 5 次 → OPEN', () => { /* ... */ });
    it('连续失败 10 次 → OPEN', () => { /* ... */ });
    it('OPEN 等待 30s → HALF_OPEN', () => { /* ... */ });
    it('HALF_OPEN 成功 → CLOSED', () => { /* ... */ });
    it('HALF_OPEN 失败 → OPEN', () => { /* ... */ });
  });

  describe('硬上限', () => {
    it('达到 maxTurnsHardCap 返回 break=true', () => { /* ... */ });
    it('Token 超预算返回 break=true', () => { /* ... */ });
  });

  describe('全局断路器', () => {
    it('同一调用+同一结果 30 次触发全局断路器', () => { /* ... */ });
    it('相同工具但不同结果不触发', () => { /* ... */ });
  });
});
```

**验证**：`bun test app/src/query/LoopDetector.test.ts` 全部通过。

---

### 3.5 Phase 2 导出更新

`app/src/query/index.ts` 新增导出：

```typescript
export { PathGuard, createPathGuard } from './PathGuard.js';
export type { PathGuardConfig, PathCheckResult } from './PathGuard.js';
export { FileIOLoopDetector, createFileIOLoopDetector } from './FileIOLoopDetector.js';
export type { FileIOConfig, FileIOBlockResult } from './FileIOLoopDetector.js';
```

---

### 3.6 Phase 2 验证清单

- [ ] `bun run typecheck` 零错误
- [ ] `bun test` 新增 3 个测试文件全部通过
- [ ] unknown_tool_repeat 能在模型调用不存在工具时检测到
- [ ] 全局断路器在极端重复场景下触发
- [ ] 连续读同一文件 4 次被 FileIOLoopDetector 阻止
- [ ] PathGuard 能正确拦截敏感路径

---

## 四、Phase 3：预算优化（两周内，预计 4-6h）

### 4.1 新增收益递减检测

**对标**：cc_code `deltaSinceLastCheck`（连续两次 Token 增量 < 500 时自动停止）

**文件**：`app/src/query/DailyBudgetManager.ts`（修改现有文件）

**修改**：

```typescript
// DailyBudgetManager.ts — 新增收益递减检测

interface DailyBudgetConfig {
  // ... 现有字段
  /** 收益递减检测的最小 Token 增量，默认 500 */
  minTokenDelta: number; // ← 新增
  /** 连续低增量次数阈值，默认 2 */
  diminishingTurnsThreshold: number; // ← 新增
}

const DEFAULT_CONFIG: DailyBudgetConfig = {
  dailyLimit: 1_000_000,
  warningThreshold: 0.8,
  lockThreshold: 1.0,
  minTokenDelta: 500,
  diminishingTurnsThreshold: 2,
};

export class DailyBudgetManager {
  // ... 现有字段
  private lastTotalTokens: number = 0; // ← 新增
  private diminishingTurnsCount: number = 0; // ← 新增

  /**
   * 检查收益递减（每轮结束后调用）
   * 连续 N 轮 Token 增量低于阈值时返回 true，表示应终止（避免低效消耗）
   */
  checkDiminishingReturns(currentTotalTokens: number): { diminishing: boolean; reason?: string } {
    const delta = currentTotalTokens - this.lastTotalTokens;
    this.lastTotalTokens = currentTotalTokens;

    if (delta < this.config.minTokenDelta) {
      this.diminishingTurnsCount++;

      if (this.diminishingTurnsCount >= this.config.diminishingTurnsThreshold) {
        return {
          diminishing: true,
          reason: `连续 ${this.diminishingTurnsCount} 轮 Token 增量低于阈值 (${this.config.minTokenDelta})，可能已陷入低效循环`,
        };
      }

      return { diminishing: false }; // 还没达到阈值
    }

    // Token 有进展 → 重置
    this.diminishingTurnsCount = 0;
    return { diminishing: false };
  }

  /**
   * 重置收益递减计数
   */
  resetDiminishingReturns(): void {
    this.lastTotalTokens = this.todayUsed;
    this.diminishingTurnsCount = 0;
  }

  reset(): void {
    // ... 现有重置逻辑
    this.lastTotalTokens = 0;
    this.diminishingTurnsCount = 0;
  }
}
```

**集成点**：在 `TAORLoop.ts` 的 `_runModern()` 每轮结束后调用：

```typescript
// 每轮结束后
const diminishingCheck = this.dailyBudget.checkDiminishingReturns(totalTokens);
if (diminishingCheck.diminishing) {
  this.stopReason = 'diminishing_returns';
  this.logger.warn('收益递减，终止循环', { reason: diminishingCheck.reason });
  break;
}
```

`StopHookReason` 类型新增 `'diminishing_returns'`。

---

### 4.2 新增优雅最后一次调用

**对标**：hermes `_budget_grace_call`（预算耗尽时允许完成当前工具调用）

**文件**：`app/src/query/DailyBudgetManager.ts`（修改现有文件）

**修改**：

```typescript
export class DailyBudgetManager {
  // ... 现有字段
  private _graceCallActive: boolean = false; // ← 新增

  /**
   * 检查是否需要优雅最后一次调用
   * 当预算耗尽但当前正在执行工具调用时，允许完成当前轮
   */
  needsGraceCall(): boolean {
    if (this._graceCallActive) return false; // 只能有一次优雅调用

    const mode = this.getMode();
    if (mode.mode === 'locked' && !this._graceCallActive) {
      this._graceCallActive = true;
      return true;
    }

    return false;
  }

  /**
   * 确认优雅调用已使用
   */
  consumeGraceCall(): void {
    this._graceCallActive = true;
  }

  /**
   * 是否已完成优雅调用
   */
  graceCallConsumed(): boolean {
    return this._graceCallActive;
  }

  reset(): void {
    // ... 现有重置逻辑
    this._graceCallActive = false;
  }
}
```

**集成点**：在 `TAORLoop.ts` 中，当 `canExecute() === false` 时，调用 `needsGraceCall()` 判断是否允许最后一次调用。

```typescript
// TAORLoop._runModern() 主循环中
if (!this.dailyBudget.canExecute()) {
  if (this.toolCallsInProgress > 0 && this.dailyBudget.needsGraceCall()) {
    this.logger.warn('预算已耗尽，但允许完成当前工具调用（优雅最后一调）');
    // 不 break，继续执行
  } else {
    this.stopReason = 'budget_exhausted';
    break;
  }
}
```

---

### 4.3 删除废弃代码

**文件**：`app/src/core/loop/TAORLoop.ts`

**操作**：直接删除该文件（如灰度已全量）。如果仍有关联引用，先移除引用再删除。

**验证**：
- [ ] `bun run typecheck` 无报错（确认无残留引用）
- [ ] 全局搜索 `@modules/core/loop` 结果为零
- [ ] 全局搜索 `core/loop/TAORLoop` 结果为零

---

### 4.4 Phase 3 验证清单

- [ ] `bun run typecheck` 零错误
- [ ] 连续 3 轮 Token 增量 < 500 时成功触发 `diminishing_returns`
- [ ] 预算耗尽但工具执行中时允许完成当前轮
- [ ] 废弃文件 `core/loop/TAORLoop.ts` 已删除
- [ ] 废弃代码无残留引用

---

### 4.5 Phase 3 补充：长对话记忆保持（与 Phase 3 并行，预计 6-10h）

> 来源：与 Liri 关于 100+ 轮对话记忆不丢失的架构讨论（详见 `logs/app.md`）
> 诊断发现：当前记忆系统存在 5 大瓶颈，导致 30 轮后信息衰减至 60%，50 轮后仅剩 30%

#### 4.5.1 瓶颈诊断摘要

```
第 1-10 轮 → 第 11-30 轮 → 第 31-50 轮 → 第 50+ 轮
   完好        压缩开始         摘要变粗        细节消失
   100%         85%             60%            30%
```

| 瓶颈 | 根因 | 文件位置 |
|------|------|---------|
| **B1: 压缩只保留 2-3 轮** | `CompactService.ts` `roundsToKeep=2` (auto) / `=3` (manual) | [CompactService.ts:304](file:///E:/PY/CODES/PY_APP/app/src/services/compact/CompactService.ts#L304) |
| **B2: 记忆提取阈值过高** | `SessionMemoryManager.ts` `tokenThreshold=20000`, `toolCallThreshold=10` | [SessionMemoryManager.ts:83-86](file:///E:/PY/CODES/PY_APP/app/src/session/memory/SessionMemoryManager.ts#L83-L86) |
| **B3: 无逐轮记忆提取** | 批次累计到阈值才提炼，轮次间信息是"裸奔"状态，崩溃即丢失 | [SessionMemoryManager.ts:197-203](file:///E:/PY/CODES/PY_APP/app/src/session/memory/SessionMemoryManager.ts#L197-L203) |
| **B4: 记忆未注入系统提示词** | `getMemoryContext()` 存在于代码中但从未被调用 | [SessionMemoryManager.ts:285-289](file:///E:/PY/CODES/PY_APP/app/src/session/memory/SessionMemoryManager.ts#L285-L289) |
| **B5: 无自动轮次检查点** | TAORLoop 检查点被 ChatManager 显式禁用 (`enableCheckpoint: false`) | [ChatManager.ts:414](file:///E:/PY/CODES/PY_APP/app/src/chat/ChatManager.ts#L414) |

> 注：更致命的是 **B2+B1 的叠加效应**——等到记忆提取触发时（20K token），前面的轮次已经被 compact 过一轮，记忆提取是在"已损失的信息"上再做摘要，造成**二次失真**。

#### 4.5.2 手术方案 1：CompactService 保留轮数 2 → 12

**对标**：cc_code 的压缩策略（保留足够的精确消息窗口）

**文件**：`app/src/services/compact/CompactService.ts`

**问题**：`roundsToKeep = 2` 意味着 100 轮对话中，每 2-3 轮就触发一次压缩，每次只保留最后 2 轮原始消息。第 5 轮的"文件路径是 xxx"在第 15 轮后被摘要吞没，精确信息永久消失。

**修改**：

```typescript
// CompactService.ts 第 304 行 — 修改前
const roundsToKeep = options?.isAutoCompact ? 2 : 3;

// CompactService.ts 第 304 行 — 修改后
/**
 * 保留轮数从 2→12（对标 cc_code 的压缩策略）。
 *
 * 理由：
 *   原值 2 意味着超过 10 轮后精确消息全部消失，第 50 轮时仅剩最近摘要。
 *   12 轮保留可确保最近 24 条消息（12 user + 12 assistant）完整保留在上下文中，
 *   配合 SessionMemoryManager 的逐轮提取（手术方案 2），历史信息不再丢失。
 *
 *   保留 12 轮约占用 ~15K-25K token（取决于消息长度），在 200K 上下文窗口中占比合理。
 */
const roundsToKeep = options?.isAutoCompact ? 12 : 15;
```

**影响评估**：
- Token 消耗：每轮平均 ~1.5K-2K token，保留 12 轮 ≈ 18K-24K token，在 200K 窗口中占比 ~10%
- 不会导致更多 compact 触发，因为 compact 边界检测阈值（167K）不变
- 与手术方案 2（逐轮提取）配合：压缩时已有完整记忆文件，不再依赖保留消息做摘要

**验证**：
- [ ] 第 15 轮对话后，第 1-12 轮的原始消息仍在上下文中
- [ ] 自动压缩触发后，摘要 + 最近 12 轮原始消息同时存在
- [ ] 200K 上下文未因保留轮数增加而过早触发压缩

---

#### 4.5.3 手术方案 2：SessionMemory 逐轮提取 + 降低阈值

**对标**：loop-engineering 的外部状态文件作为记忆（`STATE.md` 在每次运行后更新）

**文件**：`app/src/session/memory/SessionMemoryManager.ts`

**问题 A**：阈值过高（20K token / 10 次工具调用），等到触发时前面的轮次已被 compact 过一次，造成二次失真。

**问题 B**：批次提取而非逐轮提取，轮次间信息裸奔，崩溃丢失。

**修改 A — 降低阈值**：

```typescript
// SessionMemoryManager.ts 第 83-86 行 — 修改前
const DEFAULT_CONFIG: MemoryThresholdConfig = {
  tokenThreshold: 20_000,
  toolCallThreshold: 10,
};

// SessionMemoryManager.ts 第 83-86 行 — 修改后
const DEFAULT_CONFIG: MemoryThresholdConfig = {
  /**
   * 降低 token 阈值从 20K→5K，确保在首次 compact 之前就完成第一次记忆提取。
   * 避免在"压缩过的信息"上做二次摘要。
   */
  tokenThreshold: 5_000,
  /** 降低工具调用阈值从 10→5，更早捕获关键操作 */
  toolCallThreshold: 5,
};
```

**修改 B — 新增 `shouldExtractPerTurn()` 方法**（轻量逐轮提取）：

```typescript
// SessionMemoryManager.ts 新增方法

/**
 * 逐轮轻量提取：每轮结束后提取 1-2 个关键事实
 * 不做完整的 LLM 提炼，仅基于本轮内容做关键词+规则提取
 *
 * 这是批次 LLM 提取（accumulateTurn→shouldExtract→LLM 提炼）的补充，
 * 确保轮次间信息不裸奔——即使系统崩溃，最多丢失当前轮的信息。
 *
 * @returns 提取的关键事实（为空则本轮无关键信息），同时持久化到 memory.md
 */
async extractPerTurn(turnMessages: ChatMessage[]): Promise<MemoryItem[]> {
  const items: MemoryItem[] = [];

  // 1. 规则提取：文件路径、变量名、决策关键词
  const content = turnMessages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => typeof m.content === 'string' ? m.content : '')
    .join('\n');

  // 文件路径提取
  const filePaths = content.match(/(?:文件|路径|在|修改了?|创建了?|删除了?)\s*[：:]*\s*([^\s,，。]+\.(?:ts|tsx|js|py|rs|md|yaml|yml|json|toml))/gi);
  if (filePaths) {
    for (const match of filePaths) {
      items.push({ category: 'file_change', content: match, timestamp: Date.now() });
    }
  }

  // 决策提取
  const decisions = content.match(/(?:决定|决策|结论|方案)[：:]*\s*(.+?)(?:[。\n]|$)/gi);
  if (decisions) {
    for (const match of decisions.slice(0, 2)) {
      items.push({ category: 'decision', content: match, timestamp: Date.now() });
    }
  }

  // 2. 持久化追加到 memory.md（立即落盘，不等待 LLM 提炼）
  if (items.length > 0) {
    this._appendToMemoryFile(items);
  }

  return items;
}
```

**修改 C — 集成到 ChatManager 调用链**：

在 `ChatManager.ts` 的 `_accumulateSessionMemory()` 之前（或内部开头），调用 `extractPerTurn()`：

```typescript
// ChatManager.ts _accumulateSessionMemory() 开头新增
const memoryManager = this.getSessionMemoryManager();

// 逐轮轻量提取（每轮都执行，不依赖阈值）
const perTurnItems = await memoryManager.extractPerTurn(recentMessages);
if (perTurnItems.length > 0) {
  this.logger.debug('逐轮提取关键信息', { count: perTurnItems.length });
}

// 原有的批次 LLM 提炼逻辑保持不变（作为深度提炼的补充）
const result = memoryManager.accumulateTurn(turnTokens, turnToolCalls);
// ...
```

**影响评估**：
- 逐轮提取用规则匹配（O(1) 时间复杂度），不增加 LLM 调用成本
- memory.md 立即落盘，崩溃最多丢当前轮
- 作为批次 LLM 提炼的补充而非替代——让 LLM 提炼做深度概括，规则提取做即时落盘

**验证**：
- [ ] 每轮结束后 memory.md 有新增内容（如果有文件修改或决策）
- [ ] 第 5 轮时 memory.md 已有 5+ 条逐轮记录
- [ ] 500 轮对话后 memory.md 大小在可控范围（通过批次 LLM 提炼做深度概括压缩）
- [ ] 系统崩溃后恢复，检查点之前的记忆项完整保留

---

#### 4.5.4 手术方案 3：启用 TAORLoop 自动检查点

**对标**：openclaw 的 `EmbeddedRunReplayState`（压缩前快照 + 恢复后合并）

**问题**：ChatManager 在第 414 行将 `enableCheckpoint` 设为 `false`，导致 TAORLoop 的检查点功能从未生效。

**文件**：`app/src/chat/ChatManager.ts` 第 414 行

**修改**：

```typescript
// ChatManager.ts 第 414 行 — 修改前
this._taorLoop = createTAORLoop(this.getQueryEngine(), {
  sessionId,
  maxTurns: 50,
  enableCheckpoint: false,
});

// ChatManager.ts 第 414 行 — 修改后
this._taorLoop = createTAORLoop(this.getQueryEngine(), {
  sessionId,
  maxTurns: 50,
  /** 启用检查点，使用文件存储，每 3 轮自动保存（原值：关闭 + 内存存储 + 5 轮） */
  enableCheckpoint: true,
  checkpointInterval: 3, // 从 5→3，减少崩溃丢失窗口
  checkpointStorage: new FileCheckpointStorage(resolveDataSubDir('checkpoints')),
});
```

同时将 FileCheckpointStorage 接口对齐到 `CheckpointStorage`（消除双轨制）：

```typescript
// FileCheckpointStorage.ts — 确保实现 CheckpointStorage 接口
import type { TAORCheckpoint, CheckpointStorage } from './types.js';

export class FileCheckpointStorage implements CheckpointStorage {
  // ... 现有保存/加载逻辑对齐到 TAORCheckpoint 类型
}
```

**影响评估**：
- 每 3 轮一次文件写入，对性能影响可忽略（JSON 序列化 < 1ms）
- 崩溃后重启可自动恢复到最后一次检查点，最多丢失 2 轮
- 检查点文件存储到 `~/.pyapp/data/checkpoints/`，满足写前持久化规范

**验证**：
- [ ] 第 3、6、9 轮后检查点文件存在于磁盘
- [ ] 手动 kill 进程后重启，TAORLoop 自动从检查点恢复
- [ ] `TAORLoopResult.resumed = true` 且 `turnCount` 从检查点继续

---

#### 4.5.5 手术方案 4：分层记忆注入系统提示词

**对标**：cc_code 的 `needsFollowUp` + loop-engineering 的 "外部状态作为一等公民"

**问题**：`SessionMemoryManager.getMemoryContext()` 存在于代码中但从未被调用。模型唯一可用的持久化上下文是消息历史本身和 `recall_memory` 工具（该工具使用另一套 MemoryManagerImpl 系统）。

**修改**：在系统提示词组装时将 `memory.md` 内容注入。

**文件**：`app/src/chat/services/MessageContextPipeline.ts`

在 `assembleContextualSystemPrompt()` 中（第 342 行），在 `assembleSystemPrompt()` 之后、`MEMORY_CONTEXT_RULES` 之前插入分层记忆块：

```typescript
// MessageContextPipeline.ts assembleContextualSystemPrompt() — 新增

// 分层记忆注入
const memoryContext = sessionMemoryManager.getMemoryContext();
if (memoryContext && memoryContext.length > 0) {
  const memorySection = [
    '',
    '## 会话记忆（自动维护）',
    '以下是从本会话中自动提取的关键信息，用于保持长对话上下文连续性：',
    '',
    memoryContext,
    '',
    '**使用规则**：',
    '- 优先信任此记忆中的"决策记录"和"文件变更"，它们是已确认的事实',
    '- "关键讨论"部分是摘要，如需精确引用请使用 recall_memory 工具搜索原文',
    '- 不要重复记忆中已有的信息，除非用户明确要求',
  ].join('\n');

  result += memorySection;
}
```

同时精简 `MEMORY_CONTEXT_RULES`（精简为只包含工具调用指引，移除冗余的背景说明），因为真实的记忆内容已经在 memory.md 中。

**影响评估**：
- 模型在每轮开始时自动获得记忆上下文，无需主动调用 recall_memory 工具
- 分层设计："决策记录"和"文件变更"是已确认事实，嵌入提示词；"关键讨论"为摘要，精确查询仍走 recall_memory
- Token 消耗：经验上 100 轮对话的 memory.md 约 2K-5K token，在 200K 窗口中占比可忽略

**验证**：
- [ ] 第 20 轮对话时，系统提示词中包含前 19 轮的"决策记录"和"文件变更"
- [ ] 模型能准确引用第 5 轮修改的文件路径
- [ ] 模型不会重复记忆中的已确认信息

---

#### 4.5.6 内存记忆系统统一（远期）

**问题**：当前存在两套独立的记忆系统：
- `SessionMemoryManager`（用 `memory.md` 文件，会话级别）
- `MemoryManagerImpl`（用本地 SQLite，全局级别）

它们有独立的存储、检索 API，无跨通道桥接。recall_memory 工具查询的是 SQLite 全局记忆，而非 memory.md 会话记忆。

**远期方案**（Phase 4 同期规划）：
- `recall_memory` 工具同时查询两套记忆系统，合并结果
- 会话结束后，将 `memory.md` 中的关键决策和代码引用导入全局 SQLite

---

#### 4.5.7 记忆保持验证清单

- [ ] CompactService 保留 12 轮后，第 15 轮对话中能引用第 5 轮的文件路径
- [ ] 每轮结束后 memory.md 有逐轮提取内容
- [ ] 第 100 轮对话时，模型准确记得第 10 轮的决策和第 50 轮的文件变更
- [ ] 手动 kill 进程后重启，检查点恢复后记忆不丢失
- [ ] 系统提示词中包含分层记忆块（"会话记忆" section）
- [ ] `bun run typecheck` 零错误

---

## 五、Phase 4：架构演进（远期，需详细设计评审）

### 5.1 制造者/检查者分离（子代理验证模式）

**对标**：loop-engineering patterns 中的 verifier 子代理

**概述**：当前 Loop 中同一模型既执行修改又判断完成。应引入独立的验证器子代理，用不同模型或更严格指令在修改后运行测试和审查。

**设计要点**：
- 在 `LoopMaturity` L2/L3 级别启用
- 验证器默认立场：REJECT（假设修改有问题，需证明正确性）
- 验证器与实现者使用不同模型（或同一模型但 temperature=0）
- 最多 3 次修复-验证循环，超过则升级

**预估改动**：新增 `app/src/query/VerifierAgent.ts`（~200 行），修改 TAORLoop.ts 约 50 行。

### 5.2 故障模式与反模式文档

**对标**：loop-engineering `failure-modes.md`（11 种故障）+ `anti-patterns.md`（10 种反模式）

**内容规划**：

| 文档 | 内容 |
|------|------|
| `dev_docs/loop/failure-modes.md` | 工具调用死循环、上下文溢出无限重试、Token 泄漏、检查点损坏恢复、工具幻觉、空响应循环、并发工具竞态、压缩数据丢失、预算逃逸、状态不一致、断路误触发 |
| `dev_docs/loop/anti-patterns.md` | while(true)无守卫、字符串状态判断、回退掩盖错误、硬编码阈值、单层循环做所有事、无超时保护、Mock 数据兜底、静默 catch、忽略收益递减、L3 跳级 |

### 5.3 流式工具执行

**对标**：cc_code `StreamingToolExecutor`（LLM 流式输出时并发启动工具）

**设计要点**：
- 在 `TAORLoopDeps.callModel` 返回的 AsyncGenerator 中，每当产出 `tool_use` chunk 时立即启动工具执行
- 需要处理流中断时的工具结果清理
- 需要保证工具结果顺序与 `tool_use` 出现顺序一致

---

## 六、实施优先级矩阵

```
影响大 │  Phase 2       │  Phase 1
       │  循环检测增强   │  安全加固
       │  (下周)        │  (本周)
       │                │
       │  Phase 4       │  Phase 3
       │  架构演进       │  预算优化
       │  (远期)        │  (两周内)
影响小 │                │
       └────────────────┴──────────────
         改动大            改动小
```

---

## 七、风险与注意事项

| 风险 | 缓解措施 |
|------|---------|
| 新增循环检测器可能误判正常调用 | 先用 warning 级别观察，确认无误报再升级到 critical |
| 路径拒绝列表可能过于严格 | 默认仅拒绝公认敏感路径，自定义通过环境变量追加 |
| 删除废弃代码可能影响未知引用 | 删除前全局搜索确认零引用 |
| 全局断路器 30 次阈值可能过高/过低 | 通过环境变量 `LOOP_GLOBAL_BREAKER_THRESHOLD` 可配置 |
| CompactService 保留 12 轮导致上下文增长 | 逐轮记忆提取确保摘要质量，配合 200K 窗口足够容纳 |
| memory.md 在 500+ 轮后过大 | 批次 LLM 提炼做深度概括压缩，逐轮提取仅追加增量 |
| 双记忆系统并存造成困惑 | 远期统一方案已规划，近期通过分层注入区分"已确认事实"和"待搜索原文" |

---

> 本方案基于 [loop-benchmark-analysis-20260714.md](file:///E:/PY/CODES/PY_APP/dev_docs/20260714/loop-benchmark-analysis-20260714.md) 的对标分析结果，遵循 CS01-CS05 编码铁律。
