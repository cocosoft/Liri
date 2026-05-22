/**
 * Onboard命令实现
 * 应用入手指引和新手向导
 *
 * 简化版（v2）：3 步引导流程，专注于 AI 配置
 * - Step 1: 欢迎 + AI 模型选择（含 DeepSeek 申请指引）
 * - Step 2: API 密钥输入 + 写入 .env
 * - Step 3: 连接验证 + 完成
 */
import type { CommandContext, CommandResult } from '@modules/commands/types';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'readline';
import { setConfigValue, getConfig } from '@modules/config';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * AI 提供商信息
 */
const PROVIDER_INFO: Record<
  string,
  { name: string; signupUrl: string; hasFreeTier: boolean; freeQuota: string; price: string; envKey: string }
> = {
  deepseek: {
    name: 'DeepSeek',
    signupUrl: 'https://platform.deepseek.com/api_keys',
    hasFreeTier: true,
    freeQuota: '500万 tokens（约数百次对话）',
    price: '¥0.5/百万输入 tokens',
    envKey: 'DEEPSEEK_API_KEY',
  },
  anthropic: {
    name: 'Claude (Anthropic)',
    signupUrl: 'https://console.anthropic.com/',
    hasFreeTier: false,
    freeQuota: '',
    price: '$3/百万输入 tokens',
    envKey: 'ANTHROPIC_API_KEY',
  },
  openai: {
    name: 'OpenAI (GPT)',
    signupUrl: 'https://platform.openai.com/api-keys',
    hasFreeTier: true,
    freeQuota: '$5 免费额度（新用户）',
    price: '$2.5/百万输入 tokens',
    envKey: 'OPENAI_API_KEY',
  },
};

/** .env 文件路径 */
function getEnvPath(): string {
  return join(process.cwd(), '.env');
}

/**
 * 将 API 密钥写入 .env 文件
 */
function writeKeyToEnv(envKey: string, apiKey: string): boolean {
  try {
    const envPath = getEnvPath();
    let content = '';

    if (existsSync(envPath)) {
      content = readFileSync(envPath, 'utf-8');
    }

    const lines = content.split('\n');
    const keyPattern = new RegExp(`^${envKey}=`);
    let found = false;

    const newLines = lines.map((line) => {
      if (keyPattern.test(line.trim())) {
        found = true;
        return `${envKey}=${apiKey}`;
      }
      return line;
    });

    if (!found) {
      newLines.push(`${envKey}=${apiKey}`);
    }

    writeFileSync(envPath, newLines.join('\n'), 'utf-8');
    process.env[envKey] = apiKey;
    return true;
  } catch (e) {
    logger.warn('写入 .env 文件失败', { error: String(e) });
    return false;
  }
}

/**
 * 测试 API 连接
 */
async function testApiConnection(provider: string, apiKey: string): Promise<boolean> {
  try {
    if (provider === 'deepseek') {
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1,
        }),
      });
      return response.ok;
    }
    if (provider === 'openai') {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1,
        }),
      });
      return response.ok;
    }
    if (provider === 'anthropic') {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });
      return response.ok || response.status === 400;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 使用给定的 readline 接口提问（不创建新接口）
 */
function askQuestion(
  query: string,
  rl: import('readline').Interface
): Promise<string> {
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      resolve(answer.trim());
    });
  });
}

const onboardCommand = {
  /**
   * 执行 onboard 命令
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const cleanArgs = args.trim().toLowerCase();

    if (cleanArgs === 'help' || cleanArgs === '--help' || cleanArgs === '-h') {
      return this.showHelp();
    }

    if (cleanArgs === 'status') {
      return this.showStatus();
    }

    if (cleanArgs === 'reset') {
      return this.resetWizard();
    }

    if (cleanArgs === 'skip') {
      return this.skipWizard();
    }

    if (cleanArgs === 'quick' || cleanArgs === '--quick') {
      return this.quickStart();
    }

    context.stopLoading?.();
    const results = await runOnboard(context.replReadline);
    return { success: true, type: 'text', message: results.join('\n') };
  },

  /**
   * 显示帮助信息
   */
  showHelp(): CommandResult {
    const help = [
      'Onboard 入手指引命令',
      '',
      '用法:',
      '  /onboard                   - 启动交互式配置向导',
      '  /onboard quick             - 查看快速入门指引',
      '  /onboard status            - 查看配置状态',
      '  /onboard reset             - 重置向导状态',
      '  /onboard skip              - 跳过向导',
    ].join('\n');

    return { success: true, type: 'text', message: help };
  },

  /**
   * 显示配置状态
   */
  showStatus(): CommandResult {
    let aiProvider = '未配置';
    let aiKeyStatus = '未配置';
    try {
      const config = getConfig();
      const provider = (config as Record<string, unknown>)?.ai
        ? ((config as Record<string, unknown>).ai as Record<string, unknown>)
            .provider
        : undefined;
      if (provider) {
        aiProvider = String(provider);
        const providerConfig = (config as Record<string, unknown>).ai
          ? ((config as Record<string, unknown>).ai as Record<string, unknown>)[
              provider as string
            ]
          : undefined;
        if (
          providerConfig &&
          (providerConfig as Record<string, unknown>).apiKey
        ) {
          aiKeyStatus = '✅ 已配置';
        } else if (process.env.DEEPSEEK_API_KEY) {
          aiKeyStatus = '✅ 已配置（来自 .env）';
        } else {
          aiKeyStatus = '⚠️ 未配置（需设置 API 密钥）';
        }
      } else if (process.env.DEEPSEEK_API_KEY) {
        aiProvider = 'deepseek（来自 .env）';
        aiKeyStatus = '✅ 已配置';
      }
    } catch {
      aiKeyStatus = '未知';
    }

    const lines = [
      '📊 配置状态',
      '',
      `  AI 提供商:   ${aiProvider}`,
      `  API 密钥:    ${aiKeyStatus}`,
      '',
      '配置指南:',
      '  /onboard              - 启动配置向导',
      '  /config list          - 查看所有配置',
    ];

    return { success: true, type: 'text', message: lines.join('\n') };
  },

  /**
   * 重置向导
   */
  resetWizard(): CommandResult {
    return {
      success: true,
      type: 'text',
      message: '🔄 向导状态已重置。\n\n使用 /onboard 重新开始配置。',
    };
  },

  /**
   * 跳过向导
   */
  skipWizard(): CommandResult {
    return {
      success: true,
      type: 'text',
      message:
        '⏭️  已跳过向导。\n\n你可以随时使用 /onboard 重新开启。\n使用 /help 查看所有可用命令。',
    };
  },

  /**
   * 快速入门
   */
  quickStart(): CommandResult {
    const guide = [
      '🚀 PY_APP 快速入门',
      '',
      '1. 首次配置 - 设置 AI 模型',
      '   /onboard                                      ← 启动配置向导',
      '   /config set ai.provider deepseek              ← 选择 AI 提供商',
      '   /config set ai.deepseek.apiKey sk-你的密钥     ← 设置 API 密钥',
      '',
      '2. 核心命令',
      '   /chat         开始与 AI 对话',
      '   /help         查看所有命令',
      '   /config       管理配置',
      '   /docs         浏览文档',
      '',
      '3. 实用技巧',
      '   • Tab 键自动补全命令',
      '   • ↑/↓ 键浏览命令历史',
      '   • 输入 /help <命令> 查看特定命令帮助',
      '',
      '💡 首次使用请先运行 /onboard 完成配置。',
    ].join('\n');

    return { success: true, type: 'text', message: guide };
  },

  /**
   * 启动向导
   */
  startWizard(): CommandResult {
    const lines = [
      '📋 PY_APP 配置向导',
      '',
      '本向导将引导你完成 PY_APP 的初始配置（共 3 步）。',
      '',
      '在交互模式下输入 /onboard 启动交互式配置。',
    ].join('\n');

    return { success: true, type: 'text', message: lines };
  },
};

export async function runOnboard(
  replRl?: import('readline').Interface
): Promise<string[]> {
  const cwd = process.cwd();

  let rl: import('readline').Interface;
  let ownRl = false;

  if (replRl) {
    rl = replRl;
  } else {
    rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    ownRl = true;
  }

  try {
    console.log('');
    console.log('╔════════════════════════════════════════════════╗');
    console.log('║        PY_APP 配置向导（共 3 步）              ║');
    console.log('╚════════════════════════════════════════════════╝');
    console.log('');
    console.log('本向导帮助您快速完成 AI 模型配置。');
    console.log('输入 "skip" 跳过当前步骤，"exit" 退出向导。');
    console.log('');

    // ========== Step 1: 选择 AI 模型 ==========
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  步骤 1/3: 选择 AI 模型');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('  PY_APP 需要 AI 模型来回答问题。DeepSeek 推荐首选：');
    console.log('  ✅ 注册即送 500 万 tokens 免费额度，无需付费即可开始使用');
    console.log('');

    const providerKeys = Object.keys(PROVIDER_INFO);
    for (let i = 0; i < providerKeys.length; i++) {
      const key = providerKeys[i];
      const info = PROVIDER_INFO[key];
      const isRecommended = key === 'deepseek';
      const badge = isRecommended ? ' ★推荐' : '';
      const freeTag = info.hasFreeTier ? ' ✅ 免费额度' : '';
      console.log(`  ${i + 1}. ${info.name}${badge}${freeTag}`);
      console.log(`     ├ 价格: ${info.price}`);
      if (info.freeQuota) {
        console.log(`     ├ 免费: ${info.freeQuota}`);
      }
      console.log(`     └ 申请: ${info.signupUrl}`);
      console.log('');
    }
    console.log('  s. 跳过 — 暂不配置，进入离线模式');
    console.log('');

    const providerChoice = await askQuestion(
      `  请选择 (1-${providerKeys.length}, 默认 1): `,
      rl
    );

    if (providerChoice.toLowerCase() === 'exit') {
      console.log('\n  已退出向导。输入 /onboard 可重新启动。\n');
      return [];
    }

    if (providerChoice.toLowerCase() === 'skip' || providerChoice.toLowerCase() === 's') {
      console.log('\n  ⏭️ 已跳过 AI 配置，将进入离线模式。');
      console.log('  稍后可通过 /onboard 重新配置。\n');
      return [];
    }

    let selectedProvider = 'deepseek';
    switch (providerChoice) {
      case '2':
        selectedProvider = 'anthropic';
        break;
      case '3':
        selectedProvider = 'openai';
        break;
      default:
        selectedProvider = 'deepseek';
        break;
    }

    const providerInfo = PROVIDER_INFO[selectedProvider];
    console.log(`\n  ✅ 已选择: ${providerInfo.name}\n`);

    // ========== Step 2: 输入 API 密钥 ==========
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  步骤 2/3: 输入 API 密钥');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log(`  获取 ${providerInfo.name} API 密钥只需 3 步：`);
    console.log(`  1. 打开 ${providerInfo.signupUrl}`);
    console.log(`  2. 注册/登录账号`);
    console.log(`  3. 创建并复制 API 密钥`);
    console.log('');

    const apiKey = await askQuestion(
      `  请粘贴 API 密钥（留空跳过）:\n  > `,
      rl
    );

    if (apiKey.toLowerCase() === 'exit') {
      console.log('\n  已退出向导。输入 /onboard 可重新启动。\n');
      return [];
    }

    if (!apiKey) {
      console.log('\n  ⏭️ 未输入 API 密钥，将进入离线模式。');
      console.log('  稍后可通过 /onboard 重新配置。\n');
      return [];
    }

    console.log('');

    // ========== Step 3: 验证连接 ==========
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  步骤 3/3: 验证与完成');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('  ⏳ 正在验证 API 密钥...');
    console.log('');

    const isValid = await testApiConnection(selectedProvider, apiKey);

    if (isValid) {
      console.log('  ✅ API 密钥验证通过！');
    } else {
      console.log('  ⚠️ API 密钥验证失败（网络或密钥无效）。');
      console.log('  密钥将保存，您稍后可重试。');
    }
    console.log('');

    // 保存配置到运行时和 .env
    console.log('  ⏳ 正在保存配置...');

    const configKey = `ai.${selectedProvider}.apiKey`;
    let saveOk = true;

    try {
      setConfigValue('ai.provider', selectedProvider);
      setConfigValue(configKey, apiKey);
      console.log('  ✅ 配置已保存到运行时');
    } catch (e) {
      console.log(`  ⚠️ 运行时配置保存失败: ${e instanceof Error ? e.message : String(e)}`);
      saveOk = false;
    }

    // 写入 .env 文件
    const envWritten = writeKeyToEnv(providerInfo.envKey, apiKey);
    if (envWritten) {
      console.log('  ✅ API 密钥已写入 .env 文件（重启后自动生效）');
    } else {
      console.log('  ⚠️ .env 文件写入失败，密钥仅在本次会话有效');
      saveOk = false;
    }

    // 刷新 Provider 密钥（立即生效，无需重启）
    try {
      const { providerRegistry } = await import('@modules/ai/providers/ProviderRegistry');
      if (providerRegistry.has(selectedProvider)) {
        const provider = providerRegistry.get(selectedProvider);
        provider.setApiKey?.(apiKey);
      }
    } catch (e) {
      logger.warn('无法刷新 Provider 密钥，重启后生效', { error: String(e) });
    }

    // 初始化目录（兼容旧版）
    const dirs = ['config', 'data', 'logs'];
    for (const dir of dirs) {
      const dirPath = join(cwd, dir);
      if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true });
      }
    }

    console.log('');

    // 完成
    console.log('╔════════════════════════════════════════════════╗');
    if (isValid) {
      console.log('║        ✅ 配置完成！                           ║');
    } else {
      console.log('║        ⚠️ 配置完成（密钥待验证）               ║');
    }
    console.log('╚════════════════════════════════════════════════╝');
    console.log('');
    console.log('  现在您可以：');
    console.log('  • 直接输入问题开始 AI 对话');
    console.log('  • /help 查看所有命令');
    console.log('  • /config list 查看配置');
    console.log('');

    return [];
  } finally {
    if (ownRl) {
      rl.close();
    }
  }
}

export default onboardCommand;
