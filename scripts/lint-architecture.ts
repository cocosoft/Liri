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

// JS/TS 保留字，排除被误判为"方法名"的控制流语句
const RESERVED_WORDS = new Set([
    'if', 'else', 'for', 'while', 'switch', 'catch', 'return',
    'case', 'default', 'try', 'finally', 'do', 'with', 'class',
    'new', 'typeof', 'instanceof', 'in', 'of', 'var', 'let', 'const',
    'import', 'export', 'throw', 'yield', 'await', 'async', 'delete',
    'void', 'this', 'super', 'break', 'continue', 'extends', 'function',
    'get', 'set', 'static', 'private', 'public', 'protected', 'interface',
    'type', 'enum', 'namespace', 'declare', 'implements', 'abstract',
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

function readdirSyncFull(dir: string): Array<{ name: string; isDirectory: () => boolean }> {
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
            'node:http', 'node:net', 'node:events', 'Socket', 'Server',
            'Stream', 'Readable', 'Writable', 'ChildProcess',
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
            if (file.includes('core\\events\\EventBus') || file.includes('core/events\\EventBus') ||
                file.includes('core/events/EventBus')) continue;

            // 跳过已知事件总线例外
            if (knownEventBusExceptions.some(e => file.includes(e))) continue;

            const content = readFileSync(file, 'utf-8');

            // 跳过合法场景
            if (skipPatterns.some(p => content.includes(p))) continue;

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
    private detectCompetingEventBus(content: string): { isEventBus: boolean; hasEventEmitter: boolean; hasSelfBuiltDispatch: boolean; className: string } | null {
        const result = {
            isEventBus: false,
            hasEventEmitter: false,
            hasSelfBuiltDispatch: false,
            className: '',
        };

        // 模式1：类名包含 EventBus（自建事件总线）
        const eventBusClassMatch = content.match(/\bclass\s+(\w*EventBus\w*)\s*[\{<]/);
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
        const emitterMatch = content.match(/class\s+(\w+)\s+extends\s+EventEmitter/);

        // 检查是否有 Map<string, *Handler*> 模式（事件注册表）
        const hasHandlerMap = /Map\s*<\s*string\s*,\s*[^>]*[Hh]andler/.test(content);

        // 检查是否有事件分发方法
        const hasEventMethods = /\b(emit|subscribe|publish|dispatch)\s*\(/.test(content);

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
            'AppError', 'NetworkError', 'FileSystemError', 'PermissionError',
            'ValidationError', 'ExecutionError', 'ConfigParseError', 'ShellError',
            'PluginError', 'ToolError', 'CacheError', 'SecurityError',
            'APIError', 'DatabaseError', 'AbortError', 'ModuleError',
            'FallbackTriggeredError', 'SafeTelemetryError',
            'MalformedCommandError', 'LightweightNetworkError', 'LightweightFileError',
            'LightweightAPIError', 'LightweightConfigError',
        ];

        for (const file of this.allFiles) {
            // 跳过标准错误定义文件
            if (file.includes('error\\types.ts') || file.includes('error/types.ts')) continue;

            const content = readFileSync(file, 'utf-8');

            // 检查1: 与标准错误类同名
            for (const errName of stdErrors) {
                if (errName === 'AppError') continue; // AppError 是基类
                const regex = new RegExp(`export\\s+(class|interface|type)\\s+${errName}\\b`);
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
            const errorMatches = content.matchAll(/export\s+class\s+(\w+)\s+extends\s+Error\b/g);
            for (const match of errorMatches) {
                const className = match[1];

                // 跳过标准错误类型文件
                if (file.includes('error\\') || file.includes('error/')) continue;
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
            if (file.includes('query\\withRetry.ts') || file.includes('query/withRetry.ts')) continue;
            if (file.includes('utils\\withRetry.ts') || file.includes('utils/withRetry.ts')) continue;

            // 跳过测试文件
            if (file.endsWith('.test.ts') || file.endsWith('.spec.ts')) continue;

            // 跳过已知的已废弃兼容层
            if (file.includes('streaming\\retry.ts') || file.includes('streaming/retry.ts')) continue;

            // R01-003 已知例外：领域内建重试（记录在 architecture-compliance.md 已知例外表中）
            const skipExceptions = [
                'services\\api\\client.ts', 'services/api/client.ts',
                'bridge\\api\\BridgeApi.ts', 'bridge/api/BridgeApi.ts',
                'mcp\\reconnect.ts', 'mcp/reconnect.ts',
                'chat\\tool\\SmartToolIntegrator.ts', 'chat/tool/SmartToolIntegrator.ts',
                'session\\platform\\WebhookPlatform.ts', 'session/platform/WebhookPlatform.ts',
                'streaming\\IncrementalRetry.ts', 'streaming/IncrementalRetry.ts',
                // R01-003 AC-1 治理落地：channel-handlers 出站消息重试（2026-08-21 复核登记）
                // → 属于"跨 N 条独立 onOutbound 失败消息的 15s 批处理延迟调度状态机"，
                //   不是 R01-003 要禁止的"单请求线性重试"语义；硬套 withRetry 反而引入更复杂的 timer/drain 管理
                //   （详见 architecture-compliance.md 已知例外 R01-003 channel-handlers 条目）
                'infrastructure\\http\\handlers\\channel-handlers.ts', 'infrastructure/http/handlers/channel-handlers.ts',
                // 第二组：2026-Q3 前计划迁移
                'core\\utils\\ErrorHandler.ts', 'core/utils/ErrorHandler.ts',
                'ai\\providers\\BaseAIProvider.ts', 'ai/providers/BaseAIProvider.ts',
                'agent\\cli-runner\\index.ts', 'agent/cli-runner/index.ts',
                'performance\\CodeOptimizer.ts', 'performance/CodeOptimizer.ts',
                'mcp\\MCPCompatibilityTester.ts', 'mcp/MCPCompatibilityTester.ts',
                'agent\\chains\\AgentChain.ts', 'agent/chains/AgentChain.ts',
                'core\\node-host\\ExecPolicy.ts', 'core/node-host/ExecPolicy.ts',
                'remote\\RemoteTaskScheduler.ts', 'remote/RemoteTaskScheduler.ts',
                // 第三组：误报或领域重试，2026-Q3 前清理
                'chronos\\CronSubprocessExecutor.ts', 'chronos/CronSubprocessExecutor.ts',
                'agent\\remote\\RemoteAgentProtocol.ts', 'agent/remote/RemoteAgentProtocol.ts',
                'bridge\\utils\\jwtUtils.ts', 'bridge/utils/jwtUtils.ts',
                'chronos\\engine\\ExecutionEngine.ts', 'chronos/engine/ExecutionEngine.ts',
                'ai\\router\\SmartRouter.ts', 'ai/router/SmartRouter.ts',
                'oauth\\services\\TokenManager.ts', 'oauth/services/TokenManager.ts',
                'chronos\\EnhancedCronTask.ts', 'chronos/EnhancedCronTask.ts',
                'chronos\\CronScheduler.ts', 'chronos/CronScheduler.ts',
                'error\\context\\QuerySource.ts', 'error/context/QuerySource.ts',
                'main.ts', 'main.ts',
                'ai\\router\\RetryPolicy.ts', 'ai/router/RetryPolicy.ts',
                'tasks\\LongRunningTaskOrchestrator.ts', 'tasks/LongRunningTaskOrchestrator.ts',
            ];
            if (skipExceptions.some((e) => file.includes(e))) continue;

            const content = readFileSync(file, 'utf-8');

            // 检测手写重试模式
            const hasRetryFunction = /(function|const|async)\s+\w*[Rr]etry\w*\s*[=(<]/.test(content);
            const hasRetryLoop = /for\s*\(\s*(let|const|var)\s+\w+\s*=\s*0\s*;\s*\w+\s*<\s*\w*[Rr]etry/.test(content);
            const hasRetryLoopBroad = /for\s*\([^)]*maxRetries|while\s*\([^)]*maxRetries/.test(content);
            const hasRetryCount = /\bretryCount\b|\bmaxRetries\b|\bMAX_RETRIES\b/.test(content);

            // 只有同时存在重试变量名 且 有实际循环/函数时才标记（避免配置字段误报）
            const hasActualRetryConstruct = hasRetryFunction || hasRetryLoop || hasRetryLoopBroad;
            if (hasActualRetryConstruct && hasRetryCount) {
                // 检查是否已经有 import withRetry
                if (content.includes("from '") && content.includes('withRetry')) continue;

                // 跳过已知的仅类型定义/配置文件的误报
                if (this.isR01_003FalsePositive(file, content)) continue;

                this.violations.push({
                    ruleId: 'R01-003',
                    severity: 'warning',
                    file: relative(process.cwd(), file),
                    message: '可能包含自建重试逻辑',
                    suggestion: '请使用 utils/withRetry.ts 的 withRetry()（标准重试实现）',
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
        if (/(function|const|async)\s+\w*[Rr]etry\w*\s*[=(<]/.test(content)) return false;

        // 如果存在 for/while 循环中用到 retryCount/maxRetries，是真违规
        if (/for\s*\([^)]*retryCount|while\s*\([^)]*maxRetries/.test(content)) return false;

        // 检查是否所有 retry 术语都仅出现在类型/接口/配置声明中
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (retryTermPattern.test(lines[i])) {
                const line = lines[i].trim();
                // 类型定义字段: "maxRetries?: number"
                if (/^(readonly\s+|private\s+|protected\s+|public\s+)?(static\s+)?maxRetries(\?)?\s*:\s*/.test(line)) continue;
                if (/^(readonly\s+|private\s+|protected\s+|public\s+)?(static\s+)?retryCount(\?)?\s*:\s*/.test(line)) continue;
                if (/^MAX_RETRIES\s*[=:]/.test(line)) continue;
                // 配置字面量: "maxRetries: 3," (在对象字面量或构造函数赋值中)
                if (/^\s*maxRetries\s*[:=]/.test(line) && /[:=]\s*\d/.test(line)) continue;
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

            const content = readFileSync(file, 'utf-8');

            // 检测 private cache = new Map 模式
            const cachePattern = /(private|protected|public)\s+(\w*[Cc]ache\w*)\s*[=:]\s*new\s+Map\b/g;
            const matches = content.matchAll(cachePattern);
            for (const match of matches) {
                const varName = match[2];
                // 跳过非业务缓存的合理场景
            if (content.includes('CacheSystem') || content.includes('ICache')) continue;

            // 跳过已知合法的渲染 memoization 和状态追踪
            if (file.includes('ink\\ink\\screen.ts') || file.includes('ink/ink/screen.ts')) continue;
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
        const typeMap = new Map<string, Array<{ file: string; name: string; kind: string }>>();

        // 已知合法的同名类型（通道模板文件、模块入口、子模块 index 等）
        const knownSafePatterns = [
            /channels[/\\][^/\\]+[/\\](config-schema|accounts|doctor|monitor|probe|runtime|channel\.runtime)\.ts$/,
            /[/\\]index\.ts$/,
        ];

        // 常见非冲突名称（各模块自身的局部配置类型）
        const commonNames = new Set([
            'Props', 'State', 'Config', 'Options', 'Params', 'Result', 'Context',
            'Handler', 'Listener', 'Callback', 'Input', 'Output', 'Args', 'Entry',
            'Data', 'Info', 'Stats', 'Summary', 'Payload', 'Response', 'Request',
            'Status', 'Mode', 'Role', 'Event', 'Meta', 'Metadata', 'Header',
            'Item', 'Row', 'Record',
            // Tool UI 渲染函数 — 各 Tool 模块约定的同名导出，非冲突
            'renderToolUseMessage', 'renderToolResultMessage', 'getToolUseSummary',
            'renderToolUseErrorMessage', 'renderToolUseProgressMessage',
            // 领域特定类型 — 同名但不同结构，各模块独立定义，无法统一
            'Message', 'ToolResult', 'ToolCall', 'RetryConfig', 'PerformanceMetrics',
            'TokenUsage', 'Task', 'CompletionItem', 'PluginManifest', 'SearchResult',
            'CleanupResult', 'PluginLoader', 'AgentDefinition', 'PermissionContext',
            'Tool', 'SessionMetadata', 'SessionInfo', 'SecurityConfig', 'HistoryEntry',
            'AuditEvent', 'SessionContext', 'ToolPermissionContext', 'AgentProgress',
            'PermissionRule', 'TeamMember', 'ProviderConfig', 'ToolContext',
            'ToolDefinition', 'CacheEntry', 'CacheStats', 'ChatResponse', 'RetryResult',
            'TrendAnalysis', 'SDKMessage', 'DeliveryResult', 'WebhookConfig',
            'EventListener', 'PermissionMode', 'ToolInfo', 'TaskStatus', 'HealthStatus',
            'ShellType', 'PluginMetadata', 'Plugin', 'PluginValidationResult',
            'SessionState', 'Theme', 'MemoryManager', 'SandboxConfig', 'MigrationResult',
            'SandboxManager', 'AppState', 'CompressionResult', 'EventHandler',
            'AgentConfig', 'ConversationMessage', 'HealthCheckConfig', 'StreamEvent',
            'SkillContext', 'ChatMessage', 'StorageConfig', 'PerformanceEvent',
            'CostSummary', 'PluginSource', 'StartupReport', 'RetryState',
            'HeartbeatManager', 'SessionStats', 'SessionManager', 'SessionConfig',
            'NotificationType', 'CacheItem', 'ChannelConfig', 'ChannelCapabilities',
            'ChannelStatus', 'IChannelPlugin', 'SessionCheckpointService', 'StreamChunk',
            'ToolExecutionResult', 'ContentBlock', 'SessionStorage', 'ScheduledTask',
            'UpdateInfo', 'ValidationRule', 'HealthCheck',
            // 通用工具函数 — 各模块独立实现，非冲突
            'recursivelySanitizeUnicode', 'jsonStringify', 'normalizeMessage',
            'createToolUseSummaryMessage', 'throttle', 'debounce', 'memoize',
            'DEFAULT_RETRY_CONFIG',
            // G1 分析确认无法统一的类型 — 同名但不同结构，各模块独立定义
            'AuthConfig', 'SessionMessage',
            // ValidationResult — 已统一到 common/types.ts，其余模块结构各异无法统一
            'ValidationResult',
            // G1 session 模块双轨制 — TranscriptEntry/TranscriptConfig 定义在活跃和孤儿文件中
            'TranscriptEntry', 'TranscriptConfig',
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
            'ConfigValidationRule', 'SettingSource', 'ContextEngine', 'CompactResult',
            'ArchiveResult', 'DiskInfo', 'ResourceUsage', 'ChannelPlugin', 'PluginConfig',
            'RenderOptions', 'SessionStore', 'ThemeManager', 'AlertRule',
            'PerformanceAnalysis', 'ToolExecutionContext', 'LSPClient', 'ImageFormat',
            'PerformanceReport', 'PerformanceAnalyzer', 'MemorySnapshot',
            'PermissionDecision', 'createAllowDecision', 'PermissionUpdate',
            'PluginContext', 'OAuthTokens',
            // G2 遗漏 + G3 领域特定类型 — 同名但不同模块中结构各异
            'CompactConfig', 'TokenBudgetConfig', 'SecurityCheckResult',
            'AgentMemoryScope', 'AgentColorName', 'AuditQuery', 'SkillDefinition',
            'PluginSkillManifest', 'PluginSkillParameter', 'PluginHookManifest',
            'PlanStep', 'ConfigValidationError', 'RiskLevel', 'SimpleCommand',
            'PermissionBehavior', 'ToolSchema',
        ]);

        for (const file of this.allFiles) {
            // 跳过通道模板（同名类型是合法的接口实现）
            if (knownSafePatterns.some(p => p.test(file))) continue;

            const content = readFileSync(file, 'utf-8');

            // 提取 export interface / type / class / function / const
            const patterns = [
                { regex: /export\s+interface\s+(\w+)/g, kind: 'interface' },
                { regex: /export\s+type\s+(\w+)\s*=/g, kind: 'type' },
                { regex: /export\s+(abstract\s+)?class\s+(\w+)/g, kind: 'class', nameGroup: 2 },
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
            if (locations.length < 2) continue;

            // 排除所有都在同一目录下或同一模块子树中的情况
            const dirs = new Set(locations.map(l => {
                const rel = relative(this.srcPath, l.file);
                // 取前两级目录作为模块标识（如 "config/" vs "core/extensibility"）
                const parts = rel.split(/[/\\]/);
                return parts.slice(0, 2).join('/');
            }));
            if (dirs.size < 2) continue;

            const kinds = [...new Set(locations.map(l => l.kind))].join('/');
            const fileList = locations.map(l =>
                `${relative(this.srcPath, l.file)} (${l.kind})`
            ).join(', ');

            this.violations.push({
                ruleId: 'R02-002',
                severity: 'warning',
                file: fileList,
                message: `导出 "${name}" (${kinds}) 在 ${locations.length} 个不同模块中定义`,
                suggestion: '请检查这些定义是否应统一为核心数据契约（如 core/data-models.ts）或归并到单一模块',
            });
        }
    }

    /** R03-001: 检查自建基础设施 */
    async checkSelfBuiltInfrastructure(): Promise<void> {
        const infraKeywords = [
            { pattern: /class\s+(\w*EventBus\w*)/, desc: '自建 EventBus' },
            { pattern: /class\s+(\w*Cache\w*)\s*\{/, desc: '自建 Cache' },
            { pattern: /class\s+(\w*Retry\w*)/, desc: '自建 Retry' },
            { pattern: /class\s+(\w*Config\w*Manager\w*)/, desc: '自建 ConfigManager' },
            { pattern: /class\s+(\w*Health\w*Checker\w*)/, desc: '自建 HealthChecker' },
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
            'core\\tokenBudget\\ModelContextCache.ts',
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
        ];

        for (const file of this.allFiles) {
            // 跳过标准实现目录
            if (file.includes('core\\events\\') || file.includes('core/events/')) continue;
            if (file.includes('cache\\') || file.includes('cache/')) continue;
            if (file.includes('ai\\clients\\retry') || file.includes('ai/clients/retry')) continue;
            if (file.includes('config\\') || file.includes('config/')) continue;

            // 跳过已知例外文件
            if (knownExceptions.some(e => file.includes(e))) continue;

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
                            if (item.name === 'node_modules' || item.name === '.git') continue;
                            queue.push(fullPath);
                        } else if (item.name.endsWith('.js') && !item.name.endsWith('.test.js')) {
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
            suggestion: `将 .js 文件迁移为 .ts 文件\n  受影响文件:\n${jsFiles.map(f => `    - ${relative(process.cwd(), f)}`).join('\n')}`,
        });
    }

    /** 例外过期检查（G2 门禁） */
    async checkExceptionExpiry(): Promise<void> {
        const now = new Date();
        const warningDays = 7;
        const allExceptions = [...this.exceptionData.bulk, ...this.exceptionData.perModule];

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
                const daysLeft = Math.ceil((expiresDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
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
        const total = this.exceptionData.bulk.length + this.exceptionData.perModule.length;

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
        const baselinePath = resolve(process.cwd(), 'scripts', 'console-baseline.json');
        let baseline = 2045; // 默认基线（2026-06-18 快照值）
        let threshold = 0.10; // 允许超出基线的比例

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
            if (file.includes('.test.') || file.includes('__tests__') || file.includes('spec.')) continue;
            // 跳过 .js 文件（因 JS 文件本应迁移）
            if (file.endsWith('.js')) continue;

            const content = readFileSync(file, 'utf-8');
            const matches = [...content.matchAll(consolePattern)];
            if (matches.length > 0) {
                totalCount += matches.length;
                fileCounts.push({ file: relative(process.cwd(), file), count: matches.length });
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
        console.log(`\n[Console 基线] 当前 ${totalCount} 次调用（基线: ${baseline}，上限: ${limit}）`);
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
            'src\\agent\\', 'src\\ai\\', 'src\\bridge\\', 'src\\channels\\',
            'src\\cli\\', 'src\\commands\\', 'src\\common\\', 'src\\components\\',
            'src\\config\\', 'src\\constants\\', 'src\\context\\', 'src\\core\\',
            'src\\diagnostics\\', 'src\\error\\', 'src\\hooks\\', 'src\\infrastructure\\',
            'src\\ink\\', 'src\\knowledge\\', 'src\\media\\', 'src\\memory\\',
            'src\\monitoring\\', 'src\\oauth\\', 'src\\plugin-sdk\\', 'src\\plugins\\',
            'src\\promptSuggestion\\', 'src\\sandbox\\', 'src\\services\\',
            'src\\session\\', 'src\\skills\\', 'src\\state\\', 'src\\tasks\\',
            'src\\testing\\', 'src\\tools\\', 'src\\trace-recording\\',
            'src\\ui\\', 'src\\utils\\',
        ];

        for (const file of this.allFiles) {
            const basename = file.split(/[/\\]/).pop() || '';
            if (basename !== 'index.ts' && basename !== 'index.tsx') continue;

            const content = readFileSync(file, 'utf-8');
            const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);

            // 检查是否仅有 re-export 语句（export ... from ...）+ 空行/注释
            const nonReExportLines = lines.filter(l => {
                const trimmed = l.replace(/\/\/.*$/, '').trim(); // 去掉行内注释
                if (trimmed.length === 0) return false; // 空行
                if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return false; // 注释
                if (/^export\s+(type\s+)?\{\s*\}/.test(trimmed)) return false; // export {} 空导出
                // 判断是否为 re-export
                if (/^export\s+(type\s+)?\*?\s*\{.*\}\s*from\s/.test(trimmed)) return false;
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
            if (allowedModuleDirs.some(dir => relFile.startsWith(dir))) {
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
                suggestion: `Barrel 文件不利于 tree-shaking，请考虑是否必要\n  受影响文件:\n${barrelFiles.slice(0, 10).map(f => `    - ${f}`).join('\n')}${barrelFiles.length > 10 ? `\n    ... 及其他 ${barrelFiles.length - 10} 个` : ''}`,
            });
        }

        console.log(`\n[Barrel 文件] 发现 ${barrelCount} 个 barrel 文件（仅 re-export）`);
    }

    /** R05-011: Message 模型引用检查 — 检查 Message 类型的混乱引用 */
    async checkMessageModelImports(): Promise<void> {
        // 定义规范的 Message 类型来源
        const canonicalPaths = [
            'chat/types/message',
            'chat/types/message.ts',
            '@modules/chat/types/message',
        ];

        // 已知例外的文件（域级私有 Message 类型，非规范类型冲突）
        const knownExceptions = [
            'agent/TitleGenerator.ts',
            'chat/types/ToolUseBlock.ts',
            'services/compact/ContextEngine.ts',
            'subagent/SubAgentCommunicator.ts',
            'ui/components/Messages.tsx',
        ];

        // 收集所有导出 Message 类型的文件
        const messageDefs: Array<{ file: string; kind: string }> = [];

        for (const file of this.allFiles) {
            const relPath = relative(this.srcPath, file).replace(/\\/g, '/');

            // 跳过规范路径
            if (canonicalPaths.some(p => relPath.includes(p))) continue;

            // 跳过已知例外
            if (knownExceptions.some(e => relPath.includes(e))) continue;

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
                message: `存在 ${messageDefs.length} 个文件自行定义了 Message 类型，未使用 chat/types/message.ts 的规范定义`,
                suggestion: `请统一引用 chat/types/message.ts 的 Message 类型\n  受影响文件:\n${messageDefs.slice(0, 10).map(d => `    - ${d.file} (${d.kind})`).join('\n')}${messageDefs.length > 10 ? `\n    ... 及其他 ${messageDefs.length - 10} 个` : ''}`,
            });
        }

        console.log(`\n[Message 模型] ${messageDefs.length} 个文件自定 Message 类型（规范来源: chat/types/message.ts）`);
    }

    /** R05-013: 类型中心重复定义检测 — 检查模块本地类型是否已在 src/types/ 中定义 */
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
            'chat/types/tool.ts',
            'chat/types/ToolUseBlock.ts',
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
            // 服务层消息
            'services/compact/ContextEngine.ts',
            // UI 组件消息
            'ui/components/Messages.tsx',
        ];

        let conflictCount = 0;
        const conflicts: Array<{ file: string; name: string }> = [];

        for (const file of this.allFiles) {
            // 跳过类型中心文件本身
            if (file.startsWith(typeCenterDir)) continue;
            // 跳过已知安全模式
            if (knownSafePatterns.some(p => p.test(file))) continue;
            // 跳过已知例外
            const relFile = relative(this.srcPath, file).replace(/\\/g, '/');
            if (knownExceptions.some(e => relFile.includes(e))) continue;

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
                .map(([name, files]) => `    ${name}: ${files.length} 处 — ${files.slice(0, 3).join(', ')}${files.length > 3 ? `... (共 ${files.length} 处)` : ''}`)
                .join('\n');

            this.violations.push({
                ruleId: 'R05-013',
                severity: 'warning',
                file: conflicts[0].file,
                message: `存在 ${conflictCount} 处类型定义与类型中心 src/types/ 冲突（${byType.size} 个类型名）`,
                suggestion: `请考虑从 @modules/types 导入已有类型，而非重新定义:\n${details}\n  如需保留独立定义，请将文件加入 knownExceptions`,
            });
        }

        console.log(`\n[类型中心冲突] ${conflictCount} 处冲突（${[...new Set(conflicts.map(c => c.name))].length} 个类型名）`);
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
            'XDG_SESSION_TYPE',     // Linux 桌面会话类型（系统信息，非配置变量）
        ]);

        // 已知例外的文件路径片段（边界场景，合理的 process.env 直接访问）
        const knownExceptions = [
            // 测试文件（通过 __tests__ 目录和 .test.ts 文件跳过）
            // 入口点文件（启动阶段 ConfigManager 尚未就绪）
            'entrypoints/cli.tsx',
            'main.ts',
            'pyapp.ts',
            // CLI 命令和环境变量交互
            'cli/handlers/utilHandler.ts',
            'commands/login/login.ts',
            'commands/logout/logout.ts',
            // 系统上下文读取（非配置变量）
            'context/context.ts',
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
            if (knownExceptions.some(e => file.replace(/\\/g, '/').includes(e))) continue;

            const content = readFileSync(file, 'utf-8');
            const envPattern = /process\.env\.(\w+)/g;
            let match: RegExpExecArray | null;

            const foundVars: string[] = [];
            while ((match = envPattern.exec(content)) !== null) {
                const varName = match[1];
                if (!whitelist.has(varName)) {
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
                suggestion: `请通过 ConfigManager 统一访问环境变量\n  违规文件 (top 5):\n${violatingFiles.slice(0, 5).map(f => `    - ${f.file}: ${f.vars.join(', ')}`).join('\n')}${violatingFiles.length > 5 ? `\n    ... 及其他 ${violatingFiles.length - 5} 个文件` : ''}`,
            });
        }

        console.log(`\n[Config/Env] ${totalAccess} 处 process.env 直接访问（${violatingFiles.length} 个文件）`);
    }

    /** R05-008: 重复依赖检查 — 扫描 package.json 中功能重叠的依赖 */
    async checkDuplicateDependencies(): Promise<void> {
        const packageJsonPath = resolve(process.cwd(), 'app', 'package.json');
        if (!existsSync(packageJsonPath)) return;

        const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

        // 定义已知功能重叠的依赖组
        const overlappingGroups: Array<{ name: string; packages: string[]; suggestion: string }> = [
            {
                name: 'Schema 校验',
                packages: ['ajv', 'zod', '@sinclair/typebox'],
                suggestion: '请统一使用一种 schema 校验库，推荐 Zod',
            },
        ];

        const violations: Array<{ group: string; found: string[]; suggestion: string }> = [];

        for (const group of overlappingGroups) {
            const found = group.packages.filter(p => p in allDeps);
            if (found.length >= 2) {
                violations.push({ group: group.name, found, suggestion: group.suggestion });
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

        const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf-8'));
        const excluded = new Set((tsconfig.exclude || []).map((e: string) => e.replace(/\/\*\*$/, '')));

        // 检查被 tsconfig 排除但应纳入类型检查的目录
        const blindSpotDirs = [
            'src/hooks', 'src/chat', 'src/governance', 'src/memory',
            'src/plugins', 'src/session', 'src/sandbox', 'src/permission',
            'src/mcp', 'src/llm', 'src/subagents', 'src/subagent',
        ];

        const actualBlindSpots = blindSpotDirs.filter(dir => {
            for (const ex of excluded) {
                const exPrefix = ex.replace(/\/\*$/, '');
                if (dir.startsWith(exPrefix)) return true;
            }
            return false;
        });

        // 检查 tsconfig.eslint.json 是否覆盖更广
        const eslintTsconfigPath = resolve(process.cwd(), 'app', 'tsconfig.eslint.json');
        let eslintExcludesMore = false;
        if (existsSync(eslintTsconfigPath)) {
            const eslintTsconfig = JSON.parse(readFileSync(eslintTsconfigPath, 'utf-8'));
            const eslintExcluded = new Set((eslintTsconfig.exclude || []).map((e: string) => e.replace(/\/\*$/, '')));
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
                suggestion: `以下目录被 tsconfig.json 排除，tsc 不进行类型检查，属于盲区:\n${actualBlindSpots.map(d => `    - ${d}`).join('\n')}\n请逐步缩小 exclude 列表，将这些目录纳入类型检查`,
            });
        }

        if (!eslintExcludesMore) {
            this.violations.push({
                ruleId: 'R05-007',
                severity: 'warning',
                file: 'app/tsconfig.eslint.json',
                message: 'tsconfig.eslint.json 的 exclude 列表与 tsconfig.json 相同，未扩大类型检查范围',
                suggestion: 'tsconfig.eslint.json 应缩小 exclude 列表，让 ESLint 检查更多文件以弥补类型检查盲区',
            });
        }

        console.log(`\n[tsconfig/ESLint] ${actualBlindSpots.length} 个目录存在类型检查盲区`);
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
            if (file.includes(canonicalPath.replace(/\//g, '\\')) || file.includes(canonicalPath.replace(/\\/g, '/'))) continue;
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
                    violatingFiles.push({ file: relative(process.cwd(), file), line: lineNum });
                    healthCheckCount++;
                    continue;
                }

                // 检测自建 /health 端点
                if (/['"`]\/health['"`]/.test(line) && !content.includes(canonicalPath)) {
                    if (knownHealthEndpointFiles.some(e => file.includes(e))) {
                        continue;
                    }
                    violatingFiles.push({ file: relative(process.cwd(), file), line: lineNum });
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
                suggestion: `请将所有健康检查逻辑统一到 monitoring/health/HealthChecker.ts 注册\n  ${violatingFiles.slice(0, 10).map(f => `- ${f.file}:${f.line}`).join('\n  ')}${violatingFiles.length > 10 ? `\n  ... 及其他 ${violatingFiles.length - 10} 处` : ''}`,
            });
        }

        console.log(`\n[R01-005 健康检查] ${healthCheckCount} 处自建健康检查`);
    }

    // ============ P1a-T1-S2: R02-003 Session 模型统一 ============

    /** R02-003: 检查 Session ID 是否使用 acp/types.ts 的统一 SessionId */
    async checkSessionModel(): Promise<void> {
        const canonicalPaths = [
            'acp/types',
            'acp/types.ts',
            '@modules/acp/types',
        ];

        const knownExceptions = [
            'session/Session.ts',       // Session 类自身的 ID 字段
            'session/SessionManager.ts', // SessionManager 中的 ID 管理
        ];

        const sessionIdDefs: Array<{ file: string; typeName: string }> = [];

        for (const file of this.allFiles) {
            const relPath = relative(this.srcPath, file).replace(/\\/g, '/');

            // 跳过规范路径
            if (canonicalPaths.some(p => relPath.includes(p))) continue;
            // 跳过已知例外
            if (knownExceptions.some(e => relPath.includes(e))) continue;

            const content = readFileSync(file, 'utf-8');

            // 检测自定 SessionId 或 SessionID 类型（非 import 重新导出）
            const sessionIdPattern = /export\s+(interface|type)\s+(SessionId|SessionID)\b/g;
            let match: RegExpExecArray | null;
            while ((match = sessionIdPattern.exec(content)) !== null) {
                // 排除从规范路径 re-export 的场景
                const beforeMatch = content.substring(0, match.index);
                if (beforeMatch.includes("from '") || beforeMatch.includes('from "')) {
                    // 检查 export { ... } from 语法
                    const lastExport = beforeMatch.lastIndexOf('export');
                    if (lastExport >= 0) {
                        const exportLine = content.substring(lastExport, match.index).trim();
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
                suggestion: `请统一引用 acp/types.ts 的 SessionId（branded type）\n  受影响文件:\n${sessionIdDefs.slice(0, 10).map(d => `    - ${d.file} (${d.typeName})`).join('\n')}${sessionIdDefs.length > 10 ? `\n    ... 及其他 ${sessionIdDefs.length - 10} 个` : ''}`,
            });
        }

        console.log(`\n[R02-003 Session 模型] ${sessionIdDefs.length} 个文件自定 SessionId/SessionID 类型`);
    }

    // ============ P1a-T1-S3: R03-002 模块出口单一 ============

    /** R03-002: 检查模块是否从子目录直接 import（应通过 index.ts 出口） */
    async checkModuleSingleExport(): Promise<void> {
        // 定义已知的模块根目录
        const moduleRoots = new Set([
            'acp', 'agent', 'ai', 'bridge', 'cache', 'channels', 'chat',
            'chronos', 'cli', 'commands', 'config', 'context', 'core',
            'cost', 'diagnostics', 'error', 'gateway', 'hooks', 'infrastructure',
            'ink', 'llm', 'mcp', 'memory', 'monitoring', 'oauth', 'permission',
            'performance', 'plugins', 'promptSuggestion', 'query', 'remote',
            'runtime', 'sandbox', 'services', 'session', 'skillCode', 'state',
            'subagent', 'subagents', 'tasks', 'tools', 'types', 'ui', 'utils', 'voice',
        ]);

        // 已知合法的子目录 import（框架内部、测试辅助等）
        const knownSubdirExceptions = [
            '/__tests__/',    // 测试文件可自由 import
            '.test.ts',       // 测试文件
            '.spec.ts',       // 测试文件
            '/node_modules/', // 跳过
        ];

        const violations: Array<{ importer: string; targetModule: string; subDir: string }> = [];

        for (const file of this.allFiles) {
            // 跳过测试文件
            if (knownSubdirExceptions.some(e => file.includes(e))) continue;

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
                // 如果 subPath 是 index 或 index.js，不算违规
                if (subPath === 'index' || subPath === 'index.js') continue;

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

                const resolvedRel = relative(this.srcPath, resolved).replace(/\\/g, '/');
                const parts = resolvedRel.split('/');
                if (parts.length < 3) continue; // 同一模块内或根目录，跳过

                const targetModule = parts[0];
                const subDir = parts[1];

                // 如果目标是不同类型模块或非模块根，跳过
                if (!moduleRoots.has(targetModule)) continue;
                if (targetModule === importerModule) continue; // 同模块，跳过

                // 跳过 index 入口
                const fileName = parts[parts.length - 1];
                if (fileName === 'index.ts' || fileName === 'index.tsx' || fileName === 'index.js') continue;

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
                severity: 'warning',
                file: violations[0].importer,
                message: `存在 ${violations.length} 处从模块子目录直接 import 的行为（应通过模块 index.ts 出口导入）`,
                suggestion: `请改为从模块 index.ts 出口导入\n  示例 (top 5):\n${violations.slice(0, 5).map(v => `    - ${v.importer} → @modules/${v.targetModule}/${v.subDir}`).join('\n')}${violations.length > 5 ? `\n    ... 及其他 ${violations.length - 5} 处` : ''}`,
            });
        }

        console.log(`\n[R03-002 模块出口单一] ${violations.length} 处子目录 import 违规`);
    }

    // ============ P1a-T1-S4: R03-004 消息路由管线统一 ============

    /** R03-004: 检查消息路由是否统一通过 routeChannelMessage() */
    async checkMessageRouting(): Promise<void> {
        const canonicalPath = 'channels/routing/messageRouter';
        let directChatCalls = 0;
        const violatingFiles: Array<{ file: string; line: number; detail: string }> = [];

        for (const file of this.allFiles) {
            // 跳过自身和测试文件
            if (file.includes(canonicalPath.replace(/\//g, '\\')) || file.includes(canonicalPath.replace(/\\/g, '/'))) continue;
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
                suggestion: `所有入站消息必须通过 channels/routing/messageRouter.ts 的 routeChannelMessage() 统一处理\n  ${violatingFiles.slice(0, 10).map(f => `- ${f.file}:${f.line} — ${f.detail}`).join('\n  ')}${violatingFiles.length > 10 ? `\n  ... 及其他 ${violatingFiles.length - 10} 处` : ''}`,
            });
        }

        console.log(`\n[R03-004 消息路由] ${directChatCalls} 处直接 CoreAPI.chat() 调用`);
    }

    // ============ R00 分层合规 ============

    private layerExceptions: Set<string> = new Set();
    private exceptionData: { bulk: any[]; perModule: any[] } = { bulk: [], perModule: [] };
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
            this.layerExceptions.add(`${ex.ruleId}:${ex.sourceModule}:${ex.targetModule}`);
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

        console.log(`已加载 ${this.layerExceptions.size} 条有效分层例外 + ${this.fileSizeExceptions.size} 条文件大小例外 + ${this.barrelExceptions.size} 条桶文件例外 + ${this.tinyFileExceptions.size} 条微小文件例外`);
    }

    /** 判断文件是否在 R04-001 豁免清单中 */
    isFileSizeExempt(relPath: string): boolean {
        const normalized = relPath.replace(/\\/g, '/').toLowerCase();
        // 适配两种 cwd：项目根（app/src/...）或 app 目录（src/...）
        const withAppPrefix = normalized.startsWith('app/') ? normalized : `app/${normalized}`;
        if (this.fileSizeExceptions.has(normalized) || this.fileSizeExceptions.has(withAppPrefix)) {
            return true;
        }
        // pattern 例外匹配（BULK R04-001）
        return this.fileSizePatterns.some((p) => p.test(normalized) || p.test(withAppPrefix));
    }

    /** 判断文件是否在 R06-010 桶文件豁免清单中 */
    isBarrelExempt(relPath: string): boolean {
        const normalized = relPath.replace(/\\/g, '/').toLowerCase();
        const withAppPrefix = normalized.startsWith('app/') ? normalized : `app/${normalized}`;
        return this.barrelExceptions.has(normalized) || this.barrelExceptions.has(withAppPrefix);
    }

    /** 判断跨层依赖是否已被豁免 */
    isException(ruleId: string, srcModule: string, tgtModule: string): boolean {
        const srcLayer = this.moduleToLayer.get(srcModule) || '';
        const tgtLayer = this.moduleToLayer.get(tgtModule) || '';

        // 检查按模块精确例外
        if (this.layerExceptions.has(`${ruleId}:${srcModule}:${tgtModule}`)) return true;

        // 检查批量例外（按 layer 模式匹配）
        const pattern = `${srcLayer} -> ${tgtLayer}`;
        if (this.layerExceptions.has(`${ruleId}:${pattern}`)) return true;

        return false;
    }

    /** 加载分层映射配置 */
    async loadLayerMapping(): Promise<void> {
        const mappingPath = resolve(__dirname, 'modules-to-layers.json');
        if (!existsSync(mappingPath)) {
            console.warn('⚠ 警告: scripts/modules-to-layers.json 不存在，跳过分层检查');
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

    /** 解析 import 语句，提取跨模块依赖 */
    parseModuleImports(filePath: string): Set<string> {
        const content = readFileSync(filePath, 'utf-8');
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

    /** R00-001: 检查分层合规 */
    async checkLayerCompliance(): Promise<void> {
        await this.loadLayerMapping();
        if (this.moduleToLayer.size === 0) return;

        await this.loadLayerExceptions();

        console.log('\n运行分层合规检查 (R00-001)...');
        let checked = 0;
        let violationCount = 0;
        let exemptedCount = 0;

        for (const file of this.allFiles) {
            const srcModule = this.resolveModuleName(file);
            const srcLayer = this.moduleToLayer.get(srcModule);
            if (!srcLayer) continue;

            const allowedLayers = this.allowedDeps[srcLayer] || [];
            const targetModules = this.parseModuleImports(file);

            for (const tgtModule of targetModules) {
                if (tgtModule === srcModule) continue;
                const tgtLayer = this.moduleToLayer.get(tgtModule);
                if (!tgtLayer) continue;
                if (allowedLayers.includes(tgtLayer)) continue;

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
            checked++;
        }
        console.log(`分层检查完成: 检查 ${checked} 个文件 | 违规 ${violationCount} | 已豁免 ${exemptedCount}`);
    }

    // ============ P1 新增检查（AR/GR 规则） ============

    /** R06-009-1: 检查文件行数下限（碎片归集） */
    async checkFileSizeLower(): Promise<void> {
        const MIN_LINES = 100;
        // 排除模式：类型定义、barrel、测试、.d.ts、配置文件
        const excludePatterns = [
            /[\\/]types\.ts$/, /[\\/]index\.ts$/, /[\\/]constants\.ts$/,
            /\.d\.ts$/, /\.test\.ts$/, /\.test\.tsx$/,
            /[\\/]__tests__[\\/]/, /[\\/]__mocks__[\\/]/,
            /[\\/]config-schema\.ts$/, /[\\/]schemas\.ts$/,
            // 排除已知合理的微文件
            /[\\/]commands[\\/]builtin[\\/]/, // 命令声明待 P2 归集
            /[\\/]channels[\\/].*[\\/]config-schema\.ts$/,
        ];

        let checked = 0;
        let fragmentCount = 0;
        for (const file of this.allFiles) {
            const relPath = relative(process.cwd(), file);
            if (excludePatterns.some(p => p.test(relPath))) continue;

            const content = readFileSync(file, 'utf-8');
            const lines = content.split('\n').length;

            if (lines < MIN_LINES) {
                this.violations.push({
                    ruleId: 'R06-009-1',
                    severity: 'warning',
                    file: relPath,
                    message: `文件仅 ${lines} 行，低于 ${MIN_LINES} 行下限，建议合并到相关文件`,
                    suggestion: '检查是否可以合并到同领域的大文件，或与其他小文件聚合为数据驱动模块',
                });
                fragmentCount++;
            }
            checked++;
        }
        console.log(`文件下限检查完成: 检查 ${checked} 个文件 | 碎片 ${fragmentCount}`);
    }

    /** R06-006-2: 检查僵尸薄转发方法 */
    async checkZombieForward(): Promise<void> {
        let zombieCount = 0;

        for (const file of this.allFiles) {
            const content = readFileSync(file, 'utf-8');
            const relPath = relative(process.cwd(), file);
            const lines = content.split('\n');

            // 查找方法签名，然后检查方法体是否只有一行 return
            // 匹配: private/public/protected/async methodName(...) ... {
            const methodRegex = /(?:private|public|protected|async|\s)+(?:static\s+)?(\w+)\s*\([^)]*\)[^{]*\{/g;
            let match;
            // 使用 while 循环检查每个匹配
            const contentCopy = content;
            const methodRegexGlobal = new RegExp(methodRegex.source, 'g');
            while ((match = methodRegexGlobal.exec(contentCopy)) !== null) {
                const methodName = match[1];
                // 过滤保留字，排除 if/for/while 等控制流语句被误判为方法
                if (RESERVED_WORDS.has(methodName)) continue;
                const bodyStart = match.index + match[0].length;
                const bodyMatch = contentCopy.slice(bodyStart);

                // 找到匹配的 }
                let depth = 1;
                let bodyEnd = 0;
                for (let i = 0; i < bodyMatch.length && depth > 0; i++) {
                    if (bodyMatch[i] === '{') depth++;
                    else if (bodyMatch[i] === '}') { depth--; if (depth === 0) bodyEnd = i; }
                }
                if (bodyEnd === 0) continue;

                const body = bodyMatch.slice(0, bodyEnd).trim();
                const bodyLines = body.split('\n').filter(l => l.trim() !== '');

                // 僵尸方法：方法体仅一行 return xxx() 且无其他逻辑
                if (bodyLines.length === 1) {
                    const singleLine = bodyLines[0].trim();
                    if (/^return\s+\w+\(/.test(singleLine) && !singleLine.includes('if') && !singleLine.includes('try') && !singleLine.includes('await')) {
                        // 排除一些合理的一行方法（如 getter）
                        const fullLine = lines[lines.length - 1]; // 近似行号
                        this.violations.push({
                            ruleId: 'R06-006-2',
                            severity: 'warning',
                            file: relPath,
                            message: `方法 "${methodName}" 疑似僵尸薄转发（仅一行 return 调用）`,
                            suggestion: '确认调用方是否已全部迁移，若已迁移则删除此方法。禁止新增此类方法',
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
        const MODULE_ROOTS = ['chat', 'core', 'ai', 'permission', 'tools', 'channels',
            'infrastructure', 'modules', 'services', 'query', 'session', 'memory',
            'agent', 'dream', 'bridge', 'mcp', 'skills', 'plugins', 'notebook'];

        let barrelCount = 0;
        let overflowCount = 0;

        for (const file of this.allFiles) {
            const relPath = relative(process.cwd(), file);
            const baseName = relPath.split(/[\\/]/).pop() || '';

            // 只检查 index.ts
            if (baseName !== 'index.ts') continue;

            const content = readFileSync(file, 'utf-8');
            const lines = content.split('\n').filter(l => l.trim() !== '');

            // 判断是否为纯 barrel 文件（仅含 export/re-export）
            const nonExportLines = lines.filter(l => {
                const trimmed = l.trim();
                return trimmed !== '' && !trimmed.startsWith('//') && !trimmed.startsWith('/*') &&
                    !trimmed.startsWith('*') && !trimmed.startsWith('export') && !trimmed.startsWith('}');
            });

            // 如果有非 export 的代码，不是纯 barrel
            if (nonExportLines.length > 0) continue;

            const exportCount = lines.filter(l => l.trim().startsWith('export')).length;

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
        console.log(`桶文件检查完成: ${barrelCount} 个 barrel | 超限 ${overflowCount}`);
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
        console.log(`命令碎片检查完成: ${totalFiles} 个命令 | 微文件 ${microFileCount}`);
    }

    /** R07-003: 检查薄桶（re-export ≤2 符号的 index.ts，碎片归集防回潮） */
    async checkThinBarrels(): Promise<void> {
        // 与 checkBarrelFiles 一致的模块入口豁免（模块公共 API 边界）
        const allowedModuleDirs = [
            'src\\agent\\', 'src\\ai\\', 'src\\bridge\\', 'src\\channels\\',
            'src\\cli\\', 'src\\commands\\', 'src\\common\\', 'src\\components\\',
            'src\\config\\', 'src\\constants\\', 'src\\context\\', 'src\\core\\',
            'src\\diagnostics\\', 'src\\error\\', 'src\\hooks\\', 'src\\infrastructure\\',
            'src\\ink\\', 'src\\knowledge\\', 'src\\media\\', 'src\\memory\\',
            'src\\monitoring\\', 'src\\oauth\\', 'src\\plugin-sdk\\', 'src\\plugins\\',
            'src\\promptSuggestion\\', 'src\\sandbox\\', 'src\\services\\',
            'src\\session\\', 'src\\skills\\', 'src\\state\\', 'src\\tasks\\',
            'src\\testing\\', 'src\\tools\\', 'src\\trace-recording\\',
            'src\\ui\\', 'src\\utils\\',
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
            if (allowedModuleDirs.some(dir => relFile.startsWith(dir))) continue;

            const content = readFileSync(file, 'utf-8');
            // 纯 re-export 桶判定（与 checkBarrelFiles 相同逻辑）
            const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            const nonReExportLines = lines.filter(l => {
                const t = l.replace(/\/\/.*$/, '').trim();
                if (t.length === 0) return false;
                if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) return false;
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
            for (const m of content.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}\s*from/g)) {
                symbolCount += m[1].split(',').filter(s => s.trim().length > 0).length;
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
                suggestion: `薄桶应按 R07-003 删除并将引用改指实现文件\n  受影响文件:\n${thinFiles.slice(0, 10).map(f => `    - ${f}`).join('\n')}${thinFiles.length > 10 ? `\n    ... 及其他 ${thinFiles.length - 10} 个` : ''}`,
            });
        }
        console.log(`\n[薄桶检查 R07-003] 发现 ${thinCount} 个薄桶（re-export ≤${MAX_REEXPORT_SYMBOLS} 符号）`);
    }

    /** R07-001: 检查 <10 行的微小源码文件（碎片化防回潮） */
    async checkTinyFiles(): Promise<void> {
        const MIN_LINES = 10;
        const excludePatterns = [
            /\.d\.ts$/, /\.test\.ts$/, /\.test\.tsx$/,
            /[\\/]__tests__[\\/]/, /[\\/]__mocks__[\\/]/,
            /[\\/]index\.ts$/, // barrel 由 R07-003 单独治理
            /[\\/]ink[\\/]/, // ink 为本地化第三方库，保持库内文件结构
        ];
        // 纯 re-export 桶豁免：内容全部为 `export ... from '...'` 的文件交由 R07-003 治理
        const reExportRe = /^export\s+(?:type\s+|default\s+)?[^;]*\s+from\s+['"]/;

        let tinyCount = 0;
        const tinyFiles: string[] = [];
        for (const file of this.allFiles) {
            const relPath = relative(process.cwd(), file);
            if (excludePatterns.some(p => p.test(relPath))) continue;
            if (this.isTinyFileExempt(relPath)) continue;
            const content = readFileSync(file, 'utf-8');
            const codeLines = content.split('\n')
                .map(l => l.trim())
                .filter(l => l && !l.startsWith('//') && !l.startsWith('/*') && !l.startsWith('*') && !l.startsWith('//#'));
            if (codeLines.length > 0 && codeLines.every(l => reExportRe.test(l))) continue;
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
                suggestion: `微小文件应按 R07-001 归并到同域模块\n  受影响文件:\n${tinyFiles.slice(0, 10).map(f => `    - ${f}`).join('\n')}${tinyFiles.length > 10 ? `\n    ... 及其他 ${tinyFiles.length - 10} 个` : ''}`,
            });
        }
        console.log(`[微小文件检查 R07-001] 发现 ${tinyCount} 个 <${MIN_LINES} 行文件`);
    }

    /** R07-001 豁免：已登记的微小文件例外 */
    isTinyFileExempt(relPath: string): boolean {
        const normalized = relPath.replace(/\\/g, '/').toLowerCase();
        const withAppPrefix = normalized.startsWith('app/') ? normalized : `app/${normalized}`;
        return this.tinyFileExceptions.has(normalized) || this.tinyFileExceptions.has(withAppPrefix);
    }

    /** R07-002: 检查 license 文件头重复（模板复制防回潮，warning 级与 project_rules §1.2 建议不冲突） */
    async checkLicenseHeaderDuplication(): Promise<void> {
        const MAX_HEADER_COUNT = 10;
        const headerCounts = new Map<string, { count: number; samples: string[] }>();

        for (const file of this.allFiles) {
            const relPath = relative(process.cwd(), file);
            if (/\.test\.ts$/.test(relPath) || /\.test\.tsx$/.test(relPath)) continue;
            const content = readFileSync(file, 'utf-8');
            const lines = content.split('\n').slice(0, 21);
            const firstLine = lines[0]?.trim() || '';
            if (!firstLine.startsWith('/*') && !firstLine.startsWith('//')) continue;
            const header = lines.join('\n').trim();
            if (header.length < 40) continue;
            const entry = headerCounts.get(header) || { count: 0, samples: [] };
            entry.count++;
            if (entry.samples.length < 3) entry.samples.push(relPath);
            headerCounts.set(header, entry);
        }

        const duplicates = [...headerCounts.entries()].filter(([, v]) => v.count > MAX_HEADER_COUNT);
        if (duplicates.length > 0) {
            const [header, info] = duplicates.sort((a, b) => b[1].count - a[1].count)[0];
            void header;
            this.violations.push({
                ruleId: 'R07-002',
                severity: 'warning',
                file: info.samples[0],
                message: `相同文件头重复 ${info.count} 次（阈值 ${MAX_HEADER_COUNT}），存在模板复制`,
                suggestion: `文件头（如 MIT license 21 行）在 ${info.count} 个文件中重复，建议仓库根只保留一份 LICENSE，源码文件不再复制\n  样例文件: ${info.samples.join(', ')}`,
            });
        }
        console.log(`[license 头检查 R07-002] ${duplicates.length} 组重复文件头（>${MAX_HEADER_COUNT} 次）`);
    }

    /**
     * R08-001: 检查后台任务模块的跨重启状态持久化（P1 反模式防回潮）
     * 检测后台模块中"纯内存计数器/状态变量 + 递增"且文件内无任何持久化手段的模式。
     * 参考：buddy/growthPersistence.ts 落盘 JSON、buddy/dreamLogStore.ts 追加式 JSONL。
     */
    async checkBackgroundPersistence(): Promise<void> {
        // 有状态的后台任务模块目录
        const statefulDirRe = /[\\/](buddy|chronos|memory|knowledge|cost|usage|session)[\\/]/;
        // 持久化关键词：文件含任一即视为已落盘，不判违规
        const persistKeywords = /Persistence|persistence|LogStore|logStore|Storage|storage|writeFile|writeFileSync|readFile|saveTo|\.jsonl?|resolveDbPath|Database|database/i;
        // 模块级计数器（行首无缩进）+ 类字段计数器（带 private/public 修饰符），排除函数体内局部变量
        const counterRe = /^(?:let\s+(\w+)\s*=\s*0| {2,4}(?:private|protected|public)\s+(\w+)\s*=\s*0)\s*;/gm;

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
            const hasIncrement = [...counters].some(name => {
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
                suggestion: '按 R08-001 将跨重启状态落盘到 ~/.pyapp/data/（参考 buddy/growthPersistence.ts），或确认该状态为一次性运行态',
            });
        }
        console.log(`[后台状态检查 R08-001] ${counterFiles} 个后台模块存在疑似纯内存计数器/状态`);
    }

    /**
     * R08-002: 检查后台任务循环是否有日志记录（P2 反模式防回潮）
     * 检测 setInterval 回调体内无任何 logger.* 调用 → "跑了没跑、为什么没跑"无从得知。
     */
    async checkBackgroundEventLogging(): Promise<void> {
        const intervalRe = /setInterval\(\s*(?:async\s+)?(?:\(\)\s*=>|function\s*\(\s*\)\s*)\s*\{([\s\S]*?)\}\s*,\s*\d+\s*\)/g;
        const loggerRe = /logger\.\s*(info|warn|error|debug|trace)\s*\(/;
        // UI 动画循环豁免：回调体仅含 UI 状态更新（setXxx/setState/useState setter/光标闪烁等），
        // 非后台任务，不适用 R08-002 四类事件日志（避免给 spinner/loading 动画强加日志）。
        const uiAnimationRe = /^\s*(set[A-Z]\w*\([^;]*\);?|setState\([^;]*\);?|cursorBlink\.\w+\s*=\s*[^;]+;)\s*$/;
        // 终端 spinner/进度动画豁免：帧绘制（process.stdout.write + 帧索引取模），高频 UI 输出，非后台任务
        const terminalAnimationRe = /process\.stdout\.write[\s\S]*?%\s*(frames|FRAMES|\w+\.length)/;

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
                    suggestion: '按 R08-002 记录 start/skip(带原因)/fail(带错误)/complete(带结果) 四类事件，skip 与 fail 至少 warn 级',
                });
                break; // 每文件最多报 1 条，避免刷屏
            }
        }
        console.log(`[后台事件检查 R08-002] ${silentLoops} 个后台任务循环无日志记录（豁免 UI 动画 ${uiAnimationLoops} 个）`);
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
                    suggestion: '改用 getLogger(module)（默认 INFO/json 形态）或 createModule(module).logger；自定义 level/redact 形态属存量回退清单，需人工确认',
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
        const defFile = this.allFiles.find(f => norm(f).includes('/modules/ModuleDefinitions.ts'));
        const stratFile = this.allFiles.find(f => norm(f).includes('/modules/LazyModuleStrategy.ts'));
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
        const critical = [...(defIdx >= 0 ? body.slice(0, defIdx) : body).matchAll(idRe)].map(m => m[1]);
        const deferred = [...(defIdx >= 0 ? body.slice(defIdx) : '').matchAll(idRe)].map(m => m[1]);
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
            if (prio) strategy.set(m[1], { priority: prio[1], loadMode: loadMode?.[1] });
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
                    suggestion: '在 ModuleDefinitions.ts 的 MODULE_INITIALIZATION_ORDER 中按优先级阶段补充该模块',
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
                    suggestion: '在 LazyModuleStrategy.ts 中补充 ' + `'${id}': { priority: ModuleLoadPriority.X, ... }`,
                });
            }
        }
        console.log(`[模块阶段对齐 R10-004] ${errors} 处错误 / ${warnings} 处缺失优先级声明: ${[...orderAll].filter(id => !strategy.has(id)).join(', ')}`);
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
            const present = hookNames.filter(h =>
                new RegExp(`(?:async\\s+)?\\b${h}\\s*\\(\\)\\s*(?::[^{]*)?\\{`).test(content)
            );
            if (present.length === 0 || present.length === 3) continue;

            partialModules++;
            this.violations.push({
                ruleId: 'R10-003',
                severity: 'warning',
                file: relPath,
                message: `模块生命周期钩子不完整（仅 ${present.join('/')}，缺 ${hookNames.filter(h => !present.includes(h)).join('/')}）`,
                suggestion: '实现完整生命周期契约 onLoad/onReady/onDestroy（ModuleBootstrapper 四阶段：REGISTER→LOAD→READY→DESTROY）',
            });
        }
        console.log(`[模块生命周期 R10-003] ${partialModules} 个模块存在部分生命周期钩子`);
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
                suggestion: '改精准 selector：useChatStore((s) => s.xxx) / useVoiceStore((s) => s.xxx)',
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

    const errors = violations.filter(v => v.severity === 'error');
    const warnings = violations.filter(v => v.severity === 'warning');

    console.log(`\n========== 架构合规检查结果 ==========`);
    console.log(`错误: ${errors.length}  警告: ${warnings.length}  总计: ${violations.length}`);
    console.log(`========================================\n`);

    // 按规则 ID 分组输出
    const byRule = new Map<string, RuleViolation[]>();
    for (const v of violations) {
        if (!byRule.has(v.ruleId)) byRule.set(v.ruleId, []);
        byRule.get(v.ruleId)!.push(v);
    }

    for (const [ruleId, items] of byRule) {
        const icon = items.every(v => v.severity === 'error') ? '❌' : '⚠️';
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