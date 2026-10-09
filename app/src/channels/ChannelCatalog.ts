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
export interface ChannelCatalogEntry {
  type: string;
  name: string;
  /** 通道模块中导出插件/工厂的属性名 */
  exportKey: string;
  /** 惰性加载器（位置无关）：仅在启动注册或首次动态注册时执行 */
  load: () => Promise<Record<string, unknown>>;
}

export const CHANNEL_CATALOG: ChannelCatalogEntry[] = [
  {
    type: 'telegram',
    name: 'Telegram',
    exportKey: 'telegramChannel',
    load: () => import('./telegram/TelegramChannel.js'),
  },
  {
    type: 'discord',
    name: 'Discord',
    exportKey: 'discordChannel',
    load: () => import('./discord/DiscordChannel.js'),
  },
  {
    type: 'qq',
    name: 'QQ',
    exportKey: 'qqChannel',
    load: () => import('./qq/QQChannel.js'),
  },
  {
    type: 'dingtalk',
    name: '钉钉',
    exportKey: 'dingtalkChannel',
    load: () => import('./dingtalk/DingTalkChannel.js'),
  },
  {
    type: 'feishu',
    name: '飞书',
    exportKey: 'feishuChannel',
    load: () => import('./feishu/FeishuChannel.js'),
  },
  {
    type: 'wechat',
    name: '微信',
    exportKey: 'wechatChannel',
    load: () => import('./wechat/WechatChannel.js'),
  },
  {
    type: 'slack',
    name: 'Slack',
    exportKey: 'slackChannelPlugin',
    load: () => import('./slack/index.js'),
  },
  {
    type: 'line',
    name: 'Line',
    exportKey: 'lineChannelPlugin',
    load: () => import('./line/index.js'),
  },
  {
    type: 'irc',
    name: 'IRC',
    exportKey: 'ircChannelPlugin',
    load: () => import('./irc/index.js'),
  },
  {
    type: 'nostr',
    name: 'Nostr',
    exportKey: 'nostrChannelPlugin',
    load: () => import('./nostr/index.js'),
  },
  {
    type: 'email',
    name: '邮件',
    exportKey: 'emailChannelPlugin',
    load: () => import('./email/EmailChannel.js'),
  },
  {
    type: 'sms',
    name: '短信',
    exportKey: 'smsChannelPlugin',
    load: () => import('./sms/SmsChannel.js'),
  },
  {
    type: 'webhook',
    name: 'Webhook',
    exportKey: 'webhookChannelPlugin',
    load: () => import('./webhook/WebhookChannel.js'),
  },
  {
    type: 'wecom',
    name: '企业微信',
    exportKey: 'wecomChannel',
    load: () => import('./wecom/WeComChannel.js'),
  },
  {
    type: 'googlechat',
    name: 'Google Chat',
    exportKey: 'googleChatChannelPlugin',
    load: () => import('./googlechat/index.js'),
  },
  {
    type: 'msteams',
    name: 'MS Teams',
    exportKey: 'msTeamsChannelPlugin',
    load: () => import('./msteams/index.js'),
  },
  {
    type: 'zalo',
    name: 'Zalo',
    exportKey: 'zaloChannelPlugin',
    load: () => import('./zalo/index.js'),
  },
  {
    type: 'yuanbao',
    name: '元宝',
    exportKey: 'yuanbaoChannelPlugin',
    load: () => import('./yuanbao/index.js'),
  },
  {
    type: 'whatsapp',
    name: 'WhatsApp',
    exportKey: 'whatsAppChannelPlugin',
    load: () => import('./whatsapp/index.js'),
  },
  {
    type: 'signal',
    name: 'Signal',
    exportKey: 'signalChannelPlugin',
    load: () => import('./signal/index.js'),
  },
  {
    type: 'matrix',
    name: 'Matrix',
    exportKey: 'matrixChannelPlugin',
    load: () => import('./matrix/index.js'),
  },
  {
    type: 'facebook',
    name: 'Facebook Messenger',
    exportKey: 'facebookMessengerChannelPlugin',
    load: () => import('./facebookmessenger/index.js'),
  },
  {
    type: 'twitter',
    name: 'Twitter/X',
    exportKey: 'twitterChannelPlugin',
    load: () => import('./twitter/index.js'),
  },
  {
    type: 'claude',
    name: 'Claude',
    exportKey: 'claudeChannelPlugin',
    load: () => import('./claude/index.js'),
  },
  {
    type: 'mattermost',
    name: 'Mattermost',
    exportKey: 'mattermostChannel',
    load: () => import('./mattermost/MattermostChannel.js'),
  },
  {
    type: 'bluebubbles',
    name: 'iMessage',
    exportKey: 'bluebubblesChannelPlugin',
    load: () => import('./bluebubbles/BlueBubblesChannel.js'),
  },
];

/** 按 type 快速索引通道目录条目 */
export function getChannelCatalogEntry(
  type: string
): ChannelCatalogEntry | undefined {
  return CHANNEL_CATALOG.find((e) => e.type === type);
}
