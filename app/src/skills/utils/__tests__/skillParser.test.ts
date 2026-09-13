/**
 * skillParser 字段断言单测（S3-1 / S2-2）
 *
 * 覆盖 frontmatter 解析与 createSkillCommand 的字段映射：
 * when-to-use（连字符）、aliases（独立字段而非 arguments）、
 * userInvocable 默认值（未写时 true）、effort 类型一致性。
 */

import { describe, it, expect } from 'bun:test';
import {
  SkillParser,
  parseSkillFrontmatter,
  createSkillCommand,
  SkillSource,
} from '../skillParser';
import type { SkillFrontmatter } from '../skillParser';

const parser = new SkillParser();

function parse(content: string): {
  frontmatter: SkillFrontmatter;
  content: string;
} {
  return parseSkillFrontmatter(content);
}

describe('frontmatter 解析', () => {
  it('解析 when-to-use（连字符键名）', () => {
    const { frontmatter } = parse(
      '---\nname: foo\ndescription: desc\nwhen-to-use: 用户要求摘要时\n---\n正文'
    );
    expect(frontmatter['when-to-use']).toBe('用户要求摘要时');
  });

  it('aliases 解析为独立数组字段', () => {
    const { frontmatter } = parse(
      '---\nname: foo\ndescription: desc\naliases: bar, baz\n---\n正文'
    );
    expect(frontmatter.aliases).toEqual(['bar', 'baz']);
  });

  it('arguments 与 aliases 互不混淆', () => {
    const { frontmatter } = parse(
      '---\nname: foo\ndescription: desc\narguments: input\naliases: bar\n---\n正文'
    );
    expect(frontmatter.arguments).toEqual(['input']);
    expect(frontmatter.aliases).toEqual(['bar']);
  });

  it('effort 解析为数值', () => {
    const { frontmatter } = parse(
      '---\nname: foo\ndescription: desc\neffort: 5\n---\n正文'
    );
    expect(frontmatter.effort).toBe(5);
  });
});

describe('createSkillCommand 字段映射', () => {
  it('whenToUse 取连字符字段（不再误读 when_to_use）', () => {
    const skill = createSkillCommand({
      skillName: 'foo',
      frontmatter: { 'when-to-use': 'xx' } as SkillFrontmatter,
      content: 'body',
      source: SkillSource.BUILTIN,
      loadedFrom: 'file',
    });
    expect(skill.whenToUse).toBe('xx');
  });

  it('aliases 不取 arguments（参数列表不是别名）', () => {
    const skill = createSkillCommand({
      skillName: 'foo',
      frontmatter: { arguments: ['input1', 'input2'] } as SkillFrontmatter,
      content: 'body',
      source: SkillSource.BUILTIN,
      loadedFrom: 'file',
    });
    expect(skill.aliases).toEqual([]);
  });

  it('aliases 取独立 aliases 字段', () => {
    const skill = createSkillCommand({
      skillName: 'foo',
      frontmatter: { aliases: ['bar'] } as SkillFrontmatter,
      content: 'body',
      source: SkillSource.BUILTIN,
      loadedFrom: 'file',
    });
    expect(skill.aliases).toEqual(['bar']);
  });

  it('userInvocable 未写时默认 true（与 SkillHub.toEntry 对齐）', () => {
    const skill = createSkillCommand({
      skillName: 'foo',
      frontmatter: {} as SkillFrontmatter,
      content: 'body',
      source: SkillSource.BUILTIN,
      loadedFrom: 'file',
    });
    expect(skill.userInvocable).toBe(true);
  });

  it('userInvocable 显式 false 时保持 false', () => {
    const skill = createSkillCommand({
      skillName: 'foo',
      frontmatter: { 'user-invocable': false } as SkillFrontmatter,
      content: 'body',
      source: SkillSource.BUILTIN,
      loadedFrom: 'file',
    });
    expect(skill.userInvocable).toBe(false);
  });

  it('effort 统一为 string（Skill.effort 类型）', () => {
    const skill = createSkillCommand({
      skillName: 'foo',
      frontmatter: { effort: 5 } as SkillFrontmatter,
      content: 'body',
      source: SkillSource.BUILTIN,
      loadedFrom: 'file',
    });
    expect(skill.effort).toBe('5');
    expect(typeof skill.effort).toBe('string');
  });

  it('完整 frontmatter 解析到 createSkillCommand 链路正确', () => {
    const parsed = parseSkillFrontmatter(
      '---\nname: foo\ndescription: desc\nwhen-to-use: 时机\naliases: bar\nuser-invocable: true\neffort: 3\n---\n正文'
    );
    const skill = createSkillCommand({
      skillName: parsed.frontmatter.name as string,
      frontmatter: parsed.frontmatter,
      content: parsed.content,
      source: SkillSource.BUILTIN,
      loadedFrom: 'file',
    });
    expect(skill.whenToUse).toBe('时机');
    expect(skill.aliases).toEqual(['bar']);
    expect(skill.userInvocable).toBe(true);
    expect(skill.effort).toBe('3');
  });
});

describe('parseSkillFile', () => {
  it('解析技能文件成功且保留正文', async () => {
    const { fileURLToPath } = await import('node:url');
    const { writeFileSync, mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const dir = mkdtempSync(join(tmpdir(), 'skillparser-'));
    const filePath = join(dir, 'SKILL.md');
    writeFileSync(
      filePath,
      '---\nname: demo\ndescription: 演示\nwhen-to-use: 测试\n---\n正文内容',
      'utf-8'
    );
    try {
      const def = await parser.parseSkillFile(filePath, SkillSource.BUILTIN);
      expect(def.name).toBe('demo');
      expect(def.content.trim()).toBe('正文内容');
      expect(def.frontmatter['when-to-use']).toBe('测试');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
