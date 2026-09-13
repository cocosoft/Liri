// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * frontmatter parser 单元测试（KB-P1-8 公共解析器）
 */
import { describe, expect, it } from 'bun:test';
import { parseFrontmatter, parseTags } from '../frontmatter';

describe('parseTags', () => {
  it('解析 JSON 数组格式 ["a","b"]', () => {
    expect(parseTags('["a","b"]')).toEqual(['a', 'b']);
  });

  it('解析 [a, b] 无引号格式', () => {
    expect(parseTags('[a, b]')).toEqual(['a', 'b']);
  });

  it('解析 a, b 逗号分隔格式', () => {
    expect(parseTags('a, b')).toEqual(['a', 'b']);
  });

  it('空值返回空数组', () => {
    expect(parseTags('')).toEqual([]);
  });

  it('空数组 [] 返回空数组', () => {
    expect(parseTags('[]')).toEqual([]);
  });
});

describe('parseFrontmatter', () => {
  it('解析完整 frontmatter 字段', () => {
    const content = [
      '---',
      'title: "测试文档"',
      'source: upload',
      'category: "开发笔记"',
      'tags: ["a", "b"]',
      '---',
      '# 正文',
      '内容',
    ].join('\n');
    const fm = parseFrontmatter(content);
    expect(fm).not.toBeNull();
    expect(fm!.title).toBe('测试文档');
    expect(fm!.source).toBe('upload');
    expect(fm!.category).toBe('开发笔记');
    expect(fm!.tags).toEqual(['a', 'b']);
  });

  it('无 frontmatter 返回 null', () => {
    expect(parseFrontmatter('# 只有 H1')).toBeNull();
  });

  it('值内含冒号不被错误拆分（title: "a: b"）', () => {
    const content = ['---', 'title: "a: b"', '---', '# 正文'].join('\n');
    const fm = parseFrontmatter(content);
    expect(fm).not.toBeNull();
    expect(fm!.title).toBe('a: b');
  });

  it('空 tags 行返回空数组', () => {
    const content = ['---', 'title: x', 'tags: []', '---', '# 正文'].join('\n');
    const fm = parseFrontmatter(content);
    expect(fm).not.toBeNull();
    expect(fm!.tags).toEqual([]);
  });

  it('单引号值与无引号值均可解析', () => {
    const content = [
      '---',
      "title: '单引号'",
      'source: plain',
      '---',
      '# 正文',
    ].join('\n');
    const fm = parseFrontmatter(content);
    expect(fm!.title).toBe('单引号');
    expect(fm!.source).toBe('plain');
  });
});
