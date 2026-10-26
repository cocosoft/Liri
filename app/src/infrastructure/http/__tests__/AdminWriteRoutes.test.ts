/**
 * W26-15（2026-10-26）管理写路由**段边界**判定单测
 *
 * 覆盖三类回归：
 *   1. 段边界：`/v1/skills` 只匹配自身与 `/v1/skills/...`，**不再**吃掉 `/v1/skillsets`；
 *   2. 语义保持：五个前缀 + 插件市场两个后缀（capabilities / config）原有覆盖不缩水；
 *   3. 方法与插件子树：非写方法、插件安装/卸载等**不得**被误判为管理写。
 */

import { describe, expect, it } from 'bun:test';

import { isAdminWriteRoute } from '../adminWriteRoutes';

describe('isAdminWriteRoute（管理写 API 段边界判定）', () => {
  describe('段边界（W26-15 修复点）', () => {
    it('`POST /v1/skills` ⇒ 管理写（裸路径）', () => {
      expect(isAdminWriteRoute('POST', '/v1/skills')).toBe(true);
    });

    it('`POST /v1/skills/install` ⇒ 管理写（子路径）', () => {
      expect(isAdminWriteRoute('POST', '/v1/skills/install')).toBe(true);
    });

    it('`POST /v1/skills/` ⇒ 管理写（尾斜杠）', () => {
      expect(isAdminWriteRoute('POST', '/v1/skills/')).toBe(true);
    });

    it('`POST /v1/skillsets` ⇒ **不是**管理写（前缀撞车反例）', () => {
      expect(isAdminWriteRoute('POST', '/v1/skillsets')).toBe(false);
    });

    it('`POST /v1/skills-anything` ⇒ **不是**管理写（前缀撞车反例）', () => {
      expect(isAdminWriteRoute('POST', '/v1/skills-anything')).toBe(false);
    });
  });

  describe('五个前缀的既有覆盖', () => {
    it('`POST /v1/apikeys`（裸路径）⇒ 管理写', () => {
      expect(isAdminWriteRoute('POST', '/v1/apikeys')).toBe(true);
    });

    it('`DELETE /v1/apikeys/k1` ⇒ 管理写', () => {
      expect(isAdminWriteRoute('DELETE', '/v1/apikeys/k1')).toBe(true);
    });

    it('`PUT /v1/oauth/providers/p1` ⇒ 管理写', () => {
      expect(isAdminWriteRoute('PUT', '/v1/oauth/providers/p1')).toBe(true);
    });

    it('`DELETE /v1/permissions/users/u1` ⇒ 管理写', () => {
      expect(isAdminWriteRoute('DELETE', '/v1/permissions/users/u1')).toBe(
        true
      );
    });

    it('`DELETE /v1/tenants/t1` ⇒ 管理写', () => {
      expect(isAdminWriteRoute('DELETE', '/v1/tenants/t1')).toBe(true);
    });
  });

  describe('插件市场（仅 capabilities / config）', () => {
    it('`POST .../plugins/p1/capabilities` ⇒ 管理写', () => {
      expect(
        isAdminWriteRoute(
          'POST',
          '/v1/plugins/marketplace/plugins/p1/capabilities'
        )
      ).toBe(true);
    });

    it('`PUT .../plugins/p1/config` ⇒ 管理写', () => {
      expect(
        isAdminWriteRoute('PUT', '/v1/plugins/marketplace/plugins/p1/config')
      ).toBe(true);
    });

    it('`POST .../plugins/p1/install` ⇒ **不是**管理写（安装口径不变）', () => {
      expect(
        isAdminWriteRoute('POST', '/v1/plugins/marketplace/plugins/p1/install')
      ).toBe(false);
    });

    it('`POST .../pluginsX/p1/capabilities` ⇒ **不是**管理写（前缀非段边界）', () => {
      expect(
        isAdminWriteRoute(
          'POST',
          '/v1/plugins/marketplace/pluginsX/p1/capabilities'
        )
      ).toBe(false);
    });
  });

  describe('方法与无关路径', () => {
    it('`GET /v1/skills` ⇒ 不是管理写（读接口不卡）', () => {
      expect(isAdminWriteRoute('GET', '/v1/skills')).toBe(false);
    });

    it('`PATCH /v1/skills` ⇒ 不是管理写（写方法白名单未含 PATCH，保持既有语义）', () => {
      expect(isAdminWriteRoute('PATCH', '/v1/skills')).toBe(false);
    });

    it('方法大小写不敏感：`post /v1/skills` ⇒ 管理写', () => {
      expect(isAdminWriteRoute('post', '/v1/skills')).toBe(true);
    });

    it('业务接口 `POST /v1/sessions` ⇒ 不是管理写', () => {
      expect(isAdminWriteRoute('POST', '/v1/sessions')).toBe(false);
    });
  });
});
