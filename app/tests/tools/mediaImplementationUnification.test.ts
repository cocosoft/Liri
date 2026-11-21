/**
 * 媒体内部面**实现统一**守卫（C5，2026-11-21；治理方案 v3 §7「只做实现统一」）
 *
 * 口径（已核实的现状 + 本轮收口点）：
 * - **底层算法唯一**：`ImageProcessor` / `VideoProcessor` / `FFmpegWrapper`（infra）；
 * - **前端 `mediaService` 无本地实现**：只是 `/v1/tools` 的薄包装 ⇒ 与模型面天然同源；
 * - 模型面（`image` / `image_analysis` / `video` / `music`）**必须**用 infra 单例，
 *   不得再 `new XxxProcessor()`（否则与 `media_*` 各持一份实例，改动容易只落到一侧）；
 * - `video` 的 `trim` / `convert` 参数构造收口在 `VideoProcessor`（本轮从工具层下移）。
 *
 * 本文件是**静态守卫**：防止后续改动把"第二份实现"重新长回来。
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { videoProcessor } from '@openliri/infra/media/video/VideoProcessor';
import { ImageTool } from '../../src/tools/ImageTool/ImageTool';

const APP_DIR = resolve(import.meta.dir, '../..');
const REPO_DIR = resolve(APP_DIR, '..');

const read = (relative: string): string =>
  readFileSync(resolve(REPO_DIR, relative), 'utf8');

/** 模型面媒体工具（都必须走 infra 单例） */
const MODEL_FACE_TOOLS = [
  'app/src/tools/ImageTool/ImageTool.ts',
  'app/src/tools/ImageAnalysisTool/ImageAnalysisTool.ts',
  'app/src/tools/VideoTool/VideoTool.ts',
  'app/src/tools/MusicTool/MusicTool.ts',
] as const;

const SINGLETON_BY_CLASS = {
  ImageProcessor: 'imageProcessor',
  VideoProcessor: 'videoProcessor',
  FFmpegWrapper: 'ffmpegWrapper',
} as const;

describe('媒体实现统一：模型面不得自建处理器实例', () => {
  for (const file of MODEL_FACE_TOOLS) {
    it(`${file} 不含 new ImageProcessor/VideoProcessor/FFmpegWrapper`, () => {
      const source = read(file);
      for (const className of Object.keys(SINGLETON_BY_CLASS)) {
        expect(source).not.toMatch(new RegExp(`new\\s+${className}\\s*\\(`));
      }
    });
  }

  it('四个模型面工具都能解析到对应单例名', () => {
    const expected: Array<[string, string]> = [
      ['app/src/tools/ImageTool/ImageTool.ts', 'imageProcessor'],
      [
        'app/src/tools/ImageAnalysisTool/ImageAnalysisTool.ts',
        'imageProcessor',
      ],
      ['app/src/tools/VideoTool/VideoTool.ts', 'videoProcessor'],
      ['app/src/tools/VideoTool/VideoTool.ts', 'ffmpegWrapper'],
      ['app/src/tools/MusicTool/MusicTool.ts', 'ffmpegWrapper'],
    ];
    for (const [file, singleton] of expected) {
      expect(read(file)).toMatch(new RegExp(`\\b${singleton}\\b`));
    }
  });
});

describe('媒体实现统一：video 的 trim / convert 收口在 VideoProcessor', () => {
  it('infra 暴露 trim / convert 方法', () => {
    expect(typeof videoProcessor.trim).toBe('function');
    expect(typeof videoProcessor.convert).toBe('function');
  });

  it('VideoTool 不再自己拼 ffmpeg 参数（交给 videoProcessor）', () => {
    const source = read('app/src/tools/VideoTool/VideoTool.ts');
    // `-c copy` 只应出现在 VideoProcessor 里；工具层出现即为"第二份实现"回潮
    expect(source).not.toContain("'-c', 'copy'");
    expect(source).toMatch(/videoProcessor\.trim\(/);
    expect(source).toMatch(/videoProcessor\.convert\(/);
  });
});

describe('媒体实现统一：前端 mediaService 只是后端工具包装', () => {
  const source = read('client/src/services/mediaService.ts');

  it('不直接做本地文件/图像处理（无 fs / sharp 依赖）', () => {
    expect(source).not.toMatch(/from\s+["']node:fs["']/);
    expect(source).not.toMatch(/from\s+["']sharp["']/);
    expect(source).not.toMatch(/writeFileSync|readFileSync/);
  });

  it('所有媒体操作都经 toolService.execute 调后端工具', () => {
    expect(source).toMatch(/toolService\.execute\(/);
    // 每个方法名都对应一个 media_* 真名（抽样断言，防止有人改成前端本地实现）
    for (const name of [
      'media_image_convert',
      'media_image_resize',
      'media_video_compress',
      'media_pdf_extract',
    ]) {
      expect(source).toContain(`"${name}"`);
    }
  });
});

describe('媒体实现统一：水印选项集对齐（image ↔ media_image_watermark）', () => {
  it('模型可见 schema 暴露 watermarkOpacity（与 media 工具同能力）', () => {
    const names = new ImageTool().params.map((p) => p.name);
    expect(names).toContain('watermarkOpacity');
    expect(names).toContain('watermarkFontSize');
    expect(names).toContain('watermarkColor');
  });

  it('两边都把 opacity 透传给 ImageProcessor', () => {
    expect(read('app/src/tools/ImageTool/ImageTool.ts')).toMatch(
      /opacity:\s*params\.watermarkOpacity/
    );
    expect(
      read('packages/tool-media/src/tool-media/ImageWatermarkTool.ts')
    ).toMatch(/options\.opacity\s*=\s*input\.opacity/);
  });
});
