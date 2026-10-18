// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * A-4（2026-10-18）媒体产物声明表守卫。
 *
 * 钉死 `TOOL_MEDIA_ARTIFACTS` 的**取值语义**（与迁移前的分支逐字等价），
 * 防止后续「顺手改表」悄悄改变会话图片上下文/路径登记行为。
 */

import { describe, it, expect } from 'bun:test';

import {
  collectMediaArtifactPaths,
  mediaArtifactDetail,
  primaryMediaArtifact,
  resolveMediaArtifacts,
} from '../../src/utils/toolContract/mediaArtifacts.js';

describe('mediaArtifacts 声明表', () => {
  it('未登记的工具（含 MCP / 未知名）⇒ undefined（不 fail-open）', () => {
    expect(resolveMediaArtifacts('mcp_tool')).toBeUndefined();
    expect(resolveMediaArtifacts('file_write')).toBeUndefined();
  });

  it('image_generate：逐元素、逐键收集（filePath 先于 localUrl，保序）', () => {
    const spec = resolveMediaArtifacts('image_generate');
    expect(spec).toBeDefined();
    const paths = collectMediaArtifactPaths(
      {
        images: [
          { filePath: '/a/1.png', localUrl: '/v1/images/1.png' },
          { filePath: '/a/2.png' },
        ],
      },
      spec!
    );
    expect(paths).toEqual(['/a/1.png', '/v1/images/1.png', '/a/2.png']);
  });

  it('主产物：顶层键优先于数组；数组取首元素的首键', () => {
    const gen = resolveMediaArtifacts('image_generate')!;
    expect(
      primaryMediaArtifact(
        { images: [{ filePath: '/a/g.png', localUrl: '/v/g.png' }] },
        gen
      )
    ).toBe('/a/g.png');

    const image = resolveMediaArtifacts('image')!;
    expect(primaryMediaArtifact({ outputPath: '/a/e.png' }, image)).toBe(
      '/a/e.png'
    );
    expect(primaryMediaArtifact({}, image)).toBeUndefined();
  });

  it('补充字段：canvas 缺省 export，其余缺省空串（与迁移前一致）', () => {
    expect(mediaArtifactDetail({}, resolveMediaArtifacts('canvas')!)).toBe(
      'export'
    );
    expect(mediaArtifactDetail({}, resolveMediaArtifacts('image')!)).toBe('');
    expect(
      mediaArtifactDetail({ action: 'resize' }, resolveMediaArtifacts('image')!)
    ).toBe('resize');
    expect(
      mediaArtifactDetail(
        { prompt: 'a cat' },
        resolveMediaArtifacts('image_generate')!
      )
    ).toBe('a cat');
  });

  it('image_analysis：上下文取 args.inputPath，结果路径不参与', () => {
    const spec = resolveMediaArtifacts('image_analysis')!;
    expect(spec.inputPathKey).toBe('inputPath');
    expect(collectMediaArtifactPaths({ outputPath: '/x' }, spec)).toEqual([]);
  });
});
