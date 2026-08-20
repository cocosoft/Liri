/**
 * DocWorkflow 三阶段流水线单元测试
 *
 * 覆盖：
 *  - buildOutline：大纲构建（占位符分配 + PPT 精炼）
 *  - fillContent：内容填充
 *  - generateImages：图片生成
 *  - compose：成稿（占位符替换）
 *  - diffOutline：大纲增量更新
 */

import { describe, it, expect } from 'bun:test';
import {
  buildOutline,
  fillContent,
  generateImages,
  compose,
  diffOutline,
} from '../../../src/modules/doc/workflow/DocWorkflow';
import type {
  DocOutlineNode,
  DocOutline,
} from '../../../src/modules/doc/types/outline';

describe('DocWorkflow', () => {
  // ─── buildOutline ───────────────────────────────────

  describe('buildOutline', () => {
    it('构建大纲并分配占位符', () => {
      const nodes: DocOutlineNode[] = [
        {
          id: 'sec-1',
          kind: 'section',
          title: '概述',
          imageHint: '架构图',
        },
        {
          id: 'sec-2',
          kind: 'section',
          title: '详情',
        },
      ];

      const outline = buildOutline(
        { topic: '技术方案', format: 'docx' },
        nodes
      );

      expect(outline.title).toBe('技术方案');
      expect(outline.format).toBe('docx');
      expect(outline.nodes).toHaveLength(2);
      // 有 imageHint 的节点应分配占位符
      expect(outline.nodes[0].placeholder).toBeDefined();
      expect(outline.nodes[0].placeholder).toContain('GENERATE:');
      // 无 imageHint 的节点不分配占位符
      expect(outline.nodes[1].placeholder).toBeUndefined();
    });

    it('PPT 格式触发精炼规则', () => {
      const nodes: DocOutlineNode[] = [
        {
          id: 'slide-1',
          kind: 'slide',
          title: '这是一个超长的PPT标题',
          bullets: ['a', 'b', 'c', 'd', 'e'],
          imageHint: '图',
        },
      ];

      const outline = buildOutline({ topic: '演示', format: 'pptx' }, nodes);

      expect(outline.pptConfig).toBeDefined();
      expect(outline.nodes[0].title).toHaveLength(6); // 截断
      expect(outline.nodes[0].bullets).toHaveLength(3); // 截断
    });

    it('非 PPT 格式不附加 pptConfig', () => {
      const outline = buildOutline({ topic: '测试', format: 'html' }, [
        { id: 's1', kind: 'section', title: '标题' },
      ]);
      expect(outline.pptConfig).toBeUndefined();
    });
  });

  // ─── fillContent ─────────────────────────────────────

  describe('fillContent', () => {
    it('填充内容并收集图片占位符', async () => {
      const outline: DocOutline = {
        format: 'docx',
        title: '测试文档',
        createdAt: Date.now(),
        nodes: [
          {
            id: 'sec-1',
            kind: 'section',
            title: '概述',
            content: '',
          },
        ],
      };

      const fillCallback = async (node: DocOutlineNode) => {
        return `这是 ${node.title} 的内容。包含图片 ![图](GENERATE:id=img-1;prompt=画图)`;
      };

      const filled = await fillContent(outline, fillCallback);

      expect(filled.filledAt).toBeGreaterThan(0);
      expect(filled.nodes[0].content).toContain('这是 概述 的内容');
      expect(filled.imageCache.has('img-1')).toBe(true);
      expect(filled.failedNodes).toHaveLength(0);
    });

    it('填充回调失败时记录到 failedNodes', async () => {
      const outline: DocOutline = {
        format: 'docx',
        title: '测试',
        createdAt: Date.now(),
        nodes: [
          { id: 'sec-1', kind: 'section', title: '正常', content: '' },
          { id: 'sec-2', kind: 'section', title: '失败', content: '' },
        ],
      };

      const fillCallback = async (node: DocOutlineNode) => {
        if (node.id === 'sec-2') throw new Error('填充失败');
        return '正常内容';
      };

      const filled = await fillContent(outline, fillCallback);

      expect(filled.failedNodes).toContain('sec-2');
      expect(filled.nodes[0].content).toBe('正常内容');
    });
  });

  // ─── generateImages ──────────────────────────────────

  describe('generateImages', async () => {
    it('生成图片并回填缓存', async () => {
      const outline: DocOutline = {
        format: 'docx',
        title: '测试',
        createdAt: Date.now(),
        nodes: [
          {
            id: 'sec-1',
            kind: 'section',
            title: '概述',
            content: '内容 ![图](GENERATE:id=img-test;prompt=画柱状图)',
          },
        ],
      };

      const filled: any = {
        ...outline,
        filledAt: Date.now(),
        imageCache: new Map([['img-test', '']]), // 待生成
        failedNodes: [],
      };

      const result = await generateImages(filled, {
        generateImage: async (prompt: string) => {
          expect(prompt).toBe('画柱状图');
          return '/output/test-image.png';
        },
      });

      expect(result.imageCache.get('img-test')).toBe('/output/test-image.png');
      expect(result.nodes[0].imageFilePath).toBe('/output/test-image.png');
    });

    it('图片生成失败时降级', async () => {
      const filled: any = {
        format: 'docx',
        title: '测试',
        createdAt: Date.now(),
        nodes: [
          {
            id: 'sec-1',
            kind: 'section',
            title: '概述',
            content: '内容 ![图](GENERATE:id=img-fail;prompt=失败的图)',
          },
        ],
        filledAt: Date.now(),
        imageCache: new Map([['img-fail', '']]),
        failedNodes: [],
      };

      const result = await generateImages(filled, {
        generateImage: async () => {
          throw new Error('生成失败');
        },
      });

      expect(result.imageCache.get('img-fail')).toBe('');
      expect(result.failedNodes).toContain('img:img-fail');
    });
  });

  // ─── compose ─────────────────────────────────────────

  describe('compose', () => {
    it('替换占位符并生成文档', async () => {
      const filled: any = {
        format: 'docx' as const,
        title: '测试文档',
        createdAt: Date.now(),
        nodes: [
          {
            id: 'sec-1',
            kind: 'section',
            title: '概述',
            content: '正文 ![图](GENERATE:id=img-1;prompt=提示词)',
          },
        ],
        filledAt: Date.now(),
        imageCache: new Map([['img-1', '/output/img1.png']]),
        failedNodes: [],
      };

      const result = await compose(filled, async (params) => {
        expect(params.title).toBe('测试文档');
        expect(params.content).toContain('/output/img1.png');
        expect(params.content).not.toContain('GENERATE');
        return { filePath: '/output/test.docx', format: 'docx' };
      });

      expect(result.filePath).toBe('/output/test.docx');
    });

    it('未命中的占位符降级为提示文本', async () => {
      const filled: any = {
        format: 'docx' as const,
        title: '测试',
        createdAt: Date.now(),
        nodes: [
          {
            id: 'sec-1',
            kind: 'section',
            title: '概述',
            content: '正文 ![图](GENERATE:id=img-miss;prompt=未生成)',
          },
        ],
        filledAt: Date.now(),
        imageCache: new Map<string, string>(),
        failedNodes: [],
      };

      const result = await compose(filled, async (params) => {
        expect(params.content).toContain('图片未生成');
        expect(params.content).not.toContain('GENERATE');
        return { filePath: '/output/test.docx', format: 'docx' };
      });

      expect(result.filePath).toBe('/output/test.docx');
    });
  });

  // ─── diffOutline ─────────────────────────────────────

  describe('diffOutline', () => {
    it('检测新增节点', () => {
      const old: DocOutline = {
        format: 'docx',
        title: '测试',
        createdAt: Date.now(),
        nodes: [{ id: 's1', kind: 'section', title: 'A' }],
      };
      const next: DocOutline = {
        format: 'docx',
        title: '测试',
        createdAt: Date.now(),
        nodes: [
          { id: 's1', kind: 'section', title: 'A' },
          { id: 's2', kind: 'section', title: 'B' },
        ],
      };

      const patches = diffOutline(old, next);
      expect(patches).toHaveLength(1);
      expect(patches[0].type).toBe('added');
      expect(patches[0].nodeId).toBe('s2');
    });

    it('检测删除节点', () => {
      const old: DocOutline = {
        format: 'docx',
        title: '测试',
        createdAt: Date.now(),
        nodes: [
          { id: 's1', kind: 'section', title: 'A' },
          { id: 's2', kind: 'section', title: 'B' },
        ],
      };
      const next: DocOutline = {
        format: 'docx',
        title: '测试',
        createdAt: Date.now(),
        nodes: [{ id: 's1', kind: 'section', title: 'A' }],
      };

      const patches = diffOutline(old, next);
      expect(patches).toHaveLength(1);
      expect(patches[0].type).toBe('removed');
      expect(patches[0].nodeId).toBe('s2');
    });

    it('检测修改节点', () => {
      const old: DocOutline = {
        format: 'docx',
        title: '测试',
        createdAt: Date.now(),
        nodes: [{ id: 's1', kind: 'section', title: '旧标题' }],
      };
      const next: DocOutline = {
        format: 'docx',
        title: '测试',
        createdAt: Date.now(),
        nodes: [{ id: 's1', kind: 'section', title: '新标题' }],
      };

      const patches = diffOutline(old, next);
      expect(patches).toHaveLength(1);
      expect(patches[0].type).toBe('modified');
    });

    it('无变更时返回空列表', () => {
      const outline: DocOutline = {
        format: 'docx',
        title: '测试',
        createdAt: Date.now(),
        nodes: [{ id: 's1', kind: 'section', title: 'A' }],
      };

      const patches = diffOutline(outline, { ...outline });
      expect(patches).toHaveLength(0);
    });
  });
});
