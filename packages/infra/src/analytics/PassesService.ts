export type PassType = 'daily' | 'monthly' | 'custom';

export interface PassDefinition {
  type: PassType;
  name: string;
  periodDays: number;
  tokenBudget: number;
  messageBudget: number;
  toolBudget: number;
  costBudgetUSD: number;
  priority?: number;
}

export interface PassBalance {
  passType: PassType;
  passName: string;
  tokens: {
    used: number;
    budget: number;
    remaining: number;
    percentUsed: number;
  };
  messages: {
    used: number;
    budget: number;
    remaining: number;
    percentUsed: number;
  };
  tools: {
    used: number;
    budget: number;
    remaining: number;
    percentUsed: number;
  };
  cost: {
    usedUSD: number;
    budgetUSD: number;
    remainingUSD: number;
    percentUsed: number;
  };
  periodStart: number;
  periodEnd: number;
  active: boolean;
}

export const DEFAULT_PASSES: PassDefinition[] = [
  {
    type: 'daily',
    name: 'Daily Pass',
    periodDays: 1,
    tokenBudget: 1_000_000,
    messageBudget: 500,
    toolBudget: 200,
    costBudgetUSD: 50,
  },
  {
    type: 'monthly',
    name: 'Monthly Pass',
    periodDays: 30,
    tokenBudget: 30_000_000,
    messageBudget: 15000,
    toolBudget: 6000,
    costBudgetUSD: 1500,
  },
];

export class PassesService {
  private passes: Map<PassType, PassDefinition> = new Map();
  private balances: Map<PassType, PassBalance> = new Map();
  private periodStart: number;
  private tokenUsage: number = 0;
  private messageUsage: number = 0;
  private toolUsage: number = 0;
  private costUsageUSD: number = 0;

  constructor(passes?: PassDefinition[]) {
    const allPasses = passes || DEFAULT_PASSES;
    for (const p of allPasses) {
      this.passes.set(p.type, p);
    }
    this.periodStart = this.getPeriodStart();
    this.initializeBalances();
  }

  private getPeriodStart(): number {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }

  private initializeBalances(): void {
    for (const [type, def] of this.passes) {
      this.balances.set(type, {
        passType: type,
        passName: def.name,
        tokens: {
          used: 0,
          budget: def.tokenBudget,
          remaining: def.tokenBudget,
          percentUsed: 0,
        },
        messages: {
          used: 0,
          budget: def.messageBudget,
          remaining: def.messageBudget,
          percentUsed: 0,
        },
        tools: {
          used: 0,
          budget: def.toolBudget,
          remaining: def.toolBudget,
          percentUsed: 0,
        },
        cost: {
          usedUSD: 0,
          budgetUSD: def.costBudgetUSD,
          remainingUSD: def.costBudgetUSD,
          percentUsed: 0,
        },
        periodStart: this.periodStart,
        periodEnd: this.periodStart + def.periodDays * 86400000,
        active: true,
      });
    }
  }

  resetPeriod(): void {
    this.periodStart = this.getPeriodStart();
    this.tokenUsage = 0;
    this.messageUsage = 0;
    this.toolUsage = 0;
    this.costUsageUSD = 0;
    this.initializeBalances();
  }

  checkReset(): void {
    const now = Date.now();
    for (const [type, balance] of this.balances) {
      if (now > balance.periodEnd) {
        this.resetPeriod();
        return;
      }
    }
  }

  recordTokenUsage(tokens: number): void {
    this.checkReset();
    this.tokenUsage += tokens;
    this.updateBalances();
  }

  recordMessage(): void {
    this.checkReset();
    this.messageUsage++;
    this.updateBalances();
  }

  recordToolCall(): void {
    this.checkReset();
    this.toolUsage++;
    this.updateBalances();
  }

  recordCost(costUSD: number): void {
    this.checkReset();
    this.costUsageUSD += costUSD;
    this.updateBalances();
  }

  private updateBalances(): void {
    for (const [type, def] of this.passes) {
      const balance = this.balances.get(type);
      if (!balance) continue;

      const tokenRemaining = Math.max(0, def.tokenBudget - this.tokenUsage);
      const messageRemaining = Math.max(
        0,
        def.messageBudget - this.messageUsage
      );
      const toolRemaining = Math.max(0, def.toolBudget - this.toolUsage);
      const costRemaining = Math.max(0, def.costBudgetUSD - this.costUsageUSD);

      this.balances.set(type, {
        ...balance,
        tokens: {
          used: this.tokenUsage,
          budget: def.tokenBudget,
          remaining: tokenRemaining,
          percentUsed:
            def.tokenBudget > 0 ? this.tokenUsage / def.tokenBudget : 0,
        },
        messages: {
          used: this.messageUsage,
          budget: def.messageBudget,
          remaining: messageRemaining,
          percentUsed:
            def.messageBudget > 0 ? this.messageUsage / def.messageBudget : 0,
        },
        tools: {
          used: this.toolUsage,
          budget: def.toolBudget,
          remaining: toolRemaining,
          percentUsed: def.toolBudget > 0 ? this.toolUsage / def.toolBudget : 0,
        },
        cost: {
          usedUSD: this.costUsageUSD,
          budgetUSD: def.costBudgetUSD,
          remainingUSD: costRemaining,
          percentUsed:
            def.costBudgetUSD > 0 ? this.costUsageUSD / def.costBudgetUSD : 0,
        },
      });
    }
  }

  getBalance(type?: PassType): PassBalance | null {
    this.checkReset();
    if (type) {
      return this.balances.get(type) || null;
    }
    return (
      this.balances.get('daily') || this.balances.values().next().value || null
    );
  }

  getAllBalances(): PassBalance[] {
    this.checkReset();
    return Array.from(this.balances.values());
  }

  getActiveBalances(): PassBalance[] {
    return this.getAllBalances().filter((b) => b.active);
  }

  isOverQuota(type?: PassType): { over: boolean; passes: string[] } {
    this.checkReset();
    const over: string[] = [];
    const balances = type
      ? this.balances.get(type)
        ? [this.balances.get(type)!]
        : []
      : this.getAllBalances();

    for (const balance of balances) {
      if (balance.tokens.remaining <= 0)
        over.push(`${balance.passName}: tokens exhausted`);
      if (balance.messages.remaining <= 0)
        over.push(`${balance.passName}: messages exhausted`);
      if (balance.tools.remaining <= 0)
        over.push(`${balance.passName}: tools exhausted`);
      if (balance.cost.remainingUSD <= 0)
        over.push(`${balance.passName}: cost budget exhausted`);
    }

    return { over: over.length > 0, passes: over };
  }

  getUsageSummary(): string {
    this.checkReset();
    const lines: string[] = ['Pass Usage Summary:'];

    for (const balance of this.getAllBalances()) {
      const timeLeft = Math.max(0, balance.periodEnd - Date.now());
      const daysLeft = (timeLeft / 86400000).toFixed(1);
      lines.push(`\n${balance.passName}:`);
      lines.push(
        `  Tokens:    ${balance.tokens.used.toLocaleString()} / ${balance.tokens.budget.toLocaleString()} (${(balance.tokens.percentUsed * 100).toFixed(1)}%)`
      );
      lines.push(
        `  Messages:  ${balance.messages.used} / ${balance.messages.budget} (${(balance.messages.percentUsed * 100).toFixed(1)}%)`
      );
      lines.push(
        `  Tools:     ${balance.tools.used} / ${balance.tools.budget} (${(balance.tools.percentUsed * 100).toFixed(1)}%)`
      );
      lines.push(
        `  Cost:      $${balance.cost.usedUSD.toFixed(2)} / $${balance.cost.budgetUSD.toFixed(2)} (${(balance.cost.percentUsed * 100).toFixed(1)}%)`
      );
      lines.push(`  Resets in: ${daysLeft} days`);
    }

    return lines.join('\n');
  }
}

export function createPassesService(passes?: PassDefinition[]): PassesService {
  return new PassesService(passes);
}
