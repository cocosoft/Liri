/**
 * SSRF 防护单测 —— O22（RFC 2544 逃生门）回归
 *
 * 覆盖：
 *  1. 默认拦截 RFC 2544 段（198.18.0.0/15）—— fake-ip 代理（Clash / sing-box / Surge /
 *     深信服 aTrust 等）会把**所有**外网域名解析到该段，默认必须仍然拒绝（安全默认）
 *  2. 显式策略 `allowRfc2544BenchmarkRange` 放行该段
 *  3. **放行该段不会连带放开**回环 / 其它私网 / 链路本地 / 云元数据地址
 *  4. 命中该段时拦截原因附带可操作提示（含环境变量名），不再误导为"网站不安全"
 *
 * 说明：全部用 IP 字面量，不触发真实 DNS（否则会随机器 DNS 设置而变，测试不确定）；
 * 环境变量接线由运行时验证脚本覆盖，故本文件刻意不读写 `process.env`（R05-012）。
 */

import { describe, test, expect } from 'bun:test';
import { checkSsrf, ENV_ALLOW_RFC2544, type SsrfPolicy } from './ssrf.js';

const DENY: SsrfPolicy = { allowRfc2544BenchmarkRange: false };
const ALLOW: SsrfPolicy = { allowRfc2544BenchmarkRange: true };

describe('checkSsrf — RFC 2544 逃生门（O22）', () => {
  test('默认（策略关闭）拦截图 198.18.0.0/15 内的地址', async () => {
    for (const url of [
      'http://198.18.0.1/',
      'http://198.19.0.4/',
      'http://198.19.255.254/',
    ]) {
      const result = await checkSsrf(url, DENY);
      expect(result.blocked).toBe(true);
      expect(result.safe).toBe(false);
    }
  });

  test('显式放行后该段不再拦截', async () => {
    const result = await checkSsrf('http://198.19.0.4/', ALLOW);
    expect(result.blocked).toBe(false);
    expect(result.safe).toBe(true);
  });

  test('放行该段不会连带放开其它私网段 / 回环 / 链路本地', async () => {
    const stillBlocked = [
      'http://10.0.0.1/',
      'http://172.16.0.1/',
      'http://192.168.1.1/',
      'http://100.64.0.1/', // CGNAT（RFC 6598）
      'http://127.0.0.1/',
      'http://169.254.1.1/', // 链路本地
    ];
    for (const url of stillBlocked) {
      const result = await checkSsrf(url, ALLOW);
      expect(result.blocked).toBe(true);
    }
  });

  test('云元数据地址始终拦截（放行该段也不例外）', async () => {
    const result = await checkSsrf(
      'http://169.254.169.254/latest/meta-data/',
      ALLOW
    );
    expect(result.blocked).toBe(true);
    expect(result.riskLevel).toBe('critical');
  });

  test('命中该段时的拦截原因给出可操作提示（含环境变量名）', async () => {
    const result = await checkSsrf('http://198.18.0.1/', DENY);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain('RFC 2544');
    expect(result.reason).toContain(ENV_ALLOW_RFC2544);
  });

  test('非该段的拦截原因不应带该提示（避免噪音）', async () => {
    const result = await checkSsrf('http://10.0.0.1/', DENY);
    expect(result.blocked).toBe(true);
    expect(result.reason).not.toContain(ENV_ALLOW_RFC2544);
  });
});
