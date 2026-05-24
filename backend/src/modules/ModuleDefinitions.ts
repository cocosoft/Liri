/**
 * 模块定义文件
 * 统一定义所有模块的基本信息、依赖关系和生命周期
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { ErrorCodes } from '@modules/error/ErrorCodes';
import type { ModuleDefinition } from './ModuleRegistry';
import { ModuleCategory } from './ModuleRegistry';

/**
 * 所有模块的定义
 */
export const MODULE_DEFINITIONS: Record<string, ModuleDefinition> = {
  // ==================== 核心模块 ====================

  core: {
    id: 'core',
    name: 'core',
    displayName: '核心模块',
    version: '1.0.0',
    category: ModuleCategory.CORE,
    description: '应用核心功能模块，提供基础架构和生命周期管理',
    dependencies: [],
    optionalDependencies: [],
  },

  infrastructure: {
    id: 'infrastructure',
    name: 'infrastructure',
    displayName: '基础设施模块',
    version: '1.0.0',
    category: ModuleCategory.INFRASTRUCTURE,
    description: '基础设施模块，提供系统级基础设施支持',
    dependencies: ['core'],
    optionalDependencies: ['monitoring'],
  },

  bootstrap: {
    id: 'bootstrap',
    name: 'bootstrap',
    displayName: '启动引导模块',
    version: '1.0.0',
    category: ModuleCategory.INFRASTRUCTURE,
    description: '启动引导模块，负责应用启动时的环境准备、状态初始化和引导流程',
    dependencies: ['core'],
    optionalDependencies: ['performance', 'monitoring', 'utils'],
  },

  modules: {
    id: 'modules',
    name: 'modules',
    displayName: '模块系统自身',
    version: '1.0.0',
    category: ModuleCategory.INFRASTRUCTURE,
    description: '模块系统自身，管理模块注册、初始化和销毁生命周期',
    dependencies: ['core'],
    optionalDependencies: ['error', 'monitoring', 'performance'],
  },

  // ==================== 功能模块 ====================

  ai: {
    id: 'ai',
    name: 'ai',
    displayName: 'AI模块',
    version: '1.0.0',
    category: ModuleCategory.AI,
    description: 'AI相关功能模块，提供模型管理和AI服务',
    dependencies: ['core', 'infrastructure', 'error'],
    optionalDependencies: ['monitoring'],
  },

  agent: {
    id: 'agent',
    name: 'agent',
    displayName: '代理模块',
    version: '1.0.0',
    category: ModuleCategory.AGENT,
    description:
      'AI代理功能模块，提供代理管理和执行（含子代理类型、后台运行、进度追踪、工作树隔离）',
    dependencies: ['core', 'ai', 'error'],
    optionalDependencies: ['memory', 'permission', 'monitoring'],
  },

  bridge: {
    id: 'bridge',
    name: 'bridge',
    displayName: '桥接模块',
    version: '1.0.0',
    category: ModuleCategory.BRIDGE,
    description: '桥接功能模块，提供会话管理和远程控制',
    dependencies: ['core', 'infrastructure', 'oauth', 'error'],
    optionalDependencies: ['memory', 'monitoring'],
  },

  // ==================== 界面模块 ====================

  ink: {
    id: 'ink',
    name: 'ink',
    displayName: 'Ink UI渲染引擎',
    version: '1.0.0',
    category: ModuleCategory.UI,
    description:
      'Ink UI渲染引擎（React for CLI），提供Box、Text、Link等终端UI组件和useInput、useApp等Hooks',
    dependencies: ['core', 'infrastructure'],
    optionalDependencies: ['monitoring', 'utils'],
  },

  ui: {
    id: 'ui',
    name: 'ui',
    displayName: '用户界面模块',
    version: '1.1.0',
    category: ModuleCategory.UI,
    description:
      '用户界面模块，提供React组件和界面交互，包括消息气泡组件、Markdown渲染组件、Ink组件系统（Box、Text、Link、Progress等）和自定义Hooks（useInput、useApp、useStdin）',
    dependencies: ['core', 'infrastructure', 'ink'],
    optionalDependencies: ['monitoring', 'utils'],
  },

  cli: {
    id: 'cli',
    name: 'cli',
    displayName: '命令行界面模块',
    version: '1.1.0',
    category: ModuleCategory.CLI,
    description:
      '命令行界面模块，提供命令行交互功能，包括远程IO、结构化IO、认证处理器、自动模式处理器、MCP处理器、插件处理器、Agent处理器、退出处理和自动更新功能',
    dependencies: ['core', 'infrastructure'],
    optionalDependencies: ['memory', 'monitoring'],
  },

  // ==================== 工具模块 ====================

  tools: {
    id: 'tools',
    name: 'tools',
    displayName: '工具管理模块',
    version: '1.0.0',
    category: ModuleCategory.TOOLS,
    description: '工具管理模块，提供工具注册和执行功能',
    dependencies: ['core', 'infrastructure', 'error'],
    optionalDependencies: ['memory', 'monitoring'],
  },

  commands: {
    id: 'commands',
    name: 'commands',
    displayName: '命令模块',
    version: '1.0.0',
    category: ModuleCategory.COMMANDS,
    description: '命令模块，提供命令注册和执行功能',
    dependencies: ['core', 'cli'],
    optionalDependencies: ['tools', 'monitoring'],
  },

  // ==================== 数据模块 ====================

  memory: {
    id: 'memory',
    name: 'memory',
    displayName: '记忆管理模块',
    version: '1.0.0',
    category: ModuleCategory.MEMORY,
    description: '记忆管理模块，提供记忆存储和检索功能',
    dependencies: ['core', 'infrastructure', 'error'],
    optionalDependencies: ['monitoring', 'utils'],
  },

  cache: {
    id: 'cache',
    name: 'cache',
    displayName: '缓存模块',
    version: '1.0.0',
    category: ModuleCategory.CACHE,
    description: '缓存模块，提供数据缓存和性能优化功能',
    dependencies: ['core', 'infrastructure'],
    optionalDependencies: ['monitoring'],
  },

  // ==================== 系统模块 ====================

  security: {
    id: 'security',
    name: 'security',
    displayName: '安全模块',
    version: '1.0.0',
    category: ModuleCategory.SECURITY,
    description: '安全模块，提供安全防护和审计功能',
    dependencies: ['core', 'infrastructure', 'error'],
    optionalDependencies: ['monitoring'],
  },

  oauth: {
    id: 'oauth',
    name: 'oauth',
    displayName: 'OAuth认证模块',
    version: '2.0.0',
    category: ModuleCategory.SECURITY,
    description:
      'OAuth 2.0认证模块，提供完整的Token管理、Discovery和动态客户端注册功能',
    dependencies: ['core', 'infrastructure', 'config'],
    optionalDependencies: ['monitoring'],
  },

  permission: {
    id: 'permission',
    name: 'permission',
    displayName: '权限模块',
    version: '1.0.0',
    category: ModuleCategory.SECURITY,
    description: '权限模块，提供细粒度工具和文件系统权限控制',
    dependencies: ['core', 'security'],
    optionalDependencies: ['monitoring'],
  },

  performance: {
    id: 'performance',
    name: 'performance',
    displayName: '性能模块',
    version: '1.0.0',
    category: ModuleCategory.PERFORMANCE,
    description: '性能模块，提供性能监控和优化功能',
    dependencies: ['core', 'infrastructure', 'error'],
    optionalDependencies: ['monitoring'],
  },

  monitoring: {
    id: 'monitoring',
    name: 'monitoring',
    displayName: '监控模块',
    version: '1.0.0',
    category: ModuleCategory.MONITORING,
    description: '监控模块，提供系统监控和告警功能',
    dependencies: ['core', 'infrastructure', 'error'],
    optionalDependencies: ['performance'],
  },

  featureflags: {
    id: 'featureflags',
    name: 'featureflags',
    displayName: '功能开关模块',
    version: '1.0.0',
    category: ModuleCategory.SECURITY,
    description: '功能开关模块，提供条件编译和加载功能',
    dependencies: ['core', 'infrastructure'],
    optionalDependencies: ['monitoring'],
  },

  // ==================== 其他模块 ====================

  analytics: {
    id: 'analytics',
    name: 'analytics',
    displayName: '分析模块',
    version: '1.0.0',
    category: ModuleCategory.OTHER,
    description: '分析模块，提供数据分析和统计功能',
    dependencies: ['core', 'infrastructure'],
    optionalDependencies: ['monitoring'],
  },

  buddy: {
    id: 'buddy',
    name: 'buddy',
    displayName: '伙伴模块',
    version: '1.0.0',
    category: ModuleCategory.OTHER,
    description: '伙伴模块，提供虚拟伙伴生成和交互功能',
    dependencies: ['core', 'ui'],
    optionalDependencies: ['monitoring'],
  },

  chat: {
    id: 'chat',
    name: 'chat',
    displayName: '聊天模块',
    version: '1.0.0',
    category: ModuleCategory.OTHER,
    description: '聊天模块，提供聊天会话管理功能',
    dependencies: ['core', 'ai', 'error'],
    optionalDependencies: ['memory', 'monitoring'],
  },

  chronos: {
    id: 'chronos',
    name: 'chronos',
    displayName: '时间管理模块',
    version: '1.0.0',
    category: ModuleCategory.OTHER,
    description: '时间管理模块，提供任务调度和定时功能',
    dependencies: ['core', 'infrastructure'],
    optionalDependencies: ['monitoring'],
  },

  config: {
    id: 'config',
    name: 'config',
    displayName: '配置模块',
    version: '1.0.0',
    category: ModuleCategory.OTHER,
    description: '配置模块，提供配置管理和验证功能',
    dependencies: ['core', 'infrastructure'],
    optionalDependencies: ['monitoring'],
  },

  context: {
    id: 'context',
    name: 'context',
    displayName: '上下文模块',
    version: '1.0.0',
    category: ModuleCategory.OTHER,
    description: '上下文模块，提供上下文管理和注入功能',
    dependencies: ['core', 'infrastructure'],
    optionalDependencies: ['memory', 'monitoring'],
  },

  cost: {
    id: 'cost',
    name: 'cost',
    displayName: '成本模块',
    version: '1.0.0',
    category: ModuleCategory.OTHER,
    description: '成本模块，提供成本监控和分析功能',
    dependencies: ['core', 'infrastructure'],
    optionalDependencies: ['memory', 'monitoring'],
  },

  docs: {
    id: 'docs',
    name: 'docs',
    displayName: '文档模块',
    version: '1.0.0',
    category: ModuleCategory.OTHER,
    description: '文档模块，提供文档管理和帮助功能',
    dependencies: ['core', 'infrastructure'],
    optionalDependencies: ['memory', 'monitoring'],
  },

  daemon: {
    id: 'daemon',
    name: 'daemon',
    displayName: '守护进程模块',
    version: '1.0.0',
    category: ModuleCategory.INFRASTRUCTURE,
    description:
      '守护进程子系统，提供进程管理（ProcessManager）、任务队列（TaskQueue）和进程间通信（IPCService）',
    dependencies: ['core', 'monitoring'],
    optionalDependencies: ['chronos'],
  },

  error: {
    id: 'error',
    name: 'error',
    displayName: '错误处理模块',
    version: '2.0.0',
    category: ModuleCategory.INFRASTRUCTURE,
    description:
      '错误处理基础设施模块，提供错误分类、场景化 API 错误处理、增强重试机制、SSL 错误分析、双消息遥测安全和外部监控集成',
    dependencies: ['core'],
    optionalDependencies: ['infrastructure', 'memory'],
  },

  hooks: {
    id: 'hooks',
    name: 'hooks',
    displayName: '钩子模块',
    version: '1.0.0',
    category: ModuleCategory.OTHER,
    description: '钩子模块，提供事件处理和扩展点功能',
    dependencies: ['core', 'infrastructure'],
    optionalDependencies: ['monitoring'],
  },

  lsp: {
    id: 'lsp',
    name: 'lsp',
    displayName: 'LSP模块',
    version: '1.0.0',
    category: ModuleCategory.OTHER,
    description: 'LSP模块，提供语言服务器协议支持',
    dependencies: ['core', 'infrastructure'],
    optionalDependencies: ['memory', 'monitoring'],
  },

  mcp: {
    id: 'mcp',
    name: 'mcp',
    displayName: 'MCP模块',
    version: '1.0.0',
    category: ModuleCategory.OTHER,
    description: 'MCP模块，提供模型控制协议支持',
    dependencies: ['core', 'infrastructure', 'featureflags', 'oauth'],
    optionalDependencies: ['memory', 'monitoring'],
  },

  'plugin-sdk': {
    id: 'plugin-sdk',
    name: 'plugin-sdk',
    displayName: '插件SDK',
    version: '1.0.0',
    category: ModuleCategory.OTHER,
    description:
      '插件SDK模块，为第三方插件开发者提供纯净的SDK边界，不含核心模块反向引用',
    dependencies: [],
    optionalDependencies: [],
  },

  plugins: {
    id: 'plugins',
    name: 'plugins',
    displayName: '插件模块',
    version: '1.0.0',
    category: ModuleCategory.OTHER,
    description: '插件模块，提供插件管理和扩展功能',
    dependencies: ['core', 'infrastructure'],
    optionalDependencies: ['memory', 'monitoring'],
  },

  query: {
    id: 'query',
    name: 'query',
    displayName: '查询模块',
    version: '1.0.0',
    category: ModuleCategory.OTHER,
    description: '查询模块，提供查询引擎和用户输入处理',
    dependencies: ['core', 'infrastructure'],
    optionalDependencies: ['monitoring'],
  },

  remote: {
    id: 'remote',
    name: 'remote',
    displayName: '远程连接模块',
    version: '1.0.0',
    category: ModuleCategory.OTHER,
    description:
      '远程连接模块，提供SSH连接管理、连接池、密钥管理和远程会话功能',
    dependencies: ['core', 'infrastructure', 'security'],
    optionalDependencies: ['monitoring'],
  },

  sandbox: {
    id: 'sandbox',
    name: 'sandbox',
    displayName: '沙箱模块',
    version: '1.0.0',
    category: ModuleCategory.OTHER,
    description: '沙箱模块，提供代码执行隔离环境',
    dependencies: ['core', 'security', 'featureflags'],
    optionalDependencies: ['monitoring'],
  },

  services: {
    id: 'services',
    name: 'services',
    displayName: '服务模块',
    version: '1.0.0',
    category: ModuleCategory.OTHER,
    description:
      '服务模块，提供各种系统服务功能，包括API客户端、分析服务、通知服务、语音服务、技能搜索和工具摘要',
    dependencies: ['core', 'infrastructure'],
    optionalDependencies: ['monitoring'],
  },

  voice: {
    id: 'voice',
    name: 'voice',
    displayName: '实时语音模块',
    version: '1.0.0',
    category: ModuleCategory.OTHER,
    description:
      '实时语音交互模块，提供 WebSocket 语音会话、Gemini Live API 适配、实时工具调用桥接和音频处理',
    dependencies: ['core', 'infrastructure', 'tools'],
    optionalDependencies: ['monitoring'],
  },

  streaming: {
    id: 'streaming',
    name: 'streaming',
    displayName: '流式处理模块',
    version: '1.0.0',
    category: ModuleCategory.OTHER,
    description:
      '流式处理模块，提供流式API集成、流式错误处理、重试/断路器模式和背压控制',
    dependencies: ['core', 'infrastructure', 'services'],
    optionalDependencies: ['monitoring'],
  },

  utils: {
    id: 'utils',
    name: 'utils',
    displayName: '工具模块',
    version: '1.0.0',
    category: ModuleCategory.OTHER,
    description:
      '工具模块，提供通用工具函数，包括Bash工具子目录、Git工具、认证工具、安全存储、遥测、会话存储、文件历史、AWS凭证和图片处理',
    dependencies: ['core', 'infrastructure'],
    optionalDependencies: ['monitoring'],
  },

  keybindings: {
    id: 'keybindings',
    name: 'keybindings',
    displayName: '快捷键管理模块',
    version: '1.0.0',
    category: ModuleCategory.OTHER,
    description:
      '快捷键管理模块，提供动作系统、键位绑定管理、Vim模式支持和19种上下文支持',
    dependencies: ['core', 'infrastructure'],
    optionalDependencies: ['cli', 'ui', 'monitoring'],
  },

  // ==================== 新注册模块（依赖图扫描后添加） ====================

  channels: {
    id: 'channels',
    name: 'channels',
    displayName: '渠道模块',
    version: '1.0.0',
    category: ModuleCategory.OTHER,
    description: '渠道模块，提供多平台通信渠道（QQ等）的注册和管理',
    dependencies: ['core'],
    optionalDependencies: ['monitoring', 'error', 'ai', 'security'],
  },

  session: {
    id: 'session',
    name: 'session',
    displayName: '会话模块',
    version: '1.0.0',
    category: ModuleCategory.OTHER,
    description: '会话模块，提供会话管理和持久化功能',
    dependencies: ['core'],
    optionalDependencies: ['error', 'monitoring'],
  },

  skills: {
    id: 'skills',
    name: 'skills',
    displayName: '技能模块',
    version: '1.0.0',
    category: ModuleCategory.OTHER,
    description: '技能模块，提供技能注册、守卫和集线器功能',
    dependencies: ['core'],
    optionalDependencies: [
      'context',
      'monitoring',
      'error',
      'tools',
      'chronos',
      'services',
      'plugins',
      'utils',
    ],
  },

  runtime: {
    id: 'runtime',
    name: 'runtime',
    displayName: '运行时模块',
    version: '1.0.0',
    category: ModuleCategory.OTHER,
    description: '运行时模块，提供 API 运行时服务',
    dependencies: ['core'],
    optionalDependencies: ['error', 'tools', 'chat', 'monitoring', 'utils'],
  },

  acp: {
    id: 'acp',
    name: 'acp',
    displayName: 'ACP 协议模块',
    version: '1.0.0',
    category: ModuleCategory.OTHER,
    description:
      'Agent Communication Protocol 模块，提供 Agent 间标准化通信和权限协商',
    dependencies: ['core'],
    optionalDependencies: ['error', 'tools', 'monitoring', 'utils'],
  },

  tasks: {
    id: 'tasks',
    name: 'tasks',
    displayName: '任务模块',
    version: '1.0.0',
    category: ModuleCategory.OTHER,
    description: '任务模块，提供任务管理和执行功能',
    dependencies: ['core'],
    optionalDependencies: ['tools', 'chat', 'monitoring'],
  },

  vim: {
    id: 'vim',
    name: 'vim',
    displayName: 'Vim 模式模块',
    version: '1.0.0',
    category: ModuleCategory.OTHER,
    description: 'Vim 模式模块，提供 Vim 风格的编辑器模式支持',
    dependencies: ['core'],
    optionalDependencies: ['monitoring'],
  },

  media: {
    id: 'media',
    name: 'media',
    displayName: '媒体模块',
    version: '1.0.0',
    category: ModuleCategory.OTHER,
    description: '媒体模块，提供图片、视频、二维码等媒体处理功能',
    dependencies: ['core'],
    optionalDependencies: [],
  },

  flows: {
    id: 'flows',
    name: 'flows',
    displayName: '流程引擎模块',
    version: '1.0.0',
    category: ModuleCategory.OTHER,
    description: '流程引擎模块，提供工作流引擎和流程编排功能',
    dependencies: ['core'],
    optionalDependencies: [],
  },

  governance: {
    id: 'governance',
    name: 'governance',
    displayName: '治理模块',
    version: '1.0.0',
    category: ModuleCategory.OTHER,
    description: '治理模块，提供权限治理、钩子管理和沙箱监控功能',
    dependencies: ['core'],
    optionalDependencies: [
      'monitoring',
      'permission',
      'hooks',
      'sandbox',
      'tools',
      'error',
    ],
  },

  enterprise: {
    id: 'enterprise',
    name: 'enterprise',
    displayName: '企业版模块',
    version: '1.0.0',
    category: ModuleCategory.OTHER,
    description: '企业版模块，提供企业级功能支持',
    dependencies: ['core'],
    optionalDependencies: ['error', 'monitoring', 'sandbox'],
  },
};

/**
 * 模块初始化顺序（拓扑排序）
 *
 * 阶段划分与 LazyModuleStrategy.ts 的 LAZY_MODULE_STRATEGY 对齐：
 *   - Phase 1-3: CRITICAL 优先级模块，启动时必需加载
 *   - Phase 4-8: DEFERRED 优先级模块，启动完成后延迟加载
 *
 * 两套系统必须保持以下对齐规则：
 *   1. CRITICAL 模块必须集中在 Phase 1-3
 *   2. DEFERRED 模块必须在 Phase 4-8（含 ON_DEMAND 子模式）
 *   3. featureflags/memory 等 ON_DEMAND 模块放在 Phase 8
 *   4. 新增模块时同步更新 LAZY_MODULE_STRATEGY 的优先级
 */
export const MODULE_INITIALIZATION_ORDER: string[] = [
  // ==================== CRITICAL 阶段 ====================
  // 第一阶段：核心基础设施
  'plugin-sdk',
  'core',
  'infrastructure',

  // 第二阶段：基础功能模块
  'ai',
  'bootstrap',
  'config',
  'context',
  'error',
  'performance',
  'hooks',

  // 第三阶段：数据存储模块（CRITICAL 部分）
  'modules',
  'cache',

  // ==================== DEFERRED 阶段 ====================
  // 第四阶段：功能模块
  'channels',
  'session',
  'skills',
  'runtime',
  'acp',
  'tasks',
  'governance',
  'memory',
  'agent',
  'bridge',
  'chat',
  'chronos',
  'cost',
  'lsp',
  'mcp',
  'plugins',
  'query',

  // 第五阶段：界面模块
  'ink',
  'ui',
  'cli',

  // 第六阶段：工具模块
  'tools',
  'commands',

  // 第七阶段：系统模块
  'security',
  'oauth',
  'permission',
  'sandbox',
  'monitoring',
  'daemon',

  // 第八阶段：其他模块 + ON_DEMAND 模块
  'enterprise',
  'flows',
  'media',
  'vim',
  'featureflags',
  'analytics',
  'buddy',
  'docs',
  'remote',
  'services',
  'streaming',
  'utils',
  'keybindings',
  'voice',
];

/**
 * 获取模块定义
 */
export function getModuleDefinition(id: string): ModuleDefinition {
  const definition = MODULE_DEFINITIONS[id];
  if (!definition) {
    throw new AppError(
      ErrorCodes.ENTITY_NOT_FOUND.message,
      ErrorCategory.VALIDATION,
      ErrorSeverity.MEDIUM,
      'MODULE_NOT_DEFINED',
      { moduleId: id }
    );
  }
  return definition;
}

/**
 * 获取所有模块定义
 */
export function getAllModuleDefinitions(): ModuleDefinition[] {
  return Object.values(MODULE_DEFINITIONS);
}

/**
 * 按分类获取模块定义
 */
export function getModuleDefinitionsByCategory(
  category: ModuleCategory
): ModuleDefinition[] {
  return getAllModuleDefinitions().filter(
    (module) => module.category === category
  );
}

/**
 * 验证模块依赖关系
 */
export function validateModuleDependencies(): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  for (const [id, definition] of Object.entries(MODULE_DEFINITIONS)) {
    // 检查依赖是否存在
    for (const depId of definition.dependencies) {
      if (!MODULE_DEFINITIONS[depId]) {
        errors.push(`模块 ${id} 依赖的模块 ${depId} 不存在`);
      }
    }

    // 检查可选依赖是否存在
    for (const depId of definition.optionalDependencies) {
      if (!MODULE_DEFINITIONS[depId]) {
        errors.push(`模块 ${id} 的可选依赖模块 ${depId} 不存在`);
      }
    }

    // 检查循环依赖（简化检查）
    const visited = new Set<string>();
    const checkCycle = (currentId: string, path: string[]) => {
      if (visited.has(currentId)) return;
      visited.add(currentId);

      const currentPath = [...path, currentId];
      const currentModule = MODULE_DEFINITIONS[currentId];

      for (const depId of currentModule.dependencies) {
        if (path.includes(depId)) {
          errors.push(`检测到循环依赖: ${[...path, depId].join(' -> ')}`);
        } else {
          checkCycle(depId, currentPath);
        }
      }
    };

    checkCycle(id, []);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
