/**
 * 模块延迟加载策略管理器
 *
 * 将 40+ 模块按优先级分为两类：
 * - CRITICAL：启动时必需加载的核心模块
 * - DEFERRED：可在启动完成后延迟加载的模块
 *
 * DEFERRED 模块进一步分为两种模式：
 * - BATCH：后台批次加载（当前行为），在 T3 阶段按批次后台初始化
 * - ON_DEMAND：首次按需加载，仅在功能被首次请求时通过动态 import() 加载
 *
 * 重型模块（featureflags、memory 等）使用 ON_DEMAND 模式，
 * 避免其重型依赖（GrowthBook SDK、cheerio、jsonwebtoken 等）在启动时被解析。
 *
 * P1b（2026-10-20，用户裁定「方案 A」）：**纯记账**批次模块也改为 ON_DEMAND ——
 * 见 `PURE_ACCOUNTING_ON_DEMAND_MODULES`（依据 `内核瘦身-P1a-分级报告.md`）。
 */

// 2026-09-30 改走 core 门面（A3 倒挂收口）：原 `../performance/StartupProfiler`（core → infra 倒挂）
import { profilePhaseStart, profilePhaseEnd } from '../core/profilerFacade.js';
import { getLogger } from '../core/loggerFacade.js';
// P2（2026-10-23，core 独立包）：加载清单改由宿主推送注入 ⇒ 内核不再 import 上层模块，
// `bun:bundle` 也随之离开内核（清单的变体裁剪移到宿主侧生成时决定）。
import { hasLazyLoader, requireLazyLoader } from './lazy/loaderRegistry.js';
const logger = getLogger('modules:lazyModuleStrategy');

/**
 * 模块加载优先级
 */
export enum ModuleLoadPriority {
  /** 启动时必需加载 */
  CRITICAL = 'critical',
  /** 启动完成后延迟加载 */
  DEFERRED = 'deferred',
}

/**
 * 动态加载模式
 * BATCH：后台批次加载（当前行为），DEFERRED 模块在 T3 阶段按 3 个一批后台初始化
 * ON_DEMAND：首次按需加载，仅在功能被首次请求时才通过动态 import() 加载模块代码
 */
export enum DynamicLoadMode {
  /** 后台批次加载 */
  BATCH = 'batch',
  /** 首次按需加载 */
  ON_DEMAND = 'on_demand',
}

/**
 * 延迟加载策略配置
 */
interface LazyModuleConfig {
  priority: ModuleLoadPriority;
  /** 延迟加载触发条件描述 */
  trigger: string;
  /** 动态加载模式（仅 DEFERRED 模块有效），默认为 BATCH */
  loadMode?: DynamicLoadMode;
}

/**
 * 模块延迟加载策略映射
 *
 * 定义每个模块的加载优先级和延迟条件。
 * CRITICAL 模块在启动时同步加载，DEFERRED 模块在 T2 分发后异步加载。
 * DEFERRED + ON_DEMAND 模块仅在首次被请求时通过动态 import() 加载。
 */
const LAZY_MODULE_STRATEGY: Record<string, LazyModuleConfig> = {
  // ========== 第一阶段：核心基础设施 ==========
  'plugin-sdk': { priority: ModuleLoadPriority.CRITICAL, trigger: '启动必需' },
  core: { priority: ModuleLoadPriority.CRITICAL, trigger: '启动必需' },
  infrastructure: {
    priority: ModuleLoadPriority.CRITICAL,
    trigger: '启动必需',
  },
  gateway: {
    priority: ModuleLoadPriority.CRITICAL,
    trigger: 'Gateway 通道服务启动时初始化',
  },

  // ========== 第二阶段：基础功能模块 ==========
  ai: { priority: ModuleLoadPriority.CRITICAL, trigger: '核心 AI 功能' },
  bootstrap: { priority: ModuleLoadPriority.CRITICAL, trigger: '启动引导' },
  config: { priority: ModuleLoadPriority.CRITICAL, trigger: '配置管理' },
  context: { priority: ModuleLoadPriority.CRITICAL, trigger: '上下文管理' },
  error: { priority: ModuleLoadPriority.CRITICAL, trigger: '错误处理基础设施' },
  logger: { priority: ModuleLoadPriority.CRITICAL, trigger: '日志基础设施' },
  ecosystem: { priority: ModuleLoadPriority.CRITICAL, trigger: '生态基础设施' },
  sdk: { priority: ModuleLoadPriority.CRITICAL, trigger: 'SDK 基础设施' },
  featureflags: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '功能开关首次查询时加载',
    loadMode: DynamicLoadMode.ON_DEMAND,
  },

  // ========== 第三阶段：数据存储模块 ==========
  modules: { priority: ModuleLoadPriority.CRITICAL, trigger: '模块系统自身' },
  memory: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '记忆首次读写时加载',
    loadMode: DynamicLoadMode.ON_DEMAND,
  },
  cache: { priority: ModuleLoadPriority.CRITICAL, trigger: '缓存系统' },

  // ========== 第四阶段：功能模块 ==========
  channels: {
    priority: ModuleLoadPriority.CRITICAL,
    trigger: '启动时自动注册通道',
  },
  session: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '会话首次访问时加载',
  },
  acp: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: 'ACP 协议首次请求时加载',
  },
  skills: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '技能首次调用时加载',
  },
  runtime: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '运行时首次请求时加载',
  },
  tasks: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '任务系统首次触发时加载',
  },
  governance: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '治理功能首次触发时加载',
  },
  agent: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '代理操作触发时按需加载',
  },
  bridge: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '远程控制触发时按需加载',
  },
  chat: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '聊天会话启用时按需加载',
  },
  chronos: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '定时任务首次调度时加载',
    loadMode: DynamicLoadMode.ON_DEMAND,
  },
  cost: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '成本查询触发时加载',
  },
  hooks: { priority: ModuleLoadPriority.CRITICAL, trigger: '事件系统' },
  lsp: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: 'LSP 功能首次使用时加载',
    loadMode: DynamicLoadMode.ON_DEMAND,
  },
  mcp: {
    // 2026-08-06 P0-3：从 DEFERRED 提升为 CRITICAL —— doc 模块声明依赖 mcp，且需"启动即用"（MCP 工具在 doc 注册前就绪）
    priority: ModuleLoadPriority.CRITICAL,
    trigger: '启动必需（doc 模块依赖 mcp 注册 MCP 工具）',
  },
  doc: {
    // 办公模块：CRITICAL 阶段初始化以注册 MCP 工具（与 MODULE_INITIALIZATION_ORDER 第四阶段一致）
    priority: ModuleLoadPriority.CRITICAL,
    trigger: '启动必需（注册 MCP 工具）',
  },
  plugins: {
    priority: ModuleLoadPriority.CRITICAL,
    trigger: '可扩展性服务启动时初始化',
  },
  query: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '查询操作触发时加载',
  },
  knowledge: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '知识库首次查询时加载',
  },

  // ========== 第五阶段：界面模块 ==========
  ink: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: 'UI 渲染首次触发时加载',
    loadMode: DynamicLoadMode.ON_DEMAND,
  },
  ui: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '用户界面首次渲染时加载',
    loadMode: DynamicLoadMode.ON_DEMAND,
  },
  cli: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: 'CLI 交互首次触发时加载',
  },
  terminal: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '终端界面首次触发时加载',
  },

  // ========== 第六阶段：工具模块 ==========
  tools: {
    priority: ModuleLoadPriority.CRITICAL,
    trigger: '工具管理器启动时预创建',
  },
  commands: {
    priority: ModuleLoadPriority.CRITICAL,
    trigger: '命令系统启动时初始化',
  },

  // ========== 第七阶段：系统模块 ==========
  security: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '安全检查首次触发时加载',
    loadMode: DynamicLoadMode.ON_DEMAND,
  },
  oauth: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: 'OAuth 流程首次触发时加载',
  },
  permission: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '权限校验首次触发时加载',
  },
  sandbox: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '沙箱执行首次触发时加载',
    loadMode: DynamicLoadMode.ON_DEMAND,
  },
  performance: {
    priority: ModuleLoadPriority.CRITICAL,
    trigger: '性能追踪系统',
  },
  monitoring: {
    priority: ModuleLoadPriority.CRITICAL,
    trigger: '监控服务启动时启动',
  },
  daemon: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '守护进程模式启用时加载',
  },
  credentials: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '凭据管理首次触发时加载',
  },

  // ========== 第八阶段：其他模块 ==========
  enterprise: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '企业版功能首次触发时加载',
  },
  flows: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '流程引擎首次触发时加载',
  },
  media: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '媒体处理首次触发时加载',
  },
  vim: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: 'Vim 模式首次激活时加载',
  },
  analytics: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '分析功能首次触发时加载',
  },
  buddy: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '伙伴功能首次触发时加载',
  },
  docs: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '文档查询首次触发时加载',
  },
  remote: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '远程连接首次请求时加载',
    // 2026-09-30（台账 D-133）：原为 ON_DEMAND，但 `app/src/remote/` **无 index.ts**（无统一出口）
    // ⇒ 无法为其提供 `DYNAMIC_IMPORT_LOADERS` 条目（原 `'../remote/index.js'` 必失败）。
    // 改回默认 BATCH：与其他 DEFERRED 模块同生命周期（该模块无 `initialize()` 钩子 ⇒ 仅状态记账，无代码加载/无副作用）。
  },
  services: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '服务首次调用时加载',
  },
  streaming: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '流式处理首次触发时加载',
  },
  utils: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '工具函数首次调用时加载',
  },
  keybindings: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '快捷键首次触发时加载',
  },
  voice: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '语音功能首次触发时加载',
    loadMode: DynamicLoadMode.ON_DEMAND,
  },
  delivery: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '转录归档首次触发时加载',
  },
  'auto-reply': {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '自动回复首次触发时加载',
  },
  diagnostics: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '系统诊断首次触发时加载',
  },
  extensions: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: 'Provider 扩展首次请求时加载',
  },
  insights: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '对话洞察首次触发时加载',
  },
  wizard: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '设置向导首次触发时加载',
  },
  // 办公模块（mail/calendar 已在 eager 阶段加载，此处声明优先级保持与 MODULE_INITIALIZATION_ORDER 一致）
  mail: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '邮件功能首次触发时加载',
  },
  calendar: {
    priority: ModuleLoadPriority.DEFERRED,
    trigger: '日历功能首次触发时加载',
  },
};

/**
 * P1b（2026-10-20，用户裁定「方案 A」）：**纯记账**批次模块 → `ON_DEMAND`
 *
 * 依据 `dev_docs/20261020/内核瘦身-P1a-分级报告.md`：下列模块在
 * `ModuleDefinitions.ts` 里**没有 `initialize()`**（更不含任何 `import`），且**无启动面静态引用**
 * ⇒ 它们的 T3 批次加载只是 `ModuleInitializer` 的状态记账，降级后唯一变化是"状态表里不再出现"。
 *
 * **为什么用一张覆盖表而不是逐条改 `loadMode`**：17 条散落在 300+ 行的表里，
 * "为什么降级"的理由只能各写一遍 ⇒ 迟早漂移；这里一处列表 + 一处理由。
 *
 * **例外（有意保留 BATCH）**：`cli` —— 它是 CRITICAL 模块 `commands` 的**必需依赖**，
 * `ModuleRegistry.initialize()` 会递归初始化依赖 ⇒ 即使标成 ON_DEMAND 也会被初始化（降级无效果）。
 *
 * ⚠️ 这些模块**没有** `DYNAMIC_IMPORT_LOADERS` 条目（它们没有需要加载的实现）：
 * 若将来有人对它们调用 `requestOnDemandModule()`，会 **fail-loud**（"未配置动态导入加载器"）——
 * 这是有意的：宁可报错，也不假装加载。
 *
 * 回归保护：`app/tests/modules/moduleTiering.test.ts` 钉住"名单内模块确实没有 `initialize`"
 * ⇒ 谁给它们加了初始化动作，测试会红并要求重新分级。
 */
export const PURE_ACCOUNTING_ON_DEMAND_MODULES: readonly string[] = [
  'acp',
  'terminal',
  'daemon',
  'credentials',
  'enterprise',
  'flows',
  'vim',
  'buddy',
  'remote',
  'keybindings',
  'delivery',
  'auto-reply',
  'extensions',
  'insights',
  'wizard',
  'mail',
  'calendar',
];

for (const moduleId of PURE_ACCOUNTING_ON_DEMAND_MODULES) {
  const config = LAZY_MODULE_STRATEGY[moduleId];
  // 只在"已登记且仍是 DEFERRED"时覆盖：若将来被提升为 CRITICAL，本表不得静默改写优先级
  if (config && config.priority === ModuleLoadPriority.DEFERRED) {
    config.loadMode = DynamicLoadMode.ON_DEMAND;
  }
}

/**
 * 重型模块按需加载器映射
 * 对于 ON_DEMAND 模式的模块，定义其动态 import() 加载器。
 * 仅在首次请求时才加载模块代码，启动阶段完全不解析其依赖。
 *
 * ⚠️ 必须写成 **字面量动态导入**（`() => import('字面量')`），**禁止**退回"字符串路径表 + `import(变量)`"：
 * 门禁 `R00-003`（`scripts/lint-architecture.ts` 的 `parseDynamicImports`）只识别 `import('字面量')`，
 * 字符串表会让「core → 上层」这批依赖对门禁**完全不可见**（2026-09-30 台账 D-133 取证 · spec §3.17.19）。
 *
 * 2026-09-30（D-133，用户裁定 A+C）：由字符串表改为字面量 thunk 表，并清理 4 条失效条目 ——
 * `remote`（`app/src/remote/` 无 index.ts，无统一出口）· `doc`/`calendar`（真实位置在 `modules/` 下，
 * 原相对路径 `../doc` 不存在）· `mail`（两处均无 index.ts）。四者原均为**不可达或必失败**的死条目。
 *
 * ---
 * **G-C5 登记（2026-10-11，用户裁定「登记不删」）** —— ON_DEMAND **触发路径当前无消费方**：
 * · 声明侧有效：`security` / `sandbox` 等确有本表条目（`LAZY_MODULE_STRATEGY[*].loadMode = ON_DEMAND`）。
 * · 触发侧**零调用方**：`ModuleInitializer.requestOnDemandModule()` / `core.requestModule()` 在**全仓无调用**
 *   （仅 `modules/index.ts` 转出）⇒ **ON_DEMAND 从未被触发**，实际等价于静态/CRITICAL 加载。
 * · 且 `security` / `sandbox` 被 Bash 链**静态导入**（`tools/bash/BashTool.ts` 等）⇒ "省启动开销"的意图
 *   在现状下**不可能生效**（模块求值即加载）。
 * · **替代保护**：安全/沙箱链路的可用性由**静态导入**兜底（不存在"未就绪窗口"）——
 *   这也是**不删**的理由（CD07：`security`/`sandbox` 属关键域）。
 * · **reopen 条件**：若将来真要收回懒加载收益 ⇒ 须①接管 `requestOnDemandModule` 的调用方（首次安全检查/
 *   沙箱执行时请求）**且**②解除 Bash 链的静态导入，并补"未就绪窗口"的 fail-closed 兜底与实测。
 * ---
 * **P2（2026-10-23，core 独立包）**：本表已**迁出内核** —— 清单改由宿主在入口早期
 * 通过 `registerLazyLoaders()` 推送（见 `core/lazy/loaderRegistry.ts` 头注）。
 * 变体裁剪仍在构建期完成，但落点变为宿主侧生成物
 * （`app/src/bootstrap/generatedLazyLoaders.ts`，由 `build-variant.ts` 按变体写出）：
 * 未选中的模块**连 `import()` 字面量都不存在**，因此不依赖 minifier 的副作用分析。
 * 内核侧只保留「按 id 取加载器」的机制与双 API 语义（能力查询 / 执行 fail-closed）。
 */

/**
 * 获取模块的动态加载模式
 */
export function getModuleLoadMode(moduleId: string): DynamicLoadMode {
  const config = LAZY_MODULE_STRATEGY[moduleId];
  return config?.loadMode ?? DynamicLoadMode.BATCH;
}

/**
 * 检查模块是否为 ON_DEMAND 加载模式
 */
export function isModuleOnDemand(moduleId: string): boolean {
  return getModuleLoadMode(moduleId) === DynamicLoadMode.ON_DEMAND;
}

/**
 * 获取启动时必需加载的模块 ID 列表
 * 保持 MODULE_INITIALIZATION_ORDER 中的相对顺序
 */
export function getEssentialModuleIds(allOrderedModules: string[]): string[] {
  return allOrderedModules.filter((id) => {
    const config = LAZY_MODULE_STRATEGY[id];
    return config && config.priority === ModuleLoadPriority.CRITICAL;
  });
}

/**
 * 获取可延迟加载的模块 ID 列表（BATCH 模式）
 * 排除 ON_DEMAND 模块，这些模块不会被后台批次加载
 */
export function getDeferredModuleIds(allOrderedModules: string[]): string[] {
  return allOrderedModules.filter((id) => {
    const config = LAZY_MODULE_STRATEGY[id];
    return (
      config &&
      config.priority === ModuleLoadPriority.DEFERRED &&
      config.loadMode !== DynamicLoadMode.ON_DEMAND
    );
  });
}

/**
 * 获取按需加载的模块 ID 列表（ON_DEMAND 模式）
 * 这些模块不会被后台批次加载，仅在首次请求时通过动态 import() 加载
 */
export function getOnDemandModuleIds(allOrderedModules: string[]): string[] {
  return allOrderedModules.filter((id) => {
    const config = LAZY_MODULE_STRATEGY[id];
    return (
      config &&
      config.priority === ModuleLoadPriority.DEFERRED &&
      config.loadMode === DynamicLoadMode.ON_DEMAND
    );
  });
}

/**
 * 获取模块的加载优先级
 *
 * 2026-10-21（内核瘦身 P2）：**未登记的模块默认 `DEFERRED`**（原为 `CRITICAL`）。
 *
 * 理由：`内核瘦身-方案.md` §3 B3 的验收口径是「新增模块默认 DEFERRED，要进 CRITICAL 必须注明理由」。
 * 旧默认值恰好相反 —— 忘记登记的模块会被当成"启动必需"，启动面**静默回涨**且无人察觉。
 * 改为 DEFERRED 后，"未登记"的语义与门禁一致：**不进启动面**。
 *
 * 注意：真正决定"启动时同步加载"的是 `getEssentialModuleIds()`，它要求 `config` 存在且为 CRITICAL
 * ⇒ 未登记模块本来就不会进 T1；本函数只影响"是否可延迟"这一语义判断。
 */
export function getModulePriority(moduleId: string): ModuleLoadPriority {
  const config = LAZY_MODULE_STRATEGY[moduleId];
  return config ? config.priority : ModuleLoadPriority.DEFERRED;
}

/**
 * 策略表**已登记**的模块 id（内核瘦身 P2 门禁消费）
 *
 * 与 `MODULE_INITIALIZATION_ORDER` 的差集就是"未登记模块" —— 它们不会被任何阶段初始化，
 * 由 `lint:critical-modules` 阻断（见 `scripts/criticalModulesCore.ts` ⑤）。
 */
export function getDeclaredModuleIds(): string[] {
  return Object.keys(LAZY_MODULE_STRATEGY);
}

/**
 * 当前 CRITICAL 清单及其登记理由（内核瘦身 P2 门禁消费）
 *
 * `reason` 直接取策略表的 `trigger` —— **不维护第二份理由文案**，避免与实现漂移。
 */
export function getCriticalModuleRegistry(): Array<{
  id: string;
  reason: string;
}> {
  return Object.entries(LAZY_MODULE_STRATEGY)
    .filter(([, config]) => config.priority === ModuleLoadPriority.CRITICAL)
    .map(([id, config]) => ({ id, reason: config.trigger }));
}

/**
 * 检查模块是否可以延迟加载（包含 BATCH 和 ON_DEMAND）
 */
export function isModuleDeferred(moduleId: string): boolean {
  return getModulePriority(moduleId) === ModuleLoadPriority.DEFERRED;
}

/**
 * 内存缓存，避免重复动态加载
 */
const dynamicModuleCache = new Map<string, any>();
const dynamicModuleLoading = new Map<string, Promise<any>>();

/**
 * 按需加载模块（仅 ON_DEMAND 模式使用）
 * 通过动态 import() 加载模块代码，确保重型依赖只在首次请求时解析。
 * 并发请求只会触发一次加载，其余等待同一结果。
 *
 * @param moduleId - 模块 ID
 * @returns 模块导出对象
 */
export async function requestModule(moduleId: string): Promise<any> {
  const cached = dynamicModuleCache.get(moduleId);
  if (cached) return cached;

  const inFlight = dynamicModuleLoading.get(moduleId);
  if (inFlight) return inFlight;

  // 执行路径：缺失 ⇒ AppError（CORE_LAZY_LOADER_NOT_REGISTERED），不静默返回 undefined
  const loader = requireLazyLoader(moduleId);

  const loadPromise = (async () => {
    const tracePhase = `on_demand:${moduleId}`;
    profilePhaseStart(tracePhase);

    try {
      logger.info(`按需动态加载模块: ${moduleId}`);
      const mod = await loader();
      dynamicModuleCache.set(moduleId, mod);
      logger.info(`按需动态加载完成: ${moduleId}`);
      return mod;
    } finally {
      dynamicModuleLoading.delete(moduleId);
      profilePhaseEnd(tracePhase);
    }
  })();

  dynamicModuleLoading.set(moduleId, loadPromise);
  return loadPromise;
}

/**
 * 检查模块是否有动态导入加载器配置（**能力查询**：变体缺席 ⇒ false，不抛错）
 */
export function hasDynamicImport(moduleId: string): boolean {
  return hasLazyLoader(moduleId);
}

/**
 * 延迟加载状态追踪
 */
export interface DeferredLoadState {
  moduleId: string;
  status: 'pending' | 'loading' | 'loaded' | 'error';
  error?: Error;
  startTime?: number;
  endTime?: number;
}

/**
 * 延迟加载调度器
 *
 * 在 T2 分发完成后，按优先级批次加载 DEFERRED 模块。
 * 使用 setImmediate 实现非阻塞调度，不影响主线程响应。
 */
export class DeferredLoader {
  private states: Map<string, DeferredLoadState> = new Map();
  private loadedCount = 0;
  private errorCount = 0;
  private scheduled = false;

  /**
   * 获取所有延迟加载模块的状态
   */
  getStates(): DeferredLoadState[] {
    return Array.from(this.states.values());
  }

  /**
   * 获取已加载的模块数量
   */
  getLoadedCount(): number {
    return this.loadedCount;
  }

  /**
   * 获取加载失败的模块数量
   */
  getErrorCount(): number {
    return this.errorCount;
  }

  /**
   * 获取待加载的模块数量
   */
  getPendingCount(): number {
    return this.getStates().filter((s) => s.status === 'pending').length;
  }

  /**
   * 是否所有延迟模块已加载完成
   */
  isAllLoaded(): boolean {
    return this.getPendingCount() === 0 && this.scheduled;
  }

  /**
   * 注册并调度延迟加载
   *
   * @param deferredIds - 可延迟加载的模块 ID 列表
   * @param initializeFn - 模块初始化函数（接收模块 ID）
   * @param batchSize - 每批次并发加载数量，默认 3
   */
  schedule(
    deferredIds: string[],
    initializeFn: (moduleId: string) => Promise<void>,
    batchSize = 3
  ): void {
    if (this.scheduled) return;
    this.scheduled = true;

    for (const moduleId of deferredIds) {
      this.states.set(moduleId, { moduleId, status: 'pending' });
    }

    this.scheduleNextBatch(deferredIds, initializeFn, batchSize, 0);
  }

  /**
   * 调度下一批延迟加载
   */
  private scheduleNextBatch(
    deferredIds: string[],
    initializeFn: (moduleId: string) => Promise<void>,
    batchSize: number,
    startIndex: number
  ): void {
    if (startIndex >= deferredIds.length) {
      return;
    }

    const batch = deferredIds.slice(startIndex, startIndex + batchSize);
    const batchNum = Math.floor(startIndex / batchSize) + 1;

    setImmediate(async () => {
      await Promise.all(
        batch.map((moduleId) => this.loadModule(moduleId, initializeFn))
      );

      this.scheduleNextBatch(
        deferredIds,
        initializeFn,
        batchSize,
        startIndex + batchSize
      );
    });
  }

  /**
   * 加载单个延迟模块
   */
  private async loadModule(
    moduleId: string,
    initializeFn: (moduleId: string) => Promise<void>
  ): Promise<void> {
    const state = this.states.get(moduleId);
    if (!state || state.status !== 'pending') return;

    state.status = 'loading';
    state.startTime = Date.now();

    const tracePhase = `deferred:${moduleId}`;
    profilePhaseStart(tracePhase);

    try {
      await initializeFn(moduleId);

      state.status = 'loaded';
      state.endTime = Date.now();
      this.loadedCount++;

      profilePhaseEnd(tracePhase);
    } catch (error) {
      state.status = 'error';
      state.error = error as Error;
      state.endTime = Date.now();
      this.errorCount++;

      logger.error(`延迟模块加载失败: ${moduleId}`, error as Error);
    }
  }
}

/** 全局延迟加载调度器实例 */
export const deferredLoader = new DeferredLoader();
