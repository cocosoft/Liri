/**
 * 成本团队/部门维度报表
 * 为 CostReporter 增加团队/部门维度的成本分摊能力
 */

/**
 * 部门报表条目
 */
export interface DepartmentCostEntry {
  department: string;
  costUSD: number;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
  percentage: number;
}

/**
 * 团队报表条目
 */
export interface TeamCostEntry {
  team: string;
  department: string;
  costUSD: number;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
  percentage: number;
}

/**
 * 成本分摊报表
 */
export interface CostAllocationReport {
  period: { start: Date; end: Date };
  totalCost: number;
  totalRequests: number;
  departments: DepartmentCostEntry[];
  teams: TeamCostEntry[];
  generatedAt: number;
}

/**
 * 团队/部门成本管理器
 */
export class DepartmentCostReporter {
  private departmentCosts: Map<
    string,
    {
      cost: number;
      inputTokens: number;
      outputTokens: number;
      requests: number;
    }
  > = new Map();
  private teamCosts: Map<
    string,
    {
      team: string;
      department: string;
      cost: number;
      inputTokens: number;
      outputTokens: number;
      requests: number;
    }
  > = new Map();

  /**
   * 记录部门成本
   * @param department 部门名
   * @param modelUsage 模型使用量
   */
  recordDepartmentCost(
    department: string,
    modelUsage: { inputTokens: number; outputTokens: number; costUSD: number }
  ): void {
    const existing = this.departmentCosts.get(department) || {
      cost: 0,
      inputTokens: 0,
      outputTokens: 0,
      requests: 0,
    };

    existing.cost += modelUsage.costUSD;
    existing.inputTokens += modelUsage.inputTokens;
    existing.outputTokens += modelUsage.outputTokens;
    existing.requests++;

    this.departmentCosts.set(department, existing);
  }

  /**
   * 记录团队成本
   * @param team 团队名
   * @param department 部门名
   * @param modelUsage 模型使用量
   */
  recordTeamCost(
    team: string,
    department: string,
    modelUsage: { inputTokens: number; outputTokens: number; costUSD: number }
  ): void {
    const existing = this.teamCosts.get(team) || {
      team,
      department,
      cost: 0,
      inputTokens: 0,
      outputTokens: 0,
      requests: 0,
    };

    existing.cost += modelUsage.costUSD;
    existing.inputTokens += modelUsage.inputTokens;
    existing.outputTokens += modelUsage.outputTokens;
    existing.requests++;

    this.teamCosts.set(team, existing);
  }

  /**
   * 生成成本分摊报表
   * @param periodStart 周期开始
   * @param periodEnd 周期结束
   * @returns 成本分摊报表
   */
  generateReport(periodStart: Date, periodEnd: Date): CostAllocationReport {
    const totalCost = Array.from(this.departmentCosts.values()).reduce(
      (sum, d) => sum + d.cost,
      0
    );
    const totalRequests = Array.from(this.departmentCosts.values()).reduce(
      (sum, d) => sum + d.requests,
      0
    );

    const departments: DepartmentCostEntry[] = Array.from(
      this.departmentCosts.entries()
    )
      .map(([department, data]) => ({
        department,
        costUSD: data.cost,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        requestCount: data.requests,
        percentage: totalCost > 0 ? (data.cost / totalCost) * 100 : 0,
      }))
      .sort((a, b) => b.costUSD - a.costUSD);

    const teams: TeamCostEntry[] = Array.from(this.teamCosts.values())
      .map((data) => ({
        team: data.team,
        department: data.department,
        costUSD: data.cost,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        requestCount: data.requests,
        percentage: totalCost > 0 ? (data.cost / totalCost) * 100 : 0,
      }))
      .sort((a, b) => b.costUSD - a.costUSD);

    return {
      period: { start: periodStart, end: periodEnd },
      totalCost,
      totalRequests,
      departments,
      teams,
      generatedAt: Date.now(),
    };
  }

  /**
   * 获取部门报表（文本格式）
   * @param periodStart 周期开始
   * @param periodEnd 周期结束
   * @returns 格式化的报表文本
   */
  generateTextReport(periodStart: Date, periodEnd: Date): string {
    const report = this.generateReport(periodStart, periodEnd);
    const lines: string[] = [];

    lines.push('=== 成本分摊报表 ===');
    lines.push(
      `周期: ${periodStart.toISOString().slice(0, 10)} ~ ${periodEnd.toISOString().slice(0, 10)}`
    );
    lines.push(`总成本: $${report.totalCost.toFixed(4)}`);
    lines.push(`总请求: ${report.totalRequests}`);
    lines.push('');

    lines.push('--- 部门维度 ---');
    lines.push('部门\t成本\t占比\t请求数');
    for (const dept of report.departments.slice(0, 20)) {
      lines.push(
        `${dept.department}\t$${dept.costUSD.toFixed(4)}\t${dept.percentage.toFixed(1)}%\t${dept.requestCount}`
      );
    }

    if (report.teams.length > 0) {
      lines.push('');
      lines.push('--- 团队维度 ---');
      lines.push('团队\t部门\t成本\t占比\t请求数');
      for (const team of report.teams.slice(0, 20)) {
        lines.push(
          `${team.team}\t${team.department}\t$${team.costUSD.toFixed(4)}\t${team.percentage.toFixed(1)}%\t${team.requestCount}`
        );
      }
    }

    return lines.join('\n');
  }

  /**
   * 清除所有数据
   */
  clear(): void {
    this.departmentCosts.clear();
    this.teamCosts.clear();
  }
}

/**
 * 全局部门成本报表实例
 */
let globalReporter: DepartmentCostReporter | null = null;

/**
 * 获取全局部门成本报表实例
 */
export function getDepartmentCostReporter(): DepartmentCostReporter {
  if (!globalReporter) {
    globalReporter = new DepartmentCostReporter();
  }

  return globalReporter;
}
