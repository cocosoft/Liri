/**
 * 分阶段文档工作流核心（设计方案 §4）
 *
 * 三阶段流水线：
 *  ① 大纲整理（buildOutline）：生成结构化大纲
 *  ② 内容填充（fillContent + generateImages）：逐节点填充正文 + 生成配图
 *  ③ 成稿（compose）：占位符替换 + 调用 DocGenerateTool 输出文件
 *
 * 流程级确认（大纲确认/图片确认）由本模块内部管理，不经过 DecisionGate（设计方案 §4.5 v0.4 修订）
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { resolveOutputDir } from '@modules/core/paths';
import type {
  DocFormat,
  DocOutline,
  DocOutlineNode,
  FilledOutline,
  OutlinePatch,
  PptRefineConfig,
  DocWorkflowProgressData,
  DocWorkflowStage,
  DocWorkflowStageData,
  DocWorkflowNodeProgress,
} from '../types/outline';
import { DEFAULT_PPT_CONFIG } from '../types/outline';
import {
  parsePlaceholders,
  replacePlaceholders,
  deduplicatePlaceholders,
  buildPlaceholderText,
  generatePlaceholderId,
} from '../placeholder/PlaceholderResolver';
import { refineOutline } from './PptRefiner';

const logger = getLogger('doc:workflow');

// ─── 进度回调 ──────────────────────────────────────────

/** 进度回调函数类型，由调用方注入（通常推送 SSE doc_workflow chunk） */
export type DocWorkflowProgressCallback = (
  data: DocWorkflowProgressData
) => void;

/**
 * 进度发射器：封装三阶段进度状态管理，避免调用方手动组装 DocWorkflowProgressData
 */
export class DocWorkflowProgressEmitter {
  private data: DocWorkflowProgressData;

  constructor(title: string, format: DocFormat) {
    this.data = {
      title,
      format,
      currentStage: 'outline',
      stages: {
        outline: { status: 'pending' },
        filling: { status: 'pending' },
        compose: { status: 'pending' },
      },
    };
  }

  setStage(
    stage: DocWorkflowStage,
    status: DocWorkflowStageData['status'],
    description?: string
  ): void {
    this.data.currentStage = stage;
    this.data.stages[stage].status = status;
    if (description !== undefined) {
      this.data.stages[stage].description = description;
    }
  }

  setProgress(stage: DocWorkflowStage, progress: number): void {
    this.data.stages[stage].progress = Math.round(progress);
  }

  setNodes(stage: DocWorkflowStage, nodes: DocWorkflowNodeProgress[]): void {
    this.data.stages[stage].nodes = nodes;
  }

  setOutputFile(filePath: string): void {
    this.data.outputFilePath = filePath;
  }

  setError(error: string): void {
    this.data.error = error;
  }

  getData(): DocWorkflowProgressData {
    return JSON.parse(JSON.stringify(this.data));
  }

  emit(callback?: DocWorkflowProgressCallback): void {
    if (callback) {
      callback(this.getData());
    }
  }
}

// ─── 阶段输入类型 ──────────────────────────────────────

export interface BuildOutlineInput {
  topic: string;
  format: DocFormat;
  /** 用户自定义 PPT 精炼配置（仅 format=pptx 有效） */
  pptConfig?: Partial<PptRefineConfig>;
}

export interface FillContentOptions {
  /** 内容填充并发度（默认 1，串行） */
  concurrency?: number;
}

export interface GenerateImagesOptions {
  /** 图片生成并发度（默认 3） */
  concurrency?: number;
  /** 图片生成回调（由调用方注入 ImageGenerateTool 执行逻辑） */
  generateImage: (prompt: string) => Promise<string>;
}

export interface ComposeResult {
  filePath: string;
  format: string;
}

// ─── 阶段①：大纲整理 ──────────────────────────────────

/**
 * 构建大纲（阶段①）
 *
 * 此函数不调用 LLM，仅负责结构化组装。
 * LLM 生成的原始大纲由调用方传入，本函数负责：
 *  - 分配占位符 ID（imageHint → placeholder）
 *  - PPT 精炼规则校验
 *  - 返回结构化 DocOutline
 */
export function buildOutline(
  input: BuildOutlineInput,
  llmNodes: DocOutlineNode[]
): DocOutline {
  const { topic, format, pptConfig } = input;

  // 为 imageHint 非空的节点分配占位符
  const nodes = assignPlaceholders(llmNodes);

  // PPT 精炼规则校验（仅 pptx 格式）
  let finalNodes = nodes;
  if (format === 'pptx') {
    const result = refineOutline(nodes, pptConfig);
    finalNodes = result.nodes;
    if (result.allViolations.length > 0) {
      logger.info('docWorkflow:buildOutline_ppt_violations', {
        topic,
        violationCount: result.allViolations.length,
        modifiedCount: result.modifiedCount,
      });
    }
  }

  const outline: DocOutline = {
    format,
    title: topic,
    nodes: finalNodes,
    createdAt: Date.now(),
    pptConfig:
      format === 'pptx' ? { ...DEFAULT_PPT_CONFIG, ...pptConfig } : undefined,
  };

  logger.info('docWorkflow:buildOutline_done', {
    topic,
    format,
    nodeCount: finalNodes.length,
  });

  return outline;
}

// ─── 阶段②：内容填充 ──────────────────────────────────

/**
 * 填充大纲内容（阶段②）
 *
 * 对每个节点调用 fillNodeCallback 获取正文内容，
 * 将内容中的图片占位符标记到 imageCache 待生成。
 *
 * @param fillNodeCallback 调用方注入的节点内容填充回调（通常调 LLM）
 */
export async function fillContent(
  outline: DocOutline,
  fillNodeCallback: (node: DocOutlineNode) => Promise<string>,
  opts?: FillContentOptions
): Promise<FilledOutline> {
  const concurrency = opts?.concurrency ?? 1;
  const imageCache = new Map<string, string>();
  const failedNodes: string[] = [];

  // 串行或并发填充
  if (concurrency <= 1) {
    for (const node of outline.nodes) {
      await fillSingleNode(node, fillNodeCallback, imageCache, failedNodes);
    }
  } else {
    // 并发填充：分批处理
    const batches = chunkArray(outline.nodes, concurrency);
    for (const batch of batches) {
      await Promise.all(
        batch.map((node) =>
          fillSingleNode(node, fillNodeCallback, imageCache, failedNodes)
        )
      );
    }
  }

  const filled: FilledOutline = {
    ...outline,
    filledAt: Date.now(),
    imageCache,
    failedNodes,
  };

  logger.info('docWorkflow:fillContent_done', {
    title: outline.title,
    nodeCount: outline.nodes.length,
    failedCount: failedNodes.length,
    imagePlaceholderCount: imageCache.size,
  });

  return filled;
}

async function fillSingleNode(
  node: DocOutlineNode,
  fillNodeCallback: (node: DocOutlineNode) => Promise<string>,
  imageCache: Map<string, string>,
  failedNodes: string[]
): Promise<void> {
  try {
    const content = await fillNodeCallback(node);
    node.content = content;

    // 解析内容中的占位符，预注册到 imageCache（值为空，待 generateImages 填充）
    const placeholders = parsePlaceholders(content);
    for (const ph of placeholders) {
      if (!imageCache.has(ph.id)) {
        imageCache.set(ph.id, ''); // 占位，待 generateImages 填充实际路径
      }
    }
  } catch (err) {
    await handleError(err, {
      module: 'doc:workflow',
      action: 'fillContent_node',
      context: { nodeId: node.id, nodeTitle: node.title },
    });
    failedNodes.push(node.id);
  }
}

// ─── 阶段②辅助：图片生成 ──────────────────────────────

/**
 * 生成图片并回填缓存（阶段②辅助）
 *
 * 遍历 imageCache 中值为空的占位符，调用 generateImage 生成图片，
 * 按 id 去重后并发执行。
 */
export async function generateImages(
  filled: FilledOutline,
  opts: GenerateImagesOptions
): Promise<FilledOutline> {
  const { generateImage } = opts;

  // 收集待生成的占位符（imageCache 中值为空）
  const pendingIds: string[] = [];
  for (const [id, filePath] of filled.imageCache) {
    if (!filePath) {
      pendingIds.push(id);
    }
  }

  if (pendingIds.length === 0) {
    logger.info('docWorkflow:generateImages_no_pending', {
      title: filled.title,
    });
    return filled;
  }

  logger.info('docWorkflow:generateImages_start', {
    title: filled.title,
    pendingCount: pendingIds.length,
  });

  // 并发生成（受 concurrency 限制）
  const concurrency = opts.concurrency ?? 3;
  const batches = chunkArray(pendingIds, concurrency);

  for (const batch of batches) {
    await Promise.all(
      batch.map(async (id) => {
        try {
          // 查找该 id 对应的 prompt（从节点内容中解析）
          const prompt = findPromptById(filled.nodes, id);
          if (!prompt) {
            logger.warn('docWorkflow:generateImages_prompt_not_found', { id });
            return;
          }

          const filePath = await generateImage(prompt.prompt);
          filled.imageCache.set(id, filePath);

          // 回填到节点的 imageFilePath
          const node = findNodeByPlaceholderId(filled.nodes, id);
          if (node) {
            node.imageFilePath = filePath;
          }

          logger.debug('docWorkflow:generateImages_done', {
            id,
            filePath,
          });
        } catch (err) {
          await handleError(err, {
            module: 'doc:workflow',
            action: 'generateImages_single',
            context: { placeholderId: id },
          });
          // 降级：保留空值占位符，人工插图
          if (!filled.failedNodes.includes(`img:${id}`)) {
            filled.failedNodes.push(`img:${id}`);
          }
        }
      })
    );
  }

  logger.info('docWorkflow:generateImages_complete', {
    title: filled.title,
    generated: filled.imageCache.size - pendingIds.length + 1,
    failed: filled.failedNodes.filter((n) => n.startsWith('img:')).length,
  });

  return filled;
}

// ─── 阶段③：成稿 ──────────────────────────────────────

/**
 * 成稿（阶段③）：占位符替换 + 调用 doc_generate
 *
 * @param generateDocCallback 调用方注入的文档生成回调（通常调 DocGenerateTool）
 */
export async function compose(
  filled: FilledOutline,
  generateDocCallback: (params: {
    title: string;
    content: string;
    format: DocFormat;
  }) => Promise<{ filePath: string; format: string }>
): Promise<ComposeResult> {
  // 将大纲序列化为 Markdown 内容（含已替换的图片）
  const content = serializeOutlineToMarkdown(filled);

  // 执行占位符替换（图片缓存中非空的替换为 filePath）
  const { replaced, missed } = replacePlaceholders(content, filled.imageCache);

  if (missed.length > 0) {
    logger.warn('docWorkflow:compose_placeholders_missed', {
      title: filled.title,
      missedCount: missed.length,
      missedIds: missed.map((m) => m.id),
    });
    // 降级：未命中的占位符替换为提示文本
    let degraded = replaced;
    for (const ph of missed) {
      degraded = degraded.replace(ph.raw, `[图片未生成：${ph.description}]`);
    }
    const result = await generateDocCallback({
      title: filled.title,
      content: degraded,
      format: filled.format,
    });
    return result;
  }

  const result = await generateDocCallback({
    title: filled.title,
    content: replaced,
    format: filled.format,
  });

  logger.info('docWorkflow:compose_done', {
    title: filled.title,
    filePath: result.filePath,
    format: result.format,
  });

  return result;
}

// ─── 全流程编排（含进度推送） ──────────────────────────

export interface RunDocWorkflowOptions {
  fillNode: (node: DocOutlineNode) => Promise<string>;
  generateImage: (prompt: string) => Promise<string>;
  generateDoc: (params: {
    title: string;
    content: string;
    format: DocFormat;
  }) => Promise<{ filePath: string; format: string }>;
  fillConcurrency?: number;
  imageConcurrency?: number;
  onProgress?: DocWorkflowProgressCallback;
  confirmOutline?: (outline: DocOutline) => Promise<boolean>;
}

/**
 * 全流程编排：大纲 → 内容填充+配图 → 成稿
 * 封装三阶段进度推送，调用方注入各阶段回调
 */
export async function runDocWorkflow(
  input: BuildOutlineInput,
  llmNodes: DocOutlineNode[],
  opts: RunDocWorkflowOptions
): Promise<ComposeResult> {
  const emitter = new DocWorkflowProgressEmitter(input.topic, input.format);

  // 阶段①：大纲整理
  emitter.setStage('outline', 'in_progress', '正在生成大纲');
  emitter.emit(opts.onProgress);

  const outline = buildOutline(input, llmNodes);

  emitter.setStage('outline', 'awaiting_confirm', '大纲已生成，等待确认');
  emitter.emit(opts.onProgress);

  if (opts.confirmOutline) {
    const confirmed = await opts.confirmOutline(outline);
    if (!confirmed) {
      emitter.setStage('outline', 'failed', '用户取消');
      emitter.emit(opts.onProgress);
      throw new Error('用户取消大纲');
    }
  }
  emitter.setStage('outline', 'completed');
  emitter.emit(opts.onProgress);

  // 阶段②：内容填充
  emitter.setStage('filling', 'in_progress', '正在填充内容');
  emitter.setNodes(
    'filling',
    outline.nodes.map((n) => ({
      id: n.id,
      title: n.title,
      status: 'pending' as const,
      hasImage: !!n.imageHint,
    }))
  );
  emitter.emit(opts.onProgress);

  const totalNodes = outline.nodes.length;
  let filledCount = 0;
  const filled = await fillContent(
    outline,
    async (node) => {
      const content = await opts.fillNode(node);
      filledCount++;
      emitter.setProgress(
        'filling',
        Math.round((filledCount / totalNodes) * 100)
      );
      emitter.emit(opts.onProgress);
      return content;
    },
    { concurrency: opts.fillConcurrency }
  );

  // 阶段②辅助：图片生成
  await generateImages(filled, {
    generateImage: opts.generateImage,
    concurrency: opts.imageConcurrency,
  });

  emitter.setStage('filling', 'completed', '内容填充完成');
  emitter.emit(opts.onProgress);

  // 阶段③：成稿
  emitter.setStage('compose', 'in_progress', '正在生成文档');
  emitter.emit(opts.onProgress);

  try {
    const result = await compose(filled, opts.generateDoc);
    emitter.setOutputFile(result.filePath);
    emitter.setStage('compose', 'completed', '文档生成完成');
    emitter.emit(opts.onProgress);
    return result;
  } catch (err) {
    emitter.setStage('compose', 'failed', '文档生成失败');
    emitter.setError(String(err));
    emitter.emit(opts.onProgress);
    throw err;
  }
}

// ─── 增量更新（v0.4 §4.4） ────────────────────────────

/**
 * 大纲变更增量更新
 * 对比新旧大纲，生成 Patch 列表
 */
export function diffOutline(old: DocOutline, next: DocOutline): OutlinePatch[] {
  const patches: OutlinePatch[] = [];
  const oldMap = new Map(old.nodes.map((n) => [n.id, n]));
  const nextMap = new Map(next.nodes.map((n) => [n.id, n]));

  // 新增节点
  for (const [id, node] of nextMap) {
    if (!oldMap.has(id)) {
      patches.push({ type: 'added', nodeId: id, node });
    }
  }

  // 删除节点
  for (const [id] of oldMap) {
    if (!nextMap.has(id)) {
      patches.push({ type: 'removed', nodeId: id });
    }
  }

  // 修改节点
  for (const [id, node] of nextMap) {
    const oldNode = oldMap.get(id);
    if (oldNode && JSON.stringify(oldNode) !== JSON.stringify(node)) {
      patches.push({ type: 'modified', nodeId: id, node });
    }
  }

  logger.info('docWorkflow:diffOutline', {
    added: patches.filter((p) => p.type === 'added').length,
    removed: patches.filter((p) => p.type === 'removed').length,
    modified: patches.filter((p) => p.type === 'modified').length,
  });

  return patches;
}

// ─── 辅助函数 ──────────────────────────────────────────

/**
 * 为大纲节点分配占位符
 * imageHint 非空的节点自动生成占位符
 */
function assignPlaceholders(nodes: DocOutlineNode[]): DocOutlineNode[] {
  return nodes.map((node) => {
    if (node.imageHint && node.imageHint.trim()) {
      const id = generatePlaceholderId();
      const placeholder = buildPlaceholderText(
        node.imageHint,
        id,
        node.imageHint
      );
      return { ...node, placeholder };
    }

    // 递归处理子节点
    if (node.children) {
      return {
        ...node,
        children: assignPlaceholders(node.children),
      };
    }

    return node;
  });
}

/**
 * 将填充后的大纲序列化为 Markdown（含占位符）
 */
function serializeOutlineToMarkdown(filled: FilledOutline): string {
  const lines: string[] = [];

  lines.push(`# ${filled.title}`);
  lines.push('');

  for (const node of filled.nodes) {
    lines.push(...serializeNode(node, 2));
  }

  return lines.join('\n');
}

function serializeNode(node: DocOutlineNode, indent: number): string[] {
  const lines: string[] = [];
  const prefix = '#'.repeat(Math.min(indent, 6));

  if (node.kind === 'section' || node.kind === 'text') {
    lines.push(`${prefix} ${node.title}`);
    lines.push('');
  } else if (node.kind === 'slide') {
    lines.push(`${prefix} ${node.title}`);
  }

  if (node.bullets && node.bullets.length > 0) {
    for (const bullet of node.bullets) {
      lines.push(`- ${bullet}`);
    }
    lines.push('');
  }

  if (node.content) {
    lines.push(node.content);
    lines.push('');
  }

  if (node.placeholder) {
    lines.push(node.placeholder);
    lines.push('');
  }

  if (node.children) {
    for (const child of node.children) {
      lines.push(...serializeNode(child, indent + 1));
    }
  }

  return lines;
}

/**
 * 查找占位符 ID 对应的 prompt
 */
function findPromptById(
  nodes: DocOutlineNode[],
  id: string
): { prompt: string; description: string } | null {
  for (const node of nodes) {
    // 从节点内容中解析占位符
    if (node.content) {
      const placeholders = parsePlaceholders(node.content);
      const found = placeholders.find((ph) => ph.id === id);
      if (found) {
        return { prompt: found.prompt, description: found.description };
      }
    }
    // 从占位符字段解析
    if (node.placeholder) {
      const placeholders = parsePlaceholders(node.placeholder);
      const found = placeholders.find((ph) => ph.id === id);
      if (found) {
        return { prompt: found.prompt, description: found.description };
      }
    }
    // 递归子节点
    if (node.children) {
      const result = findPromptById(node.children, id);
      if (result) return result;
    }
  }
  return null;
}

/**
 * 查找占位符 ID 对应的节点
 */
function findNodeByPlaceholderId(
  nodes: DocOutlineNode[],
  id: string
): DocOutlineNode | null {
  for (const node of nodes) {
    if (node.placeholder) {
      const placeholders = parsePlaceholders(node.placeholder);
      if (placeholders.some((ph) => ph.id === id)) {
        return node;
      }
    }
    if (node.content) {
      const placeholders = parsePlaceholders(node.content);
      if (placeholders.some((ph) => ph.id === id)) {
        return node;
      }
    }
    if (node.children) {
      const result = findNodeByPlaceholderId(node.children, id);
      if (result) return result;
    }
  }
  return null;
}

/**
 * 数组分块
 */
function chunkArray<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
