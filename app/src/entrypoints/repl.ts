// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 交互式REPL模式
 * 提供交互式命令行界面
 */

import { createInterface } from 'readline';
import chalk from 'chalk';
import { commandExecutor } from '../commands/executor/index.js';
import type { CommandContext } from '../commands/types/index.js';
import type { ChatManager } from '../chat/ChatManager.js';
import { ToolAwareClient } from '../ai/clients/ToolAwareClient.js';
import { providerRegistry } from '../ai/providers/ProviderRegistry.js';
import { getToolManager } from '../tools/ToolManager.js';
import { getLogger } from '../monitoring/logs/Logger.js';
import { historyManager } from '../utils/history.js';
import { commandRegistry } from '../commands/registry/index.js';
import { getUIEnhancer } from '../ui/UIEnhancer.js';
import { profileCheckpoint } from '../performance/StartupProfiler.js';
import { getStartupChainProfiler } from '../bootstrap/StartupChainProfiler.js';
import { getCoreAPI } from '../runtime/api/CoreAPIImpl.js';
import { getConfig, configManager } from '../config/index.js';
import { modelRouter } from '../ai/modelRouter.js';
import { resolveModelRoute, RouteKey } from '../ai/router/resolveModelRoute.js';
import { SubAgentManager } from '../subagent/SubAgentManager.js';
import { SubAgentFactory } from '../subagent/SubAgentFactory.js';
import { isOfflineMode } from './shared-state.js';
import { channelRegistry } from '../channels/index.js';
import { channelBootstrapper } from '../channels/bootstrap/ChannelBootstrapper.js';
import { handleError } from '@modules/error';

const logger = getLogger('repl');

/**
 * REPL配置接口
 *
 * 预启动 HTTP 服务：主入口 (main.ts) 可在启动 REPL 循环前先启动 HTTP 服务，
 * 使前端在终端引导阻塞时也能连接。传入 preStartedHttp 后 REPL 跳过 HTTP 启动。
 */
export async function startHTTPServer(
  port: number,
  host: string = '127.0.0.1'
): Promise<
  import('@modules/infrastructure/http/LocalHTTPService').LocalHTTPService
> {
  process.stderr.write(
    `DEBUG: startHTTPServer 开始, port=${port}, host=${host}\n`
  );
  const { LocalHTTPService } =
    await import('@modules/infrastructure/http/LocalHTTPService');
  const service = new LocalHTTPService({ host, port });
  await service.start();
  process.stderr.write('DEBUG: startHTTPServer 完成, HTTP 服务已启动\n');
  return service;
}

/**
 * REPL配置接口
 */
export interface REPLConfig {
  prompt?: string;
  welcomeMessage?: string;
  exitCommand?: string;
  httpPort?: number;
  useLegacyRepl?: boolean;
  /** 已预先启动的 HTTP 服务实例（避免重复启动） */
  preStartedHttp?: import('@modules/infrastructure/http/LocalHTTPService').LocalHTTPService;
  /** 场景信任级别（chat/work/development），CLI --trust-level 参数传入 */
  trustLevel?: string;
}

/**
 * 默认REPL配置
 */
const DEFAULT_CONFIG: REPLConfig = {
  prompt: '\u{1F4AC} ',
  welcomeMessage: chalk.cyan('欢迎使用 Liri - AI Agent'),
  exitCommand: 'exit',
};

/**
 * 初始化聊天管理器
 * 通过 CoreAPIImpl 获取共享 ChatManager，避免重复创建
 *
 * Provider 初始化策略（数出同源）:
 *   1. 优先从 DB 同步 Provider 到 ProviderRegistry（用户通过 UI/CLI 配置的 Provider）
 *   2. DB 中无 deepseek 时，从环境变量回退创建（兼容旧配置）
 *   3. DB 中的 Ollama 等 Provider 通过 syncDBProvidersToRegistry 自动注册
 */
export async function initializeChatManager(): Promise<ChatManager> {
  const coreAPI = getCoreAPI();
  const chatManager = coreAPI.getChatManager();

  const toolManager = getToolManager();
  toolManager.loadBuiltinTools();
  const registry = toolManager.getRegistry();

  // Step 1: 从 DB 同步所有活跃 Provider 到运行时 ProviderRegistry
  const { syncDBProvidersToRegistry } =
    await import('../ai/providers/ProviderSyncService.js');
  await syncDBProvidersToRegistry();

  // Step 2: 从 ModelRouter 获取当前全局模型，按模型匹配 Provider
  const currentModel = await resolveModelRoute(RouteKey.CHAT);
  let provider = currentModel
    ? providerRegistry.getByModel(currentModel)
    : undefined;

  // Step 3: 模型未匹配时回退到 deepseek 类型
  if (!provider) {
    provider = providerRegistry.getByType('deepseek');
  }

  // Step 4: DB 中无 Provider 时，从环境变量检测创建
  if (!provider) {
    const { detectUnifiedProviders } =
      await import('../ai/providers/detectUnifiedProviders.js');
    const envProviders = detectUnifiedProviders();
    const envProvider = envProviders[0];

    if (envProvider) {
      provider = providerRegistry.getOrCreate(envProvider.providerType as any, {
        apiKey: envProvider.apiKey || '',
        baseUrl: envProvider.baseUrl,
        model: envProvider.model || currentModel,
      });

      if (envProvider.apiKey) {
        provider.setApiKey?.(envProvider.apiKey);
      }
    } else {
      // 最后回退：从配置文件读取 deepseek 密钥
      const config = getConfig();
      const configApiKey =
        config['ai.deepseek.apiKey'] || config.ai?.deepseek?.apiKey || '';

      if (configApiKey) {
        provider = providerRegistry.getOrCreate('deepseek', {
          apiKey: configApiKey,
          model: currentModel,
        });
        provider.setApiKey?.(configApiKey);
      }
    }
  }

  if (!provider) {
    throw new Error('未找到可用的 API Provider，无法初始化聊天管理器');
  }

  const llmClient = new ToolAwareClient(
    provider,
    registry as unknown as import('@modules/ai/interfaces/ToolExecutor').ToolRegistry,
    null
  );

  if (registry) {
    if (provider.setToolRegistry)
      provider.setToolRegistry(
        registry as unknown as Parameters<
          NonNullable<typeof provider.setToolRegistry>
        >[0]
      );
  }

  chatManager.setLLMClient(llmClient);
  if (registry) {
    chatManager.setToolRegistry(registry);
  }
  chatManager.setToolExecutor(null);
  chatManager.setPermissionManager(null);

  await chatManager.initialize();

  // 初始化子Agent管理器并注入ChatManager
  try {
    const subAgentFactory = new SubAgentFactory();
    const subAgentManager = new SubAgentManager(subAgentFactory);
    chatManager.setSubAgentManager(subAgentManager);
    logger.info('SubAgentManager initialized and injected into ChatManager');
  } catch (error) {
    await handleError(error, { module: 'repl', action: 'subAgentInit' });
    logger.warn(
      'SubAgentManager initialization failed, continuing without it',
      {
        error: String(error),
      }
    );
  }

  try {
    let sessions = chatManager.getSessions();
    if (sessions.length === 0) {
      const session = chatManager.createSession({ title: 'Default Session' });
      if (session && session.id) {
        chatManager.switchSession(session.id);
      }
    } else {
      const current = chatManager.getCurrentSession();
      if (!current) {
        chatManager.switchSession(sessions[0].id);
      }
    }
  } catch (error) {
    await handleError(error, { module: 'repl', action: 'sessionInit' });
    logger.warn('Session initialization issue, will use default', {
      error: String(error),
    });
  }

  return chatManager;
}

/**
 * 启动REPL模式
 */
export async function launchRepl(
  config: REPLConfig = DEFAULT_CONFIG
): Promise<void> {
  process.stderr.write('DEBUG: launchRepl 被调用\n');
  profileCheckpoint('repl_launch_start');
  getStartupChainProfiler().markPhaseStart('first_response');
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const ui = getUIEnhancer();

  // 显示欢迎消息
  ui.showTitle('Liri - AI Agent');

  if (isOfflineMode) {
    ui.showInfo('我是您的 AI 个人助手。当前为离线模式，AI 对话暂不可用。');
    console.log();
    ui.showSuccess('新用户起步:');
    ui.showInfo('  • "/onboard" — 3 步配置向导（推荐）');
    ui.showInfo('  • "/demo" — 预览对话效果');
    ui.showInfo('  • "/channel list" — 管理消息通道（QQ/Telegram等）');
    ui.showInfo('  • "/help" — 查看所有命令');
    ui.showInfo('  • "exit" — 退出');
  } else {
    ui.showInfo('我是您的 AI 个人助手，可以直接用自然语言与我对话。');
    console.log();
    ui.showSuccess('试试看:');
    ui.showInfo('  • 直接输入问题开始对话');
    ui.showInfo('  • "/channel list" — 管理消息通道（QQ/Telegram等）');
    ui.showInfo('  • "/help" — 查看所有命令');
    ui.showInfo('  • "/onboard" — 重新运行配置向导');
    ui.showInfo('  • "exit" — 退出');
  }

  // 根据离线/在线状态设置提示符
  if (isOfflineMode) {
    finalConfig.prompt = '\u{1F50C} [离线] ';
  }

  // 启动 LocalHTTPService（如果配置了 httpPort，或使用预启动实例）
  let localHTTPService:
    | import('@modules/infrastructure/http/LocalHTTPService').LocalHTTPService
    | null = null;
  if (finalConfig.preStartedHttp) {
    localHTTPService = finalConfig.preStartedHttp;
    ui.showInfo(
      `HTTP API 服务已在运行: http://127.0.0.1:${finalConfig.httpPort}`
    );
  } else if (finalConfig.httpPort) {
    try {
      profileCheckpoint('repl_http_service_start');
      const { LocalHTTPService } =
        await import('@modules/infrastructure/http/LocalHTTPService');
      localHTTPService = new LocalHTTPService({
        host: '127.0.0.1',
        port: finalConfig.httpPort,
      });
      await localHTTPService.start();
      ui.showInfo(
        `HTTP API 服务已启动: http://127.0.0.1:${finalConfig.httpPort}`
      );
      profileCheckpoint('repl_http_service_end');
    } catch (error) {
      await handleError(error, { module: 'repl', action: 'httpStart' });
      ui.showWarning(
        `HTTP API 服务启动失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // 记录系统信息到日志
  logger.info('REPL 系统信息', {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    cwd: process.cwd(),
  });

  // 启动检查（仅关键警告显示到控制台）
  try {
    profileCheckpoint('repl_startup_checks_start');
    const cfg = getConfig();
    const { detectUnifiedProviders } =
      await import('../ai/providers/detectUnifiedProviders.js');
    const envProviders = detectUnifiedProviders();
    const configApiKey =
      cfg['ai.deepseek.apiKey'] || cfg.ai?.deepseek?.apiKey || '';
    const hasApiKey = envProviders.length > 0 || !!configApiKey;
    if (isOfflineMode || !hasApiKey) {
      ui.showWarning('AI 对话功能不可用：未检测到有效的 API 密钥');
      ui.showInfo('配置方法（任选其一）:');
      ui.showInfo('  • 方法 1: 运行 /onboard 启动交互式配置向导（推荐）');
      ui.showInfo(
        '  • 方法 2: 在命令行输入 /config set ai.deepseek.apiKey sk-你的密钥'
      );
      ui.showInfo(
        '  • 方法 3: 编辑 app/.env 文件，填入 DEEPSEEK_API_KEY=sk-你的密钥'
      );
      ui.showInfo('  • 运行 /demo 预览对话效果（无需配置）');
    }

    const commandCount = commandRegistry.getCommandCount();
    logger.info('REPL 启动检查', { isOfflineMode, commandCount });
    profileCheckpoint('repl_startup_checks_end');
  } catch (error) {
    await handleError(error, { module: 'repl', action: 'startupCheck' });
    ui.showWarning(
      `启动检查失败: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // 检测通道状态，提示未连接的通道
  try {
    const registeredChannels = channelRegistry.getAll();
    const availableChannels = [
      'qq',
      'telegram',
      'dingtalk',
      'feishu',
      'wechat',
      'wecom',
      'discord',
      'slack',
      'line',
      'irc',
      'nostr',
      'email',
      'sms',
      'webhook',
      'googlechat',
      'msteams',
      'zalo',
      'yuanbao',
      'whatsapp',
      'signal',
      'matrix',
      'facebook',
      'twitter',
      'claude',
    ];
    const unconnectedChannels: string[] = [];
    for (const channelType of availableChannels) {
      const factory = channelBootstrapper.getPluginFactory(channelType);
      if (factory) {
        const isRegistered = registeredChannels.some(
          (rc: { type: string }) => rc.type === channelType
        );
        if (!isRegistered) {
          unconnectedChannels.push(channelType);
        }
      }
    }
    const connectedCount = registeredChannels.length;
    const factoryCount = availableChannels.filter((t) =>
      channelBootstrapper.getPluginFactory(t)
    ).length;
    if (factoryCount > 0 && connectedCount === 0) {
      ui.showInfo(`消息通道: ${connectedCount} 已连接 / ${factoryCount} 可用`);
      ui.showInfo('  • /onboard 的第 4 步可以配置消息通道');
      ui.showInfo('  • 或运行 /channel list 查看详情');
      console.log();
    } else if (unconnectedChannels.length > 0) {
      ui.showInfo(`消息通道: ${connectedCount} 已连接 / ${factoryCount} 可用`);
      console.log();
    }
  } catch {
    // @ignore-catch: 通道检测失败不影响 REPL 启动
  }

  console.log();

  // 加载历史记录
  try {
    profileCheckpoint('repl_load_history_start');
    await historyManager.load();
    const historyCount = historyManager.getHistoryCount();
    logger.info('已加载历史命令', { count: historyCount });
    profileCheckpoint('repl_load_history_end');
  } catch (error) {
    await handleError(error, { module: 'repl', action: 'historyLoad' });
    ui.showWarning(
      `加载历史记录失败: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  console.log();

  // 设置默认信任级别（从 CLI --trust-level 参数传入的全局场景）
  if (finalConfig.trustLevel) {
    try {
      const currentConfig =
        configManager.getConfigValue<Record<string, unknown>>('permission') ||
        {};
      configManager.setConfigValue('permission', {
        ...currentConfig,
        defaultTrustLevel: finalConfig.trustLevel,
      });
      ui.showInfo(
        `场景模式: ${finalConfig.trustLevel === 'chat' ? '聊天' : finalConfig.trustLevel === 'work' ? '工作' : '开发'}`
      );
    } catch {
      // @ignore-catch: 信任级别设置失败不阻塞 REPL 启动
    }
  }

  profileCheckpoint('repl_initialize_chat_manager_start');
  getStartupChainProfiler().markPhaseStart('session_init');
  const chatManager = await initializeChatManager();
  profileCheckpoint('repl_initialize_chat_manager_end');
  getStartupChainProfiler().markPhaseEnd('session_init');

  // 启动全局 Cron 调度器（附带真实 AI 执行器）
  try {
    const { ensureGlobalCronSchedulerStarted } =
      await import('../tasks/cron/GlobalCronScheduler');
    const { createCronExecutor } = await import('../tasks/cron/CronExecutor');
    const cronModel =
      (await resolveModelRoute(RouteKey.SCHEDULED)) ||
      modelRouter.getCurrentModel();
    let provider = cronModel
      ? providerRegistry.getByModel(cronModel)
      : undefined;
    if (!provider) {
      const { detectUnifiedProviders } =
        await import('../ai/providers/detectUnifiedProviders.js');
      const envProviders = detectUnifiedProviders();
      const envProvider = envProviders[0];

      if (envProvider) {
        provider = providerRegistry.getOrCreate(
          envProvider.providerType as any,
          {
            apiKey: envProvider.apiKey || '',
            baseUrl: envProvider.baseUrl,
            model: envProvider.model || cronModel,
          }
        );
      }
    }
    const realExecutor = createCronExecutor(provider!);
    await ensureGlobalCronSchedulerStarted({ executeJob: realExecutor });
    ui.showInfo('Cron 调度器已启动 (AI 执行引擎就绪)');
  } catch (cronError) {
    await handleError(cronError, { module: 'repl', action: 'cronEngine' });
    // AI provider 不可用时仍启动占位调度器
    try {
      const { ensureGlobalCronSchedulerStarted } =
        await import('../tasks/cron/GlobalCronScheduler');
      await ensureGlobalCronSchedulerStarted();
      ui.showInfo('Cron 调度器已启动（默认执行模式）');
    } catch {
      // @ignore-catch: 彻底启动失败，不阻塞 REPL
    }
    ui.showWarning(
      `Cron 调度器 AI 引擎不可用: ${cronError instanceof Error ? cronError.message : String(cronError)}`
    );
  }

  if (!finalConfig.useLegacyRepl) {
    getStartupChainProfiler().markPhaseStart('context_init');
    getStartupChainProfiler().markPhaseEnd('context_init');
    getStartupChainProfiler().markPhaseStart('app_ready');
    getStartupChainProfiler().markPhaseEnd('app_ready');
    getStartupChainProfiler().markPhaseEnd('first_response');

    try {
      const { launchInkRepl } = await import('../ink/repl/index.js');
      await launchInkRepl(chatManager);
    } catch (error) {
      await handleError(error, { module: 'repl', action: 'inkStart' });
    }

    if (localHTTPService && localHTTPService.isStarted()) {
      try {
        await localHTTPService.stop();
      } catch {
        // @ignore-catch: HTTP 服务关闭失败不影响退出流程
      }
    }
    ui.cleanup();
    profileCheckpoint('repl_launch_end');
    return;
  }

  // 上下文初始化
  getStartupChainProfiler().markPhaseStart('context_init');

  // 获取可用命令列表
  function getAvailableCommands(): string[] {
    const commands = [];
    try {
      const allCommands = commandRegistry.getVisible();
      commands.push(...allCommands.map((cmd) => cmd.name));
      // 添加命令别名
      allCommands.forEach((cmd) => {
        if (cmd.aliases) {
          commands.push(...cmd.aliases);
        }
      });
    } catch (error) {
      void handleError(error, { module: 'repl', action: 'loadCommands' });
    }
    return commands;
  }

  // 自动补全函数
  function completer(line: string): [string[], string] {
    const commands = getAvailableCommands();
    const history = historyManager.getHistory(100).map((item) => item.command);

    let completions: string[] = [];

    if (line.startsWith('/')) {
      // 命令补全
      const commandPart = line.slice(1);
      const parts = commandPart.split(' ');

      if (parts.length === 1) {
        // 补全命令名
        const cmdPart = parts[0];
        completions = commands.filter((cmd) => cmd.startsWith(cmdPart));
        completions = completions.map((cmd) => `/${cmd}`);
      } else {
        // 补全命令参数（这里可以根据具体命令添加参数补全逻辑）
        const commandName = parts[0];
        // 这里可以添加针对特定命令的参数补全逻辑
        // 例如，对于 /file 命令，可以补全文件路径
      }
    } else {
      // 历史记录补全
      completions = history.filter((cmd) => cmd.startsWith(line));
    }

    // 去重并排序
    completions = [...new Set(completions)].sort();

    return [completions, line];
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: finalConfig.prompt,
    // 启用历史记录
    historySize: 1000,
    // 启用自动补全
    completer,
  });

  // 上下文初始化完成，进入就绪状态
  getStartupChainProfiler().markPhaseEnd('context_init');
  getStartupChainProfiler().markPhaseStart('app_ready');
  getStartupChainProfiler().markPhaseEnd('app_ready');
  getStartupChainProfiler().markPhaseEnd('first_response');

  rl.prompt();

  let isProcessing = false;

  rl.on('line', async (line: string) => {
    const trimmedLine = line.trim();

    if (trimmedLine === finalConfig.exitCommand || trimmedLine === 'quit') {
      ui.showSuccess('再见！');
      rl.close();
      return;
    }

    if (!trimmedLine) {
      rl.prompt();
      return;
    }

    // 添加命令到历史记录
    try {
      await historyManager.add(trimmedLine, 'repl-session');
    } catch (error) {
      await handleError(error, { module: 'repl', action: 'historyAdd' });
      logger.warn('添加历史记录失败', { error: String(error) });
    }

    if (isProcessing) {
      ui.showWarning('正在处理您的请求，请稍候...');
      rl.prompt();
      return;
    }

    try {
      if (trimmedLine.startsWith('.scene ') || trimmedLine === '.scene') {
        // 运行时切换场景信任级别
        const sceneName = trimmedLine.startsWith('.scene ')
          ? trimmedLine.slice(7).trim()
          : '';
        if (!sceneName) {
          const current = configManager.getConfigValue<{
            defaultTrustLevel?: string;
          }>('permission')?.defaultTrustLevel;
          const label =
            current === 'chat'
              ? '聊天'
              : current === 'work'
                ? '工作'
                : current === 'development'
                  ? '开发'
                  : '未设置';
          ui.showInfo(`当前场景: ${label}${current ? ` (${current})` : ''}`);
          ui.showInfo('使用 /scene <chat|work|development> 切换场景');
        } else {
          const validLevels = ['chat', 'work', 'development'] as const;
          if (
            !validLevels.includes(sceneName as (typeof validLevels)[number])
          ) {
            ui.showError(
              `无效场景: ${sceneName}。可选: chat, work, development`
            );
          } else {
            const currentConfig =
              configManager.getConfigValue<Record<string, unknown>>(
                'permission'
              ) || {};
            configManager.setConfigValue('permission', {
              ...currentConfig,
              defaultTrustLevel: sceneName,
            });
            const label =
              sceneName === 'chat'
                ? '聊天'
                : sceneName === 'work'
                  ? '工作'
                  : '开发';
            ui.showSuccess(`场景已切换至: ${label} (${sceneName})`);
          }
        }
        rl.prompt();
        return;
      }

      if (trimmedLine.startsWith('.model ')) {
        // 运行时切换模型
        const modelName = trimmedLine.slice(7).trim();
        if (!modelName) {
          ui.showInfo(
            `当前模型: ${modelRouter.getCurrentModel() || '(未设置)'}`
          );
        } else {
          // 将模型名转换为 UUID 存储，保持 config.json 一致性
          try {
            const { modelPricingService } =
              await import('../ai/models/ModelPricingService');
            await modelPricingService.initialize();
            const record = await modelPricingService.getPricing(modelName);
            const modelId = record?.id || modelName;
            modelRouter.setCurrentModel(modelId);
          } catch {
            // @ignore-catch: 模型查找失败，使用原始模型名
            modelRouter.setCurrentModel(modelName);
          }
          ui.showSuccess(`模型已切换至: ${modelName}，重启对话后生效`);
        }
        rl.prompt();
        return;
      }

      if (trimmedLine.startsWith('/')) {
        const parts = trimmedLine.slice(1).split(' ');
        const commandName = parts[0];
        const args = parts.slice(1).join(' ');

        const loading = ui.showLoading(`执行命令: ${commandName}`);
        const context: CommandContext = {
          sessionId: `repl-${Date.now()}`,
          chatManager,
          replReadline: rl,
          stopLoading: () => loading.stop(),
        };

        profileCheckpoint('repl_execute_command_start');
        const result = await commandExecutor.execute(
          commandName + ' ' + args,
          context
        );
        profileCheckpoint('repl_execute_command_end');
        loading.stop();

        if (result.success) {
          if (result.message) {
            console.log('\n' + chalk.yellow('⚙️ System: ') + result.message);
          } else if (result.value) {
            console.log('\n' + chalk.yellow('⚙️ System: ') + result.value);
          } else if (result.data) {
            console.log(
              '\n' +
                chalk.yellow('⚙️ System: ') +
                JSON.stringify(result.data, null, 2)
            );
          }
        } else {
          ui.showError(result.error || '命令执行失败');
          // 提供更具体的错误提示
          if (result.error?.includes('Command not found')) {
            ui.showInfo('提示: 使用 /help 查看可用命令');
          }
        }
      } else {
        isProcessing = true;

        try {
          profileCheckpoint('repl_send_message_start');
          // 显示 AI 思考过程状态
          console.log(chalk.yellow('⚙️ System: 🤔 AI 正在思考...'));

          // 将 REPL 输入写入共享会话存储，使所有通道消息在统一上下文中可见
          try {
            const { getDIContainer } = await import('../core/DIContainer.js');
            const { randomUUID } = await import('crypto');
            const { MessageType, MessageRole } =
              await import('../session/types/Message.js');
            const container = getDIContainer();
            if (container.has('combinedSessionGateway')) {
              const combinedGateway = container.resolve<any>(
                'combinedSessionGateway'
              );
              if (typeof combinedGateway.sendMessage === 'function') {
                await combinedGateway.sendMessage('shared-context', {
                  id: randomUUID(),
                  sessionId: 'shared-context',
                  type: MessageType.USER,
                  role: MessageRole.USER,
                  content: trimmedLine,
                  timestamp: Date.now(),
                  metadata: { channel: 'repl', sender: 'user' },
                });
              }
            }
          } catch {
            // @ignore-catch: 共享写入失败不影响主流程
          }

          const currentSession = chatManager.getCurrentSession();
          const response = await chatManager.sendMessage(trimmedLine, {
            sessionId: currentSession?.id,
            stream: true,
            useSharedContext: true,
            /**
             * 工具调用回调：在终端实时展示工具调用过程
             */
            onToolCall: (phase, toolName, _toolCallId, detail) => {
              if (phase === 'start') {
                // 提取关键参数摘要，避免输出过多
                const paramSummary = detail ? detail.slice(0, 80) : '';
                console.log(
                  chalk.yellow('⚙️ System: 🛠 正在调用工具: ') +
                    chalk.cyan(toolName) +
                    (paramSummary ? chalk.gray(` ${paramSummary}`) : '')
                );
              } else {
                const isSuccess = detail?.startsWith('成功');
                console.log(
                  chalk.yellow('⚙️ System: ') +
                    (isSuccess ? chalk.green('✅') : chalk.red('❌')) +
                    ` 工具 ${chalk.cyan(toolName)} 执行${isSuccess ? '完成' : '失败'}`
                );
              }
            },
            /**
             * Token 用量回调：在每次 LLM 响应后展示词元用量和成本
             */
            onUsage: (usage) => {
              const costStr =
                usage.estimatedCostUsd !== undefined
                  ? ` | 💰 $${usage.estimatedCostUsd.toFixed(6)}`
                  : '';
              console.log(
                chalk.yellow('⚙️ System: 📊 Token 用量 — ') +
                  chalk.gray(
                    `输入 ${usage.inputTokens} / 输出 ${usage.outputTokens} / 总计 ${usage.totalTokens}`
                  ) +
                  costStr
              );
            },
          });
          profileCheckpoint('repl_send_message_end');

          if (response.content) {
            console.log(chalk.green('🤖 AI: ') + response.content);
          } else {
            ui.showWarning('未收到响应，请尝试再次发送');
          }
        } catch (error) {
          await handleError(error, { module: 'repl', action: 'sendMessage' });
          ui.showError(
            `处理失败: ${error instanceof Error ? error.message : String(error)}`
          );
          // 根据错误类型提供不同的提示
          if (error instanceof Error) {
            if (isOfflineMode) {
              ui.showInfo('提示: 您当前处于离线模式，AI 对话不可用');
              ui.showInfo('  请运行 /onboard 配置 API 密钥即可使用 AI 功能');
            } else if (
              error.message.includes('API key') ||
              error.message.includes('apiKey') ||
              error.message.includes('401') ||
              error.message.includes('unauthorized')
            ) {
              ui.showInfo('提示: API 密钥无效或已过期，请重新配置');
              ui.showInfo('  运行 /onboard 重新设置 API 密钥');
              ui.showInfo('  运行 /demo 预览对话效果（无需配置）');
            } else if (
              error.message.includes('No session') ||
              error.message.includes('session')
            ) {
              ui.showInfo(
                '提示: 请先配置 API 密钥，然后重启应用即可自动创建会话'
              );
              ui.showInfo(
                '  配置命令: /config set ai.deepseek.apiKey sk-你的密钥'
              );
            } else if (
              error.message.includes('network') ||
              error.message.includes('fetch')
            ) {
              ui.showInfo('提示: 网络连接失败，请检查网络');
              ui.showInfo('  如果您已配置 API 密钥，请确保可以访问互联网');
            } else {
              ui.showInfo(
                '提示: 您可以尝试使用 /help 查看可用命令。如果是首次使用，请先配置 API 密钥：\n  运行 /onboard 启动配置向导'
              );
            }
          }
        }

        isProcessing = false;
      }
    } catch (error) {
      await handleError(error, { module: 'repl', action: 'commandExec' });
      ui.showError(
        `错误: ${error instanceof Error ? error.message : String(error)}`
      );
      ui.showInfo(
        '提示: 您可以尝试使用 /help 查看可用命令，或检查命令格式是否正确。'
      );
      isProcessing = false;
    }

    rl.prompt();
  });

  rl.on('SIGINT', () => {
    console.log();
    ui.showWarning('按 Ctrl+C 退出 REPL');
    rl.close();
  });

  rl.on('close', async () => {
    ui.showSuccess('REPL 已退出');

    // 第一步：断开所有已注册通道（长轮询、心跳、重连在此停止）
    const registeredChannels = channelRegistry.getAll();
    if (registeredChannels.length > 0) {
      const disconnectResults = await Promise.allSettled(
        registeredChannels.map((ch) => channelRegistry.disconnect(ch.name))
      );
      const failedCount = disconnectResults.filter(
        (r) => r.status === 'rejected'
      ).length;
      if (failedCount > 0) {
        ui.showWarning(`${failedCount} 个通道断开失败`);
      } else {
        ui.showInfo(`${registeredChannels.length} 个通道已断开`);
      }
    }

    // 第二步：清理 ChatManager（停止任务编排器、工具注册表、流服务）
    try {
      chatManager.cleanup();
    } catch (error) {
      await handleError(error, { module: 'repl', action: 'chatCleanup' });
      ui.showWarning(
        `清理 ChatManager 失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // 第三步：清理子Agent管理器
    try {
      const subAgentMgr = chatManager.getSubAgentManager() as {
        cleanup?: () => Promise<void>;
      } | null;
      if (subAgentMgr?.cleanup) {
        await subAgentMgr.cleanup();
      }
    } catch (error) {
      await handleError(error, { module: 'repl', action: 'subAgentCleanup' });
      ui.showWarning(
        `清理子Agent失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // 第四步：停止 LocalHTTPService
    if (localHTTPService && localHTTPService.isStarted()) {
      try {
        await localHTTPService.stop();
        ui.showInfo('HTTP API 服务已停止');
      } catch (error) {
        await handleError(error, { module: 'repl', action: 'httpStopCleanup' });
        ui.showWarning(
          `停止 HTTP API 服务失败: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    ui.cleanup();
    process.exit(0);
  });

  profileCheckpoint('repl_launch_end');
}

/**
 * 单次执行模式
 * 执行单个命令或对话后退出
 */
export async function executeOnce(
  command: string,
  args: string
): Promise<void> {
  profileCheckpoint('execute_once_start');
  try {
    if (command.startsWith('/')) {
      const parts = command.split(' ');
      const commandName = parts[0].replace(/^\//, '');
      const finalArgs = args || parts.slice(1).join(' ');

      const chatManager = await initializeChatManager();
      const context: CommandContext = {
        sessionId: `once-${Date.now()}`,
        chatManager,
      };

      profileCheckpoint('execute_once_command_start');
      const result = await commandExecutor.execute(
        commandName + ' ' + finalArgs,
        context
      );
      profileCheckpoint('execute_once_command_end');
      if (result.success) {
        if (result.message) console.log(result.message);
        else if (result.value) console.log(result.value);
        else if (result.data) console.log(JSON.stringify(result.data, null, 2));
        else console.log(JSON.stringify(result));
      } else {
        logger.warn('命令执行失败', { error: result.error });
        console.error(chalk.red(result.error || '命令执行失败'));
      }
    } else {
      profileCheckpoint('execute_once_initialize_chat_start');
      const chatManager = await initializeChatManager();
      profileCheckpoint('execute_once_initialize_chat_end');

      let sessionId = 'once-session';
      try {
        const sessions = chatManager.getSessions();
        if (sessions.length > 0) {
          sessionId = sessions[0].id;
        }
      } catch {} // @ignore-catch: 会话查询失败，后续 sendMessage 会重试

      profileCheckpoint('execute_once_send_message_start');
      const response = await chatManager.sendMessage(command + ' ' + args, {
        sessionId: sessionId,
      });
      profileCheckpoint('execute_once_send_message_end');

      if (response.content) {
        console.log(chalk.white(response.content));
      }
    }
  } catch (error) {
    await handleError(error, { module: 'repl', action: 'executeOnce' });
    console.error(
      chalk.red('错误:'),
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  } finally {
    profileCheckpoint('execute_once_end');
  }
}

/**
 * 管道模式
 * 从标准输入读取命令并执行
 */
export async function executeFromPipe(): Promise<void> {
  profileCheckpoint('execute_from_pipe_start');
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  profileCheckpoint('execute_from_pipe_initialize_chat_start');
  const chatManager = await initializeChatManager();
  profileCheckpoint('execute_from_pipe_initialize_chat_end');

  try {
    for await (const line of rl) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      if (trimmedLine.startsWith('/')) {
        const parts = trimmedLine.slice(1).split(' ');
        const commandName = parts[0];
        const args = parts.slice(1).join(' ');

        const context: CommandContext = {
          sessionId: `pipe-${Date.now()}`,
          chatManager,
        };

        profileCheckpoint('execute_from_pipe_command_start');
        const result = await commandExecutor.execute(
          commandName + ' ' + args,
          context
        );
        profileCheckpoint('execute_from_pipe_command_end');

        if (result.success) {
          if (result.message) {
            console.log('\n' + result.message);
          } else if (result.value) {
            console.log('\n' + result.value);
          } else if (result.data) {
            console.log('\n' + JSON.stringify(result.data, null, 2));
          }
        } else {
          logger.warn('命令执行失败（交互模式）', { error: result.error });
          console.error(chalk.red(result.error || '命令执行失败'));
          if (result.error?.includes('Command not found')) {
            console.log(chalk.cyan('提示: 使用 /help 查看可用命令'));
          }
        }
      } else {
        try {
          profileCheckpoint('execute_from_pipe_send_message_start');
          const response = await chatManager.sendMessage(trimmedLine, {
            sessionId: 'pipe-session',
          });
          profileCheckpoint('execute_from_pipe_send_message_end');

          if (response.content) {
            console.log(chalk.white(response.content));
          }
        } catch (error) {
          await handleError(error, { module: 'repl', action: 'pipeSend' });
          console.error(
            chalk.red('处理失败:'),
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    }
  } catch (error) {
    await handleError(error, { module: 'repl', action: 'pipeOuter' });
    console.error(
      chalk.red('错误:'),
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  } finally {
    rl.close();
    profileCheckpoint('execute_from_pipe_end');
  }
}

export default {
  launchRepl,
  executeOnce,
  executeFromPipe,
};
