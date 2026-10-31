// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `ImageSafetyFilter.afterGenerate` 真伪口径（2026-10-31，P3 用户裁定「先如实标注未审核」）。
 *
 * 缺陷：原实现（`TODO: 接入第三方内容审核 API`）只复用 prompt 关键词检查就返回
 * `{passed: true}` ⇒ 调用方会把"没查到违规"误读成"图片已通过审核"。
 * 口径：**未审核就明说** —— `reviewed: false` + 明确 `reason`，不得静默冒充已审核。
 *
 * 另注（如实）：该方法当前**零生产调用方**（生成后审核整体未接线），本用例锁的是
 * "一旦接线，返回值必须如实"这一契约。
 */
import { describe, expect, it } from 'bun:test';
import { ImageSafetyFilter } from '../../src/tools/ImageGenerateTool/ImageSafetyFilter';

const buffer = Buffer.from('fake-image');

describe('ImageSafetyFilter.afterGenerate：未审核必须如实标注', () => {
  it('默认配置（无审核器）⇒ passed:true 但 reviewed:false + 明示未审核', async () => {
    const filter = new ImageSafetyFilter();
    const result = await filter.afterGenerate(buffer, '一只猫的照片');

    expect(result.passed).toBe(true);
    expect(result.reviewed).toBe(false);
    expect(String(result.reason)).toContain('未配置内容审核能力');
  });

  it('过滤已禁用 ⇒ reviewed:false 且说明"已禁用：未审核"', async () => {
    const filter = new ImageSafetyFilter({ enabled: false });
    const result = await filter.afterGenerate(buffer, 'whatever');

    expect(result.passed).toBe(true);
    expect(result.reviewed).toBe(false);
    expect(String(result.reason)).toContain('未审核');
  });

  it('prompt 命中黑名单 ⇒ passed:false，且仍不冒充已审核', async () => {
    const filter = new ImageSafetyFilter({ strictness: 'high' });
    const result = await filter.afterGenerate(buffer, 'explicit porn content');

    expect(result.passed).toBe(false);
    expect(result.reviewed).toBe(false);
    expect(result.blockedKeywords?.length).toBeGreaterThan(0);
  });

  it('负向对照：beforeGenerate 命中白名单时仍放行（前置检查语义不变）', () => {
    const filter = new ImageSafetyFilter({ strictness: 'high' });
    expect(filter.beforeGenerate('medical anatomy art').passed).toBe(true);
  });
});
