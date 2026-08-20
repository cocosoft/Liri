/**
 * PlaceholderResolver 单元测试
 *
 * 覆盖：
 *  - parsePlaceholders：占位符解析（含 id + 分号分隔）
 *  - replacePlaceholders：占位符替换
 *  - deduplicatePlaceholders：按 id 去重
 *  - buildPlaceholderText：占位符文本生成
 */

import { describe, it, expect } from 'bun:test';
import {
  parsePlaceholders,
  replacePlaceholders,
  deduplicatePlaceholders,
  buildPlaceholderText,
} from '../../../src/modules/doc/placeholder/PlaceholderResolver';

describe('PlaceholderResolver', () => {
  // ─── parsePlaceholders ────────────────────────────────

  describe('parsePlaceholders', () => {
    it('解析标准占位符', () => {
      const text =
        '一些文本 ![图表描述](GENERATE:id=img-1;prompt=画一个柱状图) 后续文本';
      const result = parsePlaceholders(text);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('img-1');
      expect(result[0].prompt).toBe('画一个柱状图');
      expect(result[0].description).toBe('图表描述');
    });

    it('解析多个占位符', () => {
      const text =
        '![图1](GENERATE:id=img-a;prompt=提示A)\n![图2](GENERATE:id=img-b;prompt=提示B)';
      const result = parsePlaceholders(text);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('img-a');
      expect(result[1].id).toBe('img-b');
    });

    it('提示词含分号时不截断', () => {
      // 分号是字段分隔符，提示词内不应含分号（设计约束）
      // 但含其他特殊字符（如括号、冒号）应正常解析
      const text = '![描述](GENERATE:id=img-1;prompt=一个：复杂（提示词）内容)';
      const result = parsePlaceholders(text);
      expect(result).toHaveLength(1);
      expect(result[0].prompt).toBe('一个：复杂（提示词）内容');
    });

    it('无占位符时返回空数组', () => {
      const text = '普通文本，无占位符';
      const result = parsePlaceholders(text);
      expect(result).toHaveLength(0);
    });

    it('缺少 id 字段时跳过', () => {
      const text = '![描述](GENERATE:prompt=没有id的占位符)';
      const result = parsePlaceholders(text);
      expect(result).toHaveLength(0);
    });

    it('缺少 prompt 字段时跳过', () => {
      const text = '![描述](GENERATE:id=img-1)';
      const result = parsePlaceholders(text);
      expect(result).toHaveLength(0);
    });

    it('空描述也能解析', () => {
      const text = '![](GENERATE:id=img-1;prompt=提示词)';
      const result = parsePlaceholders(text);
      expect(result).toHaveLength(1);
      expect(result[0].description).toBe('');
    });
  });

  // ─── replacePlaceholders ──────────────────────────────

  describe('replacePlaceholders', () => {
    it('替换命中的占位符为图片路径', () => {
      const text = '文本 ![描述](GENERATE:id=img-1;prompt=提示词) 结束';
      const cache = new Map([['img-1', '/path/to/image.png']]);
      const { replaced, missed } = replacePlaceholders(text, cache);
      expect(replaced).toContain('/path/to/image.png');
      expect(replaced).not.toContain('GENERATE');
      expect(missed).toHaveLength(0);
    });

    it('未命中的占位符记录到 missed', () => {
      const text = '文本 ![描述](GENERATE:id=img-1;prompt=提示词) 结束';
      const cache = new Map<string, string>();
      const { replaced, missed } = replacePlaceholders(text, cache);
      expect(missed).toHaveLength(1);
      expect(missed[0].id).toBe('img-1');
      // 原文不变（未命中时不替换）
      expect(replaced).toBe(text);
    });

    it('混合命中和未命中', () => {
      const text =
        '![图1](GENERATE:id=a;prompt=p1) ![图2](GENERATE:id=b;prompt=p2)';
      const cache = new Map([['a', '/img/a.png']]);
      const { replaced, missed } = replacePlaceholders(text, cache);
      expect(replaced).toContain('/img/a.png');
      expect(missed).toHaveLength(1);
      expect(missed[0].id).toBe('b');
    });
  });

  // ─── deduplicatePlaceholders ──────────────────────────

  describe('deduplicatePlaceholders', () => {
    it('相同 id 的占位符只保留首个', () => {
      const phs = parsePlaceholders(
        '![图1](GENERATE:id=dup;prompt=p1)\n![图2](GENERATE:id=dup;prompt=p2)\n![图3](GENERATE:id=uniq;prompt=p3)'
      );
      const unique = deduplicatePlaceholders(phs);
      expect(unique).toHaveLength(2);
      expect(unique[0].id).toBe('dup');
      expect(unique[0].prompt).toBe('p1'); // 保留首个
      expect(unique[1].id).toBe('uniq');
    });

    it('无重复时全部保留', () => {
      const phs = parsePlaceholders(
        '![图1](GENERATE:id=a;prompt=p1)\n![图2](GENERATE:id=b;prompt=p2)'
      );
      const unique = deduplicatePlaceholders(phs);
      expect(unique).toHaveLength(2);
    });

    it('空列表返回空', () => {
      expect(deduplicatePlaceholders([])).toHaveLength(0);
    });
  });

  // ─── buildPlaceholderText ─────────────────────────────

  describe('buildPlaceholderText', () => {
    it('生成标准格式的占位符文本', () => {
      const text = buildPlaceholderText('图表描述', 'img-test', '画柱状图');
      expect(text).toBe('![图表描述](GENERATE:id=img-test;prompt=画柱状图)');
    });

    it('生成的文本可被 parsePlaceholders 解析回来', () => {
      const text = buildPlaceholderText('描述', 'img-1', '提示词');
      const parsed = parsePlaceholders(text);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('img-1');
      expect(parsed[0].prompt).toBe('提示词');
      expect(parsed[0].description).toBe('描述');
    });
  });
});
