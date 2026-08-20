/**
 * PPT 精炼规则（设计方案 §4.6）
 *
 * 四条精炼规则 + 排版约束：
 *  ① 标题字数：每页 ≤6 字（可配置 4-8）
 *  ② 要点条数：每页 ≤3 条（可配置 2-4）
 *  ③ 配图意图：每页应标注是否配图 + 意图描述
 *  ④ 正文提炼：不是截断，而是改写为演讲语言（主语 + 动作 + 结果）
 *
 * 排版约束：16:9，标题区 / 正文区 / 配图区分区
 */

import { getLogger } from '@modules/monitoring';
import type { DocOutlineNode, PptRefineConfig } from '../types/outline';
import { DEFAULT_PPT_CONFIG, validatePptConfig } from '../types/outline';

const logger = getLogger('doc:pptRefiner');

// ─── 精炼结果 ──────────────────────────────────────────

export interface RefineResult {
  /** 精炼后的节点 */
  node: DocOutlineNode;
  /** 精炼规则违反记录 */
  violations: RefineViolation[];
  /** 是否进行了修改 */
  modified: boolean;
}

export interface RefineViolation {
  rule: 'title_length' | 'bullet_count' | 'image_hint' | 'text_refinement';
  message: string;
  /** 原始值 */
  original?: string;
  /** 修正后的值 */
  corrected?: string;
}

// ─── 规则①：标题字数 ──────────────────────────────────

/**
 * 精炼标题：超长时截断并添加省略标记
 * 注意：截断是最后手段，理想情况下应由 LLM 在生成时控制
 */
export function refineTitle(
  title: string,
  config: PptRefineConfig
): { title: string; violation?: RefineViolation } {
  const maxLen = config.maxTitleLength;

  if (title.length <= maxLen) {
    return { title };
  }

  // 截断到最大长度
  const truncated = title.slice(0, maxLen);
  logger.info('pptRefiner:title_truncated', {
    original: title,
    truncated,
    originalLen: title.length,
    maxLen,
  });

  return {
    title: truncated,
    violation: {
      rule: 'title_length',
      message: `标题超长（${title.length}字），已截断至 ${maxLen} 字`,
      original: title,
      corrected: truncated,
    },
  };
}

// ─── 规则②：要点条数 ──────────────────────────────────

/**
 * 精炼要点列表：超条数时保留前 N 条
 */
export function refineBullets(
  bullets: string[] | undefined,
  config: PptRefineConfig
): { bullets: string[] | undefined; violation?: RefineViolation } {
  if (!bullets || bullets.length === 0) {
    return { bullets };
  }

  const maxBullets = config.maxBullets;

  if (bullets.length <= maxBullets) {
    return { bullets };
  }

  const trimmed = bullets.slice(0, maxBullets);
  logger.info('pptRefiner:bullets_trimmed', {
    originalCount: bullets.length,
    trimmedCount: trimmed.length,
    maxBullets,
  });

  return {
    bullets: trimmed,
    violation: {
      rule: 'bullet_count',
      message: `要点超条（${bullets.length}条），已保留前 ${maxBullets} 条`,
      original: bullets.join(' | '),
      corrected: trimmed.join(' | '),
    },
  };
}

// ─── 规则③：配图意图 ──────────────────────────────────

/**
 * 检查配图意图标注
 * enforceImageHint=true 时，缺失 imageHint 的 slide 节点标记违规
 */
export function checkImageHint(
  node: DocOutlineNode,
  config: PptRefineConfig
): RefineViolation | null {
  if (!config.enforceImageHint) return null;

  if (node.kind !== 'slide') return null;

  if (!node.imageHint || node.imageHint.trim() === '') {
    return {
      rule: 'image_hint',
      message: '页面缺少配图意图标注',
    };
  }

  return null;
}

// ─── 规则④：正文提炼 ──────────────────────────────────

/**
 * 检查正文是否为提炼后语言（非原文平铺）
 * 启发式检测：正文超过 200 字或含 3 个以上连续句号时标记需精炼
 */
export function checkTextRefinement(
  content: string | undefined
): RefineViolation | null {
  if (!content) return null;

  // 超过 200 字 → 可能是原文平铺，需精炼
  if (content.length > 200) {
    return {
      rule: 'text_refinement',
      message: `正文过长（${content.length}字），可能未提炼为演讲语言`,
      original: content.slice(0, 50) + '...',
    };
  }

  // 连续句号超过 3 个 → 可能是直接复制段落
  const sentenceCount = (content.match(/。/g) || []).length;
  if (sentenceCount > 3) {
    return {
      rule: 'text_refinement',
      message: `正文含 ${sentenceCount} 个句子，应提炼为主语+动作+结果的演讲语言`,
    };
  }

  return null;
}

// ─── 综合精炼 ──────────────────────────────────────────

/**
 * 对单个大纲节点执行 PPT 精炼规则
 */
export function refineNode(
  node: DocOutlineNode,
  config: Partial<PptRefineConfig> = {}
): RefineResult {
  const validatedConfig = validatePptConfig(config);
  const violations: RefineViolation[] = [];
  let modified = false;

  // 规则①：标题字数
  const titleResult = refineTitle(node.title, validatedConfig);
  let title = node.title;
  if (titleResult.violation) {
    title = titleResult.title;
    violations.push(titleResult.violation);
    modified = true;
  }

  // 规则②：要点条数
  const bulletResult = refineBullets(node.bullets, validatedConfig);
  let bullets = node.bullets;
  if (bulletResult.violation) {
    bullets = bulletResult.bullets;
    violations.push(bulletResult.violation);
    modified = true;
  }

  // 规则③：配图意图
  const imageHintViolation = checkImageHint(node, validatedConfig);
  if (imageHintViolation) {
    violations.push(imageHintViolation);
    // 不自动修改——标注违规由 LLM 或用户补充
  }

  // 规则④：正文提炼
  const textViolation = checkTextRefinement(node.content);
  if (textViolation) {
    violations.push(textViolation);
  }

  return {
    node: {
      ...node,
      title,
      bullets,
    },
    violations,
    modified,
  };
}

/**
 * 对大纲中所有 slide 节点执行 PPT 精炼
 */
export function refineOutline(
  nodes: DocOutlineNode[],
  config: Partial<PptRefineConfig> = {}
): {
  nodes: DocOutlineNode[];
  allViolations: Array<{ nodeId: string; violations: RefineViolation[] }>;
  modifiedCount: number;
} {
  const validatedConfig = validatePptConfig(config);
  const allViolations: Array<{
    nodeId: string;
    violations: RefineViolation[];
  }> = [];
  let modifiedCount = 0;

  const refinedNodes = nodes.map((node) => {
    const result = refineNode(node, validatedConfig);
    if (result.violations.length > 0) {
      allViolations.push({
        nodeId: node.id,
        violations: result.violations,
      });
    }
    if (result.modified) {
      modifiedCount++;
    }
    return result.node;
  });

  logger.info('pptRefiner:refine_outline', {
    totalNodes: nodes.length,
    modifiedCount,
    violationCount: allViolations.length,
  });

  return {
    nodes: refinedNodes,
    allViolations,
    modifiedCount,
  };
}
