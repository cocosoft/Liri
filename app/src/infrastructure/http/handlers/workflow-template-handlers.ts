/**
 * 工作流模板市场 API Handler
 *
 * 管理内建和用户自定义的工作流模板：
 * - GET    /v1/workflows/templates  — 列出所有模板
 * - GET    /v1/workflows/templates/:id  — 获取模板详情
 * - POST   /v1/workflows/templates  — 创建模板
 * - PUT    /v1/workflows/templates/:id  — 更新模板
 * - DELETE /v1/workflows/templates/:id  — 删除模板
 */

import type http from 'http';
import type { HandlerCtx } from './handler-utils';
import { handleError } from '@modules/error';
import { getLogger } from '@modules/monitoring';
import type { WorkflowTemplate } from '@modules/workspace/types';

const logger = getLogger('http:workflowTemplate');

/** 内建工作流模板 */
const BUILTIN_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'builtin:bug-fix',
    name: 'Bug 修复',
    description: '标准的 Bug 修复工作流：复现 → 定位 → 修复 → 验证 → 回归',
    category: 'development',
    steps: [
      {
        id: 'reproduce',
        name: '复现问题',
        description: '复现 Bug 并确认环境',
        type: 'manual',
      },
      {
        id: 'locate',
        name: '定位根因',
        description: '分析代码定位根本原因',
        type: 'auto',
        dependsOn: ['reproduce'],
        suggestedAgentRole: 'researcher',
      },
      {
        id: 'fix',
        name: '编写修复',
        description: '编写修复代码',
        type: 'auto',
        dependsOn: ['locate'],
        suggestedAgentRole: 'coder',
      },
      {
        id: 'review',
        name: '代码审查',
        description: '审查修复代码',
        type: 'review',
        dependsOn: ['fix'],
        suggestedAgentRole: 'reviewer',
      },
      {
        id: 'verify',
        name: '验证修复',
        description: '运行测试验证修复',
        type: 'auto',
        dependsOn: ['review'],
        suggestedAgentRole: 'tester',
      },
      {
        id: 'regression',
        name: '回归测试',
        description: '确保不引入新问题',
        type: 'auto',
        dependsOn: ['verify'],
        suggestedAgentRole: 'tester',
      },
    ],
    author: 'system',
    isPublic: true,
    usageCount: 0,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    tags: ['bug', 'fix', 'standard'],
  },
  {
    id: 'builtin:feature',
    name: '新功能开发',
    description: '从需求分析到交付的新功能开发流程',
    category: 'development',
    steps: [
      {
        id: 'analysis',
        name: '需求分析',
        description: '分析需求，拆解任务',
        type: 'manual',
      },
      {
        id: 'design',
        name: '方案设计',
        description: '设计技术方案',
        type: 'auto',
        dependsOn: ['analysis'],
        suggestedAgentRole: 'planner',
      },
      {
        id: 'implement',
        name: '编码实现',
        description: '实现核心逻辑',
        type: 'auto',
        dependsOn: ['design'],
        suggestedAgentRole: 'coder',
      },
      {
        id: 'test',
        name: '编写测试',
        description: '编写单元测试和集成测试',
        type: 'auto',
        dependsOn: ['implement'],
        suggestedAgentRole: 'tester',
      },
      {
        id: 'review',
        name: '代码审查',
        description: '审查代码质量',
        type: 'review',
        dependsOn: ['test'],
        suggestedAgentRole: 'reviewer',
      },
      {
        id: 'docs',
        name: '更新文档',
        description: '更新相关文档',
        type: 'manual',
        dependsOn: ['review'],
      },
    ],
    author: 'system',
    isPublic: true,
    usageCount: 0,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    tags: ['feature', 'development', 'standard'],
  },
  {
    id: 'builtin:refactor',
    name: '代码重构',
    description: '安全的代码重构工作流：分析 → 设计 → 重构 → 测试 → 审查',
    category: 'maintenance',
    steps: [
      {
        id: 'analyze',
        name: '分析现有代码',
        description: '分析需要重构的代码结构和依赖',
        type: 'auto',
        suggestedAgentRole: 'researcher',
      },
      {
        id: 'design',
        name: '设计重构方案',
        description: '设计目标架构和迁移路径',
        type: 'auto',
        dependsOn: ['analyze'],
        suggestedAgentRole: 'planner',
      },
      {
        id: 'refactor',
        name: '执行重构',
        description: '逐步重构代码',
        type: 'auto',
        dependsOn: ['design'],
        suggestedAgentRole: 'coder',
      },
      {
        id: 'test',
        name: '验证测试',
        description: '确保所有测试通过',
        type: 'auto',
        dependsOn: ['refactor'],
        suggestedAgentRole: 'tester',
      },
      {
        id: 'review',
        name: '审查变更',
        description: '审查重构后的代码',
        type: 'review',
        dependsOn: ['test'],
        suggestedAgentRole: 'reviewer',
      },
    ],
    author: 'system',
    isPublic: true,
    usageCount: 0,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    tags: ['refactor', 'maintenance', 'standard'],
  },
  {
    id: 'builtin:db-migration',
    name: '数据库迁移',
    description: '安全的数据库迁移工作流：备份 → 编写脚本 → 评审 → 执行 → 验证',
    category: 'database',
    steps: [
      {
        id: 'backup',
        name: '备份数据库',
        description: '创建数据库备份',
        type: 'manual',
      },
      {
        id: 'script',
        name: '编写迁移脚本',
        description: '编写 SQL 迁移脚本',
        type: 'auto',
        dependsOn: ['backup'],
        suggestedAgentRole: 'coder',
      },
      {
        id: 'review',
        name: '评审迁移方案',
        description: '评审迁移脚本的安全性',
        type: 'review',
        dependsOn: ['script'],
        suggestedAgentRole: 'reviewer',
      },
      {
        id: 'migrate',
        name: '执行迁移',
        description: '执行数据库迁移',
        type: 'manual',
        dependsOn: ['review'],
      },
      {
        id: 'verify',
        name: '验证数据完整性',
        description: '验证迁移后的数据完整性',
        type: 'auto',
        dependsOn: ['migrate'],
        suggestedAgentRole: 'tester',
      },
      {
        id: 'rollback',
        name: '回滚预案',
        description: '准备回滚脚本',
        type: 'manual',
        dependsOn: ['script'],
      },
    ],
    author: 'system',
    isPublic: true,
    usageCount: 0,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    tags: ['database', 'migration', 'standard'],
  },
];

/** 用户自定义模板存储（内存） */
const userTemplates: Map<string, WorkflowTemplate> = new Map();

/**
 * 列出所有模板
 * GET /v1/workflows/templates
 */
export async function handleListWorkflowTemplates(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const all = [...BUILTIN_TEMPLATES, ...Array.from(userTemplates.values())];

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(all));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'list_workflow_templates',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Failed to list workflow templates' },
        })
      );
    }
  }
}

/**
 * 获取模板详情
 * GET /v1/workflows/templates/:id
 */
export async function handleGetWorkflowTemplate(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  templateId: string
): Promise<void> {
  try {
    const template =
      BUILTIN_TEMPLATES.find((t) => t.id === templateId) ||
      userTemplates.get(templateId);

    if (!template) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Template not found' } }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(template));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'get_workflow_template',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Failed to get workflow template' },
        })
      );
    }
  }
}

/**
 * 创建模板
 * POST /v1/workflows/templates
 */
export async function handleCreateWorkflowTemplate(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const data = JSON.parse(body || '{}');

    if (!data.name || !data.steps) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'name and steps are required' } })
      );
      return;
    }

    const template: WorkflowTemplate = {
      id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: data.name,
      description: data.description || '',
      category: data.category || 'custom',
      steps: data.steps,
      author: data.author || 'user',
      isPublic: data.isPublic || false,
      usageCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tags: data.tags,
    };

    userTemplates.set(template.id, template);
    logger.info('工作流模板已创建', {
      templateId: template.id,
      name: template.name,
    });

    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(template));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'create_workflow_template',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Failed to create workflow template' },
        })
      );
    }
  }
}

/**
 * 更新模板
 * PUT /v1/workflows/templates/:id
 */
export async function handleUpdateWorkflowTemplate(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  templateId: string
): Promise<void> {
  try {
    // 内建模板不可修改
    if (templateId.startsWith('builtin:')) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'Cannot modify builtin template' } })
      );
      return;
    }

    const existing = userTemplates.get(templateId);
    if (!existing) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Template not found' } }));
      return;
    }

    const body = await ctx.readRequestBody(req);
    const data = JSON.parse(body || '{}');

    const updated: WorkflowTemplate = {
      ...existing,
      name: data.name || existing.name,
      description: data.description || existing.description,
      category: data.category || existing.category,
      steps: data.steps || existing.steps,
      isPublic: data.isPublic !== undefined ? data.isPublic : existing.isPublic,
      tags: data.tags || existing.tags,
      updatedAt: new Date().toISOString(),
    };

    userTemplates.set(templateId, updated);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(updated));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'update_workflow_template',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Failed to update workflow template' },
        })
      );
    }
  }
}

/**
 * 删除模板
 * DELETE /v1/workflows/templates/:id
 */
export async function handleDeleteWorkflowTemplate(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  templateId: string
): Promise<void> {
  try {
    if (templateId.startsWith('builtin:')) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'Cannot delete builtin template' } })
      );
      return;
    }

    if (!userTemplates.has(templateId)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Template not found' } }));
      return;
    }

    userTemplates.delete(templateId);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'delete_workflow_template',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Failed to delete workflow template' },
        })
      );
    }
  }
}
