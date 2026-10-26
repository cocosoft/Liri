/**
 * 本地 HTTP 鉴权「两道门」合并守卫（W26-19，2026-10-26）
 *
 * 为什么用源码级断言：该逻辑位于 `LocalHTTPService.handleRequest`（私有方法 + 需要真实 server），
 * 行为测试要起端口、临时改环境变量；这里用「结构断言」钉住三条**已修复的形态**，
 * 防止后续被"顺手改回去"：
 *   1. 不再有 inline `await import('./handlers/auth-handlers')`（每请求一次无谓动态导入）；
 *   2. 登录态只解析一次（`resolveSession` 记忆化，两处 gate 共用）；
 *   3. 401 只在一处写出（`sendUnauthorized`），避免两份响应体漂移。
 *
 * 语义不变的证据：`tests/http` 的鉴权/管理写用例（`AuthAdminCheck` 等）仍全绿。
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(
  new URL('../../src/infrastructure/http/LocalHTTPService.ts', import.meta.url),
  'utf8'
);

describe('LocalHTTPService 鉴权门（W26-19）', () => {
  it('不再 inline 动态导入 auth-handlers（改走 hasValidBearerSession）', () => {
    expect(SRC).not.toContain("await import('./handlers/auth-handlers')");
    expect(SRC).toContain('hasValidBearerSession');
  });

  it('登录态只判定一次：两处 gate 共用记忆化的 resolveSession', () => {
    expect(SRC).toContain('const resolveSession = async');
    expect(SRC).toContain('sessionOk ??=');
    const gateUses = SRC.match(/await resolveSession\(\)/g) ?? [];
    expect(gateUses.length).toBe(2);
  });

  it('401 只在 sendUnauthorized 一处写出（响应体不再重复两遍）', () => {
    const unauthorizedWrites = SRC.match(/writeHead\(401/g) ?? [];
    expect(unauthorizedWrites.length).toBe(1);
    expect(SRC).toContain('const sendUnauthorized = (): void =>');
  });

  it('暴露面 fail-closed 与可观测性保留（不得被"合并"削掉）', () => {
    expect(SRC).toContain('requiresBearerSession(url)');
    expect(SRC).toContain('暴露面请求缺少有效登录态（fail-closed 401）');
  });
});
