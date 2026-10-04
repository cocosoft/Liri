/**
 * 架构规则检查器 (Architecture Compliance Linter)
 *
 * 在 CI 中运行：bun run scripts/lint-architecture.ts
 * AI 可在提交前手动调用检查架构合规性。
 *
 * 检查规则对应 .trae/rules/architecture-compliance.md 中的 R01-R06。
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';

/**
 * 测试文件排除集（2026-10-01 口径统一，用户裁定）。
 *
 * 沿革：原名 `knownSubdirExceptions`，此前**仅** R03-002（模块出口单一）使用 ⇒ 造成**同一门禁内口径不一致**：
 * R03-002 跳过测试文件，而 R00-001（分层）/ R00-003（动态跨层）**不跳**（实证：
 * `app/src/runtime/api/__tests__/CoreAPIImpl.chatStream.test.ts` 曾被计入 `runtime -> chat` 豁免）。
 * 现提升为模块级常量，并**统一**用于 R03-002 / R00-001 / R00-003。
 *
 * 口径依据（与仓内既有惯例一致）：测试文件**不属于出厂模块图**（不参与运行时装配 / 惰性加载），
 * 且 R05-012（env 门禁）· R06-009-1（碎片归集）· R07 系列**均已显式排除**测试文件。
 *
 * 注：`app/tests/**` **不在** `allFiles`（`loadFiles()` 仅收集 `app/src/**`）⇒ 天然不参与分层检查。
 */
const TEST_FILE_EXCLUSIONS = [
  '/__tests__/', // 测试文件可自由 import
  '.test.ts', // 测试文件
  '.spec.ts', // 测试文件
  '/node_modules/', // 跳过
];

// JS/TS 保留字，排除被误判为"方法名"的控制流语句
const RESERVED_WORDS = new Set([
  'if',
  'else',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'case',
  'default',
  'try',
  'finally',
  'do',
  'with',
  'class',
  'new',
  'typeof',
  'instanceof',
  'in',
  'of',
  'var',
  'let',
  'const',
  'import',
  'export',
  'throw',
  'yield',
  'await',
  'async',
  'delete',
  'void',
  'this',
  'super',
  'break',
  'continue',
  'extends',
  'function',
  'get',
  'set',
  'static',
  'private',
  'public',
  'protected',
  'interface',
  'type',
  'enum',
  'namespace',
  'declare',
  'implements',
  'abstract',
]);

/**
 * R04-001: 单文件行数上限
 * 默认 1000 行；可用环境变量 ARCH_MAX_LINES 覆盖（如大型基础设施文件无需改代码即可放宽）。
 * 超限文件仍可通过 layer-exceptions.json 的 fileSizeExceptions / bulkExceptions(R04-001) 登记豁免。
 */
const MAX_FILE_LINES = Number(process.env.ARCH_MAX_LINES) || 1000;

// ============ 类型定义 ============

interface RuleViolation {
  ruleId: string;
  severity: 'error' | 'warning';
  file: string;
  line?: number;
  message: string;
  suggestion: string;
}

// ============ 工具函数 ============

/** 递归收集目录下所有 .ts 文件（排除 node_modules） */
function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = readdirSyncFull(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        results.push(...collectTsFiles(fullPath));
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        results.push(fullPath);
      }
    }
  } catch {
    // 目录不存在时忽略
  }
  return results;
}

function readdirSyncFull(
  dir: string
): Array<{ name: string; isDirectory: () => boolean }> {
  const fs = require('node:fs');
  return fs.readdirSync(dir, { withFileTypes: true });
}

// ============ 规则检查器 ============

class ArchitectureLinter {
  private violations: RuleViolation[] = [];
  private srcPath: string;
  private allFiles: string[] = [];
  private moduleToLayer: Map<string, string> = new Map();
  private allowedDeps: Record<string, string[]> = {};
  private layerOrder: string[] = [];

  constructor(srcPath: string) {
    this.srcPath = srcPath;
  }

  /** 加载所有源文件 */
  async loadFiles(): Promise<void> {
    this.allFiles = collectTsFiles(this.srcPath);
    console.log(`已扫描 ${this.allFiles.length} 个 TypeScript 文件`);
  }

  // ============ R01 基础设施复用 ============

  /** R01-001: 检查自建事件总线（extends EventEmitter） */
  async checkSelfBuiltEventBus(): Promise<void> {
    const skipPatterns = [
      'node:http',
      'node:net',
      'node:events',
      'Socket',
      'Server',
      'Stream',
      'Readable',
      'Writable',
      'ChildProcess',
    ];

    // 已知事件总线例外的文件路径片段（均为 P2/P3 改造计划中的真正事件总线）
    const knownEventBusExceptions = [
      'core\\gateway\\events\\GatewayEventBus.ts',
      'core/gateway/events/GatewayEventBus.ts',
      'channels\\events\\ChannelEventBus.ts',
      'channels/events/ChannelEventBus.ts',
      'session\\events\\SessionLifecycleEventBus.ts',
      'session/events/SessionLifecycleEventBus.ts',
      'voice\\VoiceEventBus.ts',
      'agent\\events\\index.ts',
      'core\\auto-reply\\dispatch.ts',
      'core/auto-reply/dispatch.ts',
      'core\\extensibility\\EventBus.ts',
      'core/extensibility/EventBus.ts',
      'core\\node-host\\NodeInvoke.ts',
      'core/node-host/NodeInvoke.ts',
      'plugins\\core\\PluginEventSystem.ts',
      'plugins/core/PluginEventSystem.ts',
    ];

    for (const file of this.allFiles) {
      // 跳过标准事件总线本身
      if (
        file.includes('core\\events\\EventBus') ||
        file.includes('core/events\\EventBus') ||
        file.includes('core/events/EventBus')
      )
        continue;

      // 跳过已知事件总线例外
      if (knownEventBusExceptions.some((e) => file.includes(e))) continue;

      const content = readFileSync(file, 'utf-8');

      // 跳过合法场景
      if (skipPatterns.some((p) => content.includes(p))) continue;

      // 判断是否是真正的事件总线（有独立事件分发基础设施）
      const eventBusInfo = this.detectCompetingEventBus(content);

      if (!eventBusInfo) continue;

      // extends EventEmitter 作为事件总线
      if (eventBusInfo.hasEventEmitter) {
        this.violations.push({
          ruleId: 'R01-001',
          severity: 'error',
          file: relative(process.cwd(), file),
          message: `${eventBusInfo.className} 使用 extends EventEmitter 作为事件总线`,
          suggestion: '替换为 core/events/EventBus.ts 的 EventBusImpl',
        });
      }

      // 自建事件分发（无 extends EventEmitter）
      if (eventBusInfo.hasSelfBuiltDispatch) {
        this.violations.push({
          ruleId: 'R01-001',
          severity: 'warning',
          file: relative(process.cwd(), file),
          message: '可能存在自建事件分发（Map<string, Handler> 模式）',
          suggestion: '替换为 core/events/EventBus.ts 的 EventBusImpl',
        });
      }
    }
  }

  /**
   * 检测文件是否包含真正的事件总线模式
   * 特征：有独立的事件分发基础设施（Handler 注册表 + 事件分发方法）
   * 非事件总线的标准 EventEmitter 使用（如通道类、服务类）不会被误报
   */
  private detectCompetingEventBus(content: string): {
    isEventBus: boolean;
    hasEventEmitter: boolean;
    hasSelfBuiltDispatch: boolean;
    className: string;
  } | null {
    const result = {
      isEventBus: false,
      hasEventEmitter: false,
      hasSelfBuiltDispatch: false,
      className: '',
    };

    // 模式1：类名包含 EventBus（自建事件总线）
    const eventBusClassMatch = content.match(
      /\bclass\s+(\w*EventBus\w*)\s*[\{<]/
    );
    if (eventBusClassMatch) {
      // KB-LINT-EVENTBUS-WRAPPER（2026-08-29）：类名含 EventBus 但内部委托
      // globalEventBus（标准总线）的"类型安全包装"（如 UiEventBus）不是竞争
      // 事件总线——纯启发式按类名误报。检测到委托标准总线则跳过。
      if (/globalEventBus\.(publish|subscribe)/.test(content)) {
        return null;
      }
      result.isEventBus = true;
      result.className = eventBusClassMatch[1];
      result.hasSelfBuiltDispatch = true;
      return result;
    }

    // 检查是否 extends EventEmitter
    const emitterMatch = content.match(
      /class\s+(\w+)\s+extends\s+EventEmitter/
    );

    // 检查是否有 Map<string, *Handler*> 模式（事件注册表）
    const hasHandlerMap = /Map\s*<\s*string\s*,\s*[^>]*[Hh]andler/.test(
      content
    );

    // 检查是否有事件分发方法
    const hasEventMethods = /\b(emit|subscribe|publish|dispatch)\s*\(/.test(
      content
    );

    // 模式2：extends EventEmitter + Handler 注册表 + 事件分发方法
    if (emitterMatch && hasHandlerMap && hasEventMethods) {
      result.isEventBus = true;
      result.hasEventEmitter = true;
      result.className = emitterMatch[1];
      return result;
    }

    // 模式3：自建 Map<string, Handler> 分发 + 事件方法（无 extends EventEmitter）
    if (hasHandlerMap && hasEventMethods) {
      result.isEventBus = true;
      result.hasSelfBuiltDispatch = true;
      // 尝试提取类名
      const genericClassMatch = content.match(/\bclass\s+(\w+)\s*[\{<]/);
      if (genericClassMatch) {
        result.className = genericClassMatch[1];
      }
      return result;
    }

    return null;
  }

  /** R01-002: 检查错误类是否继承 AppError */
  async checkErrorHierarchy(): Promise<void> {
    const stdErrors = [
      'AppError',
      'NetworkError',
      'FileSystemError',
      'PermissionError',
      'ValidationError',
      'ExecutionError',
      'ConfigParseError',
      'ShellError',
      'PluginError',
      'ToolError',
      'CacheError',
      'SecurityError',
      'APIError',
      'DatabaseError',
      'AbortError',
      'ModuleError',
      'FallbackTriggeredError',
      'SafeTelemetryError',
      'MalformedCommandError',
      'LightweightNetworkError',
      'LightweightFileError',
      'LightweightAPIError',
      'LightweightConfigError',
    ];

    for (const file of this.allFiles) {
      // 跳过标准错误定义文件
      if (file.includes('error\\types.ts') || file.includes('error/types.ts'))
        continue;

      const content = readFileSync(file, 'utf-8');

      // 检查1: 与标准错误类同名
      for (const errName of stdErrors) {
        if (errName === 'AppError') continue; // AppError 是基类
        const regex = new RegExp(
          `export\\s+(class|interface|type)\\s+${errName}\\b`
        );
        if (regex.test(content)) {
          this.violations.push({
            ruleId: 'R01-002',
            severity: 'error',
            file: relative(process.cwd(), file),
            message: `错误类 ${errName} 已在 error/types.ts 中定义，禁止重复定义`,
            suggestion: `删除此定义，改为从 @modules/error/types 导入 ${errName}`,
          });
        }
      }

      // 检查2: 直接 extends Error（非 AppError）
      const errorMatches = content.matchAll(
        /export\s+class\s+(\w+)\s+extends\s+Error\b/g
      );
      for (const match of errorMatches) {
        const className = match[1];

        // 跳过**规范错误基座文件**（⚠️ 用"显式文件清单"，**禁止**用 `error/` 之类的路径子串做判据 ——
        // 子串判断会随"定义被下沉/搬家"而失效：AppError 下沉到 core/errors.ts 后即被误报，
        // 见台账 D-63/D-64 与 CS02「状态检测禁止字符串匹配」）
        const normalizedFile = file.replace(/\\/g, '/');
        const CANONICAL_ERROR_BASE_FILES = ['core/errors.ts', 'error/types.ts'];
        if (CANONICAL_ERROR_BASE_FILES.some((p) => normalizedFile.endsWith(p)))
          continue;
        // 跳过压缩/打包后的文件
        if (file.includes('.min.') || file.includes('.bundle.')) continue;
        // 跳过已知的标准 Error 继承
        if (['PYAppError'].includes(className)) {
          // PYAppError 是已知的违规，已标记
          this.violations.push({
            ruleId: 'R01-002',
            severity: 'error',
            file: relative(process.cwd(), file),
            message: `${className} 直接 extends Error（应继承 AppError）`,
            suggestion: `改为 extends AppError（从 @modules/error/types 导入），或删除此文件合并到 error/types.ts`,
          });
          continue;
        }

        this.violations.push({
          ruleId: 'R01-002',
          severity: 'warning',
          file: relative(process.cwd(), file),
          message: `${className} 直接 extends Error，应继承 AppError`,
          suggestion: `改为 extends AppError（从 @modules/error/types 导入）`,
        });
      }
    }
  }

  /** R01-003: 检查自建重试逻辑 */
  async checkSelfBuiltRetry(): Promise<void> {
    for (const file of this.allFiles) {
      // 跳过标准重试实现
      if (
        file.includes('query\\withRetry.ts') ||
        file.includes('query/withRetry.ts')
      )
        continue;
      if (
        file.includes('utils\\withRetry.ts') ||
        file.includes('utils/withRetry.ts')
      )
        continue;

      // 跳过测试文件
      if (file.endsWith('.test.ts') || file.endsWith('.spec.ts')) continue;

      // 跳过已知的已废弃兼容层
      if (
        file.includes('streaming\\retry.ts') ||
        file.includes('streaming/retry.ts')
      )
        continue;

      // R01-003 已知例外：领域内建重试（记录在 architecture-compliance.md 已知例外表中）
      const skipExceptions = [
        'services\\api\\client.ts',
        'services/api/client.ts',
        'bridge\\api\\BridgeApi.ts',
        'bridge/api/BridgeApi.ts',
        'mcp\\reconnect.ts',
        'mcp/reconnect.ts',
        'chat\\tool\\SmartToolIntegrator.ts',
        'chat/tool/SmartToolIntegrator.ts',
        'session\\platform\\WebhookPlatform.ts',
        'session/platform/WebhookPlatform.ts',
        'streaming\\IncrementalRetry.ts',
        'streaming/IncrementalRetry.ts',
        // R01-003 AC-1 治理落地：channel-handlers 出站消息重试（2026-08-21 复核登记）
        // → 属于"跨 N 条独立 onOutbound 失败消息的 15s 批处理延迟调度状态机"，
        //   不是 R01-003 要禁止的"单请求线性重试"语义；硬套 withRetry 反而引入更复杂的 timer/drain 管理
        //   （详见 architecture-compliance.md 已知例外 R01-003 channel-handlers 条目）
        'infrastructure\\http\\handlers\\channel-handlers.ts',
        'infrastructure/http/handlers/channel-handlers.ts',
        // 第二组：2026-Q3 前计划迁移
        'core\\utils\\ErrorHandler.ts',
        'core/utils/ErrorHandler.ts',
        'ai\\providers\\BaseAIProvider.ts',
        'ai/providers/BaseAIProvider.ts',
        'agent\\cli-runner\\index.ts',
        'agent/cli-runner/index.ts',
        'performance\\CodeOptimizer.ts',
        'performance/CodeOptimizer.ts',
        'mcp\\MCPCompatibilityTester.ts',
        'mcp/MCPCompatibilityTester.ts',
        'core\\node-host\\ExecPolicy.ts',
        'core/node-host/ExecPolicy.ts',
        'remote\\RemoteTaskScheduler.ts',
        'remote/RemoteTaskScheduler.ts',
        // 第三组：误报或领域重试，2026-Q3 前清理
        'chronos\\CronSubprocessExecutor.ts',
        'chronos/CronSubprocessExecutor.ts',
        'agent\\remote\\RemoteAgentProtocol.ts',
        'agent/remote/RemoteAgentProtocol.ts',
        'bridge\\utils\\jwtUtils.ts',
        'bridge/utils/jwtUtils.ts',
        'chronos\\engine\\ExecutionEngine.ts',
        'chronos/engine/ExecutionEngine.ts',
        'ai\\router\\SmartRouter.ts',
        'ai/router/SmartRouter.ts',
        'oauth\\services\\TokenManager.ts',
        'oauth/services/TokenManager.ts',
        'chronos\\EnhancedCronTask.ts',
        'chronos/EnhancedCronTask.ts',
        'chronos\\CronScheduler.ts',
        'chronos/CronScheduler.ts',
        'error\\context\\QuerySource.ts',
        'error/context/QuerySource.ts',
        'main.ts',
        'main.ts',
        'ai\\router\\RetryPolicy.ts',
        'ai/router/RetryPolicy.ts',
        'tasks\\LongRunningTaskOrchestrator.ts',
        'tasks/LongRunningTaskOrchestrator.ts',
        // 2026-08-29 R01-003 治理：领域语义重试/变量名误报
        //   - MaxOutputRetryHandler：max_output 截断扩容重试（finishReason=length 加倍 maxTokens，上限 64000），
        //     领域特定状态机，withRetry 线性重试无法表达"加倍扩容"语义（与 channel-handlers 同类）
        //   - aiService：retryResolved/retryProviderId 是"重新解析 provider 结果"变量，非重试循环（误报）
        'ai\\MaxOutputRetryHandler.ts',
        'ai/MaxOutputRetryHandler.ts',
        'ai\\services\\aiService.ts',
        'ai/services/aiService.ts',
      ];
      if (skipExceptions.some((e) => file.includes(e))) continue;

      const content = readFileSync(file, 'utf-8');

      // 检测手写重试模式
      const hasRetryFunction =
        /(function|const|async)\s+\w*[Rr]etry\w*\s*[=(<]/.test(content);
      const hasRetryLoop =
        /for\s*\(\s*(let|const|var)\s+\w+\s*=\s*0\s*;\s*\w+\s*<\s*\w*[Rr]etry/.test(
          content
        );
      const hasRetryLoopBroad =
        /for\s*\([^)]*maxRetries|while\s*\([^)]*maxRetries/.test(content);
      const hasRetryCount =
        /\bretryCount\b|\bmaxRetries\b|\bMAX_RETRIES\b/.test(content);

      // 只有同时存在重试变量名 且 有实际循环/函数时才标记（避免配置字段误报）
      const hasActualRetryConstruct =
        hasRetryFunction || hasRetryLoop || hasRetryLoopBroad;
      if (hasActualRetryConstruct && hasRetryCount) {
        // 检查是否已经有 import withRetry
        if (content.includes("from '") && content.includes('withRetry'))
          continue;

        // 跳过已知的仅类型定义/配置文件的误报
        if (this.isR01_003FalsePositive(file, content)) continue;

        this.violations.push({
          ruleId: 'R01-003',
          severity: 'warning',
          file: relative(process.cwd(), file),
          message: '可能包含自建重试逻辑',
          suggestion:
            '请使用 utils/withRetry.ts 的 withRetry()（标准重试实现）',
        });
      }
    }
  }

  /** R01-003 误报排除：仅包含 maxRetries 字段声明的类型定义/配置文件 */
  private isR01_003FalsePositive(file: string, content: string): boolean {
    // 跳过仅定义 retry 配置的 types 文件（interface/type 中的 maxRetries 字段不是自建重试逻辑）
    const retryTermPattern = /\bretryCount\b|\bmaxRetries\b|\bMAX_RETRIES\b/;
    if (!retryTermPattern.test(content)) return false;

    // 如果还定义了 retry 函数，不是误报
    if (/(function|const|async)\s+\w*[Rr]etry\w*\s*[=(<]/.test(content))
      return false;

    // 如果存在 for/while 循环中用到 retryCount/maxRetries，是真违规
    if (/for\s*\([^)]*retryCount|while\s*\([^)]*maxRetries/.test(content))
      return false;

    // 检查是否所有 retry 术语都仅出现在类型/接口/配置声明中
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (retryTermPattern.test(lines[i])) {
        const line = lines[i].trim();
        // 类型定义字段: "maxRetries?: number"
        if (
          /^(readonly\s+|private\s+|protected\s+|public\s+)?(static\s+)?maxRetries(\?)?\s*:\s*/.test(
            line
          )
        )
          continue;
        if (
          /^(readonly\s+|private\s+|protected\s+|public\s+)?(static\s+)?retryCount(\?)?\s*:\s*/.test(
            line
          )
        )
          continue;
        if (/^MAX_RETRIES\s*[=:]/.test(line)) continue;
        // 配置字面量: "maxRetries: 3," (在对象字面量或构造函数赋值中)
        if (/^\s*maxRetries\s*[:=]/.test(line) && /[:=]\s*\d/.test(line))
          continue;
        // this.maxRetries = config.maxRetries (字段赋值)
        if (/^\s*(this\.)?maxRetries\s*=/.test(line)) continue;
        // 不是类型/配置声明，是真违规
        return false;
      }
    }
    return true;
  }

  /** R01-004: 检查自建缓存 */
  async checkSelfBuiltCache(): Promise<void> {
    for (const file of this.allFiles) {
      // 跳过已知的缓存实现
      if (file.includes('cache\\') || file.includes('cache/')) continue;

      // R01-004 治理（2026-08-29）：领域映射缓存/基础设施 SPI，非通用缓存语义
      //   - ai/credentials/CredentialStore：凭证文件的内存映射（read-through + 落盘 persist），无 TTL 语义
      //   - core/spi/CacheService：core 层 TTL 缓存 SPI（基础设施，不可依赖 infra 层 cache/CacheSystem）
      //   - tools/TTSTool：人设配置映射缓存（配置变更主动失效，无需 TTL）
      if (
        file.includes('ai\\credentials\\CredentialStore.ts') ||
        file.includes('ai/credentials/CredentialStore.ts')
      )
        continue;
      if (
        file.includes('core\\spi\\CacheService.ts') ||
        file.includes('core/spi/CacheService.ts')
      )
        continue;
      if (
        file.includes('tools\\TTSTool\\TTSTool.ts') ||
        file.includes('tools/TTSTool/TTSTool.ts')
      )
        continue;

      const content = readFileSync(file, 'utf-8');

      // 检测 private cache = new Map 模式
      const cachePattern =
        /(private|protected|public)\s+(\w*[Cc]ache\w*)\s*[=:]\s*new\s+Map\b/g;
      const matches = content.matchAll(cachePattern);
      for (const match of matches) {
        const varName = match[2];
        // 跳过非业务缓存的合理场景
        if (content.includes('CacheSystem') || content.includes('ICache'))
          continue;

        // 跳过已知合法的渲染 memoization 和状态追踪
        if (
          file.includes('ink\\ink\\screen.ts') ||
          file.includes('ink/ink/screen.ts')
        )
          continue;
        if (file.includes('MCPConnectionManager.ts')) continue;

        this.violations.push({
          ruleId: 'R01-004',
          severity: 'warning',
          file: relative(process.cwd(), file),
          message: `检测到自建缓存 \`${varName}\`（new Map 模式）`,
          suggestion: '请改用 cache/CacheSystem.ts',
        });
      }
    }
  }

  // ============ R02 数据模型统一 ============

  /** R02-002: 检查同名导出冲突（interface / type / class / function / const） */
  async checkDuplicateTypeNames(): Promise<void> {
    const typeMap = new Map<
      string,
      Array<{ file: string; name: string; kind: string }>
    >();

    // 已知合法的同名类型（通道模板文件、模块入口、子模块 index 等）
    const knownSafePatterns = [
      /channels[/\\][^/\\]+[/\\](config-schema|accounts|doctor|monitor|probe|runtime|channel\.runtime)\.ts$/,
      /[/\\]index\.ts$/,
      // 2026-08-29 治理：.d.ts 的 declare module 块是模块类型声明，非真实导出
      /\.d\.ts$/,
    ];

    // 常见非冲突名称（各模块自身的局部配置类型）
    const commonNames = new Set([
      'Props',
      'State',
      'Config',
      'Options',
      'Params',
      'Result',
      'Context',
      'Handler',
      'Listener',
      'Callback',
      'Input',
      'Output',
      'Args',
      'Entry',
      'Data',
      'Info',
      'Stats',
      'Summary',
      'Payload',
      'Response',
      'Request',
      'Status',
      'Mode',
      'Role',
      'Event',
      'Meta',
      'Metadata',
      'Header',
      'Item',
      'Row',
      'Record',
      // Tool UI 渲染函数 — 各 Tool 模块约定的同名导出，非冲突
      'renderToolUseMessage',
      'renderToolResultMessage',
      'getToolUseSummary',
      'renderToolUseErrorMessage',
      'renderToolUseProgressMessage',
      // 领域特定类型 — 同名但不同结构，各模块独立定义，无法统一
      'Message',
      'ToolResult',
      'ToolCall',
      'RetryConfig',
      'PerformanceMetrics',
      'TokenUsage',
      'Task',
      'CompletionItem',
      'PluginManifest',
      'SearchResult',
      'CleanupResult',
      'PluginLoader',
      'AgentDefinition',
      'PermissionContext',
      'Tool',
      'SessionMetadata',
      'SessionInfo',
      'SecurityConfig',
      'HistoryEntry',
      'AuditEvent',
      'SessionContext',
      'ToolPermissionContext',
      'AgentProgress',
      'PermissionRule',
      'TeamMember',
      'ProviderConfig',
      'ToolContext',
      'ToolDefinition',
      'CacheEntry',
      'CacheStats',
      'ChatResponse',
      'RetryResult',
      'TrendAnalysis',
      'SDKMessage',
      'DeliveryResult',
      'WebhookConfig',
      'EventListener',
      'PermissionMode',
      'ToolInfo',
      'TaskStatus',
      'HealthStatus',
      'ShellType',
      'PluginMetadata',
      'Plugin',
      'PluginValidationResult',
      'SessionState',
      'Theme',
      'MemoryManager',
      'SandboxConfig',
      'MigrationResult',
      'SandboxManager',
      'AppState',
      'CompressionResult',
      'EventHandler',
      'AgentConfig',
      'ConversationMessage',
      'HealthCheckConfig',
      'StreamEvent',
      'SkillContext',
      'ChatMessage',
      'StorageConfig',
      'PerformanceEvent',
      'CostSummary',
      'PluginSource',
      'StartupReport',
      'RetryState',
      'HeartbeatManager',
      'SessionStats',
      'SessionManager',
      'SessionConfig',
      'NotificationType',
      'CacheItem',
      'ChannelConfig',
      'ChannelCapabilities',
      'ChannelStatus',
      'IChannelPlugin',
      'SessionCheckpointService',
      'StreamChunk',
      'ToolExecutionResult',
      'ContentBlock',
      'SessionStorage',
      'ScheduledTask',
      'UpdateInfo',
      'ValidationRule',
      'HealthCheck',
      // 通用工具函数 — 各模块独立实现，非冲突
      'recursivelySanitizeUnicode',
      'jsonStringify',
      'normalizeMessage',
      'createToolUseSummaryMessage',
      'throttle',
      'debounce',
      'memoize',
      'DEFAULT_RETRY_CONFIG',
      // G1 分析确认无法统一的类型 — 同名但不同结构，各模块独立定义
      'AuthConfig',
      'SessionMessage',
      // ValidationResult — 已统一到 common/types.ts，其余模块结构各异无法统一
      'ValidationResult',
      // G1 session 模块双轨制 — TranscriptEntry/TranscriptConfig 定义在活跃和孤儿文件中
      'TranscriptEntry',
      'TranscriptConfig',
      // G1 TaskState — 三种不同概念：状态枚举(types/task.ts)、任务对象(tasks/types.ts)、系统状态(system/state/types.ts)
      'TaskState',
      // G1 SessionId — branded type 模式，acp/types.ts 是规范定义，另外两个是纯 string 别名
      // R02-003 独立规则仍会追踪此违规
      'SessionId',
      // G2 通用工具函数 — 各模块独立实现，非冲突
      'sleep',
      // G2 config 模块 — 不同层级的 ConfigSource 结构各异
      'ConfigSource',
      // G2 领域特定类型 — 同名但不同模块中结构各异，无法实质统一
      'ConfigValidationRule',
      'SettingSource',
      'ContextEngine',
      'CompactResult',
      'ArchiveResult',
      'DiskInfo',
      'ResourceUsage',
      'ChannelPlugin',
      'PluginConfig',
      'RenderOptions',
      'SessionStore',
      'ThemeManager',
      'AlertRule',
      'PerformanceAnalysis',
      'ToolExecutionContext',
      'LSPClient',
      'ImageFormat',
      'PerformanceReport',
      'PerformanceAnalyzer',
      'MemorySnapshot',
      'PermissionDecision',
      'createAllowDecision',
      'PermissionUpdate',
      'PluginContext',
      'OAuthTokens',
      // G2 遗漏 + G3 领域特定类型 — 同名但不同模块中结构各异
      'CompactConfig',
      'TokenBudgetConfig',
      'SecurityCheckResult',
      'AgentMemoryScope',
      'AgentColorName',
      'AuditQuery',
      'SkillDefinition',
      'PluginSkillManifest',
      'PluginSkillParameter',
      'PluginHookManifest',
      'PlanStep',
      'ConfigValidationError',
      'RiskLevel',
      'SimpleCommand',
      'PermissionBehavior',
      'ToolSchema',
      // R02-002 阈值治理（2026-08-29）：UI 组件名——多套 UI 库并存
      //（components/ui、ink/ink/components、ui/design-system、ui/types、ui/UIComponents），
      // 组件名/Props 同名是既定架构事实（各套独立实现），非可统一类型
      'ProgressBar',
      'TreeNode',
      'DialogProps',
      'Dialog',
      'Divider',
      'Select',
      'SelectOption',
      'SelectProps',
      'InputProps',
      'Progress',
      'TextProps',
      'Notification',
      // R02-002 阈值治理（2026-08-29）：纯领域变体——同名但各模块结构/语义独立，
      // 无统一收益（子代理 18 组核查确认）
      'MemoryItem',
      'BatchResult',
      'PipelineContext',
      'RestoreResult',
      'SyncResult',
      // 'WRITE_TOOLS'（2026-09-26 移除本豁免）：原为**三处同名不同值**（`promptSuggestion` /
      // `tools/orchestration` / `query/tool-constants`）而豁免；裁定①改为「共享取值 + 各自命名」
      // 后仅剩 `query/tool-constants` 一处导出，同名冲突已不存在 ⇒ 豁免项删除。
      'VoiceState',
      'TaskQueue',
      'LanguagePack',
      // R02-002 阈值治理（2026-08-29）：PdcaPhase 纯领域变体——ai(modelRouter) 4 值
      // 模型路由阶段、tasks(LongRunningTaskOrchestrator) 7 值任务编排阶段、
      // workspace(ProjectItemStore) 数据字段阶段，值域/语义各自独立，无统一收益
      'PdcaPhase',
      // R02-002 治理（2026-08-30）：同名不同结构的领域变体（逐一核验，无法实质统一）
      //   - CompactionResult：压缩统计（tier/afterTokens/savingPercent）vs 压缩产物
      //     （boundaryMarker/summaryMessages/attachments）结构各异
      //   - MemoryType：记忆来源 4 值（user/feedback/project/reference）vs 抽取记忆
      //     5 值（user_fact/user_preference/code_pattern/decision）值域独立
      //   - TokenBudgetState：核心 TokenBudgetController 声明统一（Phase 2.9），
      //     query 旧版结构一致待迁移、services 层 @deprecated 简化版，收敛中
      //   - PathCheckResult：query {allowed,reason} / sandbox {allowed,pathType,matchedPattern}
      //     / media {valid,path,error} 结构各异
      //   - ToolCategory：toolCategories 字符串联合类型 vs ToolCatalog const 常量表
      //     + typeof 派生类型，用途不同
      'CompactionResult',
      'MemoryType',
      'TokenBudgetState',
      'PathCheckResult',
      'ToolCategory',
    ]);

    for (const file of this.allFiles) {
      // 跳过通道模板（同名类型是合法的接口实现）
      if (knownSafePatterns.some((p) => p.test(file))) continue;

      const content = readFileSync(file, 'utf-8');

      // 提取 export interface / type / class / function / const
      const patterns = [
        { regex: /export\s+interface\s+(\w+)/g, kind: 'interface' },
        { regex: /export\s+type\s+(\w+)\s*=/g, kind: 'type' },
        {
          regex: /export\s+(abstract\s+)?class\s+(\w+)/g,
          kind: 'class',
          nameGroup: 2,
        },
        { regex: /export\s+function\s+(\w+)/g, kind: 'function' },
        { regex: /export\s+const\s+(\w+)\s*[=:]/g, kind: 'const' },
      ];

      for (const { regex, kind, nameGroup } of patterns) {
        const matches = [...content.matchAll(regex)];
        for (const match of matches) {
          const name = match[nameGroup ?? 1];
          if (commonNames.has(name)) continue;

          if (!typeMap.has(name)) typeMap.set(name, []);
          typeMap.get(name)!.push({ file, name, kind });
        }
      }
    }

    // 报告同名导出
    for (const [name, locations] of typeMap) {
      // 2026-08-29 治理：阈值 ≥3 个模块子树——583 条中 553 条（95%）仅在 2 个模块定义，
      // 属领域局部变体/巧合（各模块自身领域类型），仅 ≥3 个模块重复才值得关注统一
      if (locations.length < 3) continue;

      // 排除所有都在同一目录下或同一模块子树中的情况
      const dirs = new Set(
        locations.map((l) => {
          const rel = relative(this.srcPath, l.file);
          // 取前两级目录作为模块标识（如 "config/" vs "core/extensibility"）
          const parts = rel.split(/[/\\]/);
          return parts.slice(0, 2).join('/');
        })
      );
      if (dirs.size < 2) continue;

      const kinds = [...new Set(locations.map((l) => l.kind))].join('/');
      const fileList = locations
        .map((l) => `${relative(this.srcPath, l.file)} (${l.kind})`)
        .join(', ');

      this.violations.push({
        ruleId: 'R02-002',
        severity: 'warning',
        file: fileList,
        message: `导出 "${name}" (${kinds}) 在 ${locations.length} 个不同模块中定义`,
        suggestion:
          '请检查这些定义是否应统一为核心数据契约（如 core/data-models.ts）或归并到单一模块',
      });
    }
  }

  /** R03-001: 检查自建基础设施 */
  async checkSelfBuiltInfrastructure(): Promise<void> {
    const infraKeywords = [
      { pattern: /class\s+(\w*EventBus\w*)/, desc: '自建 EventBus' },
      { pattern: /class\s+(\w*Cache\w*)\s*\{/, desc: '自建 Cache' },
      { pattern: /class\s+(\w*Retry\w*)/, desc: '自建 Retry' },
      {
        pattern: /class\s+(\w*Config\w*Manager\w*)/,
        desc: '自建 ConfigManager',
      },
      {
        pattern: /class\s+(\w*Health\w*Checker\w*)/,
        desc: '自建 HealthChecker',
      },
    ];

    // 已知例外的文件路径片段（已通过架构 review 或已在其他治理规则中标记）
    const knownExceptions = [
      // R01-001 EventBus 治理例外
      'agent\\events\\index.ts',
      'core\\extensibility\\EventBus.ts',
      'voice\\VoiceEventBus.ts',
      'session\\lifecycle\\SessionLifecycleEventBus.ts',
      // R01-003 重试治理例外
      'streaming\\IncrementalRetry.ts',
      'bridge\\error\\BridgeErrorHandler.ts',
      'query\\withRetry.ts',
      // R01-004 缓存治理例外
      'tokenBudget\\ModelContextCache.ts',
      'core\\utils\\Performance.ts',
      'performance\\CacheAndLazyLoading.ts',
      'context\\ContextCacheService.ts',
      // 标准实现（utils/ 工具类）
      'utils\\cache.ts',
      'utils\\withRetry.ts',
      'utils\\fileStateCache.ts',
      // core/ 层标准基础设施
      'core\\health\\DependencyHealthChecker.ts',
      'core\\approval\\ApprovalCache.ts',
      // 标准健康检查基础设施
      'diagnostics\\SystemHealthChecker.ts',
      'monitoring\\health\\HealthChecker.ts',
      // 非基础设施的误报（私有内联类）
      'channels\\line\\LineChannel.ts',
      // 2026-08-29 R03-001 治理：领域特定配置/缓存/健康检查类（20 个 A 类）
      // 类名含 Cache/ConfigManager/HealthChecker 关键词，但语义是管理本领域配置/缓存
      // （schema 校验、版本回滚、音频指纹、prompt 归一化、breakpoint 决策等），非全局基础设施重复
      'acp\\control-plane\\runtime-cache.ts',
      'agent\\managers\\AgentConfigManager.ts',
      'ai\\health\\ModelHealthCheck.ts',
      'ai\\prompts\\PromptCacheManager.ts',
      'cost\\DailyCostCache.ts',
      'governance\\managers\\GovernanceConfigManager.ts',
      'hooks\\managers\\HookConfigManager.ts',
      'oauth\\services\\OAuthDiscovery.ts',
      'performance\\PerformanceConfig.ts',
      'plugins\\management\\PluginConfigManager.ts',
      'query\\config.ts',
      'security\\redact\\RedactConfig.ts',
      'services\\mcp\\config.ts',
      'services\\mcp\\EnhancedMCPConfigManager.ts',
      'services\\voice\\services\\sttRegistry.ts',
      'services\\voice\\services\\ttsProvider.ts',
      'tools\\ImageGenerateTool\\ImageGenerationCache.ts',
      'tools\\search\\ToolSearchConfig.ts',
      'tools\\utils\\OptimizedToolManagerUtils.ts',
      'workspace\\LiriConfigManager.ts',
      // 2026-08-29 R03-001 治理（B 类）：已 @deprecated 的 ConfigManager 变体，待移除
      //（lint 报告准确，但文件头已声明"请使用 @modules/config/ConfigManager 替代"，按计划清理）
      'cli\\config.ts',
      'core\\extensibility\\ConfigManager.ts',
      'core\\RemoteConfigManager.ts',
    ];

    for (const file of this.allFiles) {
      // 跳过标准实现目录
      if (file.includes('core\\events\\') || file.includes('core/events/'))
        continue;
      if (file.includes('cache\\') || file.includes('cache/')) continue;
      if (
        file.includes('ai\\clients\\retry') ||
        file.includes('ai/clients/retry')
      )
        continue;
      if (file.includes('config\\') || file.includes('config/')) continue;

      // 跳过已知例外文件
      if (knownExceptions.some((e) => file.includes(e))) continue;

      const content = readFileSync(file, 'utf-8');

      for (const kw of infraKeywords) {
        if (kw.pattern.test(content)) {
          this.violations.push({
            ruleId: 'R03-001',
            severity: 'warning',
            file: relative(process.cwd(), file),
            message: `可能包含${kw.desc}`,
            suggestion: '如确为基础设施，请确保已获架构 review 批准',
          });
          break; // 每个文件只报告一次
        }
      }
    }
  }

  // ============ R04 文件组织 ============

  /** R04-001: 检查文件行数 */
  async checkFileSize(): Promise<void> {
    for (const file of this.allFiles) {
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n').length;

      if (lines > MAX_FILE_LINES) {
        const relPath = relative(process.cwd(), file);
        // R04-001 豁免：已登记 fileSizeExceptions 的文件不阻断
        if (this.isFileSizeExempt(relPath)) continue;
        this.violations.push({
          ruleId: 'R04-001',
          severity: 'error',
          file: relPath,
          message: `文件 ${lines} 行，超过 ${MAX_FILE_LINES} 行限制`,
          suggestion: '必须拆分为子目录下的多个文件，或在例外表中登记',
        });
      }
    }
  }

  /** R05-004: 检查 src/ 目录下的 .js 文件 */
  async checkJsFilesInSrc(): Promise<void> {
    const jsFiles: string[] = [];
    try {
      const entries = readdirSyncFull(this.srcPath);
      const queue = [this.srcPath];
      while (queue.length > 0) {
        const dir = queue.pop()!;
        try {
          const items = readdirSyncFull(dir);
          for (const item of items) {
            const fullPath = join(dir, item.name);
            if (item.isDirectory()) {
              if (item.name === 'node_modules' || item.name === '.git')
                continue;
              queue.push(fullPath);
            } else if (
              item.name.endsWith('.js') &&
              !item.name.endsWith('.test.js')
            ) {
              jsFiles.push(fullPath);
            }
          }
        } catch {
          // 跳过无法读取的目录
        }
      }
    } catch {
      return;
    }

    if (jsFiles.length === 0) return;

    this.violations.push({
      ruleId: 'R05-004',
      severity: 'error',
      file: jsFiles[0],
      message: `src/ 目录下存在 ${jsFiles.length} 个 .js 文件，应改为 .ts`,
      suggestion: `将 .js 文件迁移为 .ts 文件\n  受影响文件:\n${jsFiles.map((f) => `    - ${relative(process.cwd(), f)}`).join('\n')}`,
    });
  }

  /** 例外过期检查（G2 门禁） */
  async checkExceptionExpiry(): Promise<void> {
    const now = new Date();
    const warningDays = 7;
    const allExceptions = [
      ...this.exceptionData.bulk,
      ...this.exceptionData.perModule,
    ];

    for (const ex of allExceptions) {
      if (!ex.expiresAt) continue;
      const expiresDate = new Date(ex.expiresAt);

      if (expiresDate < now) {
        this.violations.push({
          ruleId: 'EXC-EXPIRED',
          severity: 'error',
          file: 'scripts/layer-exceptions.json',
          message: `例外 ${ex.id} 已过期（${ex.expiresAt}），请及时修复或申请续期`,
          suggestion: `修复对应违规代码后从 layer-exceptions.json 移除，或联系 Arch Lead 续期`,
        });
      } else {
        const daysLeft = Math.ceil(
          (expiresDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        );
        if (daysLeft <= warningDays) {
          this.violations.push({
            ruleId: 'EXC-EXPIRING',
            severity: 'warning',
            file: 'scripts/layer-exceptions.json',
            message: `例外 ${ex.id} 将在 ${daysLeft} 天后过期（${ex.expiresAt}），请安排修复`,
            suggestion: `修复对应违规代码后从 layer-exceptions.json 移除，或联系 Arch Lead 续期`,
          });
        }
      }
    }
  }

  /** 例外数量上限检查（G2 门禁，上限 30 条） */
  async checkExceptionCount(): Promise<void> {
    const MAX_EXCEPTIONS = 30;
    const total =
      this.exceptionData.bulk.length + this.exceptionData.perModule.length;

    if (total > MAX_EXCEPTIONS) {
      this.violations.push({
        ruleId: 'EXC-COUNT-LIMIT',
        severity: 'error',
        file: 'scripts/layer-exceptions.json',
        message: `例外总数 ${total} 超过上限 ${MAX_EXCEPTIONS}`,
        suggestion: '减少例外数量，修复对应违规代码',
      });
    }
  }

  /** R05-003: Console 基线检查 — 统计 console.log/warn/error/debug 总数 */
  async checkConsoleBaseline(): Promise<void> {
    // 基线值：从 scripts/console-baseline.json 读取，若不存在则使用硬编码基线
    const baselinePath = resolve(
      process.cwd(),
      'scripts',
      'console-baseline.json'
    );
    let baseline = 2045; // 默认基线（2026-06-18 快照值）
    let threshold = 0.1; // 允许超出基线的比例

    if (existsSync(baselinePath)) {
      try {
        const baselineData = JSON.parse(readFileSync(baselinePath, 'utf-8'));
        if (baselineData.count) baseline = baselineData.count;
        if (baselineData.threshold) threshold = baselineData.threshold;
      } catch {
        // 使用默认值
      }
    }

    const consolePattern = /console\.(log|warn|error|debug)\s*\(/g;
    let totalCount = 0;
    const fileCounts: Array<{ file: string; count: number }> = [];

    for (const file of this.allFiles) {
      // 跳过测试文件
      if (
        file.includes('.test.') ||
        file.includes('__tests__') ||
        file.includes('spec.')
      )
        continue;
      // 跳过 .js 文件（因 JS 文件本应迁移）
      if (file.endsWith('.js')) continue;

      const content = readFileSync(file, 'utf-8');
      const matches = [...content.matchAll(consolePattern)];
      if (matches.length > 0) {
        totalCount += matches.length;
        fileCounts.push({
          file: relative(process.cwd(), file),
          count: matches.length,
        });
      }
    }

    const limit = Math.ceil(baseline * (1 + threshold));

    if (totalCount > limit) {
      this.violations.push({
        ruleId: 'R05-003',
        severity: 'warning',
        file: 'src/ (全局)',
        message: `console 调用总数 ${totalCount} 超过基线上限 ${limit}（基线: ${baseline}，允许超出: ${Math.round(threshold * 100)}%）`,
        suggestion: '请减少不必要的 console 调用，或更新 console-baseline.json',
      });
    }

    // 输出统计信息
    console.log(
      `\n[Console 基线] 当前 ${totalCount} 次调用（基线: ${baseline}，上限: ${limit}）`
    );
    if (fileCounts.length > 0) {
      // 按调用数降序，输出 top 5
      fileCounts.sort((a, b) => b.count - a.count);
      console.log(`  调用最多的文件:`);
      for (const fc of fileCounts.slice(0, 5)) {
        console.log(`    ${fc.file}: ${fc.count} 次`);
      }
    }
  }

  /** R05-005: Barrel 文件检查 — 检测仅做 re-export 的 index.ts */
  async checkBarrelFiles(): Promise<void> {
    let barrelCount = 0;
    const barrelFiles: string[] = [];

    // 公认的模块入口目录前缀（这些目录下的 barrel 文件属于模块公共 API 边界，允许保留）
    const allowedModuleDirs = [
      'src\\agent\\',
      'src\\ai\\',
      'src\\bridge\\',
      'src\\channels\\',
      'src\\cli\\',
      'src\\commands\\',
      'src\\common\\',
      'src\\components\\',
      'src\\config\\',
      'src\\constants\\',
      'src\\context\\',
      'src\\core\\',
      'src\\diagnostics\\',
      'src\\error\\',
      'src\\hooks\\',
      'src\\infrastructure\\',
      'src\\ink\\',
      'src\\knowledge\\',
      'src\\media\\',
      'src\\memory\\',
      'src\\monitoring\\',
      'src\\oauth\\',
      'src\\plugin-sdk\\',
      'src\\plugins\\',
      'src\\promptSuggestion\\',
      'src\\sandbox\\',
      'src\\services\\',
      'src\\session\\',
      'src\\skills\\',
      'src\\state\\',
      'src\\tasks\\',
      'src\\testing\\',
      'src\\tools\\',
      'src\\tokenBudget\\',
      'src\\trace-recording\\',
      'src\\ui\\',
      'src\\utils\\',
      // 2026-08-29 治理：modules/workspaces 是模块入口（calendar/workspace 模块公共 API 边界）
      'src\\modules\\',
      'src\\workspaces\\',
    ];

    for (const file of this.allFiles) {
      const basename = file.split(/[/\\]/).pop() || '';
      if (basename !== 'index.ts' && basename !== 'index.tsx') continue;

      const content = readFileSync(file, 'utf-8');
      const lines = content
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      // 检查是否仅有 re-export 语句（export ... from ...）+ 空行/注释
      const nonReExportLines = lines.filter((l) => {
        const trimmed = l.replace(/\/\/.*$/, '').trim(); // 去掉行内注释
        if (trimmed.length === 0) return false; // 空行
        if (
          trimmed.startsWith('//') ||
          trimmed.startsWith('/*') ||
          trimmed.startsWith('*')
        )
          return false; // 注释
        if (/^export\s+(type\s+)?\{\s*\}/.test(trimmed)) return false; // export {} 空导出
        // 判断是否为 re-export
        if (/^export\s+(type\s+)?\*?\s*\{.*\}\s*from\s/.test(trimmed))
          return false;
        if (/^export\s+\*\s+from\s/.test(trimmed)) return false;
        return true; // 非 re-export 行
      });

      if (nonReExportLines.length > 0) continue; // 不是 barrel 文件

      // 跳过公认的模块入口 barrel 文件
      // KB-LINT-RELPATH（2026-08-29）：relFile 归一化为 src 相对路径——
      // lint 在仓库根运行时 relative(cwd, file) 带 'app\\' 前缀，导致
      // allowedModuleDirs（'src\\...'）豁免失效，把合法的模块入口 barrel
      // 误报为薄桶/barrel（R07-003 的 18 个薄桶全是此类误报）。
      const rawRel = relative(process.cwd(), file);
      const srcIdx = rawRel.indexOf('src\\');
      const relFile = srcIdx >= 0 ? rawRel.slice(srcIdx) : rawRel;
      if (allowedModuleDirs.some((dir) => relFile.startsWith(dir))) {
        continue;
      }

      barrelCount++;
      barrelFiles.push(relFile);
    }

    if (barrelCount > 0) {
      this.violations.push({
        ruleId: 'R05-005',
        severity: 'warning',
        file: barrelFiles[0],
        message: `存在 ${barrelCount} 个仅做 re-export 的 barrel 文件（index.ts）`,
        suggestion: `Barrel 文件不利于 tree-shaking，请考虑是否必要\n  受影响文件:\n${barrelFiles
          .slice(0, 10)
          .map((f) => `    - ${f}`)
          .join(
            '\n'
          )}${barrelFiles.length > 10 ? `\n    ... 及其他 ${barrelFiles.length - 10} 个` : ''}`,
      });
    }

    console.log(
      `\n[Barrel 文件] 发现 ${barrelCount} 个 barrel 文件（仅 re-export）`
    );
  }

  /** R05-011: Message 模型引用检查 — 检查 Message 类型的混乱引用 */
  async checkMessageModelImports(): Promise<void> {
    // 定义规范的 Message 类型来源
    const canonicalPaths = [
      'session/types/message',
      'session/types/message.ts',
      '@modules/session/types/message',
    ];

    // 已知例外的文件（域级私有 Message 类型，非规范类型冲突）
    const knownExceptions = [
      'agent/TitleGenerator.ts',
      'session/types/ToolUseBlock.ts',
      'compaction/ContextEngine.ts',
      'subagent/SubAgentCommunicator.ts',
      'ui/components/Messages.tsx',
      // 2026-08-29 治理：core/types.ts 是 LLM 协议层 Message（snake_case 工具字段），领域变体
      'core/types.ts',
    ];

    // 收集所有导出 Message 类型的文件
    const messageDefs: Array<{ file: string; kind: string }> = [];

    for (const file of this.allFiles) {
      const relPath = relative(this.srcPath, file).replace(/\\/g, '/');

      // 跳过规范路径
      if (canonicalPaths.some((p) => relPath.includes(p))) continue;
      // 跳过类型中心目录自身（src/types/ 是类型定义来源，其 Message 非"自定"违规）
      if (relPath.startsWith('types/')) continue;

      // 跳过已知例外
      if (knownExceptions.some((e) => relPath.includes(e))) continue;

      const content = readFileSync(file, 'utf-8');

      // 仅检查精确名为 Message 的导出（排除 Message* 子类型如 AIMessage、ChatMessage 等）
      if (/export\s+(interface|type)\s+Message\b/.test(content)) {
        messageDefs.push({ file: relPath, kind: 'Message' });
      }
    }

    if (messageDefs.length > 0) {
      this.violations.push({
        ruleId: 'R05-011',
        severity: 'warning',
        file: messageDefs[0].file,
        message: `存在 ${messageDefs.length} 个文件自行定义了 Message 类型，未使用 session/types/message.ts 的规范定义`,
        suggestion: `请统一引用 session/types/message.ts 的 Message 类型\n  受影响文件:\n${messageDefs
          .slice(0, 10)
          .map((d) => `    - ${d.file} (${d.kind})`)
          .join(
            '\n'
          )}${messageDefs.length > 10 ? `\n    ... 及其他 ${messageDefs.length - 10} 个` : ''}`,
      });
    }

    console.log(
      `\n[Message 模型] ${messageDefs.length} 个文件自定 Message 类型（规范来源: session/types/message.ts）`
    );
  }

  /**
   * R05-013: 类型中心重复定义检测 —— 检查模块本地类型是否已在 `src/types/` 中定义。
   *
   * ── 处置口径（2026-10-01 台账 D-222，用户裁定）──
   * **冲突判据**：`src/types/**` 中的**定义**（`export interface|type|class`，见下方 Step 1）
   * 与**任一模块本地定义**同名 ⇒ 冲突。
   * ⚠️ **再导出（shim / 桶转发）不计入** —— 本函数只扫**定义**、不扫 `export … from` ⇒
   * `export * from '@modules/…'` 形式的**原址转出**是合法手法（与 D-207 `EffectScope`、
   * D-212 `TiktokenEstimator` 一致）。
   *
   * **故任何"改归 / 下沉"动作遵守三条**：
   * ① **往 `types/` 新增或迁移类型前必须核同名**：
   *    `grep -E "export (interface|type|class) (新名1|新名2|…)" app/src`
   * ② 命中同名 ⇒ **不得落 `types/`**：改落**非类型中心目录**（如 `utils/`，infra），
   *    或按 `knownExceptions` 登记并注明语义差异 —— **优先前者**（避免例外清单膨胀，与"清空例外"方向一致）。
   * ③ **值（类/函数/常量）与类型都可原址转出**（shim 不定义 ⇒ 不触发本规则）；
   *    真正受限的只有"**往类型中心塞同名定义**"这一件事。
   *
   * **反面案例（D-222 B14，已回滚）**：`context/types/Context.ts`（定义 `Context` / `SessionContext` 等
   * 5 个 interface）下沉 `types/` ⇒ 与 `docs/HelpSystem.ts#Context`、`memory/types/SessionContext.ts#SessionContext`、
   * `security/SecurityAudit.ts#SessionContext` 同名 ⇒ `[类型中心冲突] 3 处（2 名）`。
   * **该文件应落 `utils/`（非类型中心）而非 `types/`。**
   */
  async checkTypeCenterDuplicates(): Promise<void> {
    // Step 1: 收集类型中心已定义的所有公开类型名
    const typeCenterTypes = new Set<string>();
    const typeCenterDir = resolve(this.srcPath, 'types');
    const typeCenterFiles = collectTsFiles(typeCenterDir);

    for (const file of typeCenterFiles) {
      const content = readFileSync(file, 'utf-8');
      const patterns = [
        /export\s+interface\s+(\w+)/g,
        /export\s+type\s+(\w+)\s*=/g,
        /export\s+class\s+(\w+)/g,
      ];
      for (const regex of patterns) {
        const matches = [...content.matchAll(regex)];
        for (const match of matches) {
          typeCenterTypes.add(match[1]);
        }
      }
    }

    if (typeCenterTypes.size === 0) {
      console.log('\n[类型中心] src/types/ 为空，跳过 R05-013 检查');
      return;
    }

    console.log(`\n[类型中心] 已收录 ${typeCenterTypes.size} 个公开类型`);

    // 已知合法的同名类型（模块入口、子模块 index 等）
    const knownSafePatterns = [
      /channels[/\\][^/\\]+[/\\](config-schema|accounts|doctor|monitor|probe|runtime|channel\.runtime)\.ts$/,
      /[/\\]index\.ts$/,
    ];

    // 已知例外：文件路径中包含这些片段的跳过（模块内私有类型，允许与类型中心同名）
    const knownExceptions = [
      // 工具模块内部的类型定义（不同类型的 ToolResult，各有差异）
      'tools/types/ToolResult.ts',
      'tools/types/ToolTypes.ts',
      'session/types/tool.ts',
      'session/types/ToolUseBlock.ts',
      // 权限模块内部类型
      'permission/types/PermissionContext.ts',
      'security/permission/PermissionContext.ts',
      'permission/Permission.ts',
      'permission/PermissionChecker.ts',
      // AI 层工具接口
      'ai/interfaces/ToolExecutor.ts',
      // 运行时 API 类型
      'runtime/api/CoreAPI.ts',
      // 核心内部类型（与类型中心概念不同）
      'core/types.ts',
      // 代理内部消息类型
      'agent/TitleGenerator.ts',
      'agent/utils/PermissionSyncManager.ts',
      // 子代理消息（独立概念）
      'subagent/SubAgentCommunicator.ts',
      // 压缩域上下文引擎消息（2026-10-01 D-217：由 services/compact 改归独立 app 模块 compaction）
      'compaction/ContextEngine.ts',
      // UI 组件消息
      'ui/components/Messages.tsx',
      // 2026-08-29 R05-013 治理：领域变体（class 实现 vs interface 契约 / 协议类型 / 语义不同），
      // 与类型中心同名但结构/语义各异，各自为领域事实源
      //   - PluginLoader/PluginRegistry/PluginManager/ToolManager/SessionManager/Session：class 实现 vs 类型中心 interface 契约
      //   - ToolContext/ConversationMessage/PluginSource/Task/Command/PermissionContext/ToolResult/Tool/TaskState：语义不同的领域模型
      //   - ToolPermissionContext：核心字段一致但精度不同，事实源为 tools/types/PermissionContext.ts
      'agent/managers/PluginLoader.ts',
      'core/extensibility/PluginLoader.ts',
      'plugins/core/PluginLoader.ts',
      'plugins/core/PluginRegistry.ts',
      'plugins/managers/PluginManager.ts',
      'analytics/InsightsEngine.ts',
      'ai/interfaces/QueryInterfaces.ts',
      'chat/tool/SmartToolIntegrator.ts',
      'tools/types/Tool.ts',
      'tools/core/ToolManager.ts',
      'tools/ToolManager.ts',
      'tools/extensions/ExtendedToolOptions.ts',
      'tools/extensions/WorkerPool.ts',
      'tools/TaskTool/types.ts',
      'bootstrap/StartupConfig.ts',
      'plugins/categories/PluginCategories.ts',
      'bridge/managers/SessionManager.ts',
      'session/types/session.ts',
      'session/SessionManager.ts',
      'session/models/Session.ts',
      'chronos/service/TaskExpirationService.ts',
      'daemon/types.ts',
      'tasks/types.ts',
      'lsp/types.ts',
      'permission/permissions.ts',
      'permission/utils/RuleMatcher.ts',
      'system/state/types.ts',
      'tools/types/PermissionContext.ts',
      'security/PermissionManager.ts',
      // 2026-08-29 R05-013 治理（二）：模块事实源 vs 类型中心死类型——冲突根源在类型中心
      //   - session/types/message.ts 是会话消息事实规范（@deprecated 迁 DataMessage 中），不应被报
      //   - utils/config.d.ts|config.ts 是 AppConfig 配置事实源；utils/settings/types.ts 是 HooksSettings 事实源（类型中心版为空壳/同构副本）
      //   - plugin-sdk/types.ts|plugins/types/Plugin.ts|plugins/utils/schemas.ts：PluginManifest/CommandMetadata 插件清单，schemas 为 zod 校验事实源
      //   - session/types/UnifiedMessage.ts：会话存储消息模型；plugins/PluginLoader.ts：插件加载器（与已豁免的 plugins/core 同类）
      //   待专项：清理类型中心零消费死类型（Message/ContentBlock/Tool/Session/Command/AppConfig/HooksSettings 等），使 @modules/types 收缩
      'session/types/message.ts',
      'session/types/UnifiedMessage.ts',
      'plugin-sdk/types.ts',
      'plugins/types/Plugin.ts',
      'plugins/utils/schemas.ts',
      'plugins/PluginLoader.ts',
      'utils/config.d.ts',
      'utils/config.ts',
      'utils/settings/types.ts',
    ];

    let conflictCount = 0;
    const conflicts: Array<{ file: string; name: string }> = [];

    for (const file of this.allFiles) {
      // 跳过类型中心文件本身
      if (file.startsWith(typeCenterDir)) continue;
      // 跳过已知安全模式
      if (knownSafePatterns.some((p) => p.test(file))) continue;
      // 跳过已知例外
      const relFile = relative(this.srcPath, file).replace(/\\/g, '/');
      if (knownExceptions.some((e) => relFile.includes(e))) continue;

      const content = readFileSync(file, 'utf-8');

      // 检查 export interface / type / class 是否与类型中心冲突
      const exportRegex = /export\s+(interface|type|class)\s+(\w+)/g;
      const matches = [...content.matchAll(exportRegex)];
      for (const match of matches) {
        const name = match[2];
        if (typeCenterTypes.has(name)) {
          conflictCount++;
          conflicts.push({ file: relFile, name });
        }
      }
    }

    if (conflictCount > 0) {
      // 按类型名分组展示
      const byType = new Map<string, string[]>();
      for (const c of conflicts) {
        if (!byType.has(c.name)) byType.set(c.name, []);
        byType.get(c.name)!.push(c.file);
      }

      const details = [...byType.entries()]
        .slice(0, 10)
        .map(
          ([name, files]) =>
            `    ${name}: ${files.length} 处 — ${files.slice(0, 3).join(', ')}${files.length > 3 ? `... (共 ${files.length} 处)` : ''}`
        )
        .join('\n');

      this.violations.push({
        ruleId: 'R05-013',
        severity: 'warning',
        file: conflicts[0].file,
        message: `存在 ${conflictCount} 处类型定义与类型中心 src/types/ 冲突（${byType.size} 个类型名）`,
        suggestion: `请考虑从 @modules/types 导入已有类型，而非重新定义:\n${details}\n  如需保留独立定义，请将文件加入 knownExceptions`,
      });
    }

    console.log(
      `\n[类型中心冲突] ${conflictCount} 处冲突（${[...new Set(conflicts.map((c) => c.name))].length} 个类型名）`
    );
  }

  /** R05-012: config/env 门禁 — 检测 process.env 直接访问 */
  async checkConfigEnvAccess(): Promise<void> {
    // 白名单：允许直接访问的 process.env 变量
    const whitelist = new Set([
      'NODE_ENV',
      'PYAPP_PROJECT_DIR',
      'PYAPP_LOG_LEVEL',
      'PYAPP_CONFIG_DIR',
      'PYAPP_DATA_DIR',
      'HOME',
      'USERPROFILE',
      'PATH',
      'TEMP',
      'TMP',
      'OS',
      'COMPUTERNAME',
      'XDG_SESSION_TYPE', // Linux 桌面会话类型（系统信息，非配置变量）
      // 2026-08-29 治理：合法环境配置读取点
      'APP_VERSION', // 构建版本号（CI 注入）
      'OTEL_TRACES_EXPORTER', // 标准 OpenTelemetry 环境变量（与 monitoring/instrumentation 同类）
      'REACT_LOOP_MAX_DURATION_MS', // ReAct 循环最大时长配置 env
      'LANDLOCK_RUN_HELPER', // Linux 沙箱辅助工具路径（系统检测类）
      'PDCA_RUN_MAX_TOKENS', // PDCA 运行 token 上限（core/loop/PlanDrivenLoop 直读，理由见下方前缀说明）
    ]);

    // 2026-09-30（台账 D-71，用户裁定「A：`LIRI_*` 前缀入白名单」）：
    // `LIRI_*` 是本项目**自有**环境变量命名空间（见 `.trae/rules/project_rules.md` §1.4 前缀分类），
    // 与既有 `PYAPP_*` / `OTEL_*` 同类。core 层**不得** import ConfigManager（分层约束 R00-001），
    // 而 `configManager.env()` 的实现本就是 `process.env[name] ?? defaultValue`
    // （`config/ConfigManager.ts:1420`）⇒ core 侧读取本命名空间只能直读 env。
    // 故**按前缀放行**（白名单仅 `LIRI_`，不放宽到任意前缀 / 任意变量）。
    const whitelistPrefixes = ['LIRI_'];

    // 已知例外的文件路径片段（边界场景，合理的 process.env 直接访问）
    const knownExceptions = [
      // 测试文件（通过 __tests__ 目录和 .test.ts 文件跳过）
      // 入口点文件（启动阶段 ConfigManager 尚未就绪）
      // 2026-10-02 D-229：移除 `'entrypoints/cli.tsx'`（该文件经取证为死代码，已删除）
      'main.ts',
      'pyapp.ts',
      // CLI 命令和环境变量交互
      'cli/handlers/utilHandler.ts',
      'commands/login/login.ts',
      'commands/logout/logout.ts',
      // 特性开关（Feature Flag）
      'core/AppCore.ts',
      'core/extensibility/ExtensibilityService.ts',
      // 诊断/系统检测
      'diagnostics/DiagnosticsService.ts',
      // 标准 OpenTelemetry 环境变量
      'monitoring/instrumentation.ts',
      // 路径/目录配置
      'infrastructure/http/handlers/files-handlers.ts',
      // AI 模型配置覆盖
      'ai/models/ModelManager.ts',
      // 提示建议配置
      'promptSuggestion/PromptSuggestionConfig.ts',
      // 日志配置（标准配置文件级 env 读取）
      'monitoring/logs/config/LogConfig.ts',
    ];

    let totalAccess = 0;
    const violatingFiles: Array<{ file: string; vars: string[] }> = [];

    for (const file of this.allFiles) {
      // 跳过白名单文件（managedEnv.ts 等配置管理文件）
      if (file.includes('managedEnv') || file.includes('config/')) continue;

      // 跳过测试文件（__tests__ 目录或 .test.ts 文件）
      if (file.includes('__tests__') || file.includes('.test.ts')) continue;

      // 跳过已知例外
      if (knownExceptions.some((e) => file.replace(/\\/g, '/').includes(e)))
        continue;

      const content = readFileSync(file, 'utf-8');
      const envPattern = /process\.env\.(\w+)/g;
      let match: RegExpExecArray | null;

      const foundVars: string[] = [];
      while ((match = envPattern.exec(content)) !== null) {
        const varName = match[1];
        const allowed =
          whitelist.has(varName) ||
          whitelistPrefixes.some((p) => varName.startsWith(p));
        if (!allowed) {
          foundVars.push(varName);
        }
      }

      if (foundVars.length > 0) {
        const uniqueVars = [...new Set(foundVars)];
        totalAccess += foundVars.length;
        violatingFiles.push({
          file: relative(process.cwd(), file),
          vars: uniqueVars,
        });
      }
    }

    if (totalAccess > 0) {
      this.violations.push({
        ruleId: 'R05-012',
        severity: 'warning',
        file: violatingFiles[0].file,
        message: `存在 ${totalAccess} 处 process.env 直接访问（白名单除外），分布在 ${violatingFiles.length} 个文件`,
        suggestion: `请通过 ConfigManager 统一访问环境变量\n  违规文件 (top 5):\n${violatingFiles
          .slice(0, 5)
          .map((f) => `    - ${f.file}: ${f.vars.join(', ')}`)
          .join(
            '\n'
          )}${violatingFiles.length > 5 ? `\n    ... 及其他 ${violatingFiles.length - 5} 个文件` : ''}`,
      });
    }

    console.log(
      `\n[Config/Env] ${totalAccess} 处 process.env 直接访问（${violatingFiles.length} 个文件）`
    );
  }

  /** R05-008: 重复依赖检查 — 扫描 package.json 中功能重叠的依赖 */
  async checkDuplicateDependencies(): Promise<void> {
    const packageJsonPath = resolve(process.cwd(), 'app', 'package.json');
    if (!existsSync(packageJsonPath)) return;

    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    // 定义已知功能重叠的依赖组
    const overlappingGroups: Array<{
      name: string;
      packages: string[];
      suggestion: string;
    }> = [
      {
        name: 'Schema 校验',
        packages: ['ajv', 'zod', '@sinclair/typebox'],
        suggestion: '请统一使用一种 schema 校验库，推荐 Zod',
      },
    ];

    const violations: Array<{
      group: string;
      found: string[];
      suggestion: string;
    }> = [];

    for (const group of overlappingGroups) {
      const found = group.packages.filter((p) => p in allDeps);
      if (found.length >= 2) {
        violations.push({
          group: group.name,
          found,
          suggestion: group.suggestion,
        });
      }
    }

    for (const v of violations) {
      this.violations.push({
        ruleId: 'R05-008',
        severity: 'warning',
        file: 'app/package.json',
        message: `依赖重复: [${v.group}] 同时使用了 ${v.found.join('、')}`,
        suggestion: v.suggestion,
      });
    }

    console.log(`\n[重复依赖] 发现 ${violations.length} 组功能重叠依赖`);
  }

  /** R05-007: tsconfig/ESLint 一致性检查 — 比较两者的 include/exclude 列表 */
  async checkTsconfigEslintConsistency(): Promise<void> {
    const tsconfigPath = resolve(process.cwd(), 'app', 'tsconfig.json');
    if (!existsSync(tsconfigPath)) return;

    // D-138 收网（2026-09-30）：显式声明读取到的配置形状 —— 原先 `JSON.parse` 结果为 `any`，
    // 经 `new Set(...)` 后元素退化为 `unknown`，故 `ex.replace` 报 TS18046。
    const tsconfig: { exclude?: string[] } = JSON.parse(
      readFileSync(tsconfigPath, 'utf-8')
    );
    const excluded = new Set(
      (tsconfig.exclude ?? []).map((e) => e.replace(/\/\*\*$/, ''))
    );

    // 检查被 tsconfig 排除但应纳入类型检查的目录
    const blindSpotDirs = [
      'src/hooks',
      'src/chat',
      'src/governance',
      'src/memory',
      'src/plugins',
      'src/session',
      'src/sandbox',
      'src/permission',
      'src/mcp',
      'src/llm',
      'src/subagents',
      'src/subagent',
    ];

    const actualBlindSpots = blindSpotDirs.filter((dir) => {
      for (const ex of excluded) {
        const exPrefix = ex.replace(/\/\*$/, '');
        if (dir.startsWith(exPrefix)) return true;
      }
      return false;
    });

    // 检查 tsconfig.eslint.json 是否覆盖更广
    const eslintTsconfigPath = resolve(
      process.cwd(),
      'app',
      'tsconfig.eslint.json'
    );
    let eslintExcludesMore = false;
    if (existsSync(eslintTsconfigPath)) {
      const eslintTsconfig = JSON.parse(
        readFileSync(eslintTsconfigPath, 'utf-8')
      );
      const eslintExcluded = new Set(
        (eslintTsconfig.exclude || []).map((e: string) =>
          e.replace(/\/\*$/, '')
        )
      );
      // tsconfig.eslint.json 的 exclude 应该比 tsconfig.json 小（检查范围更大）
      if (eslintExcluded.size < excluded.size) {
        eslintExcludesMore = true;
      }
    }

    if (actualBlindSpots.length > 0) {
      this.violations.push({
        ruleId: 'R05-007',
        severity: 'error',
        file: 'app/tsconfig.json',
        message: `${actualBlindSpots.length} 个核心模块目录被 tsconfig exclude，导致类型检查盲区`,
        suggestion: `以下目录被 tsconfig.json 排除，tsc 不进行类型检查，属于盲区:\n${actualBlindSpots.map((d) => `    - ${d}`).join('\n')}\n请逐步缩小 exclude 列表，将这些目录纳入类型检查`,
      });
    }

    if (!eslintExcludesMore) {
      this.violations.push({
        ruleId: 'R05-007',
        severity: 'warning',
        file: 'app/tsconfig.eslint.json',
        message:
          'tsconfig.eslint.json 的 exclude 列表与 tsconfig.json 相同，未扩大类型检查范围',
        suggestion:
          'tsconfig.eslint.json 应缩小 exclude 列表，让 ESLint 检查更多文件以弥补类型检查盲区',
      });
    }

    console.log(
      `\n[tsconfig/ESLint] ${actualBlindSpots.length} 个目录存在类型检查盲区`
    );
  }

  // ============ P1a-T1-S1: R01-005 健康检查统一注册 ============

  /** R01-005: 检查健康检查是否统一注册到 HealthChecker */
  async checkHealthCheckRegistration(): Promise<void> {
    const canonicalPath = 'monitoring/health/HealthChecker';
    // KB-LINT-HEALTH-ENDPOINT（2026-08-29）：/health 对外 HTTP 端点（daemon 健康
    // 服务器、健康数据路由）是"消费方"而非"自建检查逻辑"，豁免
    const knownHealthEndpointFiles = [
      'daemon\\HealthServer.ts',
      'auth-access-routes.ts',
    ];
    let healthCheckCount = 0;
    const violatingFiles: Array<{ file: string; line: number }> = [];

    for (const file of this.allFiles) {
      // 跳过 HealthChecker 自身
      if (
        file.includes(canonicalPath.replace(/\//g, '\\')) ||
        file.includes(canonicalPath.replace(/\\/g, '/'))
      )
        continue;
      // 跳过测试文件
      if (file.endsWith('.test.ts') || file.endsWith('.spec.ts')) continue;

      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;

        // 检测自建健康检查模式: registerHealthCheck / addHealthCheck / healthCheck()
        const selfBuilt = /(register|add|create)HealthCheck\s*\(/.test(line);
        if (selfBuilt) {
          // KB-LINT-HEALTHCHECK-ADAPTER（2026-08-29）：已 import 标准
          // HealthChecker 的适配层（如 doctor-health 代理 registerCheck 到
          // monitoring）不算自建——统一视图已建立
          if (content.includes('monitoring/health/HealthChecker')) {
            continue;
          }
          violatingFiles.push({
            file: relative(process.cwd(), file),
            line: lineNum,
          });
          healthCheckCount++;
          continue;
        }

        // 检测自建 /health 端点
        if (
          /['"`]\/health['"`]/.test(line) &&
          !content.includes(canonicalPath)
        ) {
          if (knownHealthEndpointFiles.some((e) => file.includes(e))) {
            continue;
          }
          violatingFiles.push({
            file: relative(process.cwd(), file),
            line: lineNum,
          });
          healthCheckCount++;
          continue;
        }
      }
    }

    if (healthCheckCount > 0) {
      this.violations.push({
        ruleId: 'R01-005',
        severity: 'warning',
        file: violatingFiles[0].file,
        message: `检测到 ${healthCheckCount} 处自建健康检查（应统一通过 HealthChecker 注册）`,
        suggestion: `请将所有健康检查逻辑统一到 monitoring/health/HealthChecker.ts 注册\n  ${violatingFiles
          .slice(0, 10)
          .map((f) => `- ${f.file}:${f.line}`)
          .join(
            '\n  '
          )}${violatingFiles.length > 10 ? `\n  ... 及其他 ${violatingFiles.length - 10} 处` : ''}`,
      });
    }

    console.log(`\n[R01-005 健康检查] ${healthCheckCount} 处自建健康检查`);
  }

  // ============ P1a-T1-S2: R02-003 Session 模型统一 ============

  /** R02-003: 检查 Session ID 是否使用 acp/types.ts 的统一 SessionId */
  async checkSessionModel(): Promise<void> {
    const canonicalPaths = ['acp/types', 'acp/types.ts', '@modules/acp/types'];

    const knownExceptions = [
      'session/Session.ts', // Session 类自身的 ID 字段
      'session/SessionManager.ts', // SessionManager 中的 ID 管理
      // 2026-08-29 治理：system/state 是应用状态会话 ID（sess_ 格式），
      // acp 是 ACP 协议会话 ID（acp- 前缀 branded），格式不同不可统一
      'system/state/types.ts',
    ];

    const sessionIdDefs: Array<{ file: string; typeName: string }> = [];

    for (const file of this.allFiles) {
      const relPath = relative(this.srcPath, file).replace(/\\/g, '/');

      // 跳过规范路径
      if (canonicalPaths.some((p) => relPath.includes(p))) continue;
      // 跳过已知例外
      if (knownExceptions.some((e) => relPath.includes(e))) continue;

      const content = readFileSync(file, 'utf-8');

      // 检测自定 SessionId 或 SessionID 类型（非 import 重新导出）
      const sessionIdPattern =
        /export\s+(interface|type)\s+(SessionId|SessionID)\b/g;
      let match: RegExpExecArray | null;
      while ((match = sessionIdPattern.exec(content)) !== null) {
        // 排除从规范路径 re-export 的场景
        const beforeMatch = content.substring(0, match.index);
        if (beforeMatch.includes("from '") || beforeMatch.includes('from "')) {
          // 检查 export { ... } from 语法
          const lastExport = beforeMatch.lastIndexOf('export');
          if (lastExport >= 0) {
            const exportLine = content
              .substring(lastExport, match.index)
              .trim();
            if (exportLine.includes('from')) continue; // re-export，跳过
          }
        }
        sessionIdDefs.push({ file: relPath, typeName: match[1] });
      }
    }

    if (sessionIdDefs.length > 0) {
      this.violations.push({
        ruleId: 'R02-003',
        severity: 'warning',
        file: sessionIdDefs[0].file,
        message: `存在 ${sessionIdDefs.length} 个文件自行定义了 SessionId/SessionID 类型，未使用 acp/types.ts 的规范定义`,
        suggestion: `请统一引用 acp/types.ts 的 SessionId（branded type）\n  受影响文件:\n${sessionIdDefs
          .slice(0, 10)
          .map((d) => `    - ${d.file} (${d.typeName})`)
          .join(
            '\n'
          )}${sessionIdDefs.length > 10 ? `\n    ... 及其他 ${sessionIdDefs.length - 10} 个` : ''}`,
      });
    }

    console.log(
      `\n[R02-003 Session 模型] ${sessionIdDefs.length} 个文件自定 SessionId/SessionID 类型`
    );
  }

  // ============ P1a-T1-S3: R03-002 模块出口单一 ============

  /** R03-002: 检查模块是否从子目录直接 import（应通过 index.ts 出口） */
  async checkModuleSingleExport(): Promise<void> {
    // R03-002 moduleRoots **单一事实源**（2026-10-04，P0-6 D-3-c；spec `r03-002-module-roots-single-source`）：
    // 从 `modules-to-layers.json` 派生，取代此前 45 项硬编码 Set（已漂移）。
    // ⚠️ **必须直接读文件**：`loadLayerMapping()`（填充 `this.moduleToLayer`）在 R 检查**之后**执行，
    //   依赖它会得**空集**、**静默关闭本规则**（实测白名单 786→0 的假绿）。
    const r03002MappingPath = resolve(__dirname, 'modules-to-layers.json');
    const r03002Mapping = JSON.parse(
      readFileSync(r03002MappingPath, 'utf-8')
    ) as { modules: Record<string, unknown> };
    const moduleRoots = new Set(Object.keys(r03002Mapping.modules));

    // 测试文件排除集已提升为**模块级**常量 `TEST_FILE_EXCLUSIONS`（2026-10-01 口径统一，见其 JSDoc）

    // 规范子入口豁免（2026-08-29）：项目规则/架构文档指定的唯一入口子路径，非违规
    //   - core/paths：路径注册表唯一入口（project_rules §1.13）
    //   - error/handleError：错误处理唯一入口（§1.9）；error/types：AppError 标准错误类
    //   - monitoring/logs：Logger 唯一入口（§1.8）
    //   - core/events：全局事件总线；monitoring/otel：可观测性
    //   - */types：类型子路径（TS 生态普遍模式，类型导出通常不并入 index）
    // 循环安全子入口（2026-08-30）：桶精确化打破 ESM 循环依赖（BaseAIProvider TDZ）所需的
    // 精确子路径。这些子路径是避免门面桶（barrel）加载整个模块面、触发运行时循环的唯一入口，
    // 与 core/paths 等唯一入口同属"规范子路径"豁免（见 dev_docs 第六十七次修复记录）。
    const canonicalEntryKeys = new Set([
      'core/paths',
      'core/events',
      'core/external',
      'error/handleError',
      'error/types',
      'monitoring/logs',
      'monitoring/otel',
      'monitoring/health',
      'config/ConfigManager',
      'context/DependencyRegistry',
      'error/utils',
      'ai/tokenizer',
      'ai/router',
      'ai/providers',
      'ai/models',
      'query/TAORLoop',
      // 循环安全子入口（2026-09-24）：`tasks/goal/goalTemplates` 是**零跨模块 import 的叶子**，
      // 而 `chat/ReActToolLoop` 在**模块顶层**读取 `CONTINUATION_TEMPLATES.*`；若改走
      // `@modules/tasks` 桶，会形成 chat → tasks 桶 → tools 桶 → AgentTool → tasks 的求值闭环，
      // 实测运行期 `ReferenceError: Cannot access 'CONTINUATION_TEMPLATES' before initialization`（TDZ）。
      // 与既有 `ai/router`、`error/types` 同属"桶精确化打破 ESM 循环依赖"的规范子路径。
      'tasks/goal',
      // 循环安全子入口（2026-09-24）：`core/systemgraph` 只依赖 `@modules/error`（叶子级），
      // 而 `@modules/core` 桶会拉入 `core/loop/PlanDrivenLoop`（其依赖 `@modules/tasks`）；
      // `modules/workflow/WorkflowEngine` 已依赖 `@modules/tasks`，若改走 core 桶将把整条
      // core 链路引入工作流路径、增加求值闭环风险。图内核是独立纯模块 ⇒ 子入口直连更精确。
      'core/systemgraph',
      // 循环安全子入口（2026-09-26）：`query/tool-constants` 是**零跨模块 import 的叶子**
      // （只导出工具名 `Set` 字面量），而 `promptSuggestion/types.ts` 与
      // `tools/orchestration/types.ts` 需要其"文件读写工具真实名"取值（裁定①：共享取值 + 各自命名）。
      // 若改走 `@modules/query` 桶，会把 TAORLoop / PathGuard / FileIOLoopDetector 整条 query 模块面
      // 拉进推测执行与工具编排路径，徒增求值闭环（TDZ）风险 ⇒ 与 `tasks/goal`、`ai/router` 同理。
      'query/tool-constants',
      // 循环安全子入口（2026-09-29；**2026-10-01 D-152 随生成物下沉 `constants/` 迁移键名**）：
      // `constants/toolNames.generated` 是 **codegen 产物、零 import 的叶子**
      // （仅导出 `TOOL_NAMES` 字面量数组 + `ToolName` 联合类型），由 6 个文件直接引用
      // （`constants/tools`（同模块）· `query/tool-constants` · `context/compaction/MicroCompactionEngine` ·
      // `chat/services/ToolExecutionService` · `promptSuggestion/types` · `tasks/dream/DreamPhases`）
      // —— 后 5 者处于 tools 的**上游**（context/query/chat/promptSuggestion/tasks）。
      // 该叶子**必须**以子路径直连（与 `query/tool-constants`、`tasks/goal`、`ai/router` 同属"桶精确化"手法）：
      // 若改走 `@modules/constants` 桶，会把整个常量面拉进这些核心路径。
      'constants/toolNames.generated',
      // 循环安全子入口（2026-09-30，台账 D-120）：`core/LazyModuleStrategy` 是**叶子级**懒加载策略
      // （仅依赖 `core/profilerFacade` + `core/loggerFacade`），被 `modules`(app) 与其**上游**的
      // `performance`(infra) / `tools`(app) 直接消费（原位于 `modules/`；因 `modules` 由 core 改归
      // app，为避免 `performance`(infra) → modules(app) 静态倒挂而**下沉 core**）。若改走 `@modules/core`
      // 桶，会把 `core/loop/PlanDrivenLoop`（依赖 `@modules/tasks`）等整条 core 链路拉入 `performance`
      // 与模块加载路径 ⇒ 求值闭环 / TDZ 风险 ⇒ 与 `core/systemgraph` 同属"循环安全子入口"。
      'core/LazyModuleStrategy',
      // SPI 端口目录（2026-09-30，台账 D-121）：`core/spi/**` 是 core 定义的**抽象契约**
      // （Logger/OTel/Profiler/Broadcast），由上层实现并注入。**infra / core 层**消费方必须
      // **按端口精确导入**（`@modules/core/spi`）—— 若改走 `@modules/core` 桶，会被迫拉入
      // `core/loop/PlanDrivenLoop`（→ tasks）等整条 core 链路，增大求值闭环（TDZ）风险。
      // 与 `core/events`、`core/systemgraph` 同属规范子入口。
      'core/spi',
      // 单一事实源子入口（2026-09-30，台账 D-134）：`channels/ChannelCatalog` 是**零静态依赖的叶子**
      // （仅导出 26 条「type/name/exportKey/loader」，其 thunk 目标同属 channels ⇒ 同模块不产生跨层）。
      // `infrastructure/http` 的 `LocalHTTPServiceHelpers` 与 `handlers/channel-handlers` 必须直连它；
      // **禁止改走 `@modules/channels` 桶** —— 该桶**静态再导出全部 26 个通道实现**，会把整个通道面
      // 拉进 HTTP 启动路径（同 spec §3.7 记录的懒加载动机）⇒ 与 `core/spi`、`tasks/goal` 同属规范子入口。
      // 命名保持 PascalCase，以复用 eslint `module-registry/no-direct-module-import` 的 PascalCase 兜底。
      'channels/ChannelCatalog',
      // 零依赖叶子子入口（2026-10-01，台账 D-163）：`core/taskStatus` 只含 `TaskStatus`
      // 枚举 + `isTerminalTaskStatus`（**无任何 import**），但消费方横跨 core/infra/app
      // （`state/task/TaskStateMachine` 构造状态转移表、`core/Coordinator`、`tasks/*`）。
      // `tasks/types` 已改为原样转出该子路径 ⇒ 若不让 infra 层按此**精确子路径**导入，
      // 就只能走 `@modules/core` 桶（会把 core 面拉进 infra），或退回 `@modules/tasks`
      // （即原 `state`(infra) -> `tasks`(app) 倒挂）⇒ 与 `core/paths`、`core/spi` 同属规范子入口。
      'core/taskStatus',
      // 零依赖叶子子入口（2026-10-01，台账 D-167）：`core/knowledge-types` 是**纯类型、零 import**
      // （`KnowledgeRoute` / `KnowledgeRouterOptions` / `IKnowledgeSearch`），消费方横跨 app
      // （`docs` / `knowledge` 域）与 infra（`memory/services/UnifiedSearchService`）。
      // 若不让 infra 按此**精确子路径**导入，就只能退回 `@modules/docs`（即原 infra -> app 倒挂）。
      // 与 `core/taskStatus`、`core/paths` 同属规范子入口。
      'core/knowledge-types',
      // ── D-3-c 存量登记（2026-10-04，P0-6 / spec `r03-002-module-roots-single-source` 裁定 D1(b)）──
      // `moduleRoots` 改为从 `modules-to-layers.json` 派生后，以下子入口**首次被计入** R03-002。
      // 按 D1(b)：**显式登记为存量例外**并**分批收口**（不是静默放宽 —— 这些模块此前**根本不在**
      // moduleRoots 内、同为零检查；本批把「隐式盲区」变为「显式债」，并把新增直连纳入拦截）。
      // TODO(D-3-c 收口)：逐项判定 barrel 是否已导出 → 改走桶；未导出者为其增补 barrel 导出。
      //   ✅ 收口批次①已完成（提交见 git log）：tokenBudget{BudgetPolicy,PriceManager,CacheAwareBudget} ·
      //     streaming/scrubbers · constants{common,systemPromptSections} · security/injection ·
      //     skills/SkillRegistry —— 对应子路径导入已改走各模块 barrel，登记键已移除。
      //     ⚠️ `security/policy` 本批**未收口**（存在 barrel 未导出符号的残留消费方）：
      //       `channelPermissions` 值未由 security barrel 转出、`imageSanitizationPolicy` 未由
      //       security/policy 导出 ⇒ `services/mcp/channelPermissions.ts` 与 3 个 ImageTool 仍按
      //       子路径直连 ⇒ 键保留（归批次②：为 barrel 增补导出后再收口）。
      //   收口批次②、③：其余（含 docs/analytics/workspaces/knowledge/bootstrap/components/…）
      'tokenBudget/TokenBudgetController', // barrel 仅命名导出 Controller/type；`UNIFIED_THRESHOLDS` 等未导出
      'tokenBudget/UnifiedTokenTracker', // barrel 未导出（叶子令牌跟踪）
      'security/policy', // ⚠️残留消费方（见上）；barrel 未导出 channelPermissions/imageSanitizationPolicy
      'security/patterns', // barrel 仅导出 patterns 的 **type**（值未导出）→ 收口：评估为 barrel 增补值导出
      'security/redact', // barrel 仅导出 redact 的 type
      'security/scanners', // 子路径唯一入口（barrel 导出件在 `scanner/secret`，命名不一致）
      'security/validators', // 子路径唯一入口（barrel 未导出）
      'security/bash', // 子路径唯一入口（barrel 导出件在 `BashAllowlistMatcher`）
      'security/files', // 子路径唯一入口（barrel 未导出）
      'skills/loaders', // 子路径唯一入口（barrel 逐件导出，无 `./loaders` 聚合出口）
      'skills/services', // 子路径唯一入口（barrel 未导出）
      'skills/cli', // 子路径唯一入口（barrel 未导出）
      'workspace/CouncilOrchestrator', // ②（workspace 域；收口批次待检视 barrel）
      'workspaces/WorkspaceScanner', // ②
      'workspaces/commands', // ②（命令子域）
      'components/TaskListV2', // ②（UI 组件）
      'components/ui', // ②
      'docs/FileDocsProvider', // ③
      'docs/DocumentVersionService', // ③
      'docs/TemplateService', // ③
      'docs/knowledge-types', // ③（类型叶子）
      'analytics/PassesService', // ③
      'analytics/AnalyticsService', // ③
      'analytics/PerformanceMonitorService', // ③
      'knowledge/KnowledgeDigestInjector', // ③
      'knowledge/graph', // ③
      'knowledge/frontmatter', // ③
      'knowledge/KnowledgeBaseWriter', // ③
      'bootstrap/StartupChainProfiler', // ③（entry 层）
      'bootstrap/StartupYamlLoader', // ③
      'bootstrap/StartupConfig', // ③
      'common/utils', // ③（infra 叶子）
      'modules/ModuleDefinitions', // ③（模块注册表叶子）
      'governance/managers', // ③
    ]);

    // 目标模块无 index.ts（无统一出口）→ 子路径导入是唯一方式，非违规（2026-08-29）
    // 现状：services/utils/runtime/gateway/llm/remote/subagent/skillCode 均无 index.ts
    const moduleHasIndex = new Map<string, boolean>();
    for (const m of moduleRoots) {
      moduleHasIndex.set(m, existsSync(join(this.srcPath, m, 'index.ts')));
    }

    const violations: Array<{
      importer: string;
      targetModule: string;
      subDir: string;
    }> = [];

    /**
     * 落在「规范子入口白名单」（`canonicalEntryKeys` 与「types 段」子路径）而被豁免的子路径导入数。
     *
     * 为什么要单独计数（2026-10-01）：本数此前不出现在任何输出里，导致「0 处违规」与
     * 「裸 grep 到 N 处 `@modules/x/y` 导入」被混为一谈 —— 会话据此产出了「215 处绕过统一
     * 出口」的误判任务项（实际全部在白名单内、真实违规 0，见 `pending-tasks-consolidated-20261001.md`
     * T-①09/T-③01 与 `dc5137cd5`）。打印该数即可让读者一眼区分「无子路径导入」与
     * 「子路径导入均为规范子入口」。
     */
    let exemptedCount = 0;

    for (const file of this.allFiles) {
      // 跳过测试文件
      if (TEST_FILE_EXCLUSIONS.some((e) => file.includes(e))) continue;

      const content = readFileSync(file, 'utf-8');
      const relPath = relative(this.srcPath, file).replace(/\\/g, '/');
      const importerModule = relPath.split('/')[0];

      // 匹配 @modules/xxx/yyy 形式的 import（xxx 是模块名，yyy > 1 层深度即子目录）
      const importRegex = /from\s+['"]@modules\/([^'"/]+)\/([^'"]+)['"]/g;
      let match: RegExpExecArray | null;
      while ((match = importRegex.exec(content)) !== null) {
        const targetModule = match[1];
        const subPath = match[2];
        // 跳过跨模块类型导入（从 types/ 目录导入属于类型出口，允许）
        if (targetModule === 'types') continue;
        // 跳过模块自身的子目录 import（同模块内不算违规）
        if (targetModule === importerModule) continue;
        // 如果目标不在已知模块根中，跳过（可能是第三方包）
        if (!moduleRoots.has(targetModule)) continue;
        // state 别名豁免：@modules/state 映射 system/state（tsconfig paths），
        // src/state 无可用 @modules 别名，跨模块相对路径是唯一导入方式
        if (targetModule === 'state') continue;
        // 目标模块无 index.ts（无统一出口）→ 子路径导入是唯一方式，合法
        if (!moduleHasIndex.get(targetModule)) continue;
        // 如果 subPath 是 index 或 index.js，不算违规
        if (subPath === 'index' || subPath === 'index.js') continue;
        // 规范子入口豁免：类型子路径（*/types，支持任意深度如 ai/models/types.js）
        // 与唯一入口白名单（core/paths 等，剥离 .js 后缀匹配 @modules/core/paths.js）
        const subSegments = subPath.replace(/\.js$/, '').split('/');
        if (subSegments.some((s) => s === 'types')) {
          exemptedCount++;
          continue;
        }
        if (canonicalEntryKeys.has(`${targetModule}/${subSegments[0]}`)) {
          exemptedCount++;
          continue;
        }

        violations.push({
          importer: relPath,
          targetModule,
          subDir: subPath.split('/')[0],
        });
      }

      // 匹配相对路径 import，检测是否跨模块子目录 import
      const relImportRegex = /from\s+['"](\.[^'"]+)['"]/g;
      while ((match = relImportRegex.exec(content)) !== null) {
        const relImport = match[1];
        // 将相对路径解析到 src 目录
        const resolved = resolve(dirname(file), relImport);
        if (!resolved.startsWith(this.srcPath)) continue;

        const resolvedRel = relative(this.srcPath, resolved).replace(
          /\\/g,
          '/'
        );
        const parts = resolvedRel.split('/');
        if (parts.length < 3) continue; // 同一模块内或根目录，跳过

        const targetModule = parts[0];
        const subDir = parts[1];

        // 如果目标是不同类型模块或非模块根，跳过
        if (!moduleRoots.has(targetModule)) continue;
        if (targetModule === importerModule) continue; // 同模块，跳过
        // state 别名豁免：src/state 无 @modules 别名（@modules/state 被 system/state 占用）
        if (targetModule === 'state') continue;
        // 目标模块无 index.ts（无统一出口）→ 子路径导入是唯一方式，合法
        if (!moduleHasIndex.get(targetModule)) continue;
        // 规范子入口豁免：类型子路径（任意深度含 types 段）与唯一入口白名单
        //（剥离 .js 后缀匹配，与 @modules/ 分支一致）
        if (parts.slice(1).some((p) => p.replace(/\.js$/, '') === 'types')) {
          exemptedCount++;
          continue;
        }
        const relSubKey = subDir.replace(/\.js$/, '');
        if (canonicalEntryKeys.has(`${targetModule}/${relSubKey}`)) {
          exemptedCount++;
          continue;
        }

        // 跳过 index 入口
        const fileName = parts[parts.length - 1];
        if (
          fileName === 'index.ts' ||
          fileName === 'index.tsx' ||
          fileName === 'index.js'
        )
          continue;

        violations.push({
          importer: relPath,
          targetModule,
          subDir,
        });
      }
    }

    if (violations.length > 0) {
      this.violations.push({
        ruleId: 'R03-002',
        // T-③01（2026-10-03 用户裁定）：由 warning 提升为 **error** —— 与 R00-001（分层）同级阻断
        // （`errors>0 ⇒ exit 1`）。提升时实测本规则违规 **0**（783 处落在"规范子入口白名单"，
        // 非违规）⇒ 零回归；目的是**防未来回流**（新增子目录直连即提交被拒）。
        severity: 'error',
        file: violations[0].importer,
        message: `存在 ${violations.length} 处从模块子目录直接 import 的行为（应通过模块 index.ts 出口导入）；另有 ${exemptedCount} 处落在规范子入口白名单，不在此列`,
        suggestion: `请改为从模块 index.ts 出口导入\n  示例 (top 5):\n${violations
          .slice(0, 5)
          .map(
            (v) =>
              `    - ${v.importer} → @modules/${v.targetModule}/${v.subDir}`
          )
          .join(
            '\n'
          )}${violations.length > 5 ? `\n    ... 及其他 ${violations.length - 5} 处` : ''}`,
      });
    }

    console.log(
      `\n[R03-002 模块出口单一] ${violations.length} 处子目录 import 违规` +
        `（另有 ${exemptedCount} 处落在规范子入口白名单 —— canonicalEntryKeys 与 types 段，非违规）`
    );
  }

  // ============ P1a-T1-S4: R03-004 消息路由管线统一 ============

  /** R03-004: 检查消息路由是否统一通过 routeChannelMessage() */
  async checkMessageRouting(): Promise<void> {
    const canonicalPath = 'channels/routing/messageRouter';
    let directChatCalls = 0;
    const violatingFiles: Array<{
      file: string;
      line: number;
      detail: string;
    }> = [];

    for (const file of this.allFiles) {
      // 跳过自身和测试文件
      if (
        file.includes(canonicalPath.replace(/\//g, '\\')) ||
        file.includes(canonicalPath.replace(/\\/g, '/'))
      )
        continue;
      if (file.endsWith('.test.ts') || file.endsWith('.spec.ts')) continue;

      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;

        // 检测绕过 routeChannelMessage() 直接调用 CoreAPI.chat()
        const directChat = /CoreAPI\s*\.\s*chat\s*\(/.test(line);
        if (directChat) {
          // 检查是否在 messageRouter 相关文件中
          if (!file.includes('messageRouter')) {
            violatingFiles.push({
              file: relative(process.cwd(), file),
              line: lineNum,
              detail: '直接调用 CoreAPI.chat()，应通过 routeChannelMessage()',
            });
            directChatCalls++;
          }
        }
      }
    }

    if (directChatCalls > 0) {
      this.violations.push({
        ruleId: 'R03-004',
        severity: 'warning',
        file: violatingFiles[0].file,
        message: `检测到 ${directChatCalls} 处绕过 routeChannelMessage() 直接调用 CoreAPI.chat()`,
        suggestion: `所有入站消息必须通过 channels/routing/messageRouter.ts 的 routeChannelMessage() 统一处理\n  ${violatingFiles
          .slice(0, 10)
          .map((f) => `- ${f.file}:${f.line} — ${f.detail}`)
          .join(
            '\n  '
          )}${violatingFiles.length > 10 ? `\n  ... 及其他 ${violatingFiles.length - 10} 处` : ''}`,
      });
    }

    console.log(
      `\n[R03-004 消息路由] ${directChatCalls} 处直接 CoreAPI.chat() 调用`
    );
  }

  // ============ R00 分层合规 ============

  private layerExceptions: Set<string> = new Set();
  private exceptionData: { bulk: any[]; perModule: any[] } = {
    bulk: [],
    perModule: [],
  };
  /** 文件大小例外（R04-001 豁免，路径统一为小写正斜杠） */
  private fileSizeExceptions: Set<string> = new Set();
  /** 文件大小 pattern 例外（R04-001，来自 bulkExceptions 中 ruleId=R04-001 的条目） */
  private fileSizePatterns: RegExp[] = [];
  /** 桶文件例外（R06-010 豁免，路径统一为小写正斜杠） */
  private barrelExceptions: Set<string> = new Set();
  /** 微小文件例外（R07-001 豁免，路径统一为小写正斜杠） */
  private tinyFileExceptions: Set<string> = new Set();

  /** 加载分层例外清单 */
  async loadLayerExceptions(): Promise<void> {
    const exPath = resolve(__dirname, 'layer-exceptions.json');
    if (!existsSync(exPath)) return;

    const data = JSON.parse(readFileSync(exPath, 'utf-8'));
    this.exceptionData = {
      bulk: data.bulkExceptions || [],
      perModule: data.perModuleExceptions || [],
    };

    // 加载批量例外
    const bulk = data.bulkExceptions || [];
    for (const ex of bulk) {
      // 检查是否已过期
      if (ex.expiresAt && new Date(ex.expiresAt) < new Date()) continue;
      this.layerExceptions.add(`${ex.ruleId}:${ex.pattern}`);
      // R04-001 的文件大小 pattern 例外单独收集（glob 简化：* → [^/]*）
      if (ex.ruleId === 'R04-001' && typeof ex.pattern === 'string') {
        const regexSrc = ex.pattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '[^/]*');
        this.fileSizePatterns.push(new RegExp(`^${regexSrc}$`, 'i'));
      }
    }

    // 加载按模块例外
    const perModule = data.perModuleExceptions || [];
    for (const ex of perModule) {
      if (ex.expiresAt && new Date(ex.expiresAt) < new Date()) continue;
      this.layerExceptions.add(
        `${ex.ruleId}:${ex.sourceModule}:${ex.targetModule}`
      );
    }

    // 加载文件大小例外（R04-001 豁免）
    const fileSize = data.fileSizeExceptions || [];
    for (const ex of fileSize) {
      if (ex.expiresAt && new Date(ex.expiresAt) < new Date()) continue;
      this.fileSizeExceptions.add(ex.file.replace(/\\/g, '/').toLowerCase());
    }

    // 加载桶文件例外（R06-010 豁免）
    const barrels = data.barrelExceptions || [];
    for (const ex of barrels) {
      if (ex.expiresAt && new Date(ex.expiresAt) < new Date()) continue;
      this.barrelExceptions.add(ex.file.replace(/\\/g, '/').toLowerCase());
    }

    // 加载微小文件例外（R07-001 豁免）
    const tiny = data.tinyFileExceptions || [];
    for (const ex of tiny) {
      if (ex.expiresAt && new Date(ex.expiresAt) < new Date()) continue;
      this.tinyFileExceptions.add(ex.file.replace(/\\/g, '/').toLowerCase());
    }

    console.log(
      `已加载 ${this.layerExceptions.size} 条有效分层例外 + ${this.fileSizeExceptions.size} 条文件大小例外 + ${this.barrelExceptions.size} 条桶文件例外 + ${this.tinyFileExceptions.size} 条微小文件例外`
    );
  }

  /** 判断文件是否在 R04-001 豁免清单中 */
  isFileSizeExempt(relPath: string): boolean {
    const normalized = relPath.replace(/\\/g, '/').toLowerCase();
    // 适配两种 cwd：项目根（app/src/...）或 app 目录（src/...）
    const withAppPrefix = normalized.startsWith('app/')
      ? normalized
      : `app/${normalized}`;
    if (
      this.fileSizeExceptions.has(normalized) ||
      this.fileSizeExceptions.has(withAppPrefix)
    ) {
      return true;
    }
    // pattern 例外匹配（BULK R04-001）
    return this.fileSizePatterns.some(
      (p) => p.test(normalized) || p.test(withAppPrefix)
    );
  }

  /** 判断文件是否在 R06-010 桶文件豁免清单中 */
  isBarrelExempt(relPath: string): boolean {
    const normalized = relPath.replace(/\\/g, '/').toLowerCase();
    const withAppPrefix = normalized.startsWith('app/')
      ? normalized
      : `app/${normalized}`;
    return (
      this.barrelExceptions.has(normalized) ||
      this.barrelExceptions.has(withAppPrefix)
    );
  }

  /** 判断跨层依赖是否已被豁免 */
  isException(ruleId: string, srcModule: string, tgtModule: string): boolean {
    const srcLayer = this.moduleToLayer.get(srcModule) || '';
    const tgtLayer = this.moduleToLayer.get(tgtModule) || '';

    // 检查按模块精确例外
    if (this.layerExceptions.has(`${ruleId}:${srcModule}:${tgtModule}`))
      return true;

    // 检查批量例外（按 layer 模式匹配）
    const pattern = `${srcLayer} -> ${tgtLayer}`;
    if (this.layerExceptions.has(`${ruleId}:${pattern}`)) return true;

    return false;
  }

  /** 加载分层映射配置 */
  async loadLayerMapping(): Promise<void> {
    const mappingPath = resolve(__dirname, 'modules-to-layers.json');
    if (!existsSync(mappingPath)) {
      console.warn(
        '⚠ 警告: scripts/modules-to-layers.json 不存在，跳过分层检查'
      );
      return;
    }
    const data = JSON.parse(readFileSync(mappingPath, 'utf-8'));
    for (const [mod, info] of Object.entries(data.modules) as [string, any][]) {
      this.moduleToLayer.set(mod, info.layer);
    }
    this.allowedDeps = data.allowedDependencies;
    this.layerOrder = data.layerOrder;
    console.log(`已加载 ${this.moduleToLayer.size} 个模块的分层映射`);
  }

  /** 从文件路径解析所属模块名 */
  resolveModuleName(filePath: string): string {
    const rel = relative(this.srcPath, filePath).replace(/\\/g, '/');
    const parts = rel.split('/');
    if (parts.length === 0) return '__root__';
    const first = parts[0];
    // 根目录文件（如 main.ts, index.ts）以文件名作为模块名
    if (first.includes('.ts') || first.includes('.tsx')) return first;
    return first;
  }

  /**
   * 剥离注释（**保留字符串字面量**）—— 2026-10-01 台账 D-190（门禁口径裁定 ①）
   *
   * **为什么**：`parseModuleImports` / `parseDynamicImports` 用正则扫**原始文本**，而**不剥离注释**
   * ⇒ 把旧 import 写进注释的"收口说明"会让该依赖**复活**（假阳性）。本会话已实证 **3 次**：
   * D-162（`config -> sandbox`）· D-172（`oauth -> infrastructure` · `system -> tasks`，两次共致 −2 误判）。
   *
   * **为什么不能简单用正则删注释**：`from '…'` 的**说明符本身是字符串**，且源码中存在含 `//` 的字符串
   * （如 URL）⇒ 采用**逐字符状态机**：仅在 code 态识别 `//` 与 `/* *\/`，字符串/模板串内原样保留
   * （含转义 `\\`）。**保留换行** ⇒ 行号不变。
   */
  stripComments(content: string): string {
    let out = '';
    let i = 0;
    let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' =
      'code';
    while (i < content.length) {
      const ch = content[i];
      const next = content[i + 1];
      if (state === 'code') {
        if (ch === '/' && next === '/') {
          state = 'line';
          i += 2;
          continue;
        }
        if (ch === '/' && next === '*') {
          state = 'block';
          i += 2;
          continue;
        }
        if (ch === "'") state = 'single';
        else if (ch === '"') state = 'double';
        else if (ch === '`') state = 'template';
        out += ch;
        i++;
        continue;
      }
      if (state === 'line') {
        if (ch === '\n') {
          state = 'code';
          out += ch;
        }
        i++;
        continue;
      }
      if (state === 'block') {
        if (ch === '*' && next === '/') {
          state = 'code';
          i += 2;
          continue;
        }
        if (ch === '\n') out += ch;
        i++;
        continue;
      }
      // 字符串态：原样保留（含转义）
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i += 2;
        continue;
      }
      if (
        (state === 'single' && ch === "'") ||
        (state === 'double' && ch === '"') ||
        (state === 'template' && ch === '`')
      ) {
        state = 'code';
      }
      i++;
    }
    return out;
  }

  /** 解析 import 语句，提取跨模块依赖 */
  parseModuleImports(filePath: string): Set<string> {
    const content = this.stripComments(readFileSync(filePath, 'utf-8'));
    const imports = new Set<string>();

    // 匹配 @modules/xxx 形式
    const moduleRegex = /from\s+['"]@modules\/([^'"/]+)/g;
    let match: RegExpExecArray | null;
    while ((match = moduleRegex.exec(content)) !== null) {
      imports.add(match[1]);
    }

    // 匹配相对路径 import，解析目标模块
    const relImportRegex = /from\s+['"](\.[^'"]+)['"]/g;
    while ((match = relImportRegex.exec(content)) !== null) {
      const relPath = match[1];
      // 移除尾部文件名只取目录，保证 resolve 到目录
      const resolved = resolve(dirname(filePath), relPath);
      // 只解析 src 内的相对引用
      if (resolved.startsWith(this.srcPath)) {
        const targetModule = this.resolveModuleName(resolved);
        imports.add(targetModule);
      }
    }

    return imports;
  }

  /**
   * **值导入 / 再导出**目标模块（2026-10-01 R00-001 口径修正，用户裁定「甲」）。
   *
   * 与 `parseModuleImports` 的唯一差别：**排除** `import type … from` 与 `export type … from`
   * 的纯类型语句。依据（两条）：
   *   ① R00-001 的动机是防**运行时**紧耦合/循环（其 JSDoc：防循环依赖 + 模块实例须由 ModuleRegistry
   *      管生命周期）—— `import type` 编译后**完全擦除**，两者都不违反；
   *   ② 同仓 eslint 规则 `app/tools/eslint-plugin-module-registry/rules/no-direct-module-import.js`
   *      已**明确豁免** type-only（原文：「豁免 type-only import：类型导入无运行时依赖，不会导致循环依赖」）
   *      ⇒ 本处仅是对齐两条门禁的口径，**不放宽值导入判据**。
   *
   * 纯 type-only 的跨层引用**不计违规、不计豁免**，但由调用方**单独上报**（保持可见、不做成盲区）。
   */
  parseValueModuleImports(filePath: string): Set<string> {
    const content = this.stripComments(readFileSync(filePath, 'utf-8'));
    const imports = new Set<string>();

    /** 该 `from` 所属语句是否以 `import type` / `export type` 开头 */
    const isTypeStatement = (idx: number): boolean => {
      const upto = content.slice(0, idx);
      const candidates = [
        upto.lastIndexOf('\nimport'),
        upto.lastIndexOf('\nexport'),
      ].filter((n) => n >= 0);
      const start = candidates.length > 0 ? Math.max(...candidates) : 0;
      return /^\s*(import|export)\s+type\b/.test(content.slice(start, idx));
    };

    // 匹配 @modules/xxx 形式
    const moduleRegex = /from\s+['"]@modules\/([^'"/]+)/g;
    let match: RegExpExecArray | null;
    while ((match = moduleRegex.exec(content)) !== null) {
      if (isTypeStatement(match.index)) continue;
      imports.add(match[1]);
    }

    // 匹配相对路径 import，解析目标模块
    const relImportRegex = /from\s+['"](\.[^'"]+)['"]/g;
    while ((match = relImportRegex.exec(content)) !== null) {
      if (isTypeStatement(match.index)) continue;
      const resolved = resolve(dirname(filePath), match[1]);
      if (resolved.startsWith(this.srcPath)) {
        imports.add(this.resolveModuleName(resolved));
      }
    }

    return imports;
  }

  /**
   * R00-003（B 组治理）：解析文件中的**动态 / 延迟导入**目标模块 —— `import('…')` 与 `require('…')`。
   *
   * 为什么需要：`parseModuleImports` 只匹配 `from '…'` 形式 ⇒ 动态 `import('…')` 与 CommonJS
   * `require('…')` **完全不参与** R00-001 / R03-002，模块可借此"把依赖藏起来"（A 类盘点发现，
   * 见 .trae/specs/layer-inversion-a-class-inventory.md §3.6；`require` 盲区见 D-190②）。
   * 本方法只收集目标模块名 + 形态（kind）；**是否倒挂**由调用方用同一套 `allowedDependencies` 判定。
   *
   * 裁定（用户批准 2026-09-30；D-190② 2026-10-04 追加 `require`）：**仅 warning 级上报** ——
   * 不计入 `违规` / `已豁免`，不建 composition-root 白名单，不阻断提交（先"可见"再加严）。
   */
  parseDynamicImports(
    filePath: string
  ): Array<{ module: string; kind: 'import' | 'require' }> {
    // 同 parseModuleImports：剥离注释，避免"注释里复写 import()/require()"造成 R00-003 假阳性（D-190）。
    const content = this.stripComments(readFileSync(filePath, 'utf-8'));
    const seen = new Set<string>();
    const imports: Array<{ module: string; kind: 'import' | 'require' }> = [];

    // 统一按「别名 / 相对路径 / 裸包」分类；裸包（第三方依赖）与其它形式跳过
    const collect = (spec: string, kind: 'import' | 'require'): void => {
      let moduleName: string | null = null;
      const aliasMatch = /^@modules\/([^'"/]+)/.exec(spec);
      if (aliasMatch) {
        moduleName = aliasMatch[1];
      } else if (spec.startsWith('.')) {
        const resolved = resolve(dirname(filePath), spec);
        if (resolved.startsWith(this.srcPath)) {
          moduleName = this.resolveModuleName(resolved);
        }
      }
      if (!moduleName) return;
      const key = `${kind}:${moduleName}`;
      if (seen.has(key)) return;
      seen.add(key);
      imports.push({ module: moduleName, kind });
    };

    // 统一捕获 import('…') 与 require('…') 的说明符（D-190②）
    const dynRegex = /\b(import|require)\(\s*['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = dynRegex.exec(content)) !== null) {
      collect(match[2], match[1] as 'import' | 'require');
    }

    return imports;
  }

  /** R00-001: 检查分层合规 */
  async checkLayerCompliance(): Promise<void> {
    await this.loadLayerMapping();
    if (this.moduleToLayer.size === 0) return;

    await this.loadLayerExceptions();

    console.log('\n运行分层合规检查 (R00-001)...');
    let checked = 0;
    let violationCount = 0;
    let exemptedCount = 0;
    /**
     * R00-002（2026-09-28，D-3「防盲区复发」）：**未在分层映射中的顶层目录**。
     *
     * 此前 `if (!srcLayer) continue;` 是**静默**跳过 ⇒ 实测 `app/src` 有 **19 个顶层目录**
     * （含整个 `infrastructure/` HTTP 层与 `runtime/`）**从未参与分层检查**，而门禁仍报"违规 0"。
     * 改为**显式登记并报 warning**（不阻断提交）⇒ 盲区一旦新增/存续即被看见。
     * 消除方式：在 `scripts/modules-to-layers.json` 的 `modules` 里补齐该目录的层归属。
     */
    const unmappedModules = new Set<string>();

    /**
     * R00-003（B 组治理）：**动态 `import('…')` 造成的跨层引用**。
     *
     * 裁定（用户批准 2026-09-30）：**仅 warning 级上报** —— 不计入 R00-001 的 `违规`/`已豁免`，
     * 不建 composition-root 白名单、不阻断提交；目的是让"把依赖藏起来"的盲区**可见**。
     * 详见 .trae/specs/layer-inversion-a-class-inventory.md §3.6。
     */
    const dynamicCrossLayerRefs: Array<{
      file: string;
      srcModule: string;
      srcLayer: string;
      tgtModule: string;
      tgtLayer: string;
      /** `import('…')` 或 `require('…')`（D-190② 2026-10-04 追加 require 可见化） */
      kind: 'import' | 'require';
    }> = [];

    /**
     * R00-001 口径修正（2026-10-01，用户裁定「甲」）：**纯 type-only** 的跨层引用。
     *
     * 与 `dynamicCrossLayerRefs` 同定位 —— **仅上报、不计违规/已豁免**。目的：把"不构成运行时倒挂"
     * 的类型引用从账上摘掉（与同仓 eslint 规则 type-only 豁免同口径，见 `parseValueModuleImports`），
     * 同时**保持可见**（不使其成为检查盲区）。
     */
    const typeOnlyCrossLayerRefs: Array<{
      file: string;
      srcModule: string;
      srcLayer: string;
      tgtModule: string;
      tgtLayer: string;
    }> = [];

    for (const file of this.allFiles) {
      // 2026-10-01 口径统一（用户裁定）：测试文件与 R03-002 **同口径跳过** ——
      // R00-001（分层）与 R00-003（动态跨层）此前不跳，导致同一门禁内口径不一致
      // （实证：`runtime/api/__tests__/CoreAPIImpl.chatStream.test.ts` 曾被计入 `runtime -> chat`）。
      // 口径依据见 `TEST_FILE_EXCLUSIONS` 的 JSDoc。
      if (TEST_FILE_EXCLUSIONS.some((e) => file.includes(e))) continue;

      const srcModule = this.resolveModuleName(file);
      const srcLayer = this.moduleToLayer.get(srcModule);
      if (!srcLayer) {
        unmappedModules.add(srcModule);
        continue;
      }

      const allowedLayers = this.allowedDeps[srcLayer] || [];
      const targetModules = this.parseModuleImports(file);
      // 2026-10-01 R00-001 口径修正（用户裁定「甲」）：**值导入/再导出**目标模块集合。
      // 不在其中的目标模块 ⇒ 该 (file × module) 对为**纯 type-only** ⇒ 不计违规、不计豁免（仅上报）。
      const valueTargetModules = this.parseValueModuleImports(file);

      for (const tgtModule of targetModules) {
        if (tgtModule === srcModule) continue;
        const tgtLayer = this.moduleToLayer.get(tgtModule);
        if (!tgtLayer) continue;
        if (allowedLayers.includes(tgtLayer)) continue;

        // 纯 type-only ⇒ 不构成**运行时**跨层倒挂 ⇒ 从账上摘掉（仅上报，见上方声明）
        if (!valueTargetModules.has(tgtModule)) {
          typeOnlyCrossLayerRefs.push({
            file: relative(this.srcPath, file),
            srcModule,
            srcLayer,
            tgtModule,
            tgtLayer,
          });
          continue;
        }

        // 检查是否被例外豁免
        if (this.isException('R00-001', srcModule, tgtModule)) {
          exemptedCount++;
          continue;
        }

        // 真正的跨层违规
        this.violations.push({
          ruleId: 'R00-001',
          severity: 'warning',
          file: relative(process.cwd(), file),
          message: `分层违规: ${srcModule} (${srcLayer}) → ${tgtModule} (${tgtLayer})`,
          suggestion: `[${srcLayer}] 允许依赖: ${allowedLayers.join(', ')}，但当前依赖了 [${tgtLayer}] 的 ${tgtModule}`,
        });
        violationCount++;
      }

      // R00-003：动态 / 延迟导入（import() / require()）的跨层引用（仅收集，不计数）
      for (const dyn of this.parseDynamicImports(file)) {
        if (dyn.module === srcModule) continue;
        const dynLayer = this.moduleToLayer.get(dyn.module);
        if (!dynLayer) continue;
        if (allowedLayers.includes(dynLayer)) continue;
        dynamicCrossLayerRefs.push({
          file: relative(process.cwd(), file),
          srcModule,
          srcLayer,
          tgtModule: dyn.module,
          tgtLayer: dynLayer,
          kind: dyn.kind,
        });
      }
      checked++;
    }
    console.log(
      `分层检查完成: 检查 ${checked} 个文件 | 违规 ${violationCount} | 已豁免 ${exemptedCount}${
        unmappedModules.size > 0
          ? ` | 未映射目录 ${unmappedModules.size} 个`
          : ''
      }${
        typeOnlyCrossLayerRefs.length > 0
          ? ` | type-only 跨层引用 ${typeOnlyCrossLayerRefs.length} 处（R00-001 口径修正，仅上报）`
          : ''
      }${
        dynamicCrossLayerRefs.length > 0
          ? ` | 动态跨层引用 ${dynamicCrossLayerRefs.length} 处（R00-003，仅上报）`
          : ''
      }`
    );

    // R00-002：未映射目录（其文件**不参与**分层检查）—— warning 级、不阻断提交
    if (unmappedModules.size > 0) {
      const list = [...unmappedModules].sort();
      this.violations.push({
        ruleId: 'R00-002',
        severity: 'warning',
        file: 'scripts/modules-to-layers.json',
        message: `${list.length} 个顶层目录未登记分层映射 ⇒ 其文件**不参与**分层检查（门禁盲区）：${list.join(', ')}`,
        suggestion:
          '在 scripts/modules-to-layers.json 的 modules 中为每个目录补 { "layer": ... }（按职责选 entry/ui/app/service/infra/core），补齐后本条自动消失',
      });
    }

    // R00-003（B 组治理）：动态 import 的跨层引用 —— **仅 warning 级上报**
    // 裁定（用户批准 2026-09-30）：不计入 R00-001 的 违规/已豁免，不建白名单、不阻断提交。
    // 目的：让"把依赖藏起来"的盲区**可见**（详见 spec §3.6）。
    if (dynamicCrossLayerRefs.length > 0) {
      // 输出形态（2026-09-30 用户选定）：**按（源模块 → 目标模块）聚合** ——
      // 保留完整覆盖（无 top-N 截断），又不逐条刷屏；每组附一个示例文件以保持可下手性。
      const grouped = new Map<string, { count: number; sample: string }>();
      for (const r of dynamicCrossLayerRefs) {
        const key = `${r.srcModule} (${r.srcLayer}) → ${r.tgtModule} (${r.tgtLayer})`;
        const cur = grouped.get(key);
        if (cur) {
          cur.count++;
        } else {
          grouped.set(key, { count: 1, sample: r.file });
        }
      }
      const list = [...grouped.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .map(([key, v]) => `    - ${key} × ${v.count}（如 ${v.sample}）`)
        .join('\n');
      const requireRefs = dynamicCrossLayerRefs.filter(
        (r) => r.kind === 'require'
      ).length;
      this.violations.push({
        ruleId: 'R00-003',
        severity: 'warning',
        file: 'app/src (全局)',
        message: `存在 ${dynamicCrossLayerRefs.length} 处**动态 / 延迟导入**（import('…') / require('…')）造成的跨层引用${
          requireRefs > 0 ? `（其中 require('…') 形式 ${requireRefs} 处）` : ''
        }，覆盖 ${grouped.size} 个「源模块 → 目标模块」组合 —— 门禁 R00-001/R03-002 的 from 正则匹配不到（盲区）；本规则仅上报，不计入违规/已豁免`,
        suggestion: `下列依赖**真实存在**但静态正则看不见。治理口径（2026-09-30 用户裁定；2026-10-04 D-190② 追加 require 可见化）为**仅 warning 级上报**：不建白名单、不改判定。\n**按（源模块 → 目标模块）聚合（合计 ${dynamicCrossLayerRefs.length} 处）**：\n${list}`,
      });
    }
  }

  // ============ P1 新增检查（AR/GR 规则） ============

  /** R06-009-1: 检查文件行数下限（碎片归集） */
  async checkFileSizeLower(): Promise<void> {
    // 2026-08-29 治理：100 行下限对小文件文化是无效启发式（单函数/单常量/单组件均合理），
    // 1) 下限调至 40 行，仅报"真·极小文件"
    // 2) 目录级碎片检测：同目录微文件 <3 个 → 非碎片（孤立/少量小文件合理），不报
    const MIN_LINES = 40;
    // 排除模式：类型定义、barrel、测试、.d.ts、配置文件
    const excludePatterns = [
      /[\\/]types\.ts$/,
      /[\\/]index\.ts$/,
      /[\\/]constants\.ts$/,
      /\.d\.ts$/,
      /\.test\.ts$/,
      /\.test\.tsx$/,
      /[\\/]__tests__[\\/]/,
      /[\\/]__mocks__[\\/]/,
      /[\\/]config-schema\.ts$/,
      /[\\/]schemas\.ts$/,
      // 排除已知合理的微文件
      /[\\/]commands[\\/]builtin[\\/]/, // 命令声明待 P2 归集
      /[\\/]channels[\\/].*[\\/]config-schema\.ts$/,
      // 协议库（acp）与类型中心目录：模块化/类型独立成文件，非碎片
      /[\\/]acp[\\/]/,
      /[\\/]types[\\/]/,
    ];

    let checked = 0;
    const candidates: Array<{ relPath: string; lines: number; dir: string }> =
      [];
    for (const file of this.allFiles) {
      const relPath = relative(process.cwd(), file);
      if (excludePatterns.some((p) => p.test(relPath))) continue;

      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n').length;

      // 豁免（2026-08-29）：100 行下限对单一职责小文件是无效启发式
      // 1) re-export 桶/兼容层（export * from / export { } from）→ 合法
      const hasReexport =
        /export\s*\{[\s\S]*?\}\s*from|export\s*\*\s*from/.test(content);
      const hasDefault = /export\s+default/.test(content);
      // 值导出（function/const/class）计数——单值导出 = 单一职责，内聚非碎片
      const valueExports = (
        content.match(
          /export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g
        ) || []
      ).length;
      if (hasReexport) continue;
      if (valueExports === 1) continue;
      if (hasDefault && valueExports <= 1) continue;
      // 2) 常量目录（按主题分文件合理，如 constants/keys.ts）
      if (/[\\/]constants[\\/]/.test(relPath)) continue;
      // 2.1) 通道目录（架构要求每通道独立实现文件）与 ink UI 库（自研组件库一组件一文件）
      if (/[\\/]channels[\\/]/.test(relPath) || /[\\/]ink[\\/]/.test(relPath))
        continue;
      // 3) 组件/prompt/UI 文件（.tsx 一文件一组件；prompt.ts 提示词模板）
      if (/\.tsx$/.test(relPath) || /[\\/]prompt\.ts$/.test(relPath)) continue;

      if (lines < MIN_LINES) {
        candidates.push({ relPath, lines, dir: dirname(relPath) });
      }
      checked++;
    }

    // 目录级过滤：同目录微文件 <3 个 → 非碎片（孤立/少量小文件合理）
    const dirCount = new Map<string, number>();
    for (const c of candidates)
      dirCount.set(c.dir, (dirCount.get(c.dir) ?? 0) + 1);

    let fragmentCount = 0;
    for (const c of candidates) {
      if ((dirCount.get(c.dir) ?? 0) < 3) continue;
      this.violations.push({
        ruleId: 'R06-009-1',
        severity: 'warning',
        file: c.relPath,
        message: `文件仅 ${c.lines} 行，低于 ${MIN_LINES} 行下限，建议合并到相关文件（同目录 ${dirCount.get(c.dir)} 个微文件）`,
        suggestion:
          '检查是否可以合并到同领域的大文件，或与其他小文件聚合为数据驱动模块',
      });
      fragmentCount++;
    }
    console.log(
      `文件下限检查完成: 检查 ${checked} 个文件 | 碎片 ${fragmentCount}`
    );
  }

  /** R06-006-2: 检查僵尸薄转发方法 */
  async checkZombieForward(): Promise<void> {
    let zombieCount = 0;

    for (const file of this.allFiles) {
      const content = readFileSync(file, 'utf-8');
      const relPath = relative(process.cwd(), file);
      const lines = content.split('\n');

      // 收集本文件 import 的符号名（import { x, y } / import x），
      // 用于排除 "return 外部函数(...)" 的正常实现（非薄转发）
      const importedNames = new Set<string>();
      for (const im of content.matchAll(
        /import\s+(?:type\s+)?\{([^}]+)\}\s+from/g
      )) {
        for (const part of im[1].split(',')) {
          const raw = part.trim();
          if (!raw) continue;
          // 取本文件实际使用的名字（import { x as y } → y）
          importedNames.add(
            raw.includes(' as ') ? raw.split(/\s+as\s+/)[1].trim() : raw
          );
        }
      }
      for (const im of content.matchAll(
        /import\s+(?:type\s+)?(\w+)\s+from\s/g
      )) {
        if (im[1] && im[1] !== 'type') importedNames.add(im[1]);
      }

      // 收集本文件顶层 export 的函数/const（return 转发到它们是公开 API 包装，非薄转发）
      const localExports = new Set<string>();
      for (const ex of content.matchAll(
        /export\s+(?:async\s+)?function\s+(\w+)/g
      ))
        localExports.add(ex[1]);
      for (const ex of content.matchAll(/export\s+const\s+(\w+)\s*=/g))
        localExports.add(ex[1]);

      // 查找方法签名，然后检查方法体是否只有一行 return
      // 匹配: private/public/protected/async methodName(...) ... {
      const methodRegex =
        /(?:private|public|protected|async|\s)+(?:static\s+)?(\w+)\s*\([^)]*\)[^{]*\{/g;
      let match;
      // 使用 while 循环检查每个匹配
      const contentCopy = content;
      const methodRegexGlobal = new RegExp(methodRegex.source, 'g');
      while ((match = methodRegexGlobal.exec(contentCopy)) !== null) {
        const methodName = match[1];
        // 过滤保留字，排除 if/for/while 等控制流语句被误判为方法
        if (RESERVED_WORDS.has(methodName)) continue;

        // 方法名是 import 符号且本文件无同名定义（export）→ import 绑定被误当方法
        if (importedNames.has(methodName) && !localExports.has(methodName))
          continue;
        // 顶层 export 函数/const（公开 API，可能被其他模块引用）→ 非薄转发
        if (localExports.has(methodName)) continue;
        // 编译产物（含 $[N] = 临时变量，如 Babel/SWC 输出）→ 跳过整文件
        if (/\$\[\d+\]\s*=/.test(content)) continue;

        // R06-006-2 误报修复（2026-08-29）：区分真实方法声明 vs 调用/参数/赋值/getter
        // 1) 匹配位置所在行为注释 → 跳过
        const lineStart = contentCopy.lastIndexOf('\n', match.index - 1) + 1;
        const linePrefix = contentCopy
          .slice(lineStart, match.index)
          .trimStart();
        if (
          linePrefix.startsWith('//') ||
          linePrefix.startsWith('*') ||
          linePrefix.startsWith('/*')
        )
          continue;
        // 2) 前一个单词为 return/const/get/set/new 等 → 非方法声明（调用/赋值/getter）
        const prefixText = contentCopy.slice(0, match.index);
        const prevWord = (prefixText.match(/([A-Za-z_$][\w$]*)\s*$/) || [])[1];
        const callPrefixWords = new Set([
          'return',
          'const',
          'let',
          'var',
          'await',
          'typeof',
          'new',
          'delete',
          'void',
          'throw',
          'get',
          'set',
          'if',
          'else',
          'for',
          'while',
          'do',
          'switch',
          'case',
          'catch',
          'finally',
          'yield',
          'in',
          'of',
        ]);
        if (prevWord && callPrefixWords.has(prevWord)) continue;
        // 3) 前一个非空白字符为 = ( , ! ? : ; 等 → 调用/参数/赋值
        const prevChar = prefixText.trimEnd().slice(-1);
        if (
          [
            '=',
            '(',
            ',',
            '!',
            '?',
            ':',
            ';',
            '&',
            '|',
            '+',
            '-',
            '*',
            '/',
            '%',
            '<',
            '>',
            '[',
            ']',
          ].includes(prevChar)
        )
          continue;

        // 方法在本文件内被调用（出现 ≥2 次：定义 1 + 调用 ≥1）→ 活跃，非僵尸薄转发
        const nameOccurrences = (
          content.match(new RegExp(`\\b${methodName}\\s*\\(`, 'g')) || []
        ).length;
        if (nameOccurrences > 1) continue;
        const bodyStart = match.index + match[0].length;
        const bodyMatch = contentCopy.slice(bodyStart);

        // 找到匹配的 }
        let depth = 1;
        let bodyEnd = 0;
        for (let i = 0; i < bodyMatch.length && depth > 0; i++) {
          if (bodyMatch[i] === '{') depth++;
          else if (bodyMatch[i] === '}') {
            depth--;
            if (depth === 0) bodyEnd = i;
          }
        }
        if (bodyEnd === 0) continue;

        const body = bodyMatch.slice(0, bodyEnd).trim();
        const bodyLines = body.split('\n').filter((l) => l.trim() !== '');

        // 僵尸方法：方法体仅一行 return xxx() 且无其他逻辑
        if (bodyLines.length === 1) {
          const singleLine = bodyLines[0].trim();
          const retTarget = /^return\s+(\w+)\(/.exec(singleLine);
          if (
            retTarget &&
            !singleLine.includes('if') &&
            !singleLine.includes('try') &&
            !singleLine.includes('await')
          ) {
            // 排除合理的一行方法：
            // 1) return 目标是本文件 import 的符号（外部库/其他模块函数，属正常实现而非薄转发）
            if (importedNames.has(retTarget[1])) continue;
            // 2) return 目标是本文件顶层 export 的符号（公开 API 内部复用，如 semver gt→compare）
            if (localExports.has(retTarget[1])) continue;
            // 3) 其余保留为疑似薄转发
            const fullLine = lines[lines.length - 1]; // 近似行号
            this.violations.push({
              ruleId: 'R06-006-2',
              severity: 'warning',
              file: relPath,
              message: `方法 "${methodName}" 疑似僵尸薄转发（仅一行 return 调用）`,
              suggestion:
                '确认调用方是否已全部迁移，若已迁移则删除此方法。禁止新增此类方法',
            });
            zombieCount++;
          }
        }
      }
    }
    console.log(`僵尸转发检查完成: 疑似僵尸方法 ${zombieCount}`);
  }

  /** R06-010: 检查桶文件超限 */
  async checkBarrelOverflow(): Promise<void> {
    const MAX_BARREL_EXPORTS = 20;
    const MODULE_ROOTS = [
      'chat',
      'core',
      'ai',
      'permission',
      'tools',
      'channels',
      'infrastructure',
      'modules',
      'services',
      'query',
      'session',
      'memory',
      'agent',
      'dream',
      'bridge',
      'mcp',
      'skills',
      'plugins',
      'notebook',
    ];

    let barrelCount = 0;
    let overflowCount = 0;

    for (const file of this.allFiles) {
      const relPath = relative(process.cwd(), file);
      const baseName = relPath.split(/[\\/]/).pop() || '';

      // 只检查 index.ts
      if (baseName !== 'index.ts') continue;

      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim() !== '');

      // 判断是否为纯 barrel 文件（仅含 export/re-export）
      const nonExportLines = lines.filter((l) => {
        const trimmed = l.trim();
        return (
          trimmed !== '' &&
          !trimmed.startsWith('//') &&
          !trimmed.startsWith('/*') &&
          !trimmed.startsWith('*') &&
          !trimmed.startsWith('export') &&
          !trimmed.startsWith('}')
        );
      });

      // 如果有非 export 的代码，不是纯 barrel
      if (nonExportLines.length > 0) continue;

      const exportCount = lines.filter((l) =>
        l.trim().startsWith('export')
      ).length;

      if (exportCount > MAX_BARREL_EXPORTS) {
        // R06-010 豁免：已登记 barrelExceptions 的 barrel 不报
        if (this.isBarrelExempt(relPath)) continue;
        this.violations.push({
          ruleId: 'R06-010',
          severity: 'warning',
          file: relPath,
          message: `Barrel 文件包含 ${exportCount} 个 export，超过 ${MAX_BARREL_EXPORTS} 上限`,
          suggestion: '考虑拆分为按子域分组的 barrel 文件，或减少非必要暴露',
        });
        overflowCount++;
      }
      barrelCount++;
    }
    console.log(
      `桶文件检查完成: ${barrelCount} 个 barrel | 超限 ${overflowCount}`
    );
  }

  /** R06-009-2: 检查已知重复实现 */
  async checkDuplicateImplement(): Promise<void> {
    // 已知重复实现对（来自架构暴胀分析）。
    // 2026-08-09 处置记录：
    // - session-identifiers ↔ session-identity：已归集合并（session-identifiers.ts 已删除）
    // - audioNormalizer ↔ audioFormatConverter：ffmpeg 探测已去重（复用 isFFmpegAvailable）
    // - audioUtils ↔ audioLevelMeter：确认为误报（/32768 为 PCM16 标准归一化，职责不同）
    // 全部处置完毕，保留空列表作为防复发机制。新增重复实现对时在此登记。
    const knownDuplicates: Array<{ files: string[]; description: string }> = [];

    let foundCount = 0;
    for (const dup of knownDuplicates) {
      const found: string[] = [];
      for (const file of this.allFiles) {
        const baseName = file.split(/[\\/]/).pop() || '';
        if (dup.files.includes(baseName)) {
          found.push(relative(process.cwd(), file));
        }
      }
      if (found.length >= 2) {
        for (const f of found) {
          this.violations.push({
            ruleId: 'R06-009-2',
            severity: 'warning',
            file: f,
            message: `已知重复实现: ${dup.description}`,
            suggestion: `合并到单一实现，删除重复文件。关联文件: ${found.join(', ')}`,
          });
        }
        foundCount++;
      }
    }
    console.log(`重复实现检查完成: ${foundCount} 组已知重复`);
  }

  /** R06-009-2: 检查 commands/builtin 微文件碎片 */
  async checkCommandFragments(): Promise<void> {
    const commandsDir = join(this.srcPath, 'commands', 'builtin');
    if (!existsSync(commandsDir)) {
      console.log('命令碎片检查: commands/builtin 目录不存在，跳过');
      return;
    }

    const entries = readdirSyncFull(commandsDir);
    let microFileCount = 0;
    let totalFiles = 0;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const indexPath = join(commandsDir, entry.name, 'index.ts');
      if (!existsSync(indexPath)) continue;

      const content = readFileSync(indexPath, 'utf-8');
      const lines = content.split('\n').length;

      totalFiles++;
      if (lines < 50) {
        microFileCount++;
      }
    }

    if (microFileCount > 50) {
      this.violations.push({
        ruleId: 'R06-009-2',
        severity: 'warning',
        file: `commands/builtin/`,
        message: `commands/builtin 下 ${microFileCount}/${totalFiles} 个命令声明文件 < 50 行，存在碎片化`,
        suggestion: `建议归集为 1 个 command-registry.ts 数据表（${microFileCount} 个命令声明 → 1 个数据驱动文件），删除 license 头重复`,
      });
    }
    console.log(
      `命令碎片检查完成: ${totalFiles} 个命令 | 微文件 ${microFileCount}`
    );
  }

  /** R07-003: 检查薄桶（re-export ≤2 符号的 index.ts，碎片归集防回潮） */
  async checkThinBarrels(): Promise<void> {
    // 与 checkBarrelFiles 一致的模块入口豁免（模块公共 API 边界）
    const allowedModuleDirs = [
      'src\\agent\\',
      'src\\ai\\',
      'src\\bridge\\',
      'src\\channels\\',
      'src\\cli\\',
      'src\\commands\\',
      'src\\common\\',
      'src\\components\\',
      'src\\config\\',
      'src\\constants\\',
      'src\\context\\',
      'src\\core\\',
      'src\\diagnostics\\',
      'src\\error\\',
      'src\\hooks\\',
      'src\\infrastructure\\',
      'src\\ink\\',
      'src\\knowledge\\',
      'src\\media\\',
      'src\\memory\\',
      'src\\monitoring\\',
      'src\\oauth\\',
      'src\\plugin-sdk\\',
      'src\\plugins\\',
      'src\\promptSuggestion\\',
      'src\\sandbox\\',
      'src\\services\\',
      'src\\session\\',
      'src\\skills\\',
      'src\\state\\',
      'src\\tasks\\',
      'src\\testing\\',
      'src\\tools\\',
      'src\\tokenBudget\\',
      'src\\trace-recording\\',
      'src\\ui\\',
      'src\\utils\\',
    ];
    const MAX_REEXPORT_SYMBOLS = 2;

    let thinCount = 0;
    const thinFiles: string[] = [];
    for (const file of this.allFiles) {
      const basename = file.split(/[/\\]/).pop() || '';
      if (basename !== 'index.ts' && basename !== 'index.tsx') continue;
      // KB-LINT-RELPATH（2026-08-29）：relFile 归一化为 src 相对路径（同 checkBarrelFiles）——
      // 仓库根运行时避免 'app\\' 前缀导致模块入口豁免失效
      const rawRel = relative(process.cwd(), file);
      const srcIdx = rawRel.indexOf('src\\');
      const relFile = srcIdx >= 0 ? rawRel.slice(srcIdx) : rawRel;
      if (allowedModuleDirs.some((dir) => relFile.startsWith(dir))) continue;

      const content = readFileSync(file, 'utf-8');
      // 纯 re-export 桶判定（与 checkBarrelFiles 相同逻辑）
      const lines = content
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      const nonReExportLines = lines.filter((l) => {
        const t = l.replace(/\/\/.*$/, '').trim();
        if (t.length === 0) return false;
        if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*'))
          return false;
        if (/^export\s+(type\s+)?\{\s*\}/.test(t)) return false;
        if (/^export\s+(type\s+)?\*?\s*\{.*\}\s*from\s/.test(t)) return false;
        if (/^export\s+\*\s+from\s/.test(t)) return false;
        return true;
      });
      if (nonReExportLines.length > 0) continue;
      // star 聚合（export * from）无法数符号，视为合法模块聚合跳过（R07-003 仅针对 named ≤2 薄桶）
      if (/export\s*\*\s*from/.test(content)) continue;

      // 统计 named re-export 符号数（star 无法数符号，视为合法聚合跳过）
      let symbolCount = 0;
      for (const m of content.matchAll(
        /export\s+(?:type\s+)?\{([^}]*)\}\s*from/g
      )) {
        symbolCount += m[1]
          .split(',')
          .filter((s) => s.trim().length > 0).length;
      }
      if (symbolCount > MAX_REEXPORT_SYMBOLS) continue;

      thinCount++;
      thinFiles.push(relFile);
    }

    if (thinCount > 0) {
      this.violations.push({
        ruleId: 'R07-003',
        severity: 'warning',
        file: thinFiles[0],
        message: `存在 ${thinCount} 个薄桶（re-export ≤${MAX_REEXPORT_SYMBOLS} 符号）`,
        suggestion: `薄桶应按 R07-003 删除并将引用改指实现文件\n  受影响文件:\n${thinFiles
          .slice(0, 10)
          .map((f) => `    - ${f}`)
          .join(
            '\n'
          )}${thinFiles.length > 10 ? `\n    ... 及其他 ${thinFiles.length - 10} 个` : ''}`,
      });
    }
    console.log(
      `\n[薄桶检查 R07-003] 发现 ${thinCount} 个薄桶（re-export ≤${MAX_REEXPORT_SYMBOLS} 符号）`
    );
  }

  /** R07-001: 检查 <10 行的微小源码文件（碎片化防回潮） */
  async checkTinyFiles(): Promise<void> {
    const MIN_LINES = 10;
    const excludePatterns = [
      /\.d\.ts$/,
      /\.test\.ts$/,
      /\.test\.tsx$/,
      /[\\/]__tests__[\\/]/,
      /[\\/]__mocks__[\\/]/,
      /[\\/]index\.ts$/, // barrel 由 R07-003 单独治理
      /[\\/]ink[\\/]/, // ink 为本地化第三方库，保持库内文件结构
    ];
    // 纯 re-export 桶豁免：内容全部为 `export ... from '...'` 的文件交由 R07-003 治理
    const reExportRe = /^export\s+(?:type\s+|default\s+)?[^;]*\s+from\s+['"]/;

    let tinyCount = 0;
    const tinyFiles: string[] = [];
    for (const file of this.allFiles) {
      const relPath = relative(process.cwd(), file);
      if (excludePatterns.some((p) => p.test(relPath))) continue;
      if (this.isTinyFileExempt(relPath)) continue;
      const content = readFileSync(file, 'utf-8');
      const codeLines = content
        .split('\n')
        .map((l) => l.trim())
        .filter(
          (l) =>
            l &&
            !l.startsWith('//') &&
            !l.startsWith('/*') &&
            !l.startsWith('*') &&
            !l.startsWith('//#')
        );
      if (codeLines.length > 0 && codeLines.every((l) => reExportRe.test(l)))
        continue;
      const lines = content.split('\n').length;
      if (lines < MIN_LINES) {
        tinyCount++;
        tinyFiles.push(relPath);
      }
    }

    if (tinyCount > 0) {
      this.violations.push({
        ruleId: 'R07-001',
        severity: 'warning',
        file: tinyFiles[0],
        message: `存在 ${tinyCount} 个 <${MIN_LINES} 行微小源码文件`,
        suggestion: `微小文件应按 R07-001 归并到同域模块\n  受影响文件:\n${tinyFiles
          .slice(0, 10)
          .map((f) => `    - ${f}`)
          .join(
            '\n'
          )}${tinyFiles.length > 10 ? `\n    ... 及其他 ${tinyFiles.length - 10} 个` : ''}`,
      });
    }
    console.log(
      `[微小文件检查 R07-001] 发现 ${tinyCount} 个 <${MIN_LINES} 行文件`
    );
  }

  /**
   * R07-004: 检查仓库工作区内是否残留**参考副本**目录（`REF/` 等）。
   *
   * 依据（2026-09-28 实测）：`REF/` 含 **82,168 文件 / 2,659 MB**，`git ls-files REF` = **0**
   * （`.gitignore` 已有 `REF/*`）。它本身不入库，但**会污染人工统计口径** —— 当时把其中
   * 5,159 个 `.rs` 当成 Liri 自身代码（真值 **21** 个），得出完全相反的结论
   * （"Rust 193 万行" vs 真实 3,919 行）。对应架构原则「**单一事实源**」：参考副本不是本仓事实。
   *
   * 等级 **warning（不阻断提交）**：物理搬迁需用户择机执行（目录可能被 IDE/索引器占用，
   * `rename` 会被拒），处置与口径约定见 `dev_docs/20260928/liri-upgrade-plan-20260928.md` §1。
   */
  async checkWorkspaceHygiene(): Promise<void> {
    const repoRoot = resolve(__dirname, '..');
    const referenceDirs = ['REF', 'codex-main'];
    const found: string[] = [];
    for (const name of referenceDirs) {
      if (existsSync(resolve(repoRoot, name))) found.push(name);
    }

    if (found.length > 0) {
      this.violations.push({
        ruleId: 'R07-004',
        severity: 'warning',
        file: found[0],
        message: `仓库工作区存在参考副本目录：${found.join('、')}（未入库，但会污染统计口径）`,
        suggestion:
          '按「单一事实源」把参考副本移出仓库（同卷 Directory.Move 即秒级完成）；搬迁前任何人工统计/脚本必须排除这些目录，见 dev_docs/20260928/liri-upgrade-plan-20260928.md §1',
      });
    }

    console.log(
      `[工作区参考副本检查 R07-004] 发现 ${found.length} 个参考副本目录${
        found.length > 0 ? `：${found.join('、')}` : ''
      }`
    );
  }

  /**
   * R15-001: 检查「**零消费者的 `*OutputSchema` 定义**」—— 工具出参契约不得"只定义、不接线"。
   *
   * 依据（2026-09-29 T6 核查）：`app/src/tools/<各工具>/schemas.ts` 曾定义 **45 个** `*OutputSchema`，
   * 其中 **44 个零消费者** —— 既未接线到 `Tool.outputSchema`，也**全仓无任何 import**。
   * 它们是"看着像出口契约、实则无人消费"的**死代码**，正是 T4 那类"错层误接"的来源
   * （接错会每次调用误报）。同批处置结论：**21 接线 / 23 删除 / 1 转另案**，
   * 见 `.trae/specs/tool-output-schema-layer-audit.md`（T6 分类结果 / 收口结论）。
   *
   * 判据：`export const <X>OutputSchema` 若**全仓出现次数 === 1**（即只剩定义那一行）
   * ⇒ **warning**（提示"要么接线、要么删除"）。**不阻断提交**。
   *
   * ⚠️ **已知局限（如实）**：① **同名重复定义会互相掩盖** —— 判据按"全仓总出现次数"计、**不做符号解析**，
   * 故同名多份定义会互相"供血"。**真实案例**：`TaskStopOutputSchema` 曾同时定义在 `TaskTool/` 与
   * `TaskStopTool/`，后者即便孤立也抓不到（该孤儿侧已于 2026-09-29 按台账 D-9 删除 ⇒ **案例消失，风险仍在**）；
   * ② 注释/文档字符串里的同名言及、③ `import` 而未被使用，都会被计为引用 ⇒ 只会**漏报**，**不会误报**
   * （③ 另由 eslint / tsc 的未使用变量规则兜住）。
   */
  async checkOrphanOutputSchemas(): Promise<void> {
    const repoRoot = resolve(__dirname, '..');
    const appSrc = resolve(repoRoot, 'app', 'src');
    const DEF_RE = /export\s+const\s+([A-Za-z_$][\w$]*OutputSchema)\b/;
    const USAGE_RE = /\b[A-Za-z_$][\w$]*OutputSchema\b/g;

    // 第 1 遍：收集定义（只记名字与文件，不驻留全文，避免大内存）
    const files = collectTsFiles(appSrc);
    const defs: Array<{ name: string; file: string }> = [];
    for (const file of files) {
      let text: string;
      try {
        text = readFileSync(file, 'utf-8');
      } catch {
        continue;
      }
      for (const line of text.split(/\r?\n/)) {
        const m = DEF_RE.exec(line);
        if (m) defs.push({ name: m[1], file });
      }
    }
    if (defs.length === 0) {
      console.log(
        '[出参 schema 消费者检查 R15-001] 未发现任何 *OutputSchema 定义'
      );
      return;
    }

    // 第 2 遍：统计全仓出现次数（含定义行本身；注释中的言及也会被计入 ⇒ 只会漏报）
    const defNames = new Set(defs.map((d) => d.name));
    const occurrences = new Map<string, number>();
    for (const file of files) {
      let text: string;
      try {
        text = readFileSync(file, 'utf-8');
      } catch {
        continue;
      }
      for (const m of text.matchAll(USAGE_RE)) {
        if (!defNames.has(m[0])) continue;
        occurrences.set(m[0], (occurrences.get(m[0]) ?? 0) + 1);
      }
    }

    const orphans = defs.filter((d) => (occurrences.get(d.name) ?? 0) <= 1);

    for (const o of orphans) {
      this.violations.push({
        ruleId: 'R15-001',
        severity: 'warning',
        file: relative(repoRoot, o.file).replace(/\\/g, '/'),
        message: `零消费者的出参 schema 定义：${o.name}（既未接线到 Tool.outputSchema，也无任何引用）`,
        suggestion:
          '要么把它接到对应工具的 outputSchema（须先实测出口载荷与其相符），要么删除；判据与方法见 .trae/specs/tool-output-schema-layer-audit.md（T6 分类结果 / 收口结论）',
      });
    }

    console.log(
      `[出参 schema 消费者检查 R15-001] 定义 ${defs.length} 个，零消费者 ${orphans.length} 个${
        orphans.length > 0 ? `：${orphans.map((o) => o.name).join('、')}` : ''
      }`
    );
  }

  /**
   * R15-002: 检查「**零 importer 的工具 schemas 模块**」—— `tools/<X>/schemas.ts` 不得成为死文件。
   *
   * 依据（2026-09-29 D-7 核查）：`app/src/tools/<各工具>/schemas.ts` 曾共 **41 个**，其中 **20 个零 importer**
   * （**整文件死亡**：其 `*InputSchema` / `validateXxxInput` / `logger` 全无人消费，且**已实测与实现漂移** ——
   * 如 `sleep` 写 `milliseconds` 而工具读 `durationMs`、`cron_create` 的 `cron` vs 实读 `expression`）⇒ 已全部删除；
   * 现仓内 **21 个均有 importer**（恰等于 T6 接线的 21 个出参契约）。
   *
   * 判据：把 import/require 说明符**真实解析**到该文件路径（支持 `./schemas`、`./schemas.js`、
   * `../<X>/schemas` 与 `@modules/tools/<X>/schemas`）—— 若无任何解析结果指向它 ⇒ **warning**。
   *
   * ⚠️ **局限（如实）**：仅解析**静态**说明符；动态拼出的路径无法识别 ⇒ 只**漏报**、不误报。
   */
  async checkOrphanSchemaModules(): Promise<void> {
    const repoRoot = resolve(__dirname, '..');
    const appSrc = resolve(repoRoot, 'app', 'src');
    const files = collectTsFiles(appSrc);
    const toKey = (p: string): string =>
      p.replace(/\\/g, '/').replace(/\.(ts|tsx|js)$/, '');

    const candidates = files
      .filter((f) => {
        const rel = relative(appSrc, f).replace(/\\/g, '/');
        return rel.startsWith('tools/') && rel.endsWith('/schemas.ts');
      })
      .map((f) => ({ file: f, key: toKey(f) }));

    if (candidates.length === 0) {
      console.log(
        '[工具 schemas 模块引用检查 R15-002] 未发现 tools/<各工具>/schemas.ts'
      );
      return;
    }

    const keySet = new Set(candidates.map((c) => c.key));
    const imported = new Set<string>();
    const SPEC_RE = /(?:from|require\()\s*['"]([^'"]+)['"]/g;

    for (const file of files) {
      let text: string;
      try {
        text = readFileSync(file, 'utf-8');
      } catch {
        continue;
      }
      for (const m of text.matchAll(SPEC_RE)) {
        const spec = m[1];
        if (!/\/schemas(\.js|\.ts)?$/.test(spec)) continue;
        let abs: string | null = null;
        if (spec.startsWith('.')) {
          abs = resolve(dirname(file), spec);
        } else if (spec.startsWith('@modules/')) {
          abs = resolve(appSrc, spec.slice('@modules/'.length));
        }
        if (!abs) continue;
        const key = toKey(abs);
        if (keySet.has(key)) imported.add(key);
      }
    }

    const orphans = candidates.filter((c) => !imported.has(c.key));

    for (const o of orphans) {
      this.violations.push({
        ruleId: 'R15-002',
        severity: 'warning',
        file: relative(repoRoot, o.file).replace(/\\/g, '/'),
        message: `零 importer 的工具 schemas 模块：${relative(repoRoot, o.file).replace(/\\/g, '/')}（整文件无人消费）`,
        suggestion:
          '默认应删除（该类文件已多次实测与实现漂移：如 sleep 的 milliseconds vs durationMs）；若确有价值，须让工具 import 它并逐字段对齐实现，见 dev_docs/error_repairs/预存错误与待处理问题.md 的 D-7',
      });
    }

    console.log(
      `[工具 schemas 模块引用检查 R15-002] 候选 ${candidates.length} 个，零 importer ${orphans.length} 个${
        orphans.length > 0
          ? `：${orphans.map((o) => relative(appSrc, o.file).replace(/\\/g, '/')).join('、')}`
          : ''
      }`
    );
  }

  /** R07-001 豁免：已登记的微小文件例外 */
  isTinyFileExempt(relPath: string): boolean {
    const normalized = relPath.replace(/\\/g, '/').toLowerCase();
    const withAppPrefix = normalized.startsWith('app/')
      ? normalized
      : `app/${normalized}`;
    return (
      this.tinyFileExceptions.has(normalized) ||
      this.tinyFileExceptions.has(withAppPrefix)
    );
  }

  /** R07-002: 检查 license 文件头重复（模板复制防回潮，warning 级与 project_rules §1.2 建议不冲突） */
  async checkLicenseHeaderDuplication(): Promise<void> {
    const MAX_HEADER_COUNT = 10;
    const headerCounts = new Map<
      string,
      { count: number; samples: string[] }
    >();

    for (const file of this.allFiles) {
      const relPath = relative(process.cwd(), file);
      if (/\.test\.ts$/.test(relPath) || /\.test\.tsx$/.test(relPath)) continue;
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n').slice(0, 21);
      const firstLine = lines[0]?.trim() || '';
      if (!firstLine.startsWith('/*') && !firstLine.startsWith('//')) continue;
      const header = lines.join('\n').trim();
      if (header.length < 40) continue;
      // 2026-08-29 治理：MIT license 头是 project_rules §1.2 规范要求的（TS 文件建议携带），
      // 其重复是合规行为而非模板复制，跳过（R07-002 仅检测自定义文件头的异常重复）
      if (
        header.includes('MIT License') ||
        header.includes('Permission is hereby granted')
      )
        continue;
      const entry = headerCounts.get(header) || { count: 0, samples: [] };
      entry.count++;
      if (entry.samples.length < 3) entry.samples.push(relPath);
      headerCounts.set(header, entry);
    }

    const duplicates = [...headerCounts.entries()].filter(
      ([, v]) => v.count > MAX_HEADER_COUNT
    );
    if (duplicates.length > 0) {
      const [header, info] = duplicates.sort(
        (a, b) => b[1].count - a[1].count
      )[0];
      void header;
      this.violations.push({
        ruleId: 'R07-002',
        severity: 'warning',
        file: info.samples[0],
        message: `相同文件头重复 ${info.count} 次（阈值 ${MAX_HEADER_COUNT}），存在模板复制`,
        suggestion: `文件头（如 MIT license 21 行）在 ${info.count} 个文件中重复，建议仓库根只保留一份 LICENSE，源码文件不再复制\n  样例文件: ${info.samples.join(', ')}`,
      });
    }
    console.log(
      `[license 头检查 R07-002] ${duplicates.length} 组重复文件头（>${MAX_HEADER_COUNT} 次）`
    );
  }

  /**
   * R08-001: 检查后台任务模块的跨重启状态持久化（P1 反模式防回潮）
   * 检测后台模块中"纯内存计数器/状态变量 + 递增"且文件内无任何持久化手段的模式。
   * 参考：buddy/growthPersistence.ts 落盘 JSON、buddy/dreamLogStore.ts 追加式 JSONL。
   */
  async checkBackgroundPersistence(): Promise<void> {
    // 有状态的后台任务模块目录
    const statefulDirRe =
      /[\\/](buddy|chronos|memory|knowledge|cost|usage|session)[\\/]/;
    // 持久化关键词：文件含任一即视为已落盘，不判违规
    const persistKeywords =
      /Persistence|persistence|LogStore|logStore|Storage|storage|writeFile|writeFileSync|readFile|saveTo|\.jsonl?|resolveDbPath|Database|database/i;
    // 模块级计数器（行首无缩进）+ 类字段计数器（带 private/public 修饰符），排除函数体内局部变量
    const counterRe =
      /^(?:let\s+(\w+)\s*=\s*0| {2,4}(?:private|protected|public)\s+(\w+)\s*=\s*0)\s*;/gm;

    let counterFiles = 0;
    for (const file of this.allFiles) {
      const relPath = relative(process.cwd(), file);
      if (/\.test\.ts$/.test(relPath) || /\.test\.tsx$/.test(relPath)) continue;
      if (!statefulDirRe.test(relPath)) continue;

      const content = readFileSync(file, 'utf-8');
      if (persistKeywords.test(content)) continue;

      // 收集计数器声明
      const counters = new Set<string>();
      for (const m of content.matchAll(counterRe)) counters.add(m[1]);
      if (counters.size === 0) continue;

      // 检查是否存在递增（++ 或 +=）
      const hasIncrement = [...counters].some((name) => {
        const incRe = new RegExp(`\\b${name}\\s*(\\+\\+|\\+=)`, 'g');
        return incRe.test(content);
      });
      if (!hasIncrement) continue;

      counterFiles++;
      this.violations.push({
        ruleId: 'R08-001',
        severity: 'warning',
        file: relPath,
        message: `后台模块存在纯内存计数器/状态（${[...counters].join(', ')}），文件内无任何持久化手段，进程重启后状态丢失`,
        suggestion:
          '按 R08-001 将跨重启状态落盘到 ~/.pyapp/data/（参考 buddy/growthPersistence.ts），或确认该状态为一次性运行态',
      });
    }
    console.log(
      `[后台状态检查 R08-001] ${counterFiles} 个后台模块存在疑似纯内存计数器/状态`
    );
  }

  /**
   * R08-002: 检查后台任务循环是否有日志记录（P2 反模式防回潮）
   * 检测 setInterval 回调体内无任何 logger.* 调用 → "跑了没跑、为什么没跑"无从得知。
   */
  async checkBackgroundEventLogging(): Promise<void> {
    const intervalRe =
      /setInterval\(\s*(?:async\s+)?(?:\(\)\s*=>|function\s*\(\s*\)\s*)\s*\{([\s\S]*?)\}\s*,\s*\d+\s*\)/g;
    const loggerRe = /logger\.\s*(info|warn|error|debug|trace)\s*\(/;
    // UI 动画循环豁免：回调体仅含 UI 状态更新（setXxx/setState/useState setter/光标闪烁等），
    // 非后台任务，不适用 R08-002 四类事件日志（避免给 spinner/loading 动画强加日志）。
    const uiAnimationRe =
      /^\s*(set[A-Z]\w*\([^;]*\);?|setState\([^;]*\);?|cursorBlink\.\w+\s*=\s*[^;]+;)\s*$/;
    // 终端 spinner/进度动画豁免：帧绘制（process.stdout.write + 帧索引取模），高频 UI 输出，非后台任务
    const terminalAnimationRe =
      /process\.stdout\.write[\s\S]*?%\s*(frames|FRAMES|\w+\.length)/;

    let silentLoops = 0;
    let uiAnimationLoops = 0;
    for (const file of this.allFiles) {
      const relPath = relative(process.cwd(), file);
      if (/\.test\.ts$/.test(relPath) || /\.test\.tsx$/.test(relPath)) continue;

      const content = readFileSync(file, 'utf-8');
      let m: RegExpExecArray | null;
      while ((m = intervalRe.exec(content)) !== null) {
        const callbackBody = m[1];
        if (loggerRe.test(callbackBody)) continue;

        // UI 动画循环豁免：纯状态更新（无分号外的逻辑、无调用链）
        const trimmed = callbackBody.trim();
        if (uiAnimationRe.test(trimmed) || terminalAnimationRe.test(trimmed)) {
          uiAnimationLoops++;
          continue;
        }

        silentLoops++;
        this.violations.push({
          ruleId: 'R08-002',
          severity: 'warning',
          file: relPath,
          message: '后台任务循环（setInterval）回调体内无任何日志记录',
          suggestion:
            '按 R08-002 记录 start/skip(带原因)/fail(带错误)/complete(带结果) 四类事件，skip 与 fail 至少 warn 级',
        });
        break; // 每文件最多报 1 条，避免刷屏
      }
    }
    console.log(
      `[后台事件检查 R08-002] ${silentLoops} 个后台任务循环无日志记录（豁免 UI 动画 ${uiAnimationLoops} 个）`
    );
  }

  /**
   * R11-001: 检查直接构造 Logger 实例（§十一 零样板门面防回潮）
   * 新代码应使用 getLogger(module) 或 createModule(module).logger；
   * 存量自定义配置（非默认 INFO/json）作为迁移回退清单，warning 级不阻断 CI。
   */
  async checkLoggerFacade(): Promise<void> {
    const newLoggerRe = /new Logger\(/g;
    // Logger 唯一实现本身（getLogger/createLogger 内构造）
    const skipFile = (file: string): boolean => {
      const norm = file.replace(/\\/g, '/');
      return norm.includes('/monitoring/logs/Logger.ts');
    };

    let directCtor = 0;
    for (const file of this.allFiles) {
      if (skipFile(file)) continue;
      const content = readFileSync(file, 'utf-8');
      newLoggerRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      let reported = 0;
      while ((m = newLoggerRe.exec(content)) !== null) {
        const line = content.slice(0, m.index).split('\n').length;
        directCtor++;
        this.violations.push({
          ruleId: 'R11-001',
          severity: 'warning',
          file: relative(process.cwd(), file),
          line,
          message: '直接构造 Logger 实例（new Logger(...)）',
          suggestion:
            '改用 getLogger(module)（默认 INFO/json 形态）或 createModule(module).logger；自定义 level/redact 形态属存量回退清单，需人工确认',
        });
        if (++reported >= 5) break; // 每文件最多报 5 条，避免刷屏
      }
    }
    console.log(`[Logger 门面检查 R11-001] ${directCtor} 处直接构造 Logger`);
  }

  /**
   * R10-004: ModuleDefinitions 初始化顺序 与 LazyModuleStrategy 优先级对齐（§十二 步骤 4）
   * 文档规则（ModuleDefinitions.ts 注释）：
   *   1. CRITICAL 模块必须集中在 Phase 1-4（DEFERRED 标记之前）
   *   2. DEFERRED 模块必须在 Phase 5-8（DEFERRED 标记之后）
   *   3. 新增模块时同步更新 LAZY_MODULE_STRATEGY 的优先级
   */
  async checkModulePhaseAlignment(): Promise<void> {
    const norm = (f: string) => f.replace(/\\/g, '/');
    const defFile = this.allFiles.find((f) =>
      norm(f).includes('/modules/ModuleDefinitions.ts')
    );
    const stratFile = this.allFiles.find((f) =>
      norm(f).includes('/modules/LazyModuleStrategy.ts')
    );
    if (!defFile || !stratFile) return;

    const defContent = readFileSync(defFile, 'utf-8');
    const stratContent = readFileSync(stratFile, 'utf-8');

    // 解析 MODULE_INITIALIZATION_ORDER：按 "DEFERRED 阶段" 注释切成 critical / deferred 两段
    const orderStart = defContent.indexOf('MODULE_INITIALIZATION_ORDER');
    const arrStart = defContent.indexOf('[', orderStart);
    const arrEnd = defContent.indexOf('];', arrStart);
    const body = defContent.slice(arrStart, arrEnd);
    const defIdx = body.indexOf('DEFERRED 阶段');
    const idRe = /'([^']+)'/g;
    const critical = [
      ...(defIdx >= 0 ? body.slice(0, defIdx) : body).matchAll(idRe),
    ].map((m) => m[1]);
    const deferred = [
      ...(defIdx >= 0 ? body.slice(defIdx) : '').matchAll(idRe),
    ].map((m) => m[1]);
    const criticalSet = new Set(critical);
    const orderAll = new Set([...critical, ...deferred]);

    // 解析 LAZY_MODULE_STRATEGY
    const stratStart = stratContent.indexOf('LAZY_MODULE_STRATEGY');
    const sArrStart = stratContent.indexOf('{', stratStart);
    const sArrEnd = stratContent.indexOf('};', sArrStart);
    const sBody = stratContent.slice(sArrStart, sArrEnd);
    // 块级解析：支持单行与多行条目（key: { priority: ..., trigger: '...' }）
    const entryStartRe = /^\s*'?([\w-]+)'?\s*:\s*\{/gm;
    const strategy = new Map<string, { priority: string; loadMode?: string }>();
    let m: RegExpExecArray | null;
    while ((m = entryStartRe.exec(sBody)) !== null) {
      const endRel = sBody.indexOf('},', m.index);
      if (endRel < 0) continue;
      const entryBody = sBody.slice(m.index, endRel);
      const prio = /priority:\s*ModuleLoadPriority\.(\w+)/.exec(entryBody);
      const loadMode = /loadMode:\s*DynamicLoadMode\.(\w+)/.exec(entryBody);
      if (prio)
        strategy.set(m[1], { priority: prio[1], loadMode: loadMode?.[1] });
      entryStartRe.lastIndex = endRel;
    }

    let errors = 0;
    let warnings = 0;
    for (const [id, cfg] of strategy) {
      if (!orderAll.has(id)) {
        errors++;
        this.violations.push({
          ruleId: 'R10-004',
          severity: 'error',
          file: relative(process.cwd(), stratFile),
          message: `LAZY_MODULE_STRATEGY 声明了 '${id}'（${cfg.priority}），但 MODULE_INITIALIZATION_ORDER 中不存在`,
          suggestion:
            '在 ModuleDefinitions.ts 的 MODULE_INITIALIZATION_ORDER 中按优先级阶段补充该模块',
        });
        continue;
      }
      const inCritical = criticalSet.has(id);
      const isCritical = cfg.priority === 'CRITICAL';
      if (isCritical !== inCritical) {
        errors++;
        this.violations.push({
          ruleId: 'R10-004',
          severity: 'error',
          file: relative(process.cwd(), defFile),
          message: `模块 '${id}' 优先级 ${cfg.priority}，但位于 ${inCritical ? 'CRITICAL 段（Phase 1-4）' : 'DEFERRED 段（Phase 5-8）'}——与 LazyModuleStrategy 不对齐`,
          suggestion: `按对齐规则调整：${isCritical ? '移到 DEFERRED 标记之前（Phase 1-4）' : '移到 DEFERRED 标记之后（Phase 5-8）'}`,
        });
      }
    }
    // 反向：初始化顺序中缺少 strategy 优先级声明的模块（新增模块未同步）
    for (const id of orderAll) {
      if (!strategy.has(id)) {
        warnings++;
        this.violations.push({
          ruleId: 'R10-004',
          severity: 'warning',
          file: relative(process.cwd(), defFile),
          message: `MODULE_INITIALIZATION_ORDER 包含 '${id}'，但 LAZY_MODULE_STRATEGY 未声明其优先级`,
          suggestion:
            '在 LazyModuleStrategy.ts 中补充 ' +
            `'${id}': { priority: ModuleLoadPriority.X, ... }`,
        });
      }
    }
    console.log(
      `[模块阶段对齐 R10-004] ${errors} 处错误 / ${warnings} 处缺失优先级声明: ${[...orderAll].filter((id) => !strategy.has(id)).join(', ')}`
    );
  }

  /**
   * R10-003: 模块生命周期契约检查（§十二 步骤 5）
   * 实现任一生命周期钩子（onLoad/onReady/onDestroy）的模块必须实现完整三件套，
   * 禁止"部分契约"（如只有 onLoad 没有 onDestroy）。
   */
  async checkModuleLifecycle(): Promise<void> {
    const hookNames = ['onLoad', 'onReady', 'onDestroy'];
    let partialModules = 0;
    for (const file of this.allFiles) {
      const relPath = relative(process.cwd(), file);
      if (/\.test\.ts$/.test(relPath) || /\.test\.tsx$/.test(relPath)) continue;
      const content = readFileSync(file, 'utf-8');
      // 只匹配"方法定义"（空参 + 函数体），排除 onDestroy(context) 等调用与 void onReady(); 语句
      const present = hookNames.filter((h) =>
        new RegExp(`(?:async\\s+)?\\b${h}\\s*\\(\\)\\s*(?::[^{]*)?\\{`).test(
          content
        )
      );
      if (present.length === 0 || present.length === 3) continue;

      partialModules++;
      this.violations.push({
        ruleId: 'R10-003',
        severity: 'warning',
        file: relPath,
        message: `模块生命周期钩子不完整（仅 ${present.join('/')}，缺 ${hookNames.filter((h) => !present.includes(h)).join('/')}）`,
        suggestion:
          '实现完整生命周期契约 onLoad/onReady/onDestroy（ModuleBootstrapper 四阶段：REGISTER→LOAD→READY→DESTROY）',
      });
    }
    console.log(
      `[模块生命周期 R10-003] ${partialModules} 个模块存在部分生命周期钩子`
    );
  }

  /** 运行所有检查 */
  async runAll(): Promise<RuleViolation[]> {
    await this.loadFiles();
    // 提前加载例外清单，供 checkFileSize 等检查使用（checkLayerCompliance 内部调用幂等）
    await this.loadLayerExceptions();

    console.log('\n运行架构合规检查...\n');

    await Promise.all([
      this.checkSelfBuiltEventBus(),
      this.checkErrorHierarchy(),
      this.checkSelfBuiltRetry(),
      this.checkSelfBuiltCache(),
      this.checkDuplicateTypeNames(),
      this.checkSelfBuiltInfrastructure(),
      this.checkFileSize(),
      this.checkJsFilesInSrc(),
      this.checkExceptionExpiry(),
      this.checkExceptionCount(),
      this.checkConsoleBaseline(),
      this.checkBarrelFiles(),
      this.checkMessageModelImports(),
      this.checkTypeCenterDuplicates(),
      this.checkConfigEnvAccess(),
      this.checkDuplicateDependencies(),
      this.checkTsconfigEslintConsistency(),
      // P1a-T1 新增检查项
      this.checkHealthCheckRegistration(),
      this.checkSessionModel(),
      this.checkModuleSingleExport(),
      this.checkMessageRouting(),
      // P1 架构收敛新增检查项
      this.checkFileSizeLower(),
      this.checkZombieForward(),
      this.checkBarrelOverflow(),
      this.checkDuplicateImplement(),
      this.checkCommandFragments(),
      // P4 碎片防回潮（R07 系列）
      this.checkThinBarrels(),
      this.checkTinyFiles(),
      this.checkLicenseHeaderDuplication(),
      // R08 后台任务可观测性（P1/P2 反模式防回潮）
      this.checkBackgroundPersistence(),
      this.checkBackgroundEventLogging(),
      // R11 可观测性零样板门面（§十一，getLogger/createModule 防回潮）
      this.checkLoggerFacade(),
      // R10 模块统一管理（§十二，阶段对齐 + 生命周期契约）
      this.checkModulePhaseAlignment(),
      this.checkModuleLifecycle(),
      // R07 工作区卫生（参考副本不得留在仓库内：防统计口径污染复发）
      this.checkWorkspaceHygiene(),
      // R15 工具出参契约（"零消费者的 *OutputSchema" 防回潮；T6 收口后**零豁免上线**）
      this.checkOrphanOutputSchemas(),
      // R15-002 工具 schemas 模块引用（"零 importer 的 schemas.ts" 防回潮；D-7 收口后零豁免上线）
      this.checkOrphanSchemaModules(),
    ]);

    // 分层合规检查（需按顺序在 loadFiles 之后执行）
    await this.checkLayerCompliance();

    return this.violations;
  }
}

// ============ 主入口 ============

/**
 * P0-5: 前端高频渲染路径禁止无 selector 的 zustand 全量订阅。
 * 仅扫描 ChatArea 相关组件目录（流式期间每 chunk 重渲染的高频路径），
 * 低频组件（配置页 / hooks 一次性读取 action）不做检查，避免误报噪音。
 */
function checkFrontendStoreSubscription(projectDir: string): RuleViolation[] {
  const violations: RuleViolation[] = [];
  const clientSrc = resolve(projectDir, 'client', 'src');
  if (!existsSync(clientSrc)) return violations;

  const highFreqDirs = [
    join(clientSrc, 'components', 'ChatArea'),
    join(clientSrc, 'components', 'chat'),
    join(clientSrc, 'components', 'Chat'),
  ];
  const files = new Set<string>();
  for (const dir of highFreqDirs) {
    if (!existsSync(dir)) continue;
    for (const f of collectTsFiles(dir)) files.add(f);
  }

  // 高频 store：useChatStore / useVoiceStore（驱动流式渲染，全量订阅时每 chunk 重渲染）
  const storePattern = /(useChatStore|useVoiceStore)\(\s*\)/g;
  for (const file of files) {
    if (!file.endsWith('.tsx')) continue; // 仅组件文件
    if (file.includes('.test.') || file.includes('__tests__')) continue;
    const content = readFileSync(file, 'utf-8');
    const matches = [...content.matchAll(storePattern)];
    if (matches.length > 0) {
      const line = content.slice(0, matches[0].index).split('\n').length;
      violations.push({
        ruleId: 'P0-5',
        severity: 'warning',
        file: relative(projectDir, file),
        line,
        message: `无 selector 的 zustand 全量订阅 ${matches.length} 处（流式期间无关字段变化会触发本组件重渲染）`,
        suggestion:
          '改精准 selector：useChatStore((s) => s.xxx) / useVoiceStore((s) => s.xxx)',
      });
    }
  }
  return violations;
}

async function main(): Promise<void> {
  // 解析 src 路径：优先使用环境变量 PYAPP_PROJECT_DIR，其次是 cwd
  const projectDir = process.env.PYAPP_PROJECT_DIR || process.cwd();
  const srcPath = resolve(projectDir, 'app', 'src');

  if (!existsSync(srcPath)) {
    console.error(`错误: 找不到 src 目录: ${srcPath}`);
    console.error('请在项目根目录运行或设置 PYAPP_PROJECT_DIR 环境变量');
    process.exit(2);
  }

  const linter = new ArchitectureLinter(srcPath);
  const violations = await linter.runAll();
  // P0-5: 前端高频路径 store 订阅检查（独立扫描 client/src，不并入 app/src 扫描集）
  violations.push(...checkFrontendStoreSubscription(projectDir));

  const errors = violations.filter((v) => v.severity === 'error');
  const warnings = violations.filter((v) => v.severity === 'warning');

  console.log(`\n========== 架构合规检查结果 ==========`);
  console.log(
    `错误: ${errors.length}  警告: ${warnings.length}  总计: ${violations.length}`
  );
  console.log(`========================================\n`);

  // 按规则 ID 分组输出
  const byRule = new Map<string, RuleViolation[]>();
  for (const v of violations) {
    if (!byRule.has(v.ruleId)) byRule.set(v.ruleId, []);
    byRule.get(v.ruleId)!.push(v);
  }

  for (const [ruleId, items] of byRule) {
    const icon = items.every((v) => v.severity === 'error') ? '❌' : '⚠️';
    console.log(`${icon} [${ruleId}] ${items.length} 条违规:`);
    for (const v of items.slice(0, 5)) {
      console.log(`  - ${v.file}`);
      console.log(`    ${v.message}`);
      console.log(`    建议: ${v.suggestion}`);
    }
    if (items.length > 5) {
      console.log(`  ... 及其他 ${items.length - 5} 条`);
    }
    console.log('');
  }

  console.log(`========================================`);
  console.log(`规则定义: .trae/rules/architecture-compliance.md`);
  console.log(`========================================\n`);

  if (errors.length > 0) {
    console.log('存在 ERROR 级别违规，请修复后重新提交。');
    process.exit(1);
  } else if (warnings.length > 0) {
    console.log('存在 WARNING 级别违规，建议在后续迭代中修复。');
    process.exit(0);
  } else {
    console.log('✅ 所有架构合规检查通过！');
    process.exit(0);
  }
}

main().catch((err: Error) => {
  console.error('检查器运行时错误:', err.message);
  process.exit(2);
});
