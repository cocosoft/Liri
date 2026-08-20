/**
 * PptRefiner 单元测试
 *
 * 覆盖：
 *  - refineTitle：标题字数约束
 *  - refineBullets：要点条数约束
 *  - checkImageHint：配图意图检测
 *  - checkTextRefinement：正文提炼检测
 *  - refineNode：单节点综合精炼
 *  - refineOutline：大纲批量精炼
 *  - validatePptConfig：配置校验
 */

import { describe, it, expect } from 'bun:test';
import {
  refineTitle,
  refineBullets,
  checkImageHint,
  checkTextRefinement,
  refineNode,
  refineOutline,
} from '../../../src/modules/doc/workflow/PptRefiner';
import {
  validatePptConfig,
  DEFAULT_PPT_CONFIG,
} from '../../../src/modules/doc/types/outline';
import type {
  DocOutlineNode,
  PptRefineConfig,
} from '../../../src/modules/doc/types/outline';

describe('PptRefiner', () => {
  const defaultConfig: PptRefineConfig = DEFAULT_PPT_CONFIG;

  // ─── refineTitle ─────────────────────────────────────

  describe('refineTitle', () => {
    it('标题在限制内不截断', () => {
      const { title, violation } = refineTitle('周报', defaultConfig);
      expect(title).toBe('周报');
      expect(violation).toBeUndefined();
    });

    it('超长标题截断至最大长度', () => {
      const { title, violation } = refineTitle(
        '这是一个非常非常长的标题',
        defaultConfig
      );
      expect(title).toHaveLength(6);
      expect(violation).toBeDefined();
      expect(violation!.rule).toBe('title_length');
    });

    it('自定义最大长度生效', () => {
      const config = { ...defaultConfig, maxTitleLength: 8 };
      const { title, violation } = refineTitle('正好是八个字标题', config);
      expect(title).toHaveLength(8);
      expect(violation).toBeUndefined();
    });
  });

  // ─── refineBullets ────────────────────────────────────

  describe('refineBullets', () => {
    it('要点在限制内不截断', () => {
      const { bullets, violation } = refineBullets(
        ['要点1', '要点2'],
        defaultConfig
      );
      expect(bullets).toEqual(['要点1', '要点2']);
      expect(violation).toBeUndefined();
    });

    it('超条要点保留前 N 条', () => {
      const { bullets, violation } = refineBullets(
        ['要点1', '要点2', '要点3', '要点4', '要点5'],
        defaultConfig
      );
      expect(bullets).toHaveLength(3);
      expect(violation).toBeDefined();
      expect(violation!.rule).toBe('bullet_count');
    });

    it('空要点列表返回空', () => {
      const { bullets, violation } = refineBullets([], defaultConfig);
      expect(bullets).toEqual([]);
      expect(violation).toBeUndefined();
    });

    it('undefined 要点返回 undefined', () => {
      const { bullets, violation } = refineBullets(undefined, defaultConfig);
      expect(bullets).toBeUndefined();
      expect(violation).toBeUndefined();
    });
  });

  // ─── checkImageHint ───────────────────────────────────

  describe('checkImageHint', () => {
    it('slide 节点有 imageHint 时不违规', () => {
      const node: DocOutlineNode = {
        id: 's1',
        kind: 'slide',
        title: '标题',
        imageHint: '柱状图',
      };
      expect(checkImageHint(node, defaultConfig)).toBeNull();
    });

    it('slide 节点无 imageHint 时违规', () => {
      const node: DocOutlineNode = {
        id: 's1',
        kind: 'slide',
        title: '标题',
      };
      const violation = checkImageHint(node, defaultConfig);
      expect(violation).not.toBeNull();
      expect(violation!.rule).toBe('image_hint');
    });

    it('非 slide 节点不检查', () => {
      const node: DocOutlineNode = {
        id: 'sec1',
        kind: 'section',
        title: '标题',
      };
      expect(checkImageHint(node, defaultConfig)).toBeNull();
    });

    it('enforceImageHint=false 时不检查', () => {
      const config = { ...defaultConfig, enforceImageHint: false };
      const node: DocOutlineNode = {
        id: 's1',
        kind: 'slide',
        title: '标题',
      };
      expect(checkImageHint(node, config)).toBeNull();
    });
  });

  // ─── checkTextRefinement ──────────────────────────────

  describe('checkTextRefinement', () => {
    it('短正文不违规', () => {
      expect(checkTextRefinement('这是精炼的正文')).toBeNull();
    });

    it('超长正文（>200字）违规', () => {
      const longText = '这是一段很长的正文内容'.repeat(25);
      const violation = checkTextRefinement(longText);
      expect(violation).not.toBeNull();
      expect(violation!.rule).toBe('text_refinement');
    });

    it('含多个句号的正文违规', () => {
      const text = '第一句。第二句。第三句。第四句。';
      const violation = checkTextRefinement(text);
      expect(violation).not.toBeNull();
    });

    it('undefined 正文不违规', () => {
      expect(checkTextRefinement(undefined)).toBeNull();
    });
  });

  // ─── refineNode ───────────────────────────────────────

  describe('refineNode', () => {
    it('合规节点不修改', () => {
      const node: DocOutlineNode = {
        id: 's1',
        kind: 'slide',
        title: '周报',
        bullets: ['要点1', '要点2'],
        imageHint: '柱状图',
        content: '精炼正文',
      };
      const result = refineNode(node, defaultConfig);
      expect(result.modified).toBe(false);
      expect(result.node.title).toBe('周报');
    });

    it('超长标题和超条要点同时修正', () => {
      const node: DocOutlineNode = {
        id: 's1',
        kind: 'slide',
        title: '这是一个超长的标题',
        bullets: ['a', 'b', 'c', 'd', 'e'],
        imageHint: '图表',
      };
      const result = refineNode(node, defaultConfig);
      expect(result.modified).toBe(true);
      expect(result.node.title).toHaveLength(6);
      expect(result.node.bullets).toHaveLength(3);
    });
  });

  // ─── refineOutline ────────────────────────────────────

  describe('refineOutline', () => {
    it('批量精炼多个节点', () => {
      const nodes: DocOutlineNode[] = [
        {
          id: 's1',
          kind: 'slide',
          title: '短标题',
          bullets: ['a'],
          imageHint: '图',
        },
        {
          id: 's2',
          kind: 'slide',
          title: '这是一个超长超长的标题',
          bullets: ['a', 'b', 'c', 'd'],
        },
      ];
      const result = refineOutline(nodes, defaultConfig);
      expect(result.nodes).toHaveLength(2);
      expect(result.nodes[1].title).toHaveLength(6);
      expect(result.nodes[1].bullets).toHaveLength(3);
      expect(result.modifiedCount).toBeGreaterThanOrEqual(1);
    });

    it('无违规节点时 modifiedCount=0', () => {
      const nodes: DocOutlineNode[] = [
        {
          id: 's1',
          kind: 'slide',
          title: '标题',
          bullets: ['a'],
          imageHint: '图',
          content: '短正文',
        },
      ];
      const result = refineOutline(nodes, defaultConfig);
      expect(result.modifiedCount).toBe(0);
    });
  });

  // ─── validatePptConfig ───────────────────────────────

  describe('validatePptConfig', () => {
    it('默认配置合法', () => {
      const config = validatePptConfig({});
      expect(config.maxTitleLength).toBe(6);
      expect(config.maxBullets).toBe(3);
      expect(config.enforceImageHint).toBe(true);
    });

    it('超出范围的值被 clamp 到边界', () => {
      const config = validatePptConfig({
        maxTitleLength: 100,
        maxBullets: -1,
      });
      expect(config.maxTitleLength).toBe(8); // max
      expect(config.maxBullets).toBe(2); // min
    });

    it('边界值合法', () => {
      const config = validatePptConfig({
        maxTitleLength: 4,
        maxBullets: 4,
      });
      expect(config.maxTitleLength).toBe(4);
      expect(config.maxBullets).toBe(4);
    });
  });
});
