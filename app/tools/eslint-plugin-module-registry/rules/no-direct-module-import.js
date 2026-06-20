/**
 * ESLint rule: no-direct-module-import
 *
 * 禁止在模块系统外直接 import 已注册模块的默认导出。
 * 已注册模块的实例应通过 ModuleRegistry.resolve<T>() 获取，
 * 而非直接通过 import 语句引用。
 *
 * 允许导入的类型：
 * - 类型定义和接口
 * - 工具函数和工具类型（如 Logger、AppError 等基础设施）
 * - ModuleRegistry、ModuleDefinitions 本身
 * - 模块的 index.ts 聚合导出（已受模块系统管理）
 *
 * 该规则的目的：
 * - 防止模块间紧耦合的 import 导致循环依赖
 * - 确保模块实例由 ModuleRegistry 统一管理生命周期
 * - 使依赖关系图在 ModuleDefinitions 中可见
 *
 * @suggestion 使用 moduleRegistry.resolve<T>('moduleId') 替代直接 import
 */

const RESTRICTED_MODULES = new Set([
  'agent',
  'ai',
  'analytics',
  'bridge',
  'buddy',
  'cache',
  'channels',
  'chat',
  'chronos',
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
  'services',
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
 */
const ALLOWED_PATH_PATTERNS = [
  /\/types$/,           // 类型定义
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

    function isAllowedImportPath(source) {
      return allAllowedPatterns.some((pattern) => pattern.test(source));
    }

    function extractModuleId(source) {
      // Match @modules/<moduleId>/... or @modules/<moduleId>
      const match = source.match(/^@modules\/([^/]+)/);
      if (match && RESTRICTED_MODULES.has(match[1])) {
        // 检查完整导入路径是否匹配豁免模式（用于 eslint config 中配置的基础模块豁免）
        if (isAllowedImportPath(source)) {
          return null;
        }
        // 如果路径在模块 ID 后还有子路径，检查子路径是否为允许的模式
        if (source !== `@modules/${match[1]}`) {
          const restPath = source.slice(`@modules/${match[1]}`.length);
          if (restPath.length > 0 && isAllowedImportPath(restPath)) {
            return null;
          }
        }
        return match[1];
      }
      return null;
    }

    return {
      ImportDeclaration(node) {
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
