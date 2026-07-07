/**
 * ImageUrlHelper 单元测试
 * 测试从各种路径格式生成规范的图片展示 URL
 */
import { describe, it, expect } from 'bun:test';
import { ImageUrlHelper } from '../ImageUrlHelper';

const CORRECT_URL = '/v1/images/static/media/';

describe('ImageUrlHelper.toDisplayUrl', () => {
  it('正确 URL 保持不变', () => {
    expect(ImageUrlHelper.toDisplayUrl('/v1/images/static/media/abc.png')).toBe(
      '/v1/images/static/media/abc.png'
    );
  });

  it('缺少 static 的 URL 被修复', () => {
    expect(ImageUrlHelper.toDisplayUrl('/v1/images//media/abc.png')).toBe(
      `${CORRECT_URL}abc.png`
    );
  });

  it('images和static粘连被修复', () => {
    expect(ImageUrlHelper.toDisplayUrl('/v1/imagesstatic/media/abc.png')).toBe(
      `${CORRECT_URL}abc.png`
    );
  });

  it('缺少 images 段被修复', () => {
    expect(ImageUrlHelper.toDisplayUrl('/v1/static/media/abc.png')).toBe(
      `${CORRECT_URL}abc.png`
    );
  });

  it('缺少 v 被修复', () => {
    expect(ImageUrlHelper.toDisplayUrl('/1/images/static/media/abc.png')).toBe(
      `${CORRECT_URL}abc.png`
    );
  });

  it('Windows 磁盘路径被修复', () => {
    expect(
      ImageUrlHelper.toDisplayUrl(
        'E:\\PY\\CODES\\data\\pyapp\\media\\images\\abc.png'
      )
    ).toBe(`${CORRECT_URL}abc.png`);
  });

  it('Unix 磁盘路径被修复', () => {
    expect(
      ImageUrlHelper.toDisplayUrl('/data/pyapp/media/images/abc.png')
    ).toBe(`${CORRECT_URL}abc.png`);
  });

  it('文件名含特殊字符正确处理', () => {
    expect(
      ImageUrlHelper.toDisplayUrl(
        '/1/images/static/media/f_mr9y0j_19ef68_generated_1783386072592.png'
      )
    ).toBe(`${CORRECT_URL}f_mr9y0j_19ef68_generated_1783386072592.png`);
  });

  it('jpeg 格式正确处理', () => {
    expect(ImageUrlHelper.toDisplayUrl('E:\\a\\b.jpg')).toBe(
      `${CORRECT_URL}b.jpg`
    );
  });

  it('webp 格式正确处理', () => {
    expect(ImageUrlHelper.toDisplayUrl('/a/b.webp')).toBe(
      `${CORRECT_URL}b.webp`
    );
  });

  it('非图片路径返回原值', () => {
    expect(ImageUrlHelper.toDisplayUrl('/v1/chat/message')).toBe(
      '/v1/chat/message'
    );
  });

  it('空格包围路径仍正确处理', () => {
    expect(ImageUrlHelper.toDisplayUrl('  /v1/images//media/abc.png  ')).toBe(
      '  /v1/images//media/abc.png  '
    );
  });
});

describe('ImageUrlHelper.toDisplayUrlOrNull', () => {
  it('正常返回 URL', () => {
    expect(ImageUrlHelper.toDisplayUrlOrNull('/v1/images//media/x.png')).toBe(
      `${CORRECT_URL}x.png`
    );
  });

  it('非图片返回 null', () => {
    expect(ImageUrlHelper.toDisplayUrlOrNull('/some/path')).toBeNull();
  });
});

describe('ImageUrlHelper.extractFilename', () => {
  it('从 URL 提取文件名', () => {
    expect(ImageUrlHelper.extractFilename('/a/b/c.jpg')).toBe('c.jpg');
  });

  it('从磁盘路径提取文件名', () => {
    expect(ImageUrlHelper.extractFilename('E:\\a\\b\\c.png')).toBe('c.png');
  });

  it('非路径返回 null', () => {
    expect(ImageUrlHelper.extractFilename('hello world')).toBeNull();
  });
});

describe('ImageUrlHelper.repairAll', () => {
  it('修复 Markdown 图片中的错误 URL', () => {
    const input =
      '![图1](/v1/images//media/a.png) ![图2](/1/images/static/media/b.png)';
    expect(ImageUrlHelper.repairAll(input)).toBe(
      `![图1](${CORRECT_URL}a.png) ![图2](${CORRECT_URL}b.png)`
    );
  });

  it('修复 Markdown 中的磁盘路径', () => {
    const input = '![美女](E:\\PY\\CODES\\data\\pyapp\\media\\images\\abc.png)';
    expect(ImageUrlHelper.repairAll(input)).toBe(
      `![美女](${CORRECT_URL}abc.png)`
    );
  });

  it('修复裸磁盘路径（Windows）', () => {
    const input = 'path is E:\\data\\pyapp\\media\\images\\file.png here';
    expect(ImageUrlHelper.repairAll(input)).toBe(
      `path is ${CORRECT_URL}file.png here`
    );
  });

  it('正确 URL 不被修改', () => {
    const input = `![图](${CORRECT_URL}abc.png)`;
    expect(ImageUrlHelper.repairAll(input)).toBe(input);
  });

  it('多张图片全部修复', () => {
    const input =
      '![1](/v1/images//media/a.png)\n![2](E:\\b.png)\n![3](/1/images/static/media/c.png)';
    expect(ImageUrlHelper.repairAll(input)).toBe(
      `![1](${CORRECT_URL}a.png)\n![2](${CORRECT_URL}b.png)\n![3](${CORRECT_URL}c.png)`
    );
  });

  it('非图片链接不受影响', () => {
    const input = '[链接](/v1/chat) and [文档](/docs)';
    expect(ImageUrlHelper.repairAll(input)).toBe(input);
  });
});
