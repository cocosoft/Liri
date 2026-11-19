// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 引导跳过提示的措辞/级别分流（2026-11-20）
 *
 * 真机：`.onboarded` 标记缺失但配置已就绪（`GET /v1/config` 25 键、模型/任务分工齐全），
 * 每次启动仍打「首次运行…」warning（当天 43 条）⇒ 误导排查。此用例锁住分流口径。
 */

import { describe, expect, it } from 'bun:test';
import { resolveOnboardingSkipNotice } from '../../src/bootstrap/preflight.js';

describe('resolveOnboardingSkipNotice', () => {
  it('配置已就绪 ⇒ info，且不再谎报“首次运行”', () => {
    const notice = resolveOnboardingSkipNotice(true);
    expect(notice.level).toBe('info');
    expect(notice.message).toContain('.onboarded');
    expect(notice.message).toContain('已就绪');
    expect(notice.message).not.toContain('首次运行');
  });

  it('配置未就绪 ⇒ 维持 warn 与原文案（引导指引不变）', () => {
    const notice = resolveOnboardingSkipNotice(false);
    expect(notice.level).toBe('warn');
    expect(notice.message).toContain('首次运行');
    expect(notice.message).toContain('/onboard');
  });
});
