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
 * 通道目录（单一事实源）—— 26 个通道的「type / 显示名 / 导出键 / 惰性加载器」
 *
 * 为什么需要（2026-09-30 · 台账 D-134 · CS01 归一化）：
 * 同一份通道表此前在 **4 处重复维护**，且**已经漂移**：
 *   ① `channels/setupChannels.ts` 的 `channelCandidates` —— 26 条（启动注册用）
 *   ② 同文件 `ALL_CHANNEL_DEFS` —— 26 条 type/name（前端展示用）
 *   ③ `infrastructure/http/LocalHTTPServiceHelpers.ts` 的 `CHANNEL_TABLE` —— **仅 23 条**
 *      （缺 whatsapp / signal / matrix）
 *   ④ `infrastructure/http/handlers/channel-handlers.ts` 的 `CHANNEL_TABLE` —— 26 条
 * ⇒ ③的缺失使 `tryDynamicRegister()` 对那 3 个类型**恒返回 false**（前端带凭据也无法动态注册）＝实际缺陷。
 *
 * 为什么存「加载器」而不是「路径字符串」（关键设计）：
 * 相对路径字符串**只在定义文件所在目录有效** —— 这正是四份表各自重写路径
 * （`../channels/…` vs `../../../channels/…`）并最终漂移的**根因**。
 * thunk 由本文件解析 ⇒ **位置无关**，任意深度的消费方均可直接复用。
 *
 * ⚠️ 命名必须保持 **PascalCase**：`module-registry/no-direct-module-import` 通过
 * "通用 PascalCase 兜底"模式放行 `@modules/channels/ChannelCatalog`
 * （与 `LazyModuleStrategy`、`ModuleDefinitions` 同理）；改成 camelCase 会被判为违规深路径。
 *
 * ⚠️ 本文件**不得**加入 `channels/index.ts` 桶：该桶静态再导出全部 26 个通道实现，
 * 一旦被 HTTP 层引用会把 26 个通道实现全部拉进其启动面（同 spec §3.7 记录的懒加载动机）。
 * 消费方按**子入口直连**，已在 `scripts/lint-architecture.ts` 的 `canonicalEntryKeys`
 * 登记 `channels/ChannelCatalog`。
 */
import { feature as buildFeature } from 'bun:bundle';

export interface ChannelCatalogEntry {
  type: string;
  name: string;
  /** 通道模块中导出插件/工厂的属性名 */
  exportKey: string;
  /** 惰性加载器（位置无关）：仅在启动注册或首次动态注册时执行 */
  load: () => Promise<Record<string, unknown>>;
  /**
   * B-1（2026-10-18）：该通道启用所需的凭据 env 键（**声明用**；不参与求值）。
   */
  credentials: readonly string[];
  /**
   * B-1：启用判据（env 访问器注入，便于测试）。
   * `setupChannels` 用它替代原先散落在中心文件的硬编码 `*_APP_ID` 判断。
   * **必填**：新增通道漏声明即编译失败（26 个通道均已迁移）。
   */
  isEnabled: (env: (key: string) => string | undefined) => boolean;
}

export const CHANNEL_CATALOG: ChannelCatalogEntry[] = [
  {
    type: 'telegram',
    name: 'Telegram',
    exportKey: 'telegramChannel',
    load: () => import('./telegram/TelegramChannel.js'),
    credentials: ['TELEGRAM_BOT_TOKEN'],
    isEnabled: (env) => !!env('TELEGRAM_BOT_TOKEN'),
  },
  {
    type: 'discord',
    name: 'Discord',
    exportKey: 'discordChannel',
    load: () => import('./discord/DiscordChannel.js'),
    credentials: ['DISCORD_TOKEN'],
    isEnabled: (env) => !!env('DISCORD_TOKEN'),
  },
  {
    type: 'qq',
    name: 'QQ',
    exportKey: 'qqChannel',
    load: () => import('./qq/QQChannel.js'),
    credentials: ['QQ_APP_ID', 'QQ_APP_SECRET'],
    isEnabled: (env) => !!env('QQ_APP_ID') && !!env('QQ_APP_SECRET'),
  },
  {
    type: 'dingtalk',
    name: '钉钉',
    exportKey: 'dingtalkChannel',
    load: () => import('./dingtalk/DingTalkChannel.js'),
    credentials: ['DINGTALK_APP_KEY', 'DINGTALK_APP_SECRET'],
    isEnabled: (env) =>
      !!env('DINGTALK_APP_KEY') && !!env('DINGTALK_APP_SECRET'),
  },
  // ───── 编译期裁剪试点（2026-10-20，P1-0）─────
  // 反向开关：**未声明** `DROP_CHANNEL_FEISHU` ⇒ 条目保留（默认行为与改造前逐字一致）；
  // 构建时传 `--feature=DROP_CHANNEL_FEISHU` ⇒ 三元折叠为 `[]`，下方 `import()` 连同
  // `@larksuiteoapi/node-sdk`（实测 5.94 MB）一起从产物中消失（bun 已验证）。
  //
  // ⚠️ 为什么用「反向 DROP」而不是正向 `CHANNEL_FEISHU`：正向需要**所有**运行入口
  // （IDE、裸 `bun src/main.ts`、脚本、`bun test`）都显式声明全量 feature，漏一处就静默
  // 丢通道；反向默认保留 ⇒ 零行为变更，裁剪是显式 opt-in。
  // ⚠️ 条目**必须内联**在三元分支里：提取成 `const ENTRY = {...}` 后会在模块顶层求值，
  // DCE 不再生效（`import()` 仍会被打包）。
  // ⚠️ `bun:bundle` 的 `feature()` 只能用于 `if` / 三元条件（当值用会直接报错）。
  ...(buildFeature('DROP_CHANNEL_FEISHU')
    ? []
    : [
        {
          type: 'feishu',
          name: '飞书',
          exportKey: 'feishuChannel',
          load: () => import('./feishu/FeishuChannel.js'),
          credentials: ['FEISHU_APP_ID', 'FEISHU_APP_SECRET'],
          // `env` 需显式标注：三元分支里的数组字面量**不继承**外层元素的上下文类型，
          // 靠推断会触发 noImplicitAny（与其它条目写法不同，属编译期裁剪的语法代价）
          isEnabled: (env: (key: string) => string | undefined) =>
            !!env('FEISHU_APP_ID') && !!env('FEISHU_APP_SECRET'),
        },
      ]),
  {
    type: 'wechat',
    name: '微信',
    exportKey: 'wechatChannel',
    load: () => import('./wechat/WechatChannel.js'),
    credentials: ['WECHAT_BOT_HTTP_URL'],
    isEnabled: (env) => !!env('WECHAT_BOT_HTTP_URL'),
  },
  {
    type: 'slack',
    name: 'Slack',
    exportKey: 'slackChannelPlugin',
    load: () => import('./slack/index.js'),
    credentials: ['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET'],
    isEnabled: (env) =>
      !!env('SLACK_BOT_TOKEN') && !!env('SLACK_SIGNING_SECRET'),
  },
  {
    type: 'line',
    name: 'Line',
    exportKey: 'lineChannelPlugin',
    load: () => import('./line/index.js'),
    credentials: ['LINE_CHANNEL_ACCESS_TOKEN', 'LINE_CHANNEL_SECRET'],
    isEnabled: (env) =>
      !!env('LINE_CHANNEL_ACCESS_TOKEN') && !!env('LINE_CHANNEL_SECRET'),
  },
  {
    type: 'irc',
    name: 'IRC',
    exportKey: 'ircChannelPlugin',
    load: () => import('./irc/index.js'),
    credentials: ['IRC_SERVER', 'IRC_NICK'],
    isEnabled: (env) => !!env('IRC_SERVER') && !!env('IRC_NICK'),
  },
  {
    type: 'nostr',
    name: 'Nostr',
    exportKey: 'nostrChannelPlugin',
    load: () => import('./nostr/index.js'),
    // 判据为 **OR**（私钥或中继任一即可），与其余通道的 AND 语义不同。
    credentials: ['NOSTR_PRIVATE_KEY', 'NOSTR_RELAYS'],
    isEnabled: (env) => !!env('NOSTR_PRIVATE_KEY') || !!env('NOSTR_RELAYS'),
  },
  {
    type: 'email',
    name: '邮件',
    exportKey: 'emailChannelPlugin',
    load: () => import('./email/EmailChannel.js'),
    credentials: ['EMAIL_HOST', 'EMAIL_USER'],
    isEnabled: (env) => !!env('EMAIL_HOST') && !!env('EMAIL_USER'),
  },
  {
    type: 'sms',
    name: '短信',
    exportKey: 'smsChannelPlugin',
    load: () => import('./sms/SmsChannel.js'),
    credentials: ['SMS_FROM_NUMBER'],
    isEnabled: (env) => !!env('SMS_FROM_NUMBER'),
  },
  {
    type: 'webhook',
    name: 'Webhook',
    exportKey: 'webhookChannelPlugin',
    load: () => import('./webhook/WebhookChannel.js'),
    credentials: ['WEBHOOK_LISTEN_PORT'],
    isEnabled: (env) => !!env('WEBHOOK_LISTEN_PORT'),
  },
  {
    type: 'wecom',
    name: '企业微信',
    exportKey: 'wecomChannel',
    load: () => import('./wecom/WeComChannel.js'),
    credentials: ['WECOM_CORP_ID', 'WECOM_CORP_SECRET', 'WECOM_AGENT_ID'],
    isEnabled: (env) =>
      !!env('WECOM_CORP_ID') &&
      !!env('WECOM_CORP_SECRET') &&
      !!env('WECOM_AGENT_ID'),
  },
  {
    type: 'googlechat',
    name: 'Google Chat',
    exportKey: 'googleChatChannelPlugin',
    load: () => import('./googlechat/index.js'),
    credentials: ['GOOGLECHAT_SERVICE_ACCOUNT'],
    isEnabled: (env) => !!env('GOOGLECHAT_SERVICE_ACCOUNT'),
  },
  {
    type: 'msteams',
    name: 'MS Teams',
    exportKey: 'msTeamsChannelPlugin',
    load: () => import('./msteams/index.js'),
    credentials: ['MSTEAMS_BOT_ID', 'MSTEAMS_BOT_PASSWORD'],
    isEnabled: (env) =>
      !!env('MSTEAMS_BOT_ID') && !!env('MSTEAMS_BOT_PASSWORD'),
  },
  {
    type: 'zalo',
    name: 'Zalo',
    exportKey: 'zaloChannelPlugin',
    load: () => import('./zalo/index.js'),
    credentials: ['ZALO_APP_ID', 'ZALO_APP_SECRET'],
    isEnabled: (env) => !!env('ZALO_APP_ID') && !!env('ZALO_APP_SECRET'),
  },
  {
    type: 'yuanbao',
    name: '元宝',
    exportKey: 'yuanbaoChannelPlugin',
    load: () => import('./yuanbao/index.js'),
    credentials: ['YUANBAO_APP_ID', 'YUANBAO_APP_KEY'],
    isEnabled: (env) => !!env('YUANBAO_APP_ID') && !!env('YUANBAO_APP_KEY'),
  },
  {
    type: 'whatsapp',
    name: 'WhatsApp',
    exportKey: 'whatsAppChannelPlugin',
    load: () => import('./whatsapp/index.js'),
    credentials: ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN'],
    isEnabled: (env) =>
      !!env('WHATSAPP_PHONE_NUMBER_ID') && !!env('WHATSAPP_ACCESS_TOKEN'),
  },
  {
    type: 'signal',
    name: 'Signal',
    exportKey: 'signalChannelPlugin',
    load: () => import('./signal/index.js'),
    credentials: ['SIGNAL_ACCOUNT'],
    isEnabled: (env) => !!env('SIGNAL_ACCOUNT'),
  },
  {
    type: 'matrix',
    name: 'Matrix',
    exportKey: 'matrixChannelPlugin',
    load: () => import('./matrix/index.js'),
    credentials: ['MATRIX_HOMESERVER_URL', 'MATRIX_ACCESS_TOKEN'],
    isEnabled: (env) =>
      !!env('MATRIX_HOMESERVER_URL') && !!env('MATRIX_ACCESS_TOKEN'),
  },
  {
    type: 'facebook',
    name: 'Facebook Messenger',
    exportKey: 'facebookMessengerChannelPlugin',
    load: () => import('./facebookmessenger/index.js'),
    credentials: ['FACEBOOK_PAGE_ACCESS_TOKEN'],
    isEnabled: (env) => !!env('FACEBOOK_PAGE_ACCESS_TOKEN'),
  },
  {
    type: 'twitter',
    name: 'Twitter/X',
    exportKey: 'twitterChannelPlugin',
    load: () => import('./twitter/index.js'),
    credentials: ['TWITTER_API_KEY', 'TWITTER_API_SECRET_KEY'],
    isEnabled: (env) =>
      !!env('TWITTER_API_KEY') && !!env('TWITTER_API_SECRET_KEY'),
  },
  {
    type: 'claude',
    name: 'Claude',
    exportKey: 'claudeChannelPlugin',
    load: () => import('./claude/index.js'),
    credentials: ['CHANNEL_CLAUDE_ENABLED', 'CHANNEL_CLAUDE_API_KEY'],
    isEnabled: (env) =>
      !!env('CHANNEL_CLAUDE_ENABLED') && !!env('CHANNEL_CLAUDE_API_KEY'),
  },
  {
    type: 'mattermost',
    name: 'Mattermost',
    exportKey: 'mattermostChannel',
    load: () => import('./mattermost/MattermostChannel.js'),
    credentials: ['MATTERMOST_URL', 'MATTERMOST_TOKEN'],
    isEnabled: (env) => !!env('MATTERMOST_URL') && !!env('MATTERMOST_TOKEN'),
  },
  {
    type: 'bluebubbles',
    name: 'iMessage',
    exportKey: 'bluebubblesChannelPlugin',
    load: () => import('./bluebubbles/BlueBubblesChannel.js'),
    credentials: ['BLUEBUBBLES_URL', 'BLUEBUBBLES_PASSWORD'],
    isEnabled: (env) =>
      !!env('BLUEBUBBLES_URL') && !!env('BLUEBUBBLES_PASSWORD'),
  },
];

/** 按 type 快速索引通道目录条目 */
export function getChannelCatalogEntry(
  type: string
): ChannelCatalogEntry | undefined {
  return CHANNEL_CATALOG.find((e) => e.type === type);
}
