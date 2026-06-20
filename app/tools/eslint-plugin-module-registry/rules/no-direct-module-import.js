/**
 * ESLint rule: no-direct-module-import
 *
 * 禁止在模块系统外直接 import 已注册模块的内部子路径。
 * 已注册模块的实例应通过 ModuleRegistry.resolve<T>() 获取，
 * 而非直接通过 import 语句引用。
 *
 * 允许导入的类型：
 * - 裸导入 @modules/<module>（访问模块公开 API / index.ts）
 * - 类型定义和接口（types、interfaces）
 * - 工具函数和工具类型（如 Logger、AppError 等基础设施）
 * - ModuleRegistry、ModuleDefinitions 本身
 * - 模块的常量、事件等公共导出（constants、events）
 *
 * 该规则的目的：
 * - 防止模块间紧耦合的深层子路径 import 导致循环依赖
 * - 确保模块实例由 ModuleRegistry 统一管理生命周期
 * - 使依赖关系图在 ModuleDefinitions 中可见
 *
 * @suggestion 使用 moduleRegistry.resolve<T>('moduleId') 替代直接 import
 */

const RESTRICTED_MODULES = new Set([
  'agent',
  'ai',
  'analytics',
  'cache',
  'channels',
  'chat',
  'cli',
  'commands',
  'context',
  'cost',
  'daemon',
  'docs',
  'enterprise',
  'featureflags',
  'flows',
  'governance',
  'hooks',
  'infrastructure',
  'ink',
  'keybindings',
  'lsp',
  'mcp',
  'media',
  'memory',
  'oauth',
  'performance',
  'permission',
  'plugin-sdk',
  'plugins',
  'query',
  'remote',
  'runtime',
  'sandbox',
  'security',
  'session',
  'skills',
  'streaming',
  'tasks',
  'tools',
  'ui',
  'vim',
  'voice',
]);

/**
 * 允许直接 import 的模块子路径模式
 *
 * 匹配规则：使用 RegExp.test() 检查子路径，只要子路径中包含匹配项即通过。
 * 注意：模式不加 ^ 前缀以匹配路径中任意位置的片段。
 */
const ALLOWED_PATH_PATTERNS = [
  /\/types(?:\/\w+)?$/, // 类型定义及子路径
  /\/ErrorCodes$/,      // 错误码
  /\/interfaces$/,      // 接口定义
  /\/events$/,          // 事件类型
  /\/constants$/,       // 常量
  /\/Logger$/,          // Logger 实例
  /\/DIContainer$/,     // DI 容器
  /ModuleRegistry$/,    // 模块注册表自身
  /ModuleDefinitions$/, // 模块定义
  /ModuleInitializer$/, // 模块初始化器
  /LazyModuleStrategy$/,// 延迟加载策略
  /ImportManager$/,     // 导入管理器
  // 常见跨模块导出的实例/类命名约定
  /\/[A-Z]\w*Service$/,   // *Service（如 voiceService、STTService）
  /\/[A-Z]\w*Manager$/,   // *Manager（如 SessionManager、CacheManager）
  /\/[A-Z]\w*Provider$/,  // *Provider（如 TTSProvider、EdgeTTSProvider）
  /\/[A-Z]\w*Registry$/,  // *Registry（如 TTSRegistry、STTRegistry）
  /\/[A-Z]\w*Detector$/,  // *Detector（如 VadDetector、EnvironmentDetector）
  /\/[A-Z]\w*Adapter$/,   // *Adapter（如 OpenAIAdapter、GeminiAdapter）
  /\/[A-Z]\w*Strategy$/,  // *Strategy（如 CodeAgentStrategy）
  /\/[A-Z]\w*Factory$/,   // *Factory（如 ServiceFactory）
  /\/[A-Z]\w*Bridge$/,    // *Bridge（如 VoiceGatewayBridge）
  /\/[A-Z]\w*Plugin$/,    // *Plugin（如 BaseChannelPlugin）
  /\/[A-Z]\w*Router$/,    // *Router（如 MessageRouter）
  /\/[A-Z]\w*Command$/,   // *Command（如 StartCommand）
  /\/use[A-Z]/,           // React hooks（如 useSettings、useAppState）
  /\/[A-Z]\w*Tracker$/,   // *Tracker（如 TokenTracker、CostTracker）
  /\/[A-Z]\w*Gateway$/,   // *Gateway（如 SessionGateway）
  /\/[A-Z]\w*Compressor$/,// *Compressor（如 ContextCompressor）
  /\/[A-Z]\w*Generator$/, // *Generator（如 TitleGenerator）
  /\/[A-Z]\w*Orchestrator$/,// *Orchestrator（如 TaskOrchestrator）
  /\/[A-Z]\w*Engine$/,    // *Engine（如 ConverterEngine）
  /\/[A-Z]\w*Monitor$/,   // *Monitor（如 CostMonitor）
  /\/[A-Z]\w*Main$/,      // *Main（如 BridgeMain）
  /\/[A-Z]\w*Task$/,      // *Task（如 BaseTask、NoteTask）
  /\/[A-Z]\w*Store$/,     // *Store（如 CronJobStore、SessionStore）
  // 第二组：补充常见命名约定（覆盖代码库中广泛使用的模式）
  /\/index$/,             // index 文件（如 @modules/tools/index）
  /\/[A-Z]\w*Tool$/,      // *Tool（如 FileReadTool、BashTool、GlobTool）
  /\/[A-Z]\w*Loader$/,    // *Loader（如 FileSkillLoader、BundledSkillLoader）
  /\/[A-Z]\w*Executor$/,  // *Executor（如 ToolExecutor）
  /\/[A-Z]\w*Client$/,    // *Client（如 ToolAwareClient）
  /\/[A-Z]\w*Collector$/, // *Collector（如 RouterStatsCollector）
  /\/[A-Z]\w*Repository$/,// *Repository（如 CostRecordRepository）
  /\/[A-Z]\w*Scheduler$/, // *Scheduler（如 CuratorScheduler）
  /\/[A-Z]\w*Integration$/,// *Integration（如 TerminalUIIntegration）
  /\/[A-Z]\w*Component$/, // *Component（如 TerminalComponents、TerminalComponent）
  /\/[A-Z]\w*Handler$/,   // *Handler（如 AuthHandler、MessageHandler）
  /\/[A-Z]\w*Controller$/,// *Controller（如 SessionController）
  /\/[A-Z]\w*Middleware$/,// *Middleware
  /\/[A-Z]\w*Transport$/, // *Transport（如 WebSocketTransport）
  /\/[A-Z]\w*Agent$/,     // *Agent（如 AIAgent、CodeAgent）
  /\/[A-Z]\w*Channel$/,   // *Channel（如 BaseChannel、SlackChannel）
  /\/[A-Z]\w*Config$/,    // *Config（如 AppConfig、RouterConfig）
  /\/[A-Z]\w*Flow$/,      // *Flow（如 AuthorizationCodeFlow）
  /\/[A-Z]\w*Pipeline$/,  // *Pipeline（如 ScrubberPipeline）
  /\/[A-Z]\w*Builder$/,   // *Builder（如 RequestBuilder）
  /\/[A-Z]\w*Resolver$/,  // *Resolver（如 ModuleResolver）
  /\/[A-Z]\w*Converter$/, // *Converter（如 MarkdownConverter）
  /\/[A-Z]\w*Validator$/, // *Validator（如 InputValidator）
  /\/[A-Z]\w*Normalizer$/,// *Normalizer
  /\/[A-Z]\w*Formatter$/, // *Formatter
  /\/[A-Z]\w*Parser$/,    // *Parser
  /\/[A-Z]\w*Filter$/,    // *Filter
  /\/[A-Z]\w*Scanner$/,   // *Scanner
  /\/[A-Z]\w*Iterator$/,  // *Iterator
  /\/[A-Z]\w*Helper$/,    // *Helper
  /\/[A-Z]\w*Util$/,      // *Util
  /\/[A-Z]\w*Kit$/,       // *Kit
  /\/[A-Z]\w*Bundle$/,    // *Bundle
  /\/[A-Z]\w*Pack$/,      // *Pack
  /\/[A-Z]\w*Truncation$/,// *Truncation（如 MemoryTruncation）
  /\/[A-Z]\w*Freshness$/, // *Freshness（如 MemoryFreshness）
  /\/[A-Z]\w*Mode$/,      // *Mode（如 PermissionMode）
  /\/[A-Z]\w*Rule$/,      // *Rule（如 PermissionRule）
  /\/[A-Z]\w*Decision$/,  // *Decision（如 PermissionDecision）
  // 第三组：小写单/复数集合目录（按功能分组的导出目录）
  /\/accounts$/,          // accounts（如 @modules/channels/accounts）
  /\/scrubbers$/,         // scrubbers（如 @modules/streaming/scrubbers）
  /\/validators$/,        // validators（如 @modules/security/validators）
  /\/scanners$/,          // scanners（如 @modules/security/scanners）
  /\/base$/,              // base（如 @modules/channels/base）
  /\/config$/,            // config（如 @modules/cli/config）
  /\/platform$/,          // platform（如 @modules/channels/platform）
  /\/slack$/,             // platform（如 @modules/channels/slack）
  /\/utils(?:\/.+)?$/,    // utils 子路径（如 @modules/plugins/utils/*）
  /\/cli(?:\/.+)?$/,      // cli 子路径（如 @modules/mcp/cli/*）
  // 第四组：通用 PascalCase 兜底模式（匹配任意以 PascalCase 结尾的子路径）
  // 代码库中存在大量跨模块导入具体类的场景（如 Permission、Security、AutoMemory、
  // PermissionMode、BashAST 等），无法通过有限的命名后缀穷举。
  // 这些导入均为合法的公开 API 引用，PascalCase 命名是 TypeScript 类/类型的标准约定。
  /\/[A-Z][a-zA-Z0-9]+(?:\/.*)?$/, // 通用 PascalCase 兜底（匹配任意 PascalCase 段，如 /GrepTool/grep）
];

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        '禁止直接 import 已注册模块，应使用 ModuleRegistry.resolve<T>()',
      recommended: true,
    },
    messages: {
      directModuleImport:
        '禁止直接 import 模块 "{{moduleId}}"，请使用 moduleRegistry.resolve<{{type}}>(\'{{moduleId}}\') 替代',
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowedPaths: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = context.options[0] || {};
    const extraAllowedPaths = (options.allowedPaths || []).map(
      (p) => new RegExp(p)
    );
    const allAllowedPatterns = [...ALLOWED_PATH_PATTERNS, ...extraAllowedPaths];

    /**
     * 去除导入路径中的文件扩展名（.js/.mjs/.cjs/.ts/.tsx），
     * 使模式匹配不受扩展名干扰。
     */
    function stripExtension(path) {
      return path.replace(/\.(m?js|cjs|tsx?)$/, '');
    }

    function isAllowedImportPath(source) {
      return allAllowedPatterns.some((pattern) => pattern.test(source));
    }

    function extractModuleId(source) {
      // 先去扩展名，使模式匹配不受 .js 等后缀干扰
      const normalized = stripExtension(source);

      // Match @modules/<moduleId>/... or @modules/<moduleId>
      const match = normalized.match(/^@modules\/([^/]+)/);
      if (match && RESTRICTED_MODULES.has(match[1])) {
        // 裸导入（@modules/<module>）访问的是模块公开 API（index.ts），允许
        if (normalized === `@modules/${match[1]}`) {
          return null;
        }

        // 检查完整导入路径是否匹配豁免模式（用于 eslint config 中配置的基础模块豁免）
        if (isAllowedImportPath(normalized)) {
          return null;
        }

        // 子路径导入：检查子路径是否为允许的模式
        const restPath = normalized.slice(`@modules/${match[1]}`.length);
        if (restPath.length > 0 && isAllowedImportPath(restPath)) {
          return null;
        }

        return match[1];
      }
      return null;
    }

    return {
      ImportDeclaration(node) {
        // 豁免 type-only import：类型导入无运行时依赖，不会导致循环依赖
        if (node.importKind === 'type') return;

        const source = node.source.value;
        if (typeof source !== 'string') return;

        const moduleId = extractModuleId(source);
        if (!moduleId) return;

        context.report({
          node,
          messageId: 'directModuleImport',
          data: {
            moduleId,
            type: 'unknown',
          },
        });
      },

      // 也检查动态 import()
      CallExpression(node) {
        if (
          node.callee.type === 'Import' &&
          node.arguments.length > 0 &&
          node.arguments[0].type === 'Literal'
        ) {
          const source = node.arguments[0].value;
          if (typeof source !== 'string') return;

          const moduleId = extractModuleId(source);
          if (!moduleId) return;

          context.report({
            node,
            messageId: 'directModuleImport',
            data: {
              moduleId,
              type: 'unknown',
            },
          });
        }
      },
    };
  },
};
