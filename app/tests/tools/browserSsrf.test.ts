/**
 * P1-2（2026-11-22，G2）：浏览器导航的 SSRF 校验（与 web_fetch 共用同一判据）。
 *
 * 修复前：驱动只有"字面量内网 / 回环主机名"判断（`isPrivateHost`）⇒ 缺
 * DNS 解析到内网、云元数据 `100.100.100.200`、混淆 IP（十进制 / 十六进制）、内部 TLD；
 * 且重定向逐跳未校验。本用例锁定 `assertUrlAllowedDeep` 的判据面。
 */
import { describe, expect, it } from 'bun:test';

import {
  assertUrlAllowedDeep,
  resolveBrowserDriverConfig,
} from '@openliri/tool-browser';

const base = resolveBrowserDriverConfig({
  allowPrivateNetwork: false,
  allowedDomains: [],
});

describe('browser：SSRF 阻断（G2）', () => {
  const blocked = [
    'http://127.0.0.1/',
    'http://localhost:8080/',
    'http://169.254.169.254/latest/meta-data/',
    // 阿里云元数据（旧实现缺）
    'http://100.100.100.200/',
    // 混淆/整数形式（URL 解析后归一为 127.0.0.1）
    'http://2130706433/',
    'http://0x7f000001/',
    // 内部 TLD
    'http://service.local/',
    'http://wiki.internal/',
    // 协议
    'file:///etc/passwd',
    'javascript:alert(1)',
  ];

  for (const url of blocked) {
    it(`阻断：${url}`, async () => {
      await expect(assertUrlAllowedDeep(url, base)).rejects.toThrow();
    });
  }
});

describe('browser：SSRF 放行与显式豁免', () => {
  it('公网域名 ⇒ 放行（DNS 不可用时不误杀）', async () => {
    await expect(
      assertUrlAllowedDeep('https://example.com/', base)
    ).resolves.toBeInstanceOf(URL);
  });

  it('allowPrivateNetwork=true ⇒ 显式放行环回（本地开发场景）', async () => {
    const local = resolveBrowserDriverConfig({
      allowPrivateNetwork: true,
      allowedDomains: [],
    });
    await expect(
      assertUrlAllowedDeep('http://127.0.0.1:3000/', local)
    ).resolves.toBeInstanceOf(URL);
  });

  it('域名白名单仍然生效（与 SSRF 独立）', async () => {
    const scoped = resolveBrowserDriverConfig({
      allowPrivateNetwork: false,
      allowedDomains: ['example.com'],
    });
    await expect(
      assertUrlAllowedDeep('https://other.com/', scoped)
    ).rejects.toThrow();
  });
});
