// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * KnowledgeSaveTool — knowledge_save（2026-09-01）
 *
 * 知识库保存核心工具：封装系统能力 KnowledgeBaseWriter（frontmatter / 快照 /
 * 去重 / knowledge:changed 事件联动），模型结构化调用（title/content/category/tags）。
 *
 * 架构修正：知识库保存是系统核心能力，注册为工具（模型传参、系统执行），
 * 而非技能（prompt 指引模型用底层 write_file 手写，绕过系统 API）。
 */

import { Tool, ToolInfo, ToolTag } from '../types/Tool';
import { ToolResult, ToolExecutionStatus } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import { createKnowledgeBaseWriter } from '@modules/knowledge/KnowledgeBaseWriter';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('tools:KnowledgeSaveTool');

/**
 * KnowledgeSaveTool参数定义
 */
const KNOWLEDGE_SAVE_PARAMS: Tool['params'] = [
  {
    name: 'title',
    type: 'string',
    description: '文档标题（保存到知识库的文件名）',
    required: true,
  },
  {
    name: 'content',
    type: 'string',
    description: '文档内容（Markdown 格式，整理后的正文）',
    required: true,
  },
  {
    name: 'category',
    type: 'string',
    description: '文档分类（可选）',
    required: false,
  },
  {
    name: 'tags',
    type: 'array',
    description: '文档标签（可选）',
    required: false,
  },
];

/**
 * KnowledgeSaveTool实现
 */
export class KnowledgeSaveTool implements Tool {
  /** 知识库根目录（可注入；默认系统知识库目录） */
  private baseDir?: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir;
  }

  /** 工具名称 */
  readonly name: string = 'knowledge_save';

  /** 工具描述 */
  readonly description: string =
    '将内容保存到用户知识库。用户要求保存文章/网页资料/知识/归档内容/记住某资料时使用。参数：title（标题）+ content（内容）。保存成功或内容已存在时任务即完成，直接向用户确认结果，不要重复调用本工具。';

  /** 工具参数 */
  readonly params = KNOWLEDGE_SAVE_PARAMS;

  /** 搜索提示 */
  readonly searchHint?: string = 'save content to knowledge base';

  /**
   * 获取工具信息
   */
  getInfo(): ToolInfo {
    return {
      name: this.name,
      description: this.description,
      params: this.params,
      aliases: undefined,
      searchTips: undefined,
      enabled: true,
      readOnly: false,
      destructive: false,
      concurrencySafe: true,
      deferred: false,
      alwaysLoad: false,
      interruptBehavior: 'block',
      tags: [ToolTag.AGENT],
    };
  }

  /**
   * 检查工具是否启用
   */
  isEnabled(): boolean {
    return true;
  }

  /**
   * 非只读工具（写入知识库）
   */
  isReadOnly(_input?: Record<string, unknown>): boolean {
    return false;
  }

  /**
   * 非破坏性
   */
  isDestructive(_input?: Record<string, unknown>): boolean {
    return false;
  }

  /**
   * 并发安全
   */
  isConcurrencySafe(_input?: Record<string, unknown>): boolean {
    return true;
  }

  /**
   * 中断行为
   */
  interruptBehavior(): 'cancel' | 'block' {
    return 'block';
  }

  /**
   * 保存内容到知识库
   */
  async execute(
    input: Record<string, unknown>,
    _context?: ToolUseContext
  ): Promise<ToolResult<unknown>> {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const content = typeof input.content === 'string' ? input.content.trim() : '';
    if (!title || !content) {
      return {
        status: ToolExecutionStatus.FAILURE,
        toolName: this.name,
        result: null,
        error: 'knowledge_save 需要 title 和 content 参数',
      };
    }

    // 2026-09-01 P3 防污染校验：模型曾在"请继续"指令下把系统提示词/占位文本
    // 作为 content 保存并覆盖已有文件（action:updated）。检测系统指令协议标记
    // （结构化标记，非业务字符串匹配）：命中即拒绝，防止上下文文本污染知识库。
    const SYSTEM_MARKER_RE =
      /\[(SYSTEM|SYSTEM_PROMPT|STEERING|TOOL RESULT|TOOL_CALL_RESULT|FILE_OPERATION|AVAILABLE_SKILLS|MODEL_CONTEXT|DEEPSEEK|THINKING)\]/i;
    if (
      SYSTEM_MARKER_RE.test(content) ||
      SYSTEM_MARKER_RE.test(title)
    ) {
      logger.warn('knowledge_save 拒绝写入：内容含系统指令标记', {
        title,
        contentPreview: content.slice(0, 80),
      });
      return {
        status: ToolExecutionStatus.FAILURE,
        toolName: this.name,
        result: null,
        error:
          '内容疑似引用系统指令/上下文（检测到 [SYSTEM]/[STEERING]/[FILE_OPERATION] 等标记），已拒绝写入。请提供真实文档内容后重试。',
      };
    }

    return (async () => {
      try {
        const writer = createKnowledgeBaseWriter(this.baseDir);
        const result = await writer.writeEntry({
          title,
          content,
          category:
            typeof input.category === 'string' ? input.category : '',
          tags: Array.isArray(input.tags)
            ? input.tags
                .filter((t): t is string => typeof t === 'string')
                .slice(0, 20)
            : [],
          source: 'ai_tool',
        });

        if (!result.success) {
          logger.warn('knowledge_save 写入失败', {
            title,
            error: result.error,
          });
          return {
            status: ToolExecutionStatus.FAILURE,
            toolName: this.name,
            result: null,
            error: result.error ?? '知识库写入失败',
          };
        }

        logger.info('knowledge_save 成功', {
          title,
          action: result.action,
          filePath: result.filePath,
        });
        const isCreated = result.action === 'created';
        return {
          status: ToolExecutionStatus.SUCCESS,
          toolName: this.name,
          result: {
            success: true,
            title,
            action: result.action,
            filePath: result.filePath,
            // 2026-09-01：明确完成性指引——模型曾在 skipped 后反复重试
            // （换 category/tags 重调）致 no_progress_loop 熔断、最终空正文。
            // 措辞区分"本文档完成"与"整体任务"：组合任务（多个保存请求）中
            // 模型应停止对同一标题的重复调用，但可继续其他子任务。
            message: isCreated
              ? `已成功保存到知识库（标题：${title}）。本文档已完成，请勿对同一标题再次调用本工具；如有其他内容需保存，请使用不同标题。`
              : `文档已存在且内容一致（标题：${title}），本文档无需重复保存。请勿对同一标题再次调用本工具；如有其他内容需保存，请使用不同标题。`,
          },
        };
      } catch (error) {
        const errMsg =
          error instanceof Error ? error.message : String(error);
        logger.warn('knowledge_save 异常', { title, error: errMsg });
        return {
          status: ToolExecutionStatus.FAILURE,
          toolName: this.name,
          result: null,
          error: errMsg,
        };
      }
    })();
  }
}
