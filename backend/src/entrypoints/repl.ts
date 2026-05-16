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
import { createToolManager } from '../tools/ToolManager.js';
import { historyManager } from '../utils/history.js';
import { commandRegistry } from '../commands/registry/index.js';
import { getUIEnhancer } from '../ui/UIEnhancer.js';
import { getThemeManager } from '../core/theme.js';
import { profileCheckpoint } from '../utils/startupProfiler.js';
import { getCoreAPI } from '../core/api/CoreAPIImpl.js';
import { LocalHTTPService } from '../core/gateway/local/LocalHTTPService.js';

/**
 * REPL配置接口
 */
export interface REPLConfig {
  prompt?: string;
  welcomeMessage?: string;
  exitCommand?: string;
  httpPort?: number;
}

/**
 * 默认REPL配置
 */
const DEFAULT_CONFIG: REPLConfig = {
  prompt: 'PY_APP> ',
  welcomeMessage: chalk.cyan('欢迎使用 PY_APP - AI Agent'),
  exitCommand: 'exit',
};

/**
 * 初始化聊天管理器
 * 通过 CoreAPIImpl 获取共享 ChatManager，避免重复创建
 */
export function initializeChatManager(): ChatManager {
  const coreAPI = getCoreAPI();
  const chatManager = coreAPI.getChatManager();

  const toolManager = createToolManager();
  const registry = toolManager.getRegistry();

  const provider = providerRegistry.getOrCreate('deepseek', {
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    baseUrl: process.env.DEEPSEEK_BASE_URL,
    model: process.env.DEEPSEEK_MODEL,
  });

  const llmClient = new ToolAwareClient(provider, registry, null);

  if (registry) {
    if (provider.setToolRegistry) provider.setToolRegistry(registry);
  }

  chatManager.setLLMClient(llmClient);
  if (registry) {
    chatManager.setToolRegistry(registry);
  }
  chatManager.setToolExecutor(null);
  chatManager.setPermissionManager(null);

  chatManager.initialize();

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
    console.log(
      chalk.yellow('Warning: Session initialization issue, will use default')
    );
  }

  return chatManager;
}

/**
 * 启动REPL模式
 */
export async function launchRepl(
  config: REPLConfig = DEFAULT_CONFIG
): Promise<void> {
  profileCheckpoint('repl_launch_start');
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const ui = getUIEnhancer();
  const themeManager = getThemeManager();

  // 显示欢迎消息
  ui.showTitle('PY_APP - 交互式REPL模式');
  ui.showSubtitle(finalConfig.welcomeMessage || '');
  ui.showInfo('输入命令开始交互，输入 exit 退出');
  console.log();

  // 启动 LocalHTTPService（如果配置了 httpPort）
  let localHTTPService: LocalHTTPService | null = null;
  if (finalConfig.httpPort) {
    try {
      profileCheckpoint('repl_http_service_start');
      localHTTPService = new LocalHTTPService({
        host: '127.0.0.1',
        port: finalConfig.httpPort,
      });
      await localHTTPService.start();
      ui.showInfo(`HTTP API 服务已启动: http://127.0.0.1:${finalConfig.httpPort}`);
      profileCheckpoint('repl_http_service_end');
    } catch (error) {
      ui.showWarning(
        `HTTP API 服务启动失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // 显示系统信息
  try {
    profileCheckpoint('repl_system_info_start');
    ui.showInfo('系统信息:');
    ui.showInfo(`  Node.js 版本: ${process.version}`);
    ui.showInfo(`  操作系统: ${process.platform} ${process.arch}`);
    ui.showInfo(`  当前目录: ${process.cwd()}`);
    profileCheckpoint('repl_system_info_end');
  } catch (error) {
    // 忽略系统信息显示错误
  }

  console.log();

  // 启动检查
  try {
    profileCheckpoint('repl_startup_checks_start');
    ui.showInfo('启动检查:');

    // 检查环境变量
    const requiredEnvVars = ['DEEPSEEK_API_KEY'];
    const missingVars = requiredEnvVars.filter(
      (varName) => !process.env[varName]
    );
    if (missingVars.length > 0) {
      ui.showWarning(`  警告: 缺少环境变量: ${missingVars.join(', ')}`);
      ui.showInfo('  某些功能可能无法正常工作');
    } else {
      ui.showInfo('  环境变量配置正常');
    }

    // 检查命令系统
    const commandCount = commandRegistry.getCommandCount();
    ui.showInfo(`  已加载命令: ${commandCount}`);

    profileCheckpoint('repl_startup_checks_end');
  } catch (error) {
    ui.showWarning(
      `  启动检查失败: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  console.log();

  // 加载历史记录
  try {
    profileCheckpoint('repl_load_history_start');
    const loading = ui.showLoading('加载历史记录...');
    await historyManager.load();
    loading.stop();
    ui.showInfo(`已加载 ${historyManager.getHistoryCount()} 条历史命令`);
    profileCheckpoint('repl_load_history_end');
  } catch (error) {
    ui.showWarning(
      `加载历史记录失败: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  console.log();

  // 显示当前主题
  ui.showInfo(`当前主题: ${themeManager.getCurrentTheme().name}`);
  ui.showInfo('使用 /theme 命令切换主题');
  console.log();

  // 显示快速帮助
  ui.showInfo('快速帮助:');
  ui.showInfo('  /help - 查看可用命令');
  ui.showInfo('  /session - 管理会话');
  ui.showInfo('  /tool - 管理工具');
  ui.showInfo('  /skill - 管理技能');
  console.log();

  profileCheckpoint('repl_initialize_chat_manager_start');
  const chatManager = initializeChatManager();
  profileCheckpoint('repl_initialize_chat_manager_end');

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
      // 忽略错误
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
      // 历史记录添加失败不影响命令执行
      console.warn(
        chalk.yellow('添加历史记录失败:'),
        error instanceof Error ? error.message : String(error)
      );
    }

    if (isProcessing) {
      ui.showWarning('正在处理您的请求，请稍候...');
      rl.prompt();
      return;
    }

    try {
      if (trimmedLine.startsWith('/')) {
        const parts = trimmedLine.slice(1).split(' ');
        const commandName = parts[0];
        const args = parts.slice(1).join(' ');

        const context: CommandContext = {
          sessionId: `repl-${Date.now()}`,
          chatManager,
        };

        const loading = ui.showLoading(`执行命令: ${commandName}`);
        profileCheckpoint('repl_execute_command_start');
        const result = await commandExecutor.execute(
          commandName + ' ' + args,
          context
        );
        profileCheckpoint('repl_execute_command_end');
        loading.stop();

        if (result.success) {
          if (result.message) {
            console.log('\n' + result.message);
          } else if (result.value) {
            console.log('\n' + result.value);
          } else if (result.data) {
            // 处理带有数据的命令结果
            console.log('\n' + JSON.stringify(result.data, null, 2));
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
        const loading = ui.showLoading('思考中...');

        try {
          profileCheckpoint('repl_send_message_start');
          const response = await chatManager.sendMessage(trimmedLine, {
            sessionId: 'repl-session',
            stream: true,
          });
          profileCheckpoint('repl_send_message_end');
          loading.stop();
          if (response.content) {
            console.log('\n' + response.content);
          } else {
            ui.showWarning('未收到响应，请尝试再次发送');
          }
        } catch (error) {
          loading.stop();
          ui.showError(
            `处理失败: ${error instanceof Error ? error.message : String(error)}`
          );
          // 根据错误类型提供不同的提示
          if (error instanceof Error) {
            if (error.message.includes('API key')) {
              ui.showInfo('提示: 请检查您的API密钥配置');
            } else if (error.message.includes('network')) {
              ui.showInfo('提示: 请检查您的网络连接');
            } else {
              ui.showInfo(
                '提示: 您可以尝试使用 /help 查看可用命令，或使用 /session 管理会话。'
              );
            }
          }
        }

        isProcessing = false;
      }
    } catch (error) {
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

    // 停止 LocalHTTPService
    if (localHTTPService && localHTTPService.isStarted()) {
      try {
        await localHTTPService.stop();
        ui.showInfo('HTTP API 服务已停止');
      } catch (error) {
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

      const chatManager = initializeChatManager();
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
        console.error(chalk.red(result.error || '命令执行失败'));
      }
    } else {
      profileCheckpoint('execute_once_initialize_chat_start');
      const chatManager = initializeChatManager();
      profileCheckpoint('execute_once_initialize_chat_end');

      let sessionId = 'once-session';
      try {
        const sessions = chatManager.getSessions();
        if (sessions.length > 0) {
          sessionId = sessions[0].id;
        }
      } catch {}

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
  const chatManager = initializeChatManager();
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
          console.error(
            chalk.red('处理失败:'),
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    }
  } catch (error) {
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
