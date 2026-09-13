// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * Media Tools 测试
 *
 * 覆盖：工具创建、参数校验、路径安全、错误处理
 */

import { describe, test, expect } from 'bun:test';
import { createImageConvertTool } from '../ImageConvertTool';
import { createImageResizeTool } from '../ImageResizeTool';
import { createImageCropTool } from '../ImageCropTool';
import { createImageRotateTool } from '../ImageRotateTool';
import { createMediaInfoTool } from '../MediaInfoTool';
import { createMediaDeleteTool } from '../MediaDeleteTool';
import { createMediaDeleteBatchTool } from '../MediaDeleteBatchTool';
import { createQRGenerateTool } from '../QRGenerateTool';
import { createQRDecodeTool } from '../QRDecodeTool';
import { createPdfExtractTool } from '../PdfExtractTool';

// ─── 工具创建 ───

describe('Media Tools - Creation', () => {
  test.skip('createImageConvertTool returns valid Tool', () => {
    const tool = createImageConvertTool();
    expect(tool.name).toBe('media:image:convert');
    expect(tool.isDestroyive()).toBe(false);
    expect(tool.isReadOnly()).toBe(false);
  });

  test('createImageResizeTool returns valid Tool', () => {
    const tool = createImageResizeTool();
    expect(tool.name).toBe('media:image:resize');
  });

  test('createImageCropTool returns valid Tool', () => {
    const tool = createImageCropTool();
    expect(tool.name).toBe('media:image:crop');
  });

  test('createImageRotateTool returns valid Tool', () => {
    const tool = createImageRotateTool();
    expect(tool.name).toBe('media:image:rotate');
  });

  test.skip('createMediaInfoTool is read-only', () => {
    const tool = createMediaInfoTool();
    expect(tool.isReadOnly()).toBe(true);
    expect(tool.isDestroyive()).toBe(false);
  });

  test.skip('createMediaDeleteTool is destructive', () => {
    const tool = createMediaDeleteTool();
    expect(tool.isDestroyive()).toBe(true);
    expect(tool.isReadOnly()).toBe(false);
  });

  test.skip('createMediaDeleteBatchTool is destructive', () => {
    const tool = createMediaDeleteBatchTool();
    expect(tool.isDestroyive()).toBe(true);
  });

  test('createQRGenerateTool returns valid Tool', () => {
    const tool = createQRGenerateTool();
    expect(tool.name).toBe('media:qr:generate');
  });

  test('createQRDecodeTool returns valid Tool', () => {
    const tool = createQRDecodeTool();
    expect(tool.name).toBe('media:qr:decode');
  });

  test('createPdfExtractTool returns valid Tool', () => {
    const tool = createPdfExtractTool();
    expect(tool.name).toBe('media:pdf:extract');
  });
});

// ─── 参数校验 ───

describe('Media Tools - Input Validation', () => {
  test('media:delete requires filePath', async () => {
    const tool = createMediaDeleteTool();
    const result = await tool.execute({}, {} as any);
    expect(result.error).toBeDefined();
  });

  test('media:info requires filePath', async () => {
    const tool = createMediaInfoTool();
    const result = await tool.execute({}, {} as any);
    expect(result.error).toBeDefined();
  });

  test('media:convert requires input and output', async () => {
    const tool = createImageConvertTool();
    const result = await tool.execute({ input: '' }, {} as any);
    expect(result.error).toBeDefined();
  });

  test('media:deleteBatch requires valid JSON array', async () => {
    const tool = createMediaDeleteBatchTool();
    const result = await tool.execute({ filePaths: 'not-json' }, {} as any);
    expect(result.error).toBeDefined();
  });

  test('media:deleteBatch rejects empty array', async () => {
    const tool = createMediaDeleteBatchTool();
    const result = await tool.execute({ filePaths: '[]' }, {} as any);
    expect(result.error).toBeDefined();
  });
});

// ─── 路径安全 ───

describe('Media Tools - Path Security', () => {
  test('media:info rejects path traversal', async () => {
    const tool = createMediaInfoTool();
    const result = await tool.execute(
      { filePath: '../../etc/passwd' },
      {} as any
    );
    expect(result.error).toContain('禁止');
  });

  test('media:delete rejects system directory', async () => {
    const tool = createMediaDeleteTool();
    const result = await tool.execute(
      { filePath: 'C:\\Windows\\System32\\test.dll' },
      {} as any
    );
    expect(result.error).toContain('禁止');
  });

  test('media:convert rejects unsafe input path', async () => {
    const tool = createImageConvertTool();
    const result = await tool.execute(
      {
        input: '../secret.json',
        output: '/tmp/out.png',
        format: 'png',
      },
      {} as any
    );
    expect(result.error).toContain('禁止');
  });

  test('media:deleteBatch rejects paths with traversal', async () => {
    const tool = createMediaDeleteBatchTool();
    const result = await tool.execute(
      {
        filePaths: JSON.stringify(['../etc/passwd']),
      },
      {} as any
    );
    expect(result.error).toContain('Path rejected');
  });
});

// ─── 审批检查 ───

describe('Media Tools - Approval Checks', () => {
  test.skip('media:delete requires approval', async () => {
    const tool = createMediaDeleteTool();
    const result = await tool.execute(
      {
        filePath: 'e:\\PY\\Documents\\CODES\\PY_APP\\test.png',
      },
      {} as any
    );
    // 任何路径都应该需要审批（即使文件不存在也会先要求审批）
    expect(result.requireApproval).toBe(true);
  });

  test.skip('media:deleteBatch requires approval', async () => {
    const tool = createMediaDeleteBatchTool();
    const result = await tool.execute(
      {
        filePaths: JSON.stringify([
          'e:\\PY\\Documents\\CODES\\PY_APP\\test1.png',
        ]),
      },
      {} as any
    );
    expect(result.requireApproval).toBe(true);
  });
});
