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
 * 通道目录（单一事实源）—— 27 个通道的「type / 显示名 / 导出键 / 惰性加载器」
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

/**
 * 凭据环境变量读取器（`isEnabled` 的入参形状）。
 *
 * 抽成别名而非内联长类型：整组条目被包进 `buildFeature(...) ? [] : [ … ]` 三元后，
 * **数组字面量不再继承外层元素的上下文类型** ⇒ 所有 `isEnabled` 的 `env` 会退化为
 * 隐式 `any`（noImplicitAny 报错），必须显式标注。统一用本别名，避免 20+ 处重复长类型。
 */
export type ChannelEnvReader = (key: string) => string | undefined;

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
  isEnabled: (env: ChannelEnvReader) => boolean;
}

export const CHANNEL_CATALOG: ChannelCatalogEntry[] = [
  // ───── 整组开关（2026-10-20，P1 推广）─────
  // 声明 `DROP_CHANNELS_ALL` ⇒ 下面**整组**条目与其 `import()` 目标（含各通道 SDK）
  // 一起从产物中消失（实测 `bun build --feature DROP_CHANNELS_ALL` 有效）；未声明 ⇒ 全保留。
  // 与单通道开关（`DROP_CHANNEL_FEISHU`）是**与**关系：整组丢时，内层单通道开关不再求值。
  ...(buildFeature('DROP_CHANNELS_ALL')
    ? []
    : [
        // 2026-10-20（P2.5）：移动端**接入**通道 —— 语义适配器，不新起监听端口
        // （入站复用 LocalHTTPService，出站复用 /v1/events SSE）。
        // 默认**不自动启用**：需 `LIRI_MOBILE_CHANNEL=true` 显式开启，避免挤占 CHANNEL_MAX_COUNT。
        {
          type: 'mobile',
          name: '移动端（接入）',
          exportKey: 'mobileChannelPlugin',
          load: () => import('./mobile/MobileChannel.js'),
          credentials: ['LIRI_MOBILE_CHANNEL'],
          isEnabled: (env: ChannelEnvReader) => !!env('LIRI_MOBILE_CHANNEL'),
        },
        {
          type: 'telegram',
          name: 'Telegram',
          exportKey: 'telegramChannel',
          load: () => import('./telegram/TelegramChannel.js'),
          credentials: ['TELEGRAM_BOT_TOKEN'],
          isEnabled: (env: ChannelEnvReader) => !!env('TELEGRAM_BOT_TOKEN'),
        },
        {
          type: 'discord',
          name: 'Discord',
          exportKey: 'discordChannel',
          load: () => import('./discord/DiscordChannel.js'),
          credentials: ['DISCORD_TOKEN'],
          isEnabled: (env: ChannelEnvReader) => !!env('DISCORD_TOKEN'),
        },
        {
          type: 'qq',
          name: 'QQ',
          exportKey: 'qqChannel',
          load: () => import('./qq/QQChannel.js'),
          credentials: ['QQ_APP_ID', 'QQ_APP_SECRET'],
          isEnabled: (env: ChannelEnvReader) =>
            !!env('QQ_APP_ID') && !!env('QQ_APP_SECRET'),
        },
        {
          type: 'dingtalk',
          name: '钉钉',
          exportKey: 'dingtalkChannel',
          load: () => import('./dingtalk/DingTalkChannel.js'),
          credentials: ['DINGTALK_APP_KEY', 'DINGTALK_APP_SECRET'],
          isEnabled: (env: ChannelEnvReader) =>
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
                isEnabled: (env: ChannelEnvReader) =>
                  !!env('FEISHU_APP_ID') && !!env('FEISHU_APP_SECRET'),
              },
            ]),
        {
          type: 'wechat',
          name: '微信',
          exportKey: 'wechatChannel',
          load: () => import('./wechat/WechatChannel.js'),
          credentials: ['WECHAT_BOT_HTTP_URL'],
          isEnabled: (env: ChannelEnvReader) => !!env('WECHAT_BOT_HTTP_URL'),
        },
        {
          type: 'slack',
          name: 'Slack',
          exportKey: 'slackChannelPlugin',
          load: () => import('./slack/index.js'),
          credentials: ['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET'],
          isEnabled: (env: ChannelEnvReader) =>
            !!env('SLACK_BOT_TOKEN') && !!env('SLACK_SIGNING_SECRET'),
        },
        {
          type: 'line',
          name: 'Line',
          exportKey: 'lineChannelPlugin',
          load: () => import('./line/index.js'),
          credentials: ['LINE_CHANNEL_ACCESS_TOKEN', 'LINE_CHANNEL_SECRET'],
          isEnabled: (env: ChannelEnvReader) =>
            !!env('LINE_CHANNEL_ACCESS_TOKEN') && !!env('LINE_CHANNEL_SECRET'),
        },
        {
          type: 'irc',
          name: 'IRC',
          exportKey: 'ircChannelPlugin',
          load: () => import('./irc/index.js'),
          credentials: ['IRC_SERVER', 'IRC_NICK'],
          isEnabled: (env: ChannelEnvReader) =>
            !!env('IRC_SERVER') && !!env('IRC_NICK'),
        },
        {
          type: 'nostr',
          name: 'Nostr',
          exportKey: 'nostrChannelPlugin',
          load: () => import('./nostr/index.js'),
          // 判据为 **OR**（私钥或中继任一即可），与其余通道的 AND 语义不同。
          credentials: ['NOSTR_PRIVATE_KEY', 'NOSTR_RELAYS'],
          isEnabled: (env: ChannelEnvReader) =>
            !!env('NOSTR_PRIVATE_KEY') || !!env('NOSTR_RELAYS'),
        },
        {
          type: 'email',
          name: '邮件',
          exportKey: 'emailChannelPlugin',
          load: () => import('./email/EmailChannel.js'),
          credentials: ['EMAIL_HOST', 'EMAIL_USER'],
          isEnabled: (env: ChannelEnvReader) =>
            !!env('EMAIL_HOST') && !!env('EMAIL_USER'),
        },
        {
          type: 'sms',
          name: '短信',
          exportKey: 'smsChannelPlugin',
          load: () => import('./sms/SmsChannel.js'),
          credentials: ['SMS_FROM_NUMBER'],
          isEnabled: (env: ChannelEnvReader) => !!env('SMS_FROM_NUMBER'),
        },
        {
          type: 'webhook',
          name: 'Webhook',
          exportKey: 'webhookChannelPlugin',
          load: () => import('./webhook/WebhookChannel.js'),
          credentials: ['WEBHOOK_LISTEN_PORT'],
          isEnabled: (env: ChannelEnvReader) => !!env('WEBHOOK_LISTEN_PORT'),
        },
        {
          type: 'wecom',
          name: '企业微信',
          exportKey: 'wecomChannel',
          load: () => import('./wecom/WeComChannel.js'),
          credentials: ['WECOM_CORP_ID', 'WECOM_CORP_SECRET', 'WECOM_AGENT_ID'],
          isEnabled: (env: ChannelEnvReader) =>
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
          isEnabled: (env: ChannelEnvReader) =>
            !!env('GOOGLECHAT_SERVICE_ACCOUNT'),
        },
        {
          type: 'msteams',
          name: 'MS Teams',
          exportKey: 'msTeamsChannelPlugin',
          load: () => import('./msteams/index.js'),
          credentials: ['MSTEAMS_BOT_ID', 'MSTEAMS_BOT_PASSWORD'],
          isEnabled: (env: ChannelEnvReader) =>
            !!env('MSTEAMS_BOT_ID') && !!env('MSTEAMS_BOT_PASSWORD'),
        },
        {
          type: 'zalo',
          name: 'Zalo',
          exportKey: 'zaloChannelPlugin',
          load: () => import('./zalo/index.js'),
          credentials: ['ZALO_APP_ID', 'ZALO_APP_SECRET'],
          isEnabled: (env: ChannelEnvReader) =>
            !!env('ZALO_APP_ID') && !!env('ZALO_APP_SECRET'),
        },
        {
          type: 'yuanbao',
          name: '元宝',
          exportKey: 'yuanbaoChannelPlugin',
          load: () => import('./yuanbao/index.js'),
          credentials: ['YUANBAO_APP_ID', 'YUANBAO_APP_KEY'],
          isEnabled: (env: ChannelEnvReader) =>
            !!env('YUANBAO_APP_ID') && !!env('YUANBAO_APP_KEY'),
        },
        {
          type: 'whatsapp',
          name: 'WhatsApp',
          exportKey: 'whatsAppChannelPlugin',
          load: () => import('./whatsapp/index.js'),
          credentials: ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN'],
          isEnabled: (env: ChannelEnvReader) =>
            !!env('WHATSAPP_PHONE_NUMBER_ID') && !!env('WHATSAPP_ACCESS_TOKEN'),
        },
        {
          type: 'signal',
          name: 'Signal',
          exportKey: 'signalChannelPlugin',
          load: () => import('./signal/index.js'),
          credentials: ['SIGNAL_ACCOUNT'],
          isEnabled: (env: ChannelEnvReader) => !!env('SIGNAL_ACCOUNT'),
        },
        {
          type: 'matrix',
          name: 'Matrix',
          exportKey: 'matrixChannelPlugin',
          load: () => import('./matrix/index.js'),
          credentials: ['MATRIX_HOMESERVER_URL', 'MATRIX_ACCESS_TOKEN'],
          isEnabled: (env: ChannelEnvReader) =>
            !!env('MATRIX_HOMESERVER_URL') && !!env('MATRIX_ACCESS_TOKEN'),
        },
        {
          type: 'facebook',
          name: 'Facebook Messenger',
          exportKey: 'facebookMessengerChannelPlugin',
          load: () => import('./facebookmessenger/index.js'),
          credentials: ['FACEBOOK_PAGE_ACCESS_TOKEN'],
          isEnabled: (env: ChannelEnvReader) =>
            !!env('FACEBOOK_PAGE_ACCESS_TOKEN'),
        },
        {
          type: 'twitter',
          name: 'Twitter/X',
          exportKey: 'twitterChannelPlugin',
          load: () => import('./twitter/index.js'),
          credentials: ['TWITTER_API_KEY', 'TWITTER_API_SECRET_KEY'],
          isEnabled: (env: ChannelEnvReader) =>
            !!env('TWITTER_API_KEY') && !!env('TWITTER_API_SECRET_KEY'),
        },
        {
          type: 'claude',
          name: 'Claude',
          exportKey: 'claudeChannelPlugin',
          load: () => import('./claude/index.js'),
          credentials: ['CHANNEL_CLAUDE_ENABLED', 'CHANNEL_CLAUDE_API_KEY'],
          isEnabled: (env: ChannelEnvReader) =>
            !!env('CHANNEL_CLAUDE_ENABLED') && !!env('CHANNEL_CLAUDE_API_KEY'),
        },
        {
          type: 'mattermost',
          name: 'Mattermost',
          exportKey: 'mattermostChannel',
          load: () => import('./mattermost/MattermostChannel.js'),
          credentials: ['MATTERMOST_URL', 'MATTERMOST_TOKEN'],
          isEnabled: (env: ChannelEnvReader) =>
            !!env('MATTERMOST_URL') && !!env('MATTERMOST_TOKEN'),
        },
        {
          type: 'bluebubbles',
          name: 'iMessage',
          exportKey: 'bluebubblesChannelPlugin',
          load: () => import('./bluebubbles/BlueBubblesChannel.js'),
          credentials: ['BLUEBUBBLES_URL', 'BLUEBUBBLES_PASSWORD'],
          isEnabled: (env: ChannelEnvReader) =>
            !!env('BLUEBUBBLES_URL') && !!env('BLUEBUBBLES_PASSWORD'),
        },
      ]),
];

/** 按 type 快速索引通道目录条目 */
export function getChannelCatalogEntry(
  type: string
): ChannelCatalogEntry | undefined {
  return CHANNEL_CATALOG.find((e) => e.type === type);
}

/**
 * 单通道裁剪清单：`DROP_CHANNEL_*` 与通道 type 的对应关系（声明式，供报错引用）。
 *
 * 为什么用「清单 + includes」而不是 `type === '…'`：`channels/**` 禁止**平台名判断分支**
 * （R11-C6 守则，能力差异必须走能力位）；这里是"裁掉了谁"的声明，不是按平台分叉逻辑。
 * 数组字面量在三元"被丢弃"分支里 ⇒ 未声明该开关时随 DCE 一起消失。
 */
const BUILD_DROPPED_TYPES: readonly string[] = buildFeature(
  'DROP_CHANNEL_FEISHU'
)
  ? ['feishu']
  : [];

/**
 * 该 type 是否**因编译期裁剪**而不在目录里（主包瘦身 R4）。
 *
 * 为什么需要单独判断：条目被 `DROP_*` 物理删除后，`getChannelCatalogEntry()` 的
 * 「查不到」与"type 拼写错误 / 通道已下线"完全同形 —— 调用方无法给出正确指引。
 *
 * ⚠️ `feature()` 只能出现在 if / 三元条件里，故用逐项 if 而非 `&&` 表达式。
 */
export function isChannelDroppedByBuild(type: string): boolean {
  if (buildFeature('DROP_CHANNELS_ALL')) {
    // 整组裁剪下任何通道都不可用（含配置里拼错的 type：本构建确实一个通道都没有）
    return true;
  }
  return BUILD_DROPPED_TYPES.includes(type);
}

/**
 * 把「目录里查不到该 type」翻译成**可操作**的错误文案（主包瘦身 R4）。
 *
 * 裁剪是编译期行为、不可逆（代码已不在产物里），所以配置侧唯一正确的处置是
 * "换未裁剪的构建 / 删掉这条配置" —— 文案必须把这点说清楚，否则用户会反复改凭据。
 */
export function describeChannelUnavailable(type: string): string {
  if (isChannelDroppedByBuild(type)) {
    return (
      `通道「${type}」在本构建中不可用：该构建已在编译期裁掉它（DROP_CHANNELS_ALL / DROP_CHANNEL_FEISHU），` +
      '与凭据配置无关 —— 请改用未裁剪的构建（personal / coding / enterprise），或删除该通道的持久化配置'
    );
  }
  return `通道「${type}」未在 CHANNEL_CATALOG 中登记（type 拼写错误，或该通道已下线）`;
}
