// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 通道厂商站点 / 默认 API 基址（B5-2-100+：跨文件同值字面量收敛）
 *
 * **收录口径**：仅收录「通道实现」与「Onboard 引导页」共用的地址；
 * 各协议自身的端点（如 webhook 路径、OAuth 域名）仍留在各自模块，不在此处。
 */

/** 企业微信厂商站点（`WeComChannel.vendorSite` 与 Onboard 引导链接共用） */
export const WECOM_VENDOR_SITE_URL = 'https://work.weixin.qq.com/';

/** 元宝厂商站点（`YuanbaoChannel.vendorSite` 与 Onboard 引导链接共用） */
export const YUANBAO_VENDOR_SITE_URL = 'https://yuanbao.tencent.com/';

/** 元宝开放平台默认 API 基址（通道实现与配置默认值共用） */
export const YUANBAO_API_BASE_URL = 'https://api.yuanbao.tencent.com';

/** 各通道厂商站点（`vendorSite` / Onboard 引导链接共用；B5-2-104） */
export const MATRIX_SITE_URL = 'https://matrix.org';
export const DINGTALK_SITE_URL = 'https://open.dingtalk.com';
export const DISCORD_SITE_URL = 'https://discord.com';
export const FEISHU_SITE_URL = 'https://open.feishu.cn';
export const NOSTR_SITE_URL = 'https://nostr.com';
export const QQ_SITE_URL = 'https://q.qq.com';
export const SIGNAL_SITE_URL = 'https://signal.org';

/** 通道厂商默认 API 基址（通道实现与配置默认值共用；B5-2-104） */
export const DISCORD_API_BASE_URL = `${DISCORD_SITE_URL}/api/v10`;
export const FEISHU_API_BASE_URL = `${FEISHU_SITE_URL}/open-apis`;
export const LINE_API_BASE_URL = 'https://api.line.me/v2/bot';
export const FACEBOOK_GRAPH_API_BASE_URL = 'https://graph.facebook.com';
export const MICROSOFT_LOGIN_BASE_URL = 'https://login.microsoftonline.com';
export const MSTEAMS_BOT_FRAMEWORK_BASE_URL =
  'https://smba.trafficmanager.net/amer';
export const QQ_API_BASE_URL = 'https://api.sgroup.qq.com';
export const SIGNAL_SERVICE_URL = 'https://chat.signal.org';
