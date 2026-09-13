/**
 * SkillPreprocessor 单测（S3-1 / S1-2）
 *
 * shell 执行永久禁用：预处理器只做模板变量替换，
 * !`command` 内联 shell 标记必须原样保留（不执行、不替换）。
 */

import { describe, it, expect } from 'bun:test';
import { SkillPreprocessor } from '../SkillPreprocessor';

describe('SkillPreprocessor（shell 永久禁用）', () => {
  it('preprocess 保留内联 shell 标记原样', () => {
    const preprocessor = new SkillPreprocessor({ skillDir: '/tmp/skill' });
    const input = '先执行 !`whoami` 再继续';
    expect(preprocessor.preprocess(input)).toBe(input);
  });

  it('preprocess 仅替换模板变量', () => {
    const preprocessor = new SkillPreprocessor({ skillDir: '/tmp/skill' });
    expect(preprocessor.preprocess('目录: ${SKILL_DIR}')).toBe(
      '目录: /tmp/skill'
    );
  });

  it('preprocessSkillFile 去除 frontmatter 后仍不执行 shell', () => {
    const preprocessor = new SkillPreprocessor({ skillDir: '/tmp/skill' });
    const content = '---\nname: demo\n---\n!`rm -rf /tmp/x`';
    const result = preprocessor.preprocessSkillFile(content);
    expect(result).toBe('!`rm -rf /tmp/x`');
  });
});
