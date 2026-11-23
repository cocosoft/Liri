// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P1（2026-11-22）—— 原址**转发**。
 *
 * SSRF 判定已下沉到 `@openliri/infra/security/ssrf`（唯一事实源）：
 * `packages/tool-browser` 的 Playwright 驱动不能反向 import app（R30），
 * 而 `web_fetch` 与 `browser` 必须共用同一判据（CS01）。
 *
 * 保留本路径使 `WebFetchTool` / 既有测试的 import **零改动**。
 */
export {
  checkSsrf,
  describeSsrfBlock,
  hasSsrfBypassPattern,
} from '@openliri/infra/security/ssrf';
export type {
  SsrfCheckResult,
  SsrfBlockDetail,
  SsrfBlockType,
} from '@openliri/infra/security/ssrf';
