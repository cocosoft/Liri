// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * projectContext 段落的三个**纯组装辅助**（P3-2 拆分，从 `builtinSections.ts` 原样外移）。
 *
 * 只负责「读数据 → 拼字符串」，全部失败路径沿用原语义（静默降级为 ''，不阻断 prompt 组装）。
 * 段落主体（null 判定 / 4000 字截断 / 工具约定）仍留在 `builtinSections.projectContext`。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { resolveDataDir } from '@openliri/infra/environment';
import { createProjectStore } from '../../workspace/ProjectStore.js';
import { WorkItemStore } from '../../workspace/WorkItemStore.js';

// P1-2: 模块级单例，避免每次组装 prompt 都 new ProjectStore/WorkItemStore
// （与 WriteProjectFileTool 的 P4-1 单例模式一致；若 dataDir 运行时变化需重新初始化）
let _promptWorkItemStore: WorkItemStore | null = null;
let _promptProjectStore: ReturnType<typeof createProjectStore> | null = null;
function getPromptProjectStore() {
  if (!_promptWorkItemStore || !_promptProjectStore) {
    const dataDir = resolveDataDir();
    _promptWorkItemStore = new WorkItemStore(dataDir);
    _promptProjectStore = createProjectStore(dataDir, _promptWorkItemStore);
  }
  return _promptProjectStore;
}

/**
 * S5b：项目阶段与进度（来自 ProjectStore）。
 *
 * 查询失败只留空（`''`）—— prompt 组装不得因项目库异常而中断。
 */
export function buildProjectPhaseInfo(projectId: string): string {
  let phaseInfo = '';
  try {
    // P1-2: 复用模块级单例，避免每次组装都 new store + require
    const store = getPromptProjectStore();
    const project = store.get(projectId);
    if (project) {
      const phaseLabel: Record<string, string> = {
        plan: '规划中',
        do: '执行中',
        check: '审查中',
        act: '反馈中',
        active: '活跃',
        completed: '已完成',
      };
      const pdcaCount = project.pdcaIds?.length ?? 0;
      const workItemCount = project.workItemIds?.length ?? 0;
      const lines: string[] = [];
      lines.push(
        `**阶段**: ${phaseLabel[project.phase ?? 'active'] ?? project.phase ?? '活跃'}`
      );
      if (pdcaCount > 0) lines.push(`**PDCA 任务**: ${pdcaCount} 个`);
      if (workItemCount > 0) lines.push(`**工作项**: ${workItemCount} 个`);
      if (project.status === 'completed') lines.push('**状态**: 已完成');
      if (lines.length > 0) {
        phaseInfo = '\n\n## 项目状态\n\n' + lines.join('\n');
      }
    }
  } catch {
    // @ignore-catch ProjectStore 查询失败不影响 prompt 组装主流程
  }
  return phaseInfo;
}

/**
 * P3-5：最近摘要（最近 1 条阶段性小结 + 2 条决策）。
 *
 * 注：本 section 为同步构建（DANGEROUS_uncached），无法 await items.db；
 * 已迁移项目的摘要经 handleGetSummaries（HTTP 读回退 items.db）与
 * SessionSummarizer（写分流进 items.db）保障可见，此处仅同步读 summaries.json。
 */
export function buildProjectSummaryInfo(projectId: string): string {
  let summaryInfo = '';
  try {
    const summariesPath = join(
      resolveDataDir(),
      'projects',
      projectId,
      'summaries.json'
    );
    let all: Array<{
      type?: string;
      title?: string;
      content?: string;
    }> = [];
    if (existsSync(summariesPath)) {
      const raw = readFileSync(summariesPath, 'utf-8');
      // G-2 修复：兼容写入者结构。SessionSummarizer 写的是 SummaryEntry
      // （{sessionId, summary, messageCount, createdAt, decision?, phaseSummary?}，
      // 无 type 字段），原实现按 s.type==='decision'/'phase_summary' 过滤恒空 →
      // AI 上下文永远看不到项目最近小结/决策。此处归一化为 {type,title,content}。
      const rawEntries = JSON.parse(raw) as Array<Record<string, unknown>>;
      all = rawEntries
        .map((s) => {
          if (s.decision) {
            return {
              type: 'decision',
              title: '决策',
              content: String(s.decision),
            };
          }
          if (s.phaseSummary) {
            return {
              type: 'phase_summary',
              title: '阶段性小结',
              content: String(s.summary ?? ''),
            };
          }
          if (typeof s.type === 'string') {
            return {
              type: s.type,
              title: String(s.title ?? ''),
              content: String(s.content ?? ''),
            };
          }
          return null;
        })
        .filter(
          (x): x is { type: string; title: string; content: string } =>
            x !== null
        );
    }
    const decisions = all.filter((s) => s.type === 'decision').slice(-2);
    const phaseSummaries = all
      .filter((s) => s.type === 'phase_summary')
      .slice(-1);

    const lines: string[] = [];
    if (phaseSummaries.length > 0) {
      lines.push('## 最近阶段性小结');
      for (const s of phaseSummaries) {
        lines.push(
          `- ${s.title ?? '小结'}: ${(s.content ?? '').slice(0, 150)}`
        );
      }
    }
    if (decisions.length > 0) {
      lines.push('## 最近决策');
      for (const d of decisions) {
        lines.push(
          `- ${d.title ?? '决策'}: ${(d.content ?? '').slice(0, 100)}`
        );
      }
    }
    if (lines.length > 0) {
      summaryInfo = '\n\n' + lines.join('\n');
    }
  } catch {
    // @ignore-catch 读取摘要失败不影响 prompt 组装主流程
  }
  return summaryInfo;
}

/**
 * 扫描项目文件夹，列出子目录与前 20 个文件（带大小）。
 *
 * 目录不存在 / 扫描失败 ⇒ `''`（不出现文件列表）。
 */
export function buildProjectFileList(sandboxPath: string | undefined): string {
  let fileList = '';
  if (sandboxPath && existsSync(sandboxPath)) {
    try {
      const entries = readdirSync(sandboxPath, { withFileTypes: true });
      const BUILTIN_SECTION_MAX_FILES = 20;
      const files = entries
        .filter((e) => e.isFile())
        .slice(0, BUILTIN_SECTION_MAX_FILES);
      const dirs = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .slice(0, 5);

      if (files.length > 0 || dirs.length > 0) {
        const lines: string[] = ['**项目文件**：'];
        for (const d of dirs) {
          lines.push(`- ${d.name}/`);
        }
        for (const f of files) {
          try {
            const size = statSync(join(sandboxPath, f.name)).size;
            const sizeStr =
              size < 1024
                ? `${size}B`
                : size < 1024 * 1024
                  ? `${(size / 1024).toFixed(0)}KB`
                  : `${(size / (1024 * 1024)).toFixed(1)}MB`;
            lines.push(`- ${f.name} (${sizeStr})`);
          } catch {
            // @ignore-catch 单个文件 stat 失败仅回退无大小展示
            lines.push(`- ${f.name}`);
          }
        }
        if (
          entries.filter((e) => e.isFile()).length > BUILTIN_SECTION_MAX_FILES
        ) {
          lines.push(
            `(+${entries.filter((e) => e.isFile()).length - BUILTIN_SECTION_MAX_FILES} 个文件未列出)`
          );
        }
        fileList = '\n' + lines.join('\n');
      }
    } catch {
      // @ignore-catch 目录扫描失败不影响 prompt 组装主流程
    }
  }
  return fileList;
}
