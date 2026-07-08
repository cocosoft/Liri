/**
 * Onboard命令实现
 * 应用入手指引和新手向导
 *
 * v3：5 步引导流程
 * - Step 1: 欢迎 + AI 模型选择（含 DeepSeek 申请指引）
 * - Step 2: API 密钥输入 + 写入 .env
 * - Step 3: 连接验证 + 完成
 * - Step 4: 身份与人格设置（SOUL.md / USER.md）
 * - Step 5（可选）: 消息通道配置
 */
import type { CommandContext, CommandResult } from '@modules/commands';
import { getLogger } from '@modules/monitoring';
import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'path';
import { resolveProjectRoot } from '@modules/core';
import { createInterface } from 'readline';
import { setConfigValue, getConfig } from '@modules/config';
import { writeSoulMd, readSoulMd } from '@modules/services/soul/SoulReader';
import { writeUserMd, readUserMd } from '@modules/services/soul/UserReader';
import { detectUnifiedProviders } from '@modules/ai';
import {
  OnboardHintKey,
  showHintIfNeeded,
  HINT_SOUL_CUSTOMIZATION,
  HINT_CHANNEL_SETUP,
  resetAllHints,
  getHintStats,
} from './OnboardHints';

const logger = getLogger('Onboard');

/**
 * AI 提供商信息
 */
const CHANNEL_INFO: Record<
  string,
  {
    name: string;
    signupUrl: string;
    envVars: { key: string; label: string }[];
    channelType: string;
  }
> = {
  qq: {
    name: 'QQ Bot',
    signupUrl: 'https://q.qq.com/',
    envVars: [
      { key: 'QQ_APP_ID', label: 'QQ Bot AppID' },
      { key: 'QQ_APP_SECRET', label: 'QQ Bot AppSecret' },
    ],
    channelType: 'qq',
  },
  telegram: {
    name: 'Telegram',
    signupUrl: 'https://t.me/BotFather',
    envVars: [{ key: 'TELEGRAM_BOT_TOKEN', label: 'Bot Token' }],
    channelType: 'telegram',
  },
  dingtalk: {
    name: '钉钉',
    signupUrl: 'https://open.dingtalk.com/',
    envVars: [
      { key: 'DINGTALK_APP_KEY', label: 'App Key' },
      { key: 'DINGTALK_APP_SECRET', label: 'App Secret' },
    ],
    channelType: 'dingtalk',
  },
  feishu: {
    name: '飞书',
    signupUrl: 'https://open.feishu.cn/',
    envVars: [
      { key: 'FEISHU_APP_ID', label: 'App ID' },
      { key: 'FEISHU_APP_SECRET', label: 'App Secret' },
    ],
    channelType: 'feishu',
  },
  wechat: {
    name: '微信公众号',
    signupUrl: 'https://mp.weixin.qq.com/',
    envVars: [
      { key: 'WECHAT_APP_ID', label: 'App ID' },
      { key: 'WECHAT_APP_SECRET', label: 'App Secret' },
    ],
    channelType: 'wechat',
  },
  wecom: {
    name: '企业微信',
    signupUrl: 'https://work.weixin.qq.com/',
    envVars: [
      { key: 'WECOM_CORP_ID', label: '企业 ID (corpId)' },
      { key: 'WECOM_CORP_SECRET', label: '企业密钥 (corpSecret)' },
      { key: 'WECOM_AGENT_ID', label: '应用 AgentId' },
    ],
    channelType: 'wecom',
  },
  discord: {
    name: 'Discord',
    signupUrl: 'https://discord.com/developers/applications',
    envVars: [{ key: 'DISCORD_TOKEN', label: 'Bot Token' }],
    channelType: 'discord',
  },
  slack: {
    name: 'Slack',
    signupUrl: 'https://api.slack.com/apps',
    envVars: [
      { key: 'SLACK_BOT_TOKEN', label: 'Bot Token' },
      { key: 'SLACK_SIGNING_SECRET', label: 'Signing Secret' },
    ],
    channelType: 'slack',
  },
  line: {
    name: 'LINE',
    signupUrl: 'https://developers.line.biz/console/',
    envVars: [
      { key: 'LINE_CHANNEL_ACCESS_TOKEN', label: 'Channel Access Token' },
      { key: 'LINE_CHANNEL_SECRET', label: 'Channel Secret' },
    ],
    channelType: 'line',
  },
  irc: {
    name: 'IRC',
    signupUrl: '',
    envVars: [
      { key: 'IRC_SERVER', label: 'IRC Server' },
      { key: 'IRC_NICK', label: 'Nickname' },
    ],
    channelType: 'irc',
  },
  nostr: {
    name: 'Nostr',
    signupUrl: 'https://nostr.com/',
    envVars: [
      { key: 'NOSTR_PRIVATE_KEY', label: 'Private Key (nsec)' },
      { key: 'NOSTR_RELAYS', label: 'Relay URLs (逗号分隔)' },
    ],
    channelType: 'nostr',
  },
  email: {
    name: 'Email',
    signupUrl: '',
    envVars: [
      { key: 'EMAIL_HOST', label: 'SMTP Host' },
      { key: 'EMAIL_USER', label: 'SMTP Username' },
      { key: 'EMAIL_PASS', label: 'SMTP Password' },
    ],
    channelType: 'email',
  },
  sms: {
    name: 'SMS',
    signupUrl: '',
    envVars: [{ key: 'SMS_FROM_NUMBER', label: 'Sender Phone Number' }],
    channelType: 'sms',
  },
  webhook: {
    name: 'Webhook',
    signupUrl: '',
    envVars: [{ key: 'WEBHOOK_LISTEN_PORT', label: 'Webhook Listen Port' }],
    channelType: 'webhook',
  },
  googlechat: {
    name: 'Google Chat',
    signupUrl: 'https://developers.google.com/chat',
    envVars: [
      { key: 'GOOGLECHAT_SERVICE_ACCOUNT', label: 'Service Account Key' },
    ],
    channelType: 'googlechat',
  },
  msteams: {
    name: 'Microsoft Teams',
    signupUrl: 'https://dev.teams.microsoft.com/',
    envVars: [
      { key: 'MSTEAMS_BOT_ID', label: 'Bot ID' },
      { key: 'MSTEAMS_BOT_PASSWORD', label: 'Bot Password' },
    ],
    channelType: 'msteams',
  },
  zalo: {
    name: 'Zalo',
    signupUrl: 'https://developers.zalo.me/',
    envVars: [
      { key: 'ZALO_APP_ID', label: 'App ID' },
      { key: 'ZALO_APP_SECRET', label: 'App Secret' },
    ],
    channelType: 'zalo',
  },
  yuanbao: {
    name: '元宝',
    signupUrl: 'https://yuanbao.tencent.com/',
    envVars: [
      { key: 'YUANBAO_APP_ID', label: 'App ID' },
      { key: 'YUANBAO_APP_KEY', label: 'App Key' },
    ],
    channelType: 'yuanbao',
  },
  whatsapp: {
    name: 'WhatsApp',
    signupUrl: 'https://developers.facebook.com/docs/whatsapp',
    envVars: [
      { key: 'WHATSAPP_PHONE_NUMBER_ID', label: 'Phone Number ID' },
      { key: 'WHATSAPP_ACCESS_TOKEN', label: 'Access Token' },
    ],
    channelType: 'whatsapp',
  },
  signal: {
    name: 'Signal',
    signupUrl: 'https://signal.org/download/',
    envVars: [{ key: 'SIGNAL_ACCOUNT', label: 'Signal Account' }],
    channelType: 'signal',
  },
  matrix: {
    name: 'Matrix',
    signupUrl: 'https://matrix.org/',
    envVars: [
      { key: 'MATRIX_HOMESERVER_URL', label: 'Homeserver URL' },
      { key: 'MATRIX_ACCESS_TOKEN', label: 'Access Token' },
    ],
    channelType: 'matrix',
  },
  facebook: {
    name: 'Facebook Messenger',
    signupUrl: 'https://developers.facebook.com/docs/messenger-platform',
    envVars: [
      { key: 'FACEBOOK_PAGE_ACCESS_TOKEN', label: 'Page Access Token' },
    ],
    channelType: 'facebook',
  },
  twitter: {
    name: 'Twitter',
    signupUrl: 'https://developer.twitter.com/',
    envVars: [
      { key: 'TWITTER_API_KEY', label: 'API Key' },
      { key: 'TWITTER_API_SECRET_KEY', label: 'API Secret Key' },
    ],
    channelType: 'twitter',
  },
  claude: {
    name: 'Claude',
    signupUrl: 'https://console.anthropic.com/',
    envVars: [{ key: 'CLAUDE_API_KEY', label: 'API Key' }],
    channelType: 'claude',
  },
};

const PROVIDER_INFO: Record<
  string,
  {
    name: string;
    signupUrl: string;
    hasFreeTier: boolean;
    freeQuota: string;
    price: string;
    envKey: string;
  }
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
  return join(resolveProjectRoot(), '.env');
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
async function testApiConnection(
  provider: string,
  apiKey: string
): Promise<boolean> {
  try {
    if (provider === 'deepseek') {
      const response = await fetch(
        'https://api.deepseek.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: '',
            messages: [{ role: 'user', content: 'hi' }],
            max_tokens: 1,
          }),
        }
      );
      return response.ok;
    }
    if (provider === 'openai') {
      const response = await fetch(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: '',
            messages: [{ role: 'user', content: 'hi' }],
            max_tokens: 1,
          }),
        }
      );
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

/**
 * 检测现有 AI 配置（对标 OpenClaw/Hermes "Press Enter to keep" 模式）
 */
function detectExistingConfig(): {
  provider: string | null;
  apiKeyConfigured: boolean;
  apiKeyMasked: string;
  soulCustomized: boolean;
  userCustomized: boolean;
} {
  let provider: string | null = null;
  let apiKeyConfigured = false;
  let apiKeyMasked = '';

  try {
    const config = getConfig();
    const ai = (config as Record<string, unknown>).ai as
      | Record<string, unknown>
      | undefined;
    if (ai) {
      provider = (ai.provider as string) || null;
      if (provider) {
        const providerConfig = ai[provider] as
          | Record<string, unknown>
          | undefined;
        const key = (providerConfig?.apiKey as string) || '';
        if (key) {
          apiKeyConfigured = true;
          apiKeyMasked =
            key.length > 8
              ? `${key.substring(0, 4)}...${key.substring(key.length - 4)}`
              : '****';
        }
      }
    }
  } catch {
    // 忽略
  }

  if (!apiKeyConfigured) {
    const envProviders = detectUnifiedProviders();
    if (envProviders.length > 0) {
      apiKeyConfigured = true;
      apiKeyMasked = '**** (from .env)';
      provider = envProviders[0].name;
    }
  }

  let soulCustomized = false;
  let userCustomized = false;
  try {
    const soulContent = readSoulMd();
    const defaultSoulText = '# SOUL.md';
    if (soulContent && soulContent.length > defaultSoulText.length + 100) {
      soulCustomized = true;
    }
  } catch {
    // 忽略
  }
  try {
    const userContent = readUserMd();
    const defaultUserText = '# USER.md';
    if (userContent && userContent.length > defaultUserText.length + 50) {
      userCustomized = true;
    }
  } catch {
    // 忽略
  }

  return {
    provider,
    apiKeyConfigured,
    apiKeyMasked,
    soulCustomized,
    userCustomized,
  };
}

/**
 * 分段独立重配：仅 AI 模型与密钥（1 步）
 */
async function runModelSection(
  rl: import('readline').Interface,
  cwd: string,
  step: number,
  total: number
): Promise<string[]> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  步骤 ${step}/${total}: 选择 AI 模型`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('  Liri 需要 AI 模型来回答问题。DeepSeek 推荐首选：');
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
    console.log('\n  已退出向导。\n');
    return [];
  }

  let selectedProvider = 'deepseek';

  if (
    providerChoice.toLowerCase() !== 'skip' &&
    providerChoice.toLowerCase() !== 's' &&
    providerChoice !== ''
  ) {
    const idx = parseInt(providerChoice, 10) - 1;
    if (idx >= 0 && idx < providerKeys.length) {
      selectedProvider = providerKeys[idx];
    }
  }

  const info = PROVIDER_INFO[selectedProvider];
  console.log(`\n  ✅ 已选择 ${info.name} 作为 AI 提供商`);
  console.log(`  🔗 注册链接: ${info.signupUrl}`);
  console.log('  📋 请访问注册链接获取 API Key（免费额度无需付费）');
  console.log('');

  const apiKey = await askQuestion(
    '  请输入 API Key（或输入 skip 跳过）: ',
    rl
  );

  if (apiKey.toLowerCase() === 'exit') {
    console.log('\n  已退出向导。\n');
    return [];
  }

  if (apiKey.toLowerCase() === 'skip' || apiKey.toLowerCase() === 's') {
    console.log('\n  ⚠️ 跳过 API Key 设置，进入离线模式');
    console.log('  随时可以重新运行 /onboard model 配置\n');
    return [];
  }

  if (!apiKey || apiKey.trim().length === 0) {
    console.log('\n  ⚠️ API Key 不能为空，已跳过');
    console.log('  随时可以重新运行 /onboard model 配置\n');
    return [];
  }

  const envKey = PROVIDER_INFO[selectedProvider].envKey;

  writeKeyToEnv(envKey, apiKey);

  process.env[envKey] = apiKey;
  setConfigValue('ai.provider', selectedProvider);
  setConfigValue(`ai.${selectedProvider}.apiKey`, apiKey);

  console.log('\n  ⏳ 正在验证 API Key 连接...');
  console.log('');
  try {
    const isValid = await testApiConnection(selectedProvider, apiKey);
    if (isValid) {
      console.log('  ✅ 连接验证成功！');
    } else {
      console.log('  ⚠️ 连接验证失败。');
      console.log('     API Key 已保存，稍后可能生效。');
    }
    console.log('');
  } catch {
    console.log('  ⚠️ 无法验证连接（网络错误）。');
    console.log('     API Key 已保存，稍后可能生效。');
    console.log('');
  }

  console.log('  ✅ AI 模型配置完成！');
  console.log('');
  showHintIfNeeded(
    OnboardHintKey.FIRST_SETUP_COMPLETE,
    HINT_SOUL_CUSTOMIZATION
  );

  return [];
}

/**
 * 分段独立重配：仅 SOUL/USER 身份与人格设置
 */
async function runSoulSection(
  rl: import('readline').Interface
): Promise<string[]> {
  await runSoulSetup(rl, 1);
  console.log('  ✅ 身份与人格设置完成！');
  console.log('');
  return [];
}

/**
 * 分段独立重配：仅消息通道设置
 */
async function runChannelSection(
  rl: import('readline').Interface,
  cwd: string
): Promise<string[]> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  配置消息通道');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('  Liri 支持连接 QQ/Telegram 等消息平台，');
  console.log('  让您在这些平台上与 AI 对话。');
  console.log('');

  const wantChannel = await askQuestion('  是否要配置消息通道？(y/N): ', rl);

  if (
    wantChannel.toLowerCase() !== 'y' &&
    wantChannel.toLowerCase() !== 'yes'
  ) {
    console.log('\n  已跳过。\n');
    return [];
  }

  const channelKeys = Object.keys(CHANNEL_INFO);

  console.log('');
  for (let i = 0; i < channelKeys.length; i++) {
    const key = channelKeys[i];
    const info = CHANNEL_INFO[key];
    console.log(`  ${i + 1}. ${info.name}`);
    console.log(`     申请: ${info.signupUrl}`);
    console.log('');
  }
  console.log('  s. 跳过');
  console.log('');

  const channelChoice = await askQuestion(
    `  请选择要配置的通道 (1-${channelKeys.length}): `,
    rl
  );

  if (
    channelChoice.toLowerCase() !== 'skip' &&
    channelChoice.toLowerCase() !== 's' &&
    channelChoice !== ''
  ) {
    const idx = parseInt(channelChoice, 10) - 1;
    if (idx >= 0 && idx < channelKeys.length) {
      const selectedKey = channelKeys[idx];
      const info = CHANNEL_INFO[selectedKey];

      console.log(`\n  ✅ 已选择: ${info.name}`);
      console.log(`  🔗 申请地址: ${info.signupUrl}`);
      console.log('');

      const envValues: Record<string, string> = {};

      for (const envVar of info.envVars) {
        const value = await askQuestion(`  请输入 ${envVar.label}: `, rl);
        if (
          value &&
          value.toLowerCase() !== 'skip' &&
          value.toLowerCase() !== 'exit'
        ) {
          envValues[envVar.key] = value;
        }
      }

      if (Object.keys(envValues).length > 0) {
        console.log('');
        console.log('  ⏳ 正在保存通道配置...');

        let allWritten = true;
        for (const [key, value] of Object.entries(envValues)) {
          const written = writeKeyToEnv(key, value);
          if (!written) {
            allWritten = false;
            console.log(`  ⚠️ ${key} 写入 .env 失败`);
          }
        }

        if (allWritten) {
          console.log(`  ✅ ${info.name} 配置已保存`);
        }

        try {
          const { channelBootstrapper } =
            await import('@modules/channels/bootstrap/ChannelBootstrapper');
          const factory = channelBootstrapper.getPluginFactory(
            info.channelType
          );
          if (factory) {
            const plugin = factory();
            if (plugin) {
              const connectConfig: Record<string, string> = {};
              for (const envVar of info.envVars) {
                connectConfig[
                  envVar.key.replace(/^[A-Z_]+_/, '').toLowerCase()
                ] = envValues[envVar.key];
              }
              await plugin.lifecycle.connect(connectConfig);
              const { channelRegistry } = await import('@modules/channels');
              channelRegistry.register(plugin);
              console.log(`  ✅ ${info.name} 已连接！`);
              console.log('  💡 输入 /channel list 查看通道状态');
            }
          }
        } catch {
          console.log(
            '  ⚠️ 重启后自动连接（或运行 /channel connect 手动连接）'
          );
        }
      }
    }
  }

  showHintIfNeeded(OnboardHintKey.CHANNEL_SETUP, HINT_CHANNEL_SETUP);

  console.log('');
  console.log('  ✅ 消息通道配置完成！');
  console.log('');
  return [];
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

    // 分段独立重配（对标 Hermes hermes setup <section>）
    if (cleanArgs === 'model') {
      return this.startSectionWizard('model');
    }

    if (cleanArgs === 'soul') {
      return this.startSectionWizard('soul');
    }

    if (cleanArgs === 'channel') {
      return this.startSectionWizard('channel');
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
      '  /onboard                   - 启动交互式配置向导（含 Quick/Full 模式选择）',
      '  /onboard model             - 单独配置 AI 模型和密钥',
      '  /onboard soul              - 单独设置 AI 人格和用户档案',
      '  /onboard channel           - 单独配置消息通道',
      '  /onboard quick             - 查看快速入门指引',
      '  /onboard status            - 查看配置状态和提示状态',
      '  /onboard reset             - 重置向导状态和所有提示',
      '  /onboard skip              - 跳过向导',
    ].join('\n');

    return { success: true, type: 'text', message: help };
  },

  /**
   * 分段独立重配：启动单个 section 的配置向导
   */
  async startSectionWizard(
    section: 'model' | 'soul' | 'channel'
  ): Promise<CommandResult> {
    const sectionLabels: Record<string, string> = {
      model: 'AI 模型与密钥',
      soul: 'AI 人格与用户档案',
      channel: '消息通道',
    };

    const messages: string[] = [];

    if (section === 'model') {
      messages.push('🔧 正在启动 AI 模型配置向导...');
      messages.push('');
      const results = await runOnboard(undefined, 'model');
      if (results.length > 0) {
        messages.push(...results);
      }
    } else if (section === 'soul') {
      messages.push('🎭 正在启动身份与人格设置向导...');
      messages.push('');
      const results = await runOnboard(undefined, 'soul');
      if (results.length > 0) {
        messages.push(...results);
      }
    } else if (section === 'channel') {
      messages.push('📡 正在启动消息通道配置向导...');
      messages.push('');
      const results = await runOnboard(undefined, 'channel');
      if (results.length > 0) {
        messages.push(...results);
      }
    }

    messages.push('');
    messages.push(`💡 运行 /onboard 进行完整配置`);
    return { success: true, type: 'text', message: messages.join('\n') };
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
        } else {
          aiKeyStatus = '⚠️ 未配置（需设置 API 密钥）';
        }
      }

      // 检测环境变量中的 API Key
      const envProviders = detectUnifiedProviders();
      if (envProviders.length > 0 && !provider) {
        aiProvider = `${envProviders[0].name}（来自 .env）`;
        aiKeyStatus = '✅ 已配置';
      }
    } catch {
      aiKeyStatus = '未知';
    }

    // 检查 SOUL/USER 自定义状态
    let soulStatus = '使用默认';
    let userStatus = '使用默认';
    try {
      const soulContent = readSoulMd();
      const defaultSoulText = `# SOUL.md — Liri 的人格`;
      if (soulContent && soulContent.length > defaultSoulText.length + 100) {
        soulStatus = '✅ 已自定义';
      }
    } catch {
      // 忽略
    }
    try {
      const userContent = readUserMd();
      const defaultUserText = `# USER.md — 你的档案`;
      if (userContent && userContent.length > defaultUserText.length + 50) {
        userStatus = '✅ 已自定义';
      }
    } catch {
      // 忽略
    }

    const hintStats = getHintStats();

    const lines = [
      '📊 配置状态',
      '',
      `  AI 提供商:   ${aiProvider}`,
      `  API 密钥:    ${aiKeyStatus}`,
      `  AI 人格:     ${soulStatus}`,
      `  用户档案:    ${userStatus}`,
      `  上下文提示:   ${hintStats.seen}/${hintStats.total} 已展示`,
      '',
      '配置指南:',
      '  /onboard              - 启动完整配置向导',
      '  /onboard model        - 单独配置 AI 模型',
      '  /onboard soul         - 单独设置 AI 人格',
      '  /onboard channel      - 单独配置消息通道',
      '  /onboard reset        - 重置向导和提示状态',
      '  /config list          - 查看所有配置',
    ];

    return { success: true, type: 'text', message: lines.join('\n') };
  },

  /**
   * 重置向导
   */
  resetWizard(): CommandResult {
    resetAllHints();

    return {
      success: true,
      type: 'text',
      message: '🔄 向导状态和提示已全部重置。\n\n使用 /onboard 重新开始配置。',
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
      '🚀 Liri 快速入门',
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
      '📋 Liri 配置向导',
      '',
      '本向导将引导你完成 Liri 的初始配置。',
      '',
      '• 快速配置（推荐）—— 仅需 AI 模型和密钥',
      '• 完整配置 —— 额外包含 AI 人格、用户档案、消息通道',
      '',
      '在交互模式下输入 /onboard 启动交互式配置。',
    ].join('\n');

    return { success: true, type: 'text', message: lines };
  },
};

export async function runOnboard(
  replRl?: import('readline').Interface,
  section?: 'model' | 'soul' | 'channel'
): Promise<string[]> {
  const cwd = process.cwd();

  let rl: import('readline').Interface;
  let ownRl = false;

  if (replRl) {
    rl = replRl;
  } else {
    // 非交互环境检测：无 TTY 时跳过交互式向导
    if (!process.stdin.isTTY) {
      console.log('');
      console.log('╔════════════════════════════════════════════════╗');
      console.log('║        Liri 配置向导                         ║');
      console.log('╚════════════════════════════════════════════════╝');
      console.log('');
      console.log('检测到非交互环境（无 TTY），无法运行交互式配置向导。');
      console.log('');
      console.log('请通过以下方式完成配置：');
      console.log('  1. 手动编辑 .env 文件，设置 API 密钥（任选一种方式）：');
      console.log('     - 方式一（大厂专用变量名）: DEEPSEEK_API_KEY=sk-xxx');
      console.log(
        '     - 方式二（统一格式，支持任意供应商）: PROVIDER_xxx_KEY=sk-xxx'
      );
      console.log('  2. 手动编辑 ~/.pyapp/SOUL.md 设置 AI 人格');
      console.log('  3. 手动编辑 ~/.pyapp/USER.md 设置用户档案');
      console.log('');
      console.log('快速入门文档：');
      console.log('  /help onboard — 查看配置指引');
      console.log('  /config list  — 查看当前配置');
      console.log('');
      return [];
    }

    rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    ownRl = true;
  }

  try {
    console.log('');
    console.log('╔════════════════════════════════════════════════╗');
    console.log('║        Liri 配置向导                         ║');
    console.log('╚════════════════════════════════════════════════╝');
    console.log('');
    console.log('本向导帮助您快速完成 AI 模型与个性化配置。');
    console.log('输入 "skip" 跳过当前步骤，"exit" 退出向导。');
    console.log('');

    // 分段独立重配：直接跳转到指定 section
    if (section === 'model') {
      return await runModelSection(rl, cwd, 1, 1);
    }
    if (section === 'soul') {
      return await runSoulSection(rl);
    }
    if (section === 'channel') {
      return await runChannelSection(rl, cwd);
    }

    // ========== 选择模式: Quick / Full ==========
    // 检测现有配置，提供 "保留/重配" 指引（对标 OpenClaw/Hermes）
    const existingConfig = detectExistingConfig();
    const hasExistingConfig =
      existingConfig.provider !== null || existingConfig.apiKeyConfigured;

    if (hasExistingConfig) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('  检测到已有配置');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('');
      if (existingConfig.provider) {
        console.log(`  当前 AI 提供商: ${existingConfig.provider}`);
      }
      if (existingConfig.apiKeyConfigured) {
        console.log(`  当前 API 密钥:  ${existingConfig.apiKeyMasked}`);
      }
      console.log('');
      console.log('  每次提示会显示当前值作为默认。');
      console.log('  直接按 Enter 保持当前设置，或输入新值重新配置。');
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  选择配置模式');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('  1. 快速配置（推荐）— 只用配置 AI 模型和密钥即可开始');
    console.log('     AI 人格和用户档案使用默认值，稍后可手动调整');
    console.log('  2. 完整配置 — 除 AI 配置外，还会引导设置 AI 人格、');
    console.log('     用户档案和消息通道');
    console.log('');

    const modeChoice = await askQuestion('  请选择 (1/2, 默认 1): ', rl);

    if (modeChoice.toLowerCase() === 'exit') {
      console.log('\n  已退出向导。输入 /onboard 可重新启动。\n');
      return [];
    }

    const isQuickMode = modeChoice !== '2';
    const totalSteps = isQuickMode ? 3 : 5;

    if (!isQuickMode) {
      console.log('');
      console.log('╔════════════════════════════════════════════════╗');
      console.log(`║        Liri 配置向导（共 ${totalSteps} 步）         ║`);
      console.log('╚════════════════════════════════════════════════╝');
      console.log('');
    }

    // ========== Step 1: 选择 AI 模型 ==========
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  步骤 1/${totalSteps}: 选择 AI 模型`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('  Liri 需要 AI 模型来回答问题。DeepSeek 推荐首选：');
    console.log('  ✅ 注册即送 500 万 tokens 免费额度，无需付费即可开始使用');
    console.log('');

    const providerKeys = Object.keys(PROVIDER_INFO);
    for (let i = 0; i < providerKeys.length; i++) {
      const key = providerKeys[i];
      const info = PROVIDER_INFO[key];
      const isRecommended = key === 'deepseek';
      const isCurrent = existingConfig.provider === key;
      const badge = isCurrent ? ' ★当前' : isRecommended ? ' ★推荐' : '';
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

    if (
      providerChoice.toLowerCase() === 'skip' ||
      providerChoice.toLowerCase() === 's'
    ) {
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
    console.log(`  步骤 2/${totalSteps}: 输入 API 密钥`);
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
    console.log(`  步骤 3/${totalSteps}: 验证与完成`);
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
      console.log(
        `  ⚠️ 运行时配置保存失败: ${e instanceof Error ? e.message : String(e)}`
      );
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
      const { providerRegistry } =
        await import('@modules/ai/providers/ProviderRegistry');
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

    // Quick 模式：到此为止，跳过 SOUL/USER 和通道设置
    if (isQuickMode) {
      console.log('  💡 AI 人格和用户档案使用默认值。');
      console.log('     手动编辑：~/.pyapp/SOUL.md 和 ~/.pyapp/USER.md');
      console.log('     或运行 /onboard 选择完整配置重新设置');
      console.log('');
      console.log('  现在您可以：');
      console.log('  • 直接输入问题开始 AI 对话');
      console.log('  • /help 查看所有命令');
      console.log('  • /config list 查看配置');
      console.log('  • /onboard 重新运行完整向导');
      console.log('');

      showHintIfNeeded(
        OnboardHintKey.SOUL_CUSTOMIZATION,
        HINT_SOUL_CUSTOMIZATION
      );

      return [];
    }

    // ========== Step 4: SOUL/USER 身份与人格设置 ==========
    await runSoulSetup(rl, totalSteps);

    // ========== Step 5（可选）: 配置消息通道 ==========
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  步骤 5/${totalSteps}（可选）: 配置消息通道`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('  Liri 支持连接 QQ/Telegram 等消息平台，');
    console.log('  让您在这些平台上与 AI 对话。');
    console.log('');

    const wantChannel = await askQuestion('  是否要配置消息通道？(y/N): ', rl);

    if (
      wantChannel.toLowerCase() === 'y' ||
      wantChannel.toLowerCase() === 'yes'
    ) {
      const channelKeys = Object.keys(CHANNEL_INFO);

      console.log('');
      for (let i = 0; i < channelKeys.length; i++) {
        const key = channelKeys[i];
        const info = CHANNEL_INFO[key];
        console.log(`  ${i + 1}. ${info.name}`);
        console.log(`     申请: ${info.signupUrl}`);
        console.log('');
      }
      console.log('  s. 跳过');
      console.log('');

      const channelChoice = await askQuestion(
        `  请选择要配置的通道 (1-${channelKeys.length}): `,
        rl
      );

      if (
        channelChoice.toLowerCase() !== 'skip' &&
        channelChoice.toLowerCase() !== 's' &&
        channelChoice !== ''
      ) {
        const idx = parseInt(channelChoice, 10) - 1;
        if (idx >= 0 && idx < channelKeys.length) {
          const selectedKey = channelKeys[idx];
          const info = CHANNEL_INFO[selectedKey];

          console.log(`\n  ✅ 已选择: ${info.name}`);
          console.log(`  🔗 申请地址: ${info.signupUrl}`);
          console.log('');

          const envValues: Record<string, string> = {};

          for (const envVar of info.envVars) {
            const value = await askQuestion(`  请输入 ${envVar.label}: `, rl);
            if (
              value &&
              value.toLowerCase() !== 'skip' &&
              value.toLowerCase() !== 'exit'
            ) {
              envValues[envVar.key] = value;
            }
          }

          if (Object.keys(envValues).length > 0) {
            console.log('');
            console.log('  ⏳ 正在保存通道配置...');

            let allWritten = true;
            for (const [key, value] of Object.entries(envValues)) {
              const written = writeKeyToEnv(key, value);
              if (!written) allWritten = false;
            }

            if (allWritten) {
              console.log('  ✅ 通道配置已保存到 .env 文件');
            }

            // 尝试热连接
            console.log('  ⏳ 正在尝试连接...');
            try {
              const { channelBootstrapper } =
                await import('@modules/channels/bootstrap/ChannelBootstrapper');
              const factory = channelBootstrapper.getPluginFactory(
                info.channelType
              );
              if (factory) {
                const plugin = factory();
                if (plugin) {
                  const connectConfig: Record<string, string> = {};
                  for (const envVar of info.envVars) {
                    connectConfig[
                      envVar.key.replace(/^[A-Z_]+_/, '').toLowerCase()
                    ] = envValues[envVar.key];
                  }
                  await plugin.lifecycle.connect(connectConfig);
                  const { channelRegistry } = await import('@modules/channels');
                  channelRegistry.register(plugin);
                  console.log(`  ✅ ${info.name} 已连接！`);
                  console.log('  💡 输入 /channel list 查看通道状态');
                }
              }
            } catch {
              console.log(
                '  ⚠️ 重启后自动连接（或运行 /channel connect 手动连接）'
              );
            }
          }
        }
      }
    }

    console.log('');
    console.log('  现在您可以：');
    console.log('  • 直接输入问题开始 AI 对话');
    console.log('  • /channel list — 查看消息通道状态');
    console.log('  • /help 查看所有命令');
    console.log('  • /config list 查看配置');
    console.log('');

    showHintIfNeeded(
      OnboardHintKey.SOUL_CUSTOMIZATION,
      HINT_SOUL_CUSTOMIZATION
    );

    return [];
  } finally {
    if (ownRl) {
      rl.close();
    }
  }
}

/**
 * SOUL/USER 身份与人格设置引导
 * 交互式问答收集用户信息和 AI 人格偏好
 */
async function runSoulSetup(
  rl: import('readline').Interface,
  totalSteps: number
): Promise<void> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  步骤 4/${totalSteps}: 身份与人格设置`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('  接下来，让 Liri 了解你 —— 以及你希望它如何与你互动。');
  console.log('  这些信息会保存到 SOUL.md（AI 人格）和 USER.md（用户档案），');
  console.log('  并自动注入到每次对话中。');
  console.log('  输入 "skip" 跳过此步骤，使用默认设置。');
  console.log('');

  // ========== USER.md 配置 ==========
  console.log('  ── 关于你 ──');
  console.log('');

  const userName = await askQuestion(
    '  你的名字或称呼？（如：小明、Tom）> ',
    rl
  );
  if (userName.toLowerCase() === 'exit') return;
  if (userName.toLowerCase() === 'skip') return;

  const userField = await askQuestion(
    '  专业领域？（如：全栈开发、AI 研究、项目管）> ',
    rl
  );
  if (userField.toLowerCase() === 'exit') return;
  if (userField.toLowerCase() === 'skip') return;

  const userTech = await askQuestion(
    '  偏好的技术栈？（如：TypeScript, Rust, Python）> ',
    rl
  );
  if (userTech.toLowerCase() === 'exit') return;
  if (userTech.toLowerCase() === 'skip') return;

  const userScene = await askQuestion(
    '  主要工作场景？（如：个人开发、团队协作、学习研究）> ',
    rl
  );
  if (userScene.toLowerCase() === 'exit') return;
  if (userScene.toLowerCase() === 'skip') return;

  const userLang = await askQuestion(
    '  希望 AI 用什么语言回复？（如：中文、English、混合）> ',
    rl
  );
  if (userLang.toLowerCase() === 'exit') return;

  const userDetail = await askQuestion(
    '  喜欢简洁回答，还是详细解释？（简洁/平衡/详细，默认 平衡）> ',
    rl
  );
  if (userDetail.toLowerCase() === 'exit') return;

  console.log('');

  const userInfo = buildUserInfoLines(userName, userField, userTech, userScene);
  const userPrefs = buildUserPrefLines(userLang, userDetail);

  if (userInfo || userPrefs) {
    const currentUser = readUserMd();
    let newUser = currentUser;
    if (userInfo) newUser = replaceSection(newUser, '基本信息', userInfo);
    if (userPrefs) newUser = replaceSection(newUser, '沟通偏好', userPrefs);
    writeUserMd(newUser);
    console.log('  ✅ 用户档案已保存到 ~/.pyapp/USER.md');
  } else {
    console.log('  ⏭️ 未提供用户信息，使用默认设置。');
  }

  console.log('');

  // ========== SOUL.md 配置 ==========
  console.log('  ── 关于 Liri ──');
  console.log('');

  const aiName = await askQuestion(
    '  你希望 Liri 怎么称呼你？（如：主人、老板、用户）> ',
    rl
  );
  if (aiName.toLowerCase() === 'exit') return;
  if (aiName.toLowerCase() === 'skip') return;

  const aiTone = await askQuestion(
    '  希望 AI 的语气风格是什么？（如：专业严谨/轻松幽默/简洁直接）> ',
    rl
  );
  if (aiTone.toLowerCase() === 'exit') return;
  if (aiTone.toLowerCase() === 'skip') return;

  const aiExtra = await askQuestion(
    '  有什么特别规则或偏好？（如：不要自称 Cluade、不要提出建议，留空跳过）> ',
    rl
  );
  if (aiExtra.toLowerCase() === 'exit') return;

  console.log('');

  if (aiName || aiTone || aiExtra) {
    const currentSoul = readSoulMd();
    let newSoul = currentSoul;

    if (aiName || aiTone || aiExtra) {
      const toneLines: string[] = [];
      if (aiName) toneLines.push(`- 称呼用户为：${aiName}`);
      if (aiTone) toneLines.push(`- 语气风格：${aiTone}`);
      if (aiExtra) toneLines.push(`- 额外规则：${aiExtra}`);
      newSoul = replaceSection(newSoul, '语气', toneLines.join('\n'));
    }

    writeSoulMd(newSoul);
    console.log('  ✅ AI 人格已保存到 ~/.pyapp/SOUL.md');
  } else {
    console.log('  ⏭️ 未提供人格偏好，使用默认设置。');
  }

  console.log('');
  console.log('  💡 文件的初始设置已完成');
  console.log('  💡 此后与 Liri 对话时，AI 会自动感知并更新这些文件');
  console.log('  💡 你也可以手动编辑 ~/.pyapp/SOUL.md 和 USER.md');
  console.log('');
}

function buildUserInfoLines(
  name: string,
  field: string,
  tech: string,
  scene: string
): string | null {
  const lines: string[] = [];
  if (name) lines.push(`- 称呼：${name}`);
  if (field) lines.push(`- 专业领域：${field}`);
  if (tech) lines.push(`- 技术栈偏好：${tech}`);
  if (scene) lines.push(`- 工作场景：${scene}`);
  return lines.length > 0 ? lines.join('\n') : null;
}

function buildUserPrefLines(lang: string, detail: string): string | null {
  const lines: string[] = [];
  if (lang) lines.push(`- 回复语言：${lang}`);
  if (detail) lines.push(`- 详细程度：${detail}`);
  return lines.length > 0 ? lines.join('\n') : null;
}

function replaceSection(
  content: string,
  sectionName: string,
  sectionContent: string
): string {
  const escapedName = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(
    `(## ${escapedName}\\n\\n)[\\s\\S]*?(?=\\n## |\\n*$)`,
    'm'
  );
  if (regex.test(content)) {
    return content.replace(regex, `$1${sectionContent}`);
  }
  return (
    content.replace(/\n*$/, '') + `\n\n## ${sectionName}\n\n${sectionContent}\n`
  );
}

export default onboardCommand;
