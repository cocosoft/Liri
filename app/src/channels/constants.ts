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
