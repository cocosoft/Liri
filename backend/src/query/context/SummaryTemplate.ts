/**
 * 结构化摘要模板
 * 对标 Hermes 的结构化摘要 + Resolved/Pending 问题跟踪
 */

/**
 * 问题状态
 */
export type IssueStatus = 'resolved' | 'pending' | 'blocked' | 'deferred';

/**
 * 问题条目
 */
export interface IssueEntry {
  id: string;
  title: string;
  status: IssueStatus;
  description: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * 决策记录
 */
export interface DecisionRecord {
  id: string;
  title: string;
  decision: string;
  rationale: string;
  alternatives: string[];
  timestamp: number;
}

/**
 * 文件变更摘要
 */
export interface FileChangeSummary {
  filePath: string;
  operation: 'created' | 'modified' | 'deleted' | 'read';
  summary: string;
}

/**
 * 结构化摘要
 */
export interface StructuredSummary {
  /** 对话关键点 */
  keyPoints: string[];
  /** 问题列表 */
  issues: IssueEntry[];
  /** 决策记录 */
  decisions: DecisionRecord[];
  /** 文件变更 */
  fileChanges: FileChangeSummary[];
  /** 当前目标 */
  currentGoal: string;
  /** 摘要生成时间 */
  generatedAt: number;
  /** 被压缩的消息范围 */
  compressedRange: { start: number; end: number };
}

/**
 * 摘要模板引擎
 */
export class SummaryTemplate {
  /** Resolved 问题 */
  private resolvedIssues: IssueEntry[] = [];
  /** Pending 问题 */
  private pendingIssues: IssueEntry[] = [];
  /** Blocked 问题 */
  private blockedIssues: IssueEntry[] = [];
  /** 决策记录 */
  private decisions: DecisionRecord[] = [];
  /** 文件变更 */
  private fileChanges: FileChangeSummary[] = [];
  /** 关键点 */
  private keyPoints: string[] = [];
  /** 当前目标 */
  private currentGoal: string = '';

  /**
   * 记录问题
   * @param title 标题
   * @param description 描述
   * @param status 状态
   * @returns 问题 ID
   */
  addIssue(
    title: string,
    description: string,
    status: IssueStatus = 'pending'
  ): string {
    const now = Date.now();
    const id = `issue_${now}_${Math.random().toString(36).slice(2, 8)}`;

    const issue: IssueEntry = {
      id,
      title,
      status,
      description,
      createdAt: now,
      updatedAt: now,
    };

    switch (status) {
      case 'resolved':
        this.resolvedIssues.push(issue);
        this.pendingIssues = this.pendingIssues.filter((i) => i.id !== id);
        break;
      case 'blocked':
        this.blockedIssues.push(issue);
        break;
      default:
        this.pendingIssues.push(issue);
        break;
    }

    return id;
  }

  /**
   * 将问题标记为已解决
   * @param id 问题 ID
   */
  resolveIssue(id: string): void {
    const issue =
      this.pendingIssues.find((i) => i.id === id) ||
      this.blockedIssues.find((i) => i.id === id);

    if (issue) {
      issue.status = 'resolved';
      issue.updatedAt = Date.now();
      this.resolvedIssues.push(issue);
      this.pendingIssues = this.pendingIssues.filter((i) => i.id !== id);
      this.blockedIssues = this.blockedIssues.filter((i) => i.id !== id);
    }
  }

  /**
   * 记录决策
   * @param title 标题
   * @param decision 决策
   * @param rationale 理由
   * @param alternatives 备选方案
   * @returns 决策 ID
   */
  addDecision(
    title: string,
    decision: string,
    rationale: string,
    alternatives: string[] = []
  ): string {
    const id = `decision_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    this.decisions.push({
      id,
      title,
      decision,
      rationale,
      alternatives,
      timestamp: Date.now(),
    });

    return id;
  }

  /**
   * 记录文件变更
   * @param filePath 文件路径
   * @param operation 操作
   * @param summary 摘要
   */
  addFileChange(
    filePath: string,
    operation: FileChangeSummary['operation'],
    summary: string
  ): void {
    this.fileChanges.push({
      filePath,
      operation,
      summary,
    });
  }

  /**
   * 添加关键点
   * @param point 关键点
   */
  addKeyPoint(point: string): void {
    this.keyPoints.push(point);
  }

  /**
   * 设置当前目标
   * @param goal 目标描述
   */
  setCurrentGoal(goal: string): void {
    this.currentGoal = goal;
  }

  /**
   * 生成结构化摘要
   * @param compressedRange 被压缩的消息范围
   * @returns 结构化摘要
   */
  toStructuredSummary(compressedRange: {
    start: number;
    end: number;
  }): StructuredSummary {
    return {
      keyPoints: [...this.keyPoints],
      issues: [
        ...this.resolvedIssues,
        ...this.pendingIssues,
        ...this.blockedIssues,
      ],
      decisions: [...this.decisions],
      fileChanges: [...this.fileChanges],
      currentGoal: this.currentGoal,
      generatedAt: Date.now(),
      compressedRange,
    };
  }

  /**
   * 生成摘要文本（用于注入系统提示）
   * @param summary 结构化摘要
   * @returns 格式化的摘要文本
   */
  formatSummaryText(summary: StructuredSummary): string {
    const lines: string[] = [];

    lines.push('[上下文摘要]');
    lines.push('');

    if (summary.currentGoal) {
      lines.push(`当前目标: ${summary.currentGoal}`);
      lines.push('');
    }

    if (summary.keyPoints.length > 0) {
      lines.push('关键点:');
      for (const point of summary.keyPoints.slice(-10)) {
        lines.push(`  - ${point}`);
      }
      lines.push('');
    }

    if (summary.issues.length > 0) {
      const open = summary.issues.filter((i) => i.status !== 'resolved');
      const resolved = summary.issues.filter((i) => i.status === 'resolved');

      if (open.length > 0) {
        lines.push('待解决问题:');
        for (const issue of open) {
          const statusLabel =
            issue.status === 'blocked' ? '[阻塞]' : '[待处理]';
          lines.push(`  ${statusLabel} ${issue.title}: ${issue.description}`);
        }
        lines.push('');
      }

      if (resolved.length > 0) {
        lines.push(`已解决问题: ${resolved.length} 个`);
        lines.push('');
      }
    }

    if (summary.decisions.length > 0) {
      lines.push('关键决策:');
      for (const decision of summary.decisions.slice(-5)) {
        lines.push(`  - ${decision.title}: ${decision.decision}`);
      }
      lines.push('');
    }

    if (summary.fileChanges.length > 0) {
      lines.push('文件变更:');
      for (const change of summary.fileChanges.slice(-10)) {
        const opLabel = {
          created: '创建',
          modified: '修改',
          deleted: '删除',
          read: '读取',
        }[change.operation];
        lines.push(`  - [${opLabel}] ${change.filePath}: ${change.summary}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * 清除所有记录
   */
  clear(): void {
    this.resolvedIssues = [];
    this.pendingIssues = [];
    this.blockedIssues = [];
    this.decisions = [];
    this.fileChanges = [];
    this.keyPoints = [];
    this.currentGoal = '';
  }

  /**
   * 获取未解决问题数量
   * @returns 数量
   */
  getPendingIssueCount(): number {
    return this.pendingIssues.length + this.blockedIssues.length;
  }
}
