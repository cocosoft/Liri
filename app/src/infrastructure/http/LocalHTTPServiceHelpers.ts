/**
 * LocalHTTPServiceHelpers.ts — HTTP 服务辅助方法（从 LocalHTTPService 提取）
 *
 * 包含通道注册表、动态注册、知识库种子、编译调度等辅助功能。
 */

import http from 'http';

import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import type { IChannelPlugin } from '@modules/channels/types/IChannel';

const logger = new Logger({
  module: 'infrastructure:http:localHTTPServiceHelpers',
  level: LogLevel.INFO,
});

// ── 通道动态注册元信息表（26 通道全覆盖）──────────────────────────

export const CHANNEL_TABLE: Array<{
  type: string;
  name: string;
  importPath: string;
  exportKey: string;
}> = [
  {
    type: 'telegram',
    name: 'Telegram',
    importPath: '../../../channels/telegram/TelegramChannel',
    exportKey: 'telegramChannel',
  },
  {
    type: 'discord',
    name: 'Discord',
    importPath: '../../../channels/discord/DiscordChannel',
    exportKey: 'discordChannel',
  },
  {
    type: 'qq',
    name: 'QQ',
    importPath: '../../../channels/qq/QQChannel',
    exportKey: 'qqChannel',
  },
  {
    type: 'dingtalk',
    name: '钉钉',
    importPath: '../../../channels/dingtalk/DingTalkChannel',
    exportKey: 'dingtalkChannel',
  },
  {
    type: 'feishu',
    name: '飞书',
    importPath: '../../../channels/feishu/FeishuChannel',
    exportKey: 'feishuChannel',
  },
  {
    type: 'wechat',
    name: '微信',
    importPath: '../../../channels/wechat/WechatChannel',
    exportKey: 'wechatChannel',
  },
  {
    type: 'slack',
    name: 'Slack',
    importPath: '../../../channels/slack/index',
    exportKey: 'slackChannelPlugin',
  },
  {
    type: 'line',
    name: 'Line',
    importPath: '../../../channels/line/index',
    exportKey: 'lineChannelPlugin',
  },
  {
    type: 'irc',
    name: 'IRC',
    importPath: '../../../channels/irc/index',
    exportKey: 'ircChannelPlugin',
  },
  {
    type: 'nostr',
    name: 'Nostr',
    importPath: '../../../channels/nostr/index',
    exportKey: 'nostrChannelPlugin',
  },
  {
    type: 'email',
    name: '邮件',
    importPath: '../../../channels/email/EmailChannel',
    exportKey: 'emailChannelPlugin',
  },
  {
    type: 'sms',
    name: '短信',
    importPath: '../../../channels/sms/SmsChannel',
    exportKey: 'smsChannelPlugin',
  },
  {
    type: 'webhook',
    name: 'Webhook',
    importPath: '../../../channels/webhook/WebhookChannel',
    exportKey: 'webhookChannelPlugin',
  },
  {
    type: 'wecom',
    name: '企业微信',
    importPath: '../../../channels/wecom/WeComChannel',
    exportKey: 'wecomChannel',
  },
  {
    type: 'googlechat',
    name: 'Google Chat',
    importPath: '../../../channels/googlechat/index',
    exportKey: 'googleChatChannelPlugin',
  },
  {
    type: 'msteams',
    name: 'MS Teams',
    importPath: '../../../channels/msteams/index',
    exportKey: 'msteamsChannelPlugin',
  },
  {
    type: 'zalo',
    name: 'Zalo',
    importPath: '../../../channels/zalo/index',
    exportKey: 'zaloChannelPlugin',
  },
  {
    type: 'yuanbao',
    name: '元宝',
    importPath: '../../../channels/yuanbao/index',
    exportKey: 'yuanbaoChannelPlugin',
  },
  {
    type: 'facebook',
    name: 'Facebook Messenger',
    importPath: '../../../channels/facebookmessenger/index',
    exportKey: 'facebookMessengerChannelPlugin',
  },
  {
    type: 'twitter',
    name: 'Twitter/X',
    importPath: '../../../channels/twitter/index',
    exportKey: 'twitterChannelPlugin',
  },
  {
    type: 'claude',
    name: 'Claude',
    importPath: '../../../channels/claude/index',
    exportKey: 'claudeChannelPlugin',
  },
  {
    type: 'mattermost',
    name: 'Mattermost',
    importPath: '../../../channels/mattermost/MattermostChannel',
    exportKey: 'mattermostChannel',
  },
  {
    type: 'bluebubbles',
    name: 'iMessage',
    importPath: '../../../channels/bluebubbles/BlueBubblesChannel',
    exportKey: 'bluebubblesChannelPlugin',
  },
];

/** CHANNEL_TABLE 的快速索引 */
export function getChannelEntry(type: string) {
  return CHANNEL_TABLE.find((e) => e.type === type);
}

/**
 * 验证请求的共享密钥
 * @param req - HTTP 请求对象
 * @param apiSecret - 服务端配置的 API 密钥
 * @returns 是否通过验证
 */
export function verifyRequestAuth(
  req: http.IncomingMessage,
  apiSecret: string
): boolean {
  const token =
    req.headers['authorization']?.replace('Bearer ', '') ||
    (req.headers['x-api-key'] as string) ||
    '';
  return token === apiSecret;
}

/**
 * 种子知识库：若用户知识库目录为空，从源码或内建默认文档初始化
 */
export async function seedKnowledgeBaseIfEmpty(): Promise<void> {
  const fs = await import('node:fs/promises');
  const path = await import('path');
  const { resolvePyappHome } = await import('@modules/core/paths');

  const userKnowledgeDir = path.join(resolvePyappHome(), 'knowledge');

  // 若用户目录已存在 .md 文件，说明已初始化，跳过
  try {
    const userFiles = await fs.readdir(userKnowledgeDir);
    if (userFiles.some((f: string) => f.endsWith('.md'))) {
      return;
    }
  } catch {
    // 目录不存在，继续初始化
  }

  await fs.mkdir(userKnowledgeDir, { recursive: true });

  // 拷贝源：1) 项目源码路径（开发环境）
  try {
    const { resolveKnowledgeBaseDir } = await import('@modules/core/paths');
    const sourceDir = resolveKnowledgeBaseDir();
    const sourceFiles = await fs.readdir(sourceDir);
    const mdFiles = sourceFiles.filter((f: string) => f.endsWith('.md'));
    if (mdFiles.length > 0) {
      for (const file of mdFiles) {
        const content = await fs.readFile(path.join(sourceDir, file), 'utf-8');
        await fs.writeFile(path.join(userKnowledgeDir, file), content, 'utf-8');
      }
      logger.info(
        `知识库种子完成：从 ${sourceDir} 复制了 ${mdFiles.length} 个文件`
      );
      return;
    }
  } catch {
    // 源码目录不可用，继续兜底
  }

  // 拷贝源：2) 内建默认文档（兜底，适用于打包生产环境）
  await writeDefaultKnowledgeDocs(userKnowledgeDir, fs, path);
}

/**
 * 写入内建默认知识库文档（无任何外部源时的最终兜底）
 */
async function writeDefaultKnowledgeDocs(
  dir: string,
  fs: typeof import('node:fs/promises'),
  path: typeof import('path')
): Promise<void> {
  const docs: Array<{ fileName: string; content: string }> = [
    {
      fileName: 'index.md',
      content: [
        '# 用户知识库',
        '',
        '欢迎使用你的个人知识库！你可以在此保存笔记、代码片段和学习资料。',
        '',
        '## 快速开始',
        '',
        '使用右侧表单创建你的第一篇知识文档。',
        '',
        '## 文档管理',
        '',
        '- **创建**：填入标题和内容，点击"创建"',
        '- **编辑**：点击文档标题进入编辑模式',
        '- **搜索**：使用搜索框快速查找内容',
        '- **删除**：移除不再需要的文档',
        '',
        '## 支持格式',
        '',
        '你的知识文档支持完整的 Markdown 语法：',
        '- 标题、列表、表格',
        '- **加粗**、*斜体*、~~删除线~~',
        '- `代码块` 和语法高亮',
        '- [链接](#) 和图片',
        '',
      ].join('\n'),
    },
    {
      fileName: '示例文档.md',
      content: [
        '# 示例文档',
        '',
        '> 创建于 2026-05-22',
        '',
        '这是一个示例知识库文档，用于演示知识库功能。',
        '',
        '## 功能',
        '',
        '- 支持 Markdown 格式',
        '- 支持代码块',
        '- 支持列表',
        '- 支持链接',
        '',
        '## 代码示例',
        '',
        '```typescript',
        '// 示例 TypeScript 代码',
        'function greet(name: string): string {',
        '  return `Hello, ${name}!`;',
        '}',
        '',
        "console.log(greet('World'));",
        '```',
        '',
        '## 列表',
        '',
        '- 第一项',
        '- 第二项',
        '- 第三项',
        '',
        '## 链接',
        '',
        '[查看项目文档](/docs)',
        '',
      ].join('\n'),
    },
  ];

  for (const doc of docs) {
    const filePath = path.join(dir, doc.fileName);
    try {
      await fs.writeFile(filePath, doc.content, 'utf-8');
      logger.info(`已写入默认知识文档：${filePath}`);
    } catch (err) {
      logger.warning(`写入默认知识文档失败：${filePath}`, {
        error: String(err),
      });
    }
  }
}

/**
 * 启动编译调度器
 * 仅在 AI 服务已配置默认模型时才启用 runOnStart，避免无模型时大量编译失败
 */
export async function startCompileScheduler(): Promise<{
  stop: () => void;
} | null> {
  try {
    const { aiService } = await import('@modules/ai/services/aiService');
    const defaultModel = aiService.getDefaultModel();
    if (!defaultModel) {
      logger.warning(
        '知识库编译调度器跳过首次编译：未配置默认模型，调度器仍按周期运行'
      );
    }

    const { runKnowledgeCompile } =
      await import('@modules/knowledge/KnowledgeCompiler');
    const { KnowledgeCompileScheduler } =
      await import('@modules/knowledge/KnowledgeCompileScheduler');
    const scheduler = new KnowledgeCompileScheduler(
      (force?: boolean) =>
        runKnowledgeCompile(aiService, {
          force,
          model: defaultModel || undefined,
        }),
      { runOnStart: !!defaultModel }
    );
    scheduler.start();
    return scheduler;
  } catch (err) {
    logger.warning('知识库编译调度器初始化失败（非关键错误）', {
      error: String(err),
    });
    return null;
  }
}

/**
 * 尝试动态注册未注册的通道（前端提供凭据时自动注册）
 * 覆盖全部 26 个通道，通过 CHANNEL_TABLE 表驱动
 */
export async function tryDynamicRegister(
  channelType: string,
  config?: Record<string, unknown>
): Promise<boolean> {
  const entry = getChannelEntry(channelType);
  if (!entry) return false;

  try {
    // 动态导入插件模块
    const mod = await import(entry.importPath);
    const plugin = (mod as Record<string, unknown>)[entry.exportKey] as
      | IChannelPlugin
      | undefined;
    if (!plugin) {
      logger.warning(
        `tryDynamicRegister: 未找到插件导出 — ${channelType}/${entry.exportKey}`
      );
      return false;
    }

    // 1. 注册到 ChannelRegistry
    const { channelRegistry } =
      await import('@modules/channels/registry/ChannelRegistry');
    const { adaptPluginToInterface } =
      await import('@modules/channels/registry/ChannelRegistry');
    channelRegistry.register(adaptPluginToInterface(plugin));

    // 2. 注册到 ChannelBootstrapper
    const { channelBootstrapper } =
      await import('../../channels/bootstrap/ChannelBootstrapper');
    channelBootstrapper.registerPluginChannel(channelType, () => plugin);

    // 3. 写入配置（合并前端传入的凭据）
    channelRegistry.updateConfig(channelType, {
      name: entry.name,
      enabled: false,
      options: {
        ...(channelRegistry.getConfig(channelType)?.options || {}),
        ...(config || {}),
      },
    });

    // 4. 绑定入站消息处理器
    bindInboundMessageHandler(channelType, plugin);

    return true;
  } catch (err) {
    logger.error(`tryDynamicRegister(${channelType}) 失败`, {
      error: String(err),
    });
    return false;
  }
}

/** 绑定入站消息 → AI → 出站 回路 */
function bindInboundMessageHandler(
  channelType: string,
  plugin: IChannelPlugin
): void {
  if (!plugin.inbound) return;

  const _processingMessages = new Set<string>();

  plugin.inbound.setMessageHandler(
    async (message: import('@modules/channels/types').MessageContext) => {
      if (_processingMessages.has(message.messageId)) return;
      _processingMessages.add(message.messageId);

      try {
        const sender = message.senderName || message.senderId || 'unknown';
        const label = channelType.toUpperCase();
        console.log(`\n── [${label}] ${sender} ──`);
        console.log(message.content);

        const coreAPI = getCoreAPI();
        const response = await coreAPI.chat({
          content: message.content,
          sessionId: message.conversationId ?? message.senderId,
          metadata: {
            channel: message.channelId,
            sender: message.senderId,
            messageType: message.messageType,
            isDirectMessage: message.isDirectMessage,
            rawPayload: message.rawPayload,
          },
        });

        if (response.content && plugin.outbound) {
          console.log(`\n── [${label}] Liri ──`);
          console.log(response.content);
          console.log('');

          await plugin.outbound.sendText(
            message.conversationId ?? message.senderId,
            response.content
          );
        }
      } catch (error) {
        await handleError(error, {
          module: 'infra:http',
          action: 'channel_inbound_message',
          context: { channelType, messageId: message.messageId },
        });
      } finally {
        setTimeout(() => {
          _processingMessages.delete(message.messageId);
        }, 3000);
      }
    }
  );
  logger.info(`[${channelType}] 入站消息处理器已绑定`);
}

/**
 * 递归复制目录
 * 跳过迁移标记文件（.migrating, .migration_committed）
 */
export function copyDirectory(
  src: string,
  dest: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fs: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  path: any
): { copied: number; skipped: number; errors: string[] } {
  let copied = 0;
  let skipped = 0;
  const errors: string[] = [];

  if (!fs.existsSync(src)) {
    return { copied, skipped, errors };
  }

  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === '.migrating' || entry.name === '.migration_committed') {
      continue;
    }
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    try {
      if (entry.isDirectory()) {
        const result = copyDirectory(srcPath, destPath, fs, path);
        copied += result.copied;
        skipped += result.skipped;
        errors.push(...result.errors);
      } else {
        if (!fs.existsSync(destPath)) {
          fs.copyFileSync(srcPath, destPath);
          copied++;
        } else {
          skipped++;
        }
      }
    } catch (err) {
      errors.push(`复制 ${srcPath} 失败: ${(err as Error).message}`);
    }
  }

  return { copied, skipped, errors };
}
