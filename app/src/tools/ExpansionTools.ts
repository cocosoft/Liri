/**
 * ExpansionTools — 5.2 工具数量追平首批
 *
 * 实现决策工具、调试工具、系统工具、Git 工具等 10 个新增工具
 * 遵循 BaseTool 模式，与 ToolFactory 集成
 */
import type {
  Tool,
  ToolUseContext,
  ToolResult,
  ValidationResult,
} from './types';
import { execSync } from 'child_process';
import * as os from 'os';
import * as fs from 'fs';
import { configManager } from '@modules/config';

// ─── 决策工具 ─────────────────────────────────────────────────────────────────

/**
 * DecisionLogger — 记录 AI 决策以用于审计追踪
 */
export function createDecisionLoggerTool(): Tool {
  const decisions: Array<{
    timestamp: number;
    action: string;
    reasoning: string;
    outcome: string;
  }> = [];

  return {
    name: 'decision_logger',
    description: 'Record and query AI decisions for audit trail and analysis',
    params: [
      {
        name: 'action',
        type: 'string',
        description:
          'log: record a decision | query: retrieve recent decisions | stats: get summary',
        required: true,
        enum: ['log', 'query', 'stats'],
      },
      {
        name: 'decision',
        type: 'object',
        description:
          'Decision details (required for action=log): { action, reasoning, outcome }',
        required: false,
      },
      {
        name: 'limit',
        type: 'number',
        description: 'Max results for query (default 10)',
        required: false,
      },
    ],
    isEnabled: () => true,
    isReadOnly: (input?: Record<string, unknown>) => {
      return (input?.action as string) !== 'log';
    },
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    getInfo: function () {
      return {
        name: this.name,
        description: this.description,
        params: this.params,
        enabled: true,
        readOnly: false,
        destructive: false,
        concurrencySafe: true,
        deferred: false,
        alwaysLoad: false,
        interruptBehavior: 'block' as const,
      };
    },
    validateInput: (input: Record<string, unknown>): ValidationResult => {
      const action = input.action as string;
      if (!action || !['log', 'query', 'stats'].includes(action)) {
        return {
          result: false,
          message: 'action must be one of: log, query, stats',
        };
      }
      if (action === 'log' && !input.decision) {
        return {
          result: false,
          message: 'decision object is required for action=log',
        };
      }
      return { result: true };
    },
    execute: async (
      input: Record<string, unknown>,
      _context: ToolUseContext
    ): Promise<ToolResult> => {
      const action = input.action as string;

      switch (action) {
        case 'log': {
          const decision = input.decision as Record<string, unknown>;
          decisions.push({
            timestamp: Date.now(),
            action: decision.action as string,
            reasoning: decision.reasoning as string,
            outcome: decision.outcome as string,
          });
          return {
            success: true,
            output: JSON.stringify({ logged: true, total: decisions.length }),
            newMessages: [
              {
                role: 'system',
                content: `Decision logged (total: ${decisions.length})`,
              },
            ],
          };
        }
        case 'query': {
          const limit = (input.limit as number) || 10;
          const recent = decisions.slice(-limit);
          return {
            success: true,
            output: JSON.stringify(recent),
            newMessages: [
              {
                role: 'system',
                content: `Returned ${recent.length} decision records`,
              },
            ],
          };
        }
        case 'stats': {
          const stats = {
            total: decisions.length,
            lastTimestamp:
              decisions.length > 0
                ? decisions[decisions.length - 1].timestamp
                : null,
          };
          return {
            success: true,
            output: JSON.stringify(stats),
            newMessages: [
              { role: 'system', content: `Total decisions: ${stats.total}` },
            ],
          };
        }
        default:
          return {
            success: false,
            output: `Error: Unknown action '${action}'`,
          };
      }
    },
  };
}

/**
 * ConfidenceScorer — 对输出/决策进行置信度评分
 */
export function createConfidenceScorerTool(): Tool {
  return {
    name: 'confidence_scorer',
    description:
      'Score the confidence of tool outputs or decisions for quality assessment',
    params: [
      {
        name: 'content',
        type: 'string',
        description: 'The content/text to assess confidence for',
        required: true,
      },
      {
        name: 'context',
        type: 'string',
        description:
          'Optional context to help score (e.g., domain, expected format)',
        required: false,
      },
    ],
    isEnabled: () => true,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    getInfo: function () {
      return {
        name: this.name,
        description: this.description,
        params: this.params,
        enabled: true,
        readOnly: true,
        destructive: false,
        concurrencySafe: true,
        deferred: false,
        alwaysLoad: false,
        interruptBehavior: 'block' as const,
      };
    },
    validateInput: (input: Record<string, unknown>): ValidationResult => {
      if (!input.content || typeof input.content !== 'string') {
        return {
          result: false,
          message: 'content is required and must be a string',
        };
      }
      return { result: true };
    },
    execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
      const content = input.content as string;
      const length = content.length;
      const hasStructure = /[{}\[\](),;:]/.test(content);
      const hasPunctuation = /[.!?，。？]/.test(content);
      const hasNumbers = /\d+/.test(content);

      let score = 0.5;
      if (length > 10) score += 0.1;
      if (length > 50) score += 0.1;
      if (hasStructure) score += 0.1;
      if (hasPunctuation) score += 0.1;
      if (hasNumbers) score += 0.1;
      if (length < 3) score -= 0.2;

      score = Math.max(0, Math.min(1, score));

      const result = {
        score: Math.round(score * 100) / 100,
        factors: {
          length,
          hasStructure,
          hasPunctuation,
          hasNumbers,
        },
        level: score >= 0.8 ? 'high' : score >= 0.5 ? 'medium' : 'low',
      };

      return {
        success: true,
        output: JSON.stringify(result),
        newMessages: [
          {
            role: 'system',
            content: `Confidence score: ${result.level} (${result.score})`,
          },
        ],
      };
    },
  };
}

// ─── 调试工具 ─────────────────────────────────────────────────────────────────

/**
 * PerformanceProfilerTool — 性能分析工具
 */
export function createPerformanceProfilerTool(): Tool {
  const profiles: Array<{
    name: string;
    durationMs: number;
    timestamp: number;
  }> = [];

  return {
    name: 'performance_profiler',
    description: 'Profile and analyze execution performance of operations',
    params: [
      {
        name: 'action',
        type: 'string',
        description:
          'start: begin profiling | stop: end and record | report: get summary | clear: reset data',
        required: true,
        enum: ['start', 'stop', 'report', 'clear'],
      },
      {
        name: 'name',
        type: 'string',
        description: 'Operation name (required for start/stop)',
        required: false,
      },
    ],
    isEnabled: () => true,
    isReadOnly: (input) =>
      !['start', 'stop'].includes((input?.action as string) || ''),
    isDestructive: () => false,
    isConcurrencySafe: () => false,
    getInfo: function () {
      return {
        name: this.name,
        description: this.description,
        params: this.params,
        enabled: this.isEnabled(),
        readOnly: this.isReadOnly(),
        destructive: false,
        concurrencySafe: this.isConcurrencySafe(),
        deferred: false,
        alwaysLoad: false,
        interruptBehavior: 'block' as const,
      };
    },
    validateInput: (input: Record<string, unknown>): ValidationResult => {
      const action = input.action as string;
      if (!action || !['start', 'stop', 'report', 'clear'].includes(action)) {
        return {
          result: false,
          message: 'action must be one of: start, stop, report, clear',
        };
      }
      if (['start', 'stop'].includes(action) && !input.name) {
        return {
          result: false,
          message: 'name is required for start/stop actions',
        };
      }
      return { result: true };
    },
    execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
      const action = input.action as string;
      const name = input.name as string;

      switch (action) {
        case 'start':
          return {
            success: true,
            output: JSON.stringify({ started: true, name }),
            metadata: { profilerStart: Date.now() },
            newMessages: [
              { role: 'system', content: `Profiling started: ${name}` },
            ],
          };
        case 'stop': {
          profiles.push({ name, durationMs: 0, timestamp: Date.now() });
          return {
            success: true,
            output: JSON.stringify({ stopped: true, name }),
            newMessages: [
              { role: 'system', content: `Profiling stopped: ${name}` },
            ],
          };
        }
        case 'report':
          return {
            success: true,
            output: JSON.stringify({ total: profiles.length, profiles }),
            newMessages: [
              { role: 'system', content: `Total profiles: ${profiles.length}` },
            ],
          };
        case 'clear':
          profiles.length = 0;
          return {
            success: true,
            output: JSON.stringify({ cleared: true }),
            newMessages: [
              { role: 'system', content: 'All profile data cleared' },
            ],
          };
        default:
          return {
            success: false,
            output: `Error: Unknown action '${action}'`,
          };
      }
    },
  };
}

/**
 * MemoryDumpTool — 内存/状态信息转储
 */
export function createMemoryDumpTool(): Tool {
  return {
    name: 'memory_dump',
    description:
      'Dump current runtime memory and state information for debugging',
    params: [
      {
        name: 'target',
        type: 'string',
        description:
          'memory: memory usage | state: runtime state | tools: registered tools count',
        required: true,
        enum: ['memory', 'state', 'tools'],
      },
    ],
    isEnabled: () => true,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    getInfo: function () {
      return {
        name: this.name,
        description: this.description,
        params: this.params,
        enabled: this.isEnabled(),
        readOnly: true,
        destructive: false,
        concurrencySafe: true,
        deferred: false,
        alwaysLoad: false,
        interruptBehavior: 'block' as const,
      };
    },
    validateInput: (input: Record<string, unknown>): ValidationResult => {
      if (
        !input.target ||
        !['memory', 'state', 'tools'].includes(input.target as string)
      ) {
        return {
          result: false,
          message: 'target must be one of: memory, state, tools',
        };
      }
      return { result: true };
    },
    execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
      const target = input.target as string;

      switch (target) {
        case 'memory': {
          const memUsage = process.memoryUsage();
          return {
            success: true,
            output: JSON.stringify(
              {
                heapUsed: memUsage.heapUsed,
                heapTotal: memUsage.heapTotal,
                rss: memUsage.rss,
                external: memUsage.external,
              },
              null,
              2
            ),
            newMessages: [
              {
                role: 'system',
                content: `Memory: RSS ${Math.round(memUsage.rss / 1024 / 1024)}MB, Heap ${Math.round(memUsage.heapUsed / 1024 / 1024)}/${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
              },
            ],
          };
        }
        case 'state': {
          const nodeVersion = process.version;
          const platform = process.platform;
          const arch = process.arch;
          const pid = process.pid;
          const uptime = process.uptime();
          return {
            success: true,
            output: JSON.stringify(
              {
                pid,
                nodeVersion,
                platform,
                arch,
                uptime: `${Math.round(uptime)}s`,
              },
              null,
              2
            ),
            newMessages: [
              {
                role: 'system',
                content: `Runtime state: Node ${nodeVersion} on ${platform}/${arch}, PID ${pid}`,
              },
            ],
          };
        }
        case 'tools': {
          return {
            success: true,
            output: JSON.stringify({
              message:
                'Use ToolSearchTool or ToolRegistry for detailed tool listing',
            }),
            newMessages: [
              {
                role: 'system',
                content: 'Use ToolSearchTool for detailed tool listing',
              },
            ],
          };
        }
        default:
          return {
            success: false,
            output: `Error: Unknown target '${target}'`,
          };
      }
    },
  };
}

// ─── 系统工具 ─────────────────────────────────────────────────────────────────

/**
 * SystemInfoTool — 综合系统信息
 */
export function createSystemInfoTool(): Tool {
  return {
    name: 'system_info',
    description:
      'Gather comprehensive system information (OS, CPU, memory, disk, network)',
    params: [
      {
        name: 'category',
        type: 'string',
        description:
          'all: everything | os: OS details | cpu: CPU info | memory: memory | disk: disk usage | network: network interfaces',
        required: false,
        default: 'all',
        enum: ['all', 'os', 'cpu', 'memory', 'disk', 'network'],
      },
    ],
    isEnabled: () => true,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    getInfo: function () {
      return {
        name: this.name,
        description: this.description,
        params: this.params,
        enabled: this.isEnabled(),
        readOnly: true,
        destructive: false,
        concurrencySafe: true,
        deferred: false,
        alwaysLoad: false,
        interruptBehavior: 'block' as const,
      };
    },
    validateInput: (input: Record<string, unknown>): ValidationResult => {
      if (
        input.category &&
        !['all', 'os', 'cpu', 'memory', 'disk', 'network'].includes(
          input.category as string
        )
      ) {
        return {
          result: false,
          message:
            'category must be one of: all, os, cpu, memory, disk, network',
        };
      }
      return { result: true };
    },
    execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
      const category = (input.category as string) || 'all';
      const info: Record<string, unknown> = {};

      if (category === 'all' || category === 'os') {
        info.os = {
          platform: os.platform(),
          release: os.release(),
          type: os.type(),
          hostname: os.hostname(),
          uptime: os.uptime(),
          loadAvg: os.loadavg(),
        };
      }
      if (category === 'all' || category === 'cpu') {
        info.cpu = {
          cpus: os.cpus().length,
          model: os.cpus()[0]?.model || 'unknown',
          speed: os.cpus()[0]?.speed || 0,
          arch: os.arch(),
        };
      }
      if (category === 'all' || category === 'memory') {
        info.memory = {
          total: os.totalmem(),
          free: os.freemem(),
          usedPercent: Math.round((1 - os.freemem() / os.totalmem()) * 100),
        };
      }
      if (category === 'all' || category === 'disk') {
        try {
          const root = os.platform() === 'win32' ? 'C:' : '/';
          const stat = fs.statfsSync(root);
          info.disk = {
            available: stat.bfree * stat.bsize,
            total: stat.blocks * stat.bsize,
          };
        } catch {
          info.disk = { error: 'Unable to read disk info' };
        }
      }
      if (category === 'all' || category === 'network') {
        info.network = os.networkInterfaces();
      }

      return {
        success: true,
        output: JSON.stringify(info, null, 2),
        newMessages: [
          {
            role: 'system',
            content: `System info: ${Object.keys(info).join(', ')}`,
          },
        ],
      };
    },
  };
}

/**
 * ProcessManagerTool — 进程管理
 */
export function createProcessManagerTool(): Tool {
  return {
    name: 'process_manager',
    description: 'List and inspect running processes on the system',
    params: [
      {
        name: 'action',
        type: 'string',
        description: 'list: list processes | search: find by name',
        required: true,
        enum: ['list', 'search'],
      },
      {
        name: 'query',
        type: 'string',
        description: 'Search term (required for action=search)',
        required: false,
      },
      {
        name: 'maxResults',
        type: 'number',
        description: 'Max results to return (default 20)',
        required: false,
      },
    ],
    isEnabled: () => true,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    getInfo: function () {
      return {
        name: this.name,
        description: this.description,
        params: this.params,
        enabled: this.isEnabled(),
        readOnly: this.isReadOnly(),
        destructive: false,
        concurrencySafe: this.isConcurrencySafe(),
        deferred: false,
        alwaysLoad: false,
        interruptBehavior: 'block' as const,
      };
    },
    validateInput: (input: Record<string, unknown>): ValidationResult => {
      const action = input.action as string;
      if (!action || !['list', 'search'].includes(action)) {
        return {
          result: false,
          message: 'action must be one of: list, search',
        };
      }
      if (
        action === 'search' &&
        (!input.query || typeof input.query !== 'string')
      ) {
        return {
          result: false,
          message: 'query is required for action=search',
        };
      }
      return { result: true };
    },
    execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
      const action = input.action as string;
      const maxResults = (input.maxResults as number) || 20;

      try {
        const cmd =
          os.platform() === 'win32'
            ? `powershell -Command "Get-Process | Select-Object -Property Id, ProcessName, CPU, WorkingSet | ConvertTo-Json -Compress"`
            : `ps -eo pid,comm,%cpu,rss --sort=-%cpu | head -$((maxResults + 1))`;

        const output = execSync(cmd, {
          timeout: 5000,
          encoding: 'utf-8',
          maxBuffer: 1024 * 1024,
        });

        let processes;
        if (action === 'search') {
          const query = (input.query as string).toLowerCase();
          const lines = output
            .split('\n')
            .filter((l) => l.toLowerCase().includes(query));
          processes = lines.slice(0, maxResults);
        } else {
          const lines = output.split('\n').slice(1, maxResults + 1);
          processes = lines;
        }

        return {
          success: true,
          output: JSON.stringify({ processes, count: processes.length }),
          newMessages: [
            { role: 'system', content: `Found ${processes.length} processes` },
          ],
        };
      } catch (error) {
        return {
          success: false,
          output: `Error listing processes: ${(error as Error).message}`,
        };
      }
    },
  };
}

// ─── Git 工具 ─────────────────────────────────────────────────────────────────

/**
 * GitBranchTool — Git 分支管理
 */
export function createGitBranchTool(): Tool {
  return {
    name: 'git_branch',
    description: 'List, create, delete, or switch Git branches',
    params: [
      {
        name: 'action',
        type: 'string',
        description:
          'list: list branches | create: create branch | delete: delete branch | switch: switch branch',
        required: true,
        enum: ['list', 'create', 'delete', 'switch'],
      },
      {
        name: 'name',
        type: 'string',
        description: 'Branch name (required for create/delete/switch)',
        required: false,
      },
      {
        name: 'base',
        type: 'string',
        description:
          'Base branch/tag/commit for create (default current branch)',
        required: false,
      },
    ],
    isEnabled: () => true,
    isReadOnly: (input) => (input?.action as string) === 'list',
    isDestructive: (input) => (input?.action as string) === 'delete',
    isConcurrencySafe: () => false,
    getInfo: function () {
      return {
        name: this.name,
        description: this.description,
        params: this.params,
        enabled: this.isEnabled(),
        readOnly: this.isReadOnly(),
        destructive: this.isDestructive ? this.isDestructive() : false,
        concurrencySafe: this.isConcurrencySafe(),
        deferred: false,
        alwaysLoad: false,
        interruptBehavior: 'block' as const,
      };
    },
    validateInput: (input: Record<string, unknown>): ValidationResult => {
      const action = input.action as string;
      if (!action || !['list', 'create', 'delete', 'switch'].includes(action)) {
        return {
          result: false,
          message: 'action must be one of: list, create, delete, switch',
        };
      }
      if (
        ['create', 'delete', 'switch'].includes(action) &&
        (!input.name || typeof input.name !== 'string')
      ) {
        return {
          result: false,
          message: 'name is required for create/delete/switch actions',
        };
      }
      return { result: true };
    },
    execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
      const action = input.action as string;
      const name = input.name as string;

      try {
        let cmd = '';
        switch (action) {
          case 'list':
            cmd = 'git branch';
            break;
          case 'create':
            cmd = `git branch ${name}${input.base ? ` ${input.base}` : ''}`;
            break;
          case 'delete':
            cmd = `git branch -d ${name}`;
            break;
          case 'switch':
            cmd = `git checkout ${name}`;
            break;
        }

        const output = execSync(cmd, {
          timeout: 10000,
          encoding: 'utf-8',
          maxBuffer: 1024 * 1024,
        });
        return {
          success: true,
          output: JSON.stringify({ action, name, output: output.trim() }),
          newMessages: [
            { role: 'system', content: `Git branch ${action} completed` },
          ],
        };
      } catch (error) {
        return {
          success: false,
          output: `Git error: ${(error as Error).message}`,
        };
      }
    },
  };
}

/**
 * GitMergeTool — Git 合并管理
 */
export function createGitMergeTool(): Tool {
  return {
    name: 'git_merge',
    description: 'Merge branches or view merge status',
    params: [
      {
        name: 'action',
        type: 'string',
        description:
          'merge: merge branch | abort: abort ongoing merge | status: check merge status',
        required: true,
        enum: ['merge', 'abort', 'status'],
      },
      {
        name: 'source',
        type: 'string',
        description: 'Source branch to merge from (required for action=merge)',
        required: false,
      },
      {
        name: 'message',
        type: 'string',
        description: 'Custom merge commit message (optional)',
        required: false,
      },
    ],
    isEnabled: () => true,
    isReadOnly: (input) => (input?.action as string) === 'status',
    isDestructive: (input) => (input?.action as string) === 'merge',
    isConcurrencySafe: () => false,
    getInfo: function () {
      return {
        name: this.name,
        description: this.description,
        params: this.params,
        enabled: this.isEnabled(),
        readOnly: this.isReadOnly(),
        destructive: this.isDestructive ? this.isDestructive() : false,
        concurrencySafe: this.isConcurrencySafe(),
        deferred: false,
        alwaysLoad: false,
        interruptBehavior: 'block' as const,
      };
    },
    validateInput: (input: Record<string, unknown>): ValidationResult => {
      const action = input.action as string;
      if (!action || !['merge', 'abort', 'status'].includes(action)) {
        return {
          result: false,
          message: 'action must be one of: merge, abort, status',
        };
      }
      if (
        action === 'merge' &&
        (!input.source || typeof input.source !== 'string')
      ) {
        return {
          result: false,
          message: 'source branch is required for action=merge',
        };
      }
      return { result: true };
    },
    execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
      const action = input.action as string;
      const source = input.source as string;

      try {
        let cmd = '';
        switch (action) {
          case 'merge':
            cmd = `git merge ${source}${input.message ? ` -m "${input.message}"` : ' --no-edit'}`;
            break;
          case 'abort':
            cmd = 'git merge --abort';
            break;
          case 'status':
            cmd = 'git status --short';
            break;
        }

        const output = execSync(cmd, {
          timeout: 30000,
          encoding: 'utf-8',
          maxBuffer: 1024 * 1024,
        });
        return {
          success: true,
          output: JSON.stringify({ action, source, output: output.trim() }),
          newMessages: [
            { role: 'system', content: `Git merge ${action} completed` },
          ],
        };
      } catch (error) {
        return {
          success: false,
          output: `Git error: ${(error as Error).message}`,
        };
      }
    },
  };
}

/**
 * GitStashTool — Git 暂存管理
 */
export function createGitStashTool(): Tool {
  return {
    name: 'git_stash',
    description: 'Stash, list, apply, or drop Git stashes',
    params: [
      {
        name: 'action',
        type: 'string',
        description:
          'save: stash changes | list: list stashes | apply: apply stash | drop: drop stash | pop: apply and drop',
        required: true,
        enum: ['save', 'list', 'apply', 'drop', 'pop'],
      },
      {
        name: 'message',
        type: 'string',
        description: 'Stash message (for action=save)',
        required: false,
      },
      {
        name: 'index',
        type: 'number',
        description: 'Stash index (for apply/drop/pop, default 0)',
        required: false,
      },
    ],
    isEnabled: () => true,
    isReadOnly: (input) => (input?.action as string) === 'list',
    isDestructive: (input) =>
      ['drop', 'pop'].includes((input?.action as string) || ''),
    isConcurrencySafe: () => false,
    getInfo: function () {
      return {
        name: this.name,
        description: this.description,
        params: this.params,
        enabled: this.isEnabled(),
        readOnly: this.isReadOnly(),
        destructive: this.isDestructive ? this.isDestructive() : false,
        concurrencySafe: this.isConcurrencySafe(),
        deferred: false,
        alwaysLoad: false,
        interruptBehavior: 'block' as const,
      };
    },
    validateInput: (input: Record<string, unknown>): ValidationResult => {
      const action = input.action as string;
      if (
        !action ||
        !['save', 'list', 'apply', 'drop', 'pop'].includes(action)
      ) {
        return {
          result: false,
          message: 'action must be one of: save, list, apply, drop, pop',
        };
      }
      return { result: true };
    },
    execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
      const action = input.action as string;
      const index = (input.index as number) || 0;

      try {
        let cmd = '';
        switch (action) {
          case 'save':
            cmd = `git stash push${input.message ? ` -m "${input.message}"` : ''}`;
            break;
          case 'list':
            cmd = 'git stash list';
            break;
          case 'apply':
            cmd = `git stash apply stash@{${index}}`;
            break;
          case 'drop':
            cmd = `git stash drop stash@{${index}}`;
            break;
          case 'pop':
            cmd = `git stash pop stash@{${index}}`;
            break;
        }

        const output = execSync(cmd, {
          timeout: 10000,
          encoding: 'utf-8',
          maxBuffer: 1024 * 1024,
        });
        return {
          success: true,
          output: JSON.stringify({ action, index, output: output.trim() }),
          newMessages: [
            { role: 'system', content: `Git stash ${action} completed` },
          ],
        };
      } catch (error) {
        return {
          success: false,
          output: `Git error: ${(error as Error).message}`,
        };
      }
    },
  };
}

// ─── 代码工具 ─────────────────────────────────────────────────────────────────

/**
 * CodeFormatTool — 代码格式化
 */
export function createCodeFormatTool(): Tool {
  return {
    name: 'code_format',
    description:
      'Format source code files using Prettier or built-in formatter',
    params: [
      {
        name: 'path',
        type: 'string',
        description: 'File or directory path to format',
        required: true,
      },
      {
        name: 'check',
        type: 'boolean',
        description: 'Only check formatting without modifying (default false)',
        required: false,
      },
    ],
    isEnabled: () => true,
    isReadOnly: (input) => !!input?.check,
    isDestructive: (input) => !input?.check,
    isConcurrencySafe: () => false,
    getInfo: function () {
      return {
        name: this.name,
        description: this.description,
        params: this.params,
        enabled: this.isEnabled(),
        readOnly: this.isReadOnly(),
        destructive: this.isDestructive ? this.isDestructive() : false,
        concurrencySafe: this.isConcurrencySafe(),
        deferred: false,
        alwaysLoad: false,
        interruptBehavior: 'block' as const,
      };
    },
    validateInput: (input: Record<string, unknown>): ValidationResult => {
      if (!input.path || typeof input.path !== 'string') {
        return {
          result: false,
          message: 'path is required and must be a string',
        };
      }
      return { result: true };
    },
    execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
      const path = input.path as string;
      const check = !!input.check;

      try {
        const cmd = check
          ? `npx prettier --check "${path}"`
          : `npx prettier --write "${path}"`;
        const output = execSync(cmd, {
          timeout: 30000,
          encoding: 'utf-8',
          maxBuffer: 1024 * 1024,
        });
        return {
          success: true,
          output: JSON.stringify({ path, check, output: output.trim() }),
          newMessages: [
            {
              role: 'system',
              content: `Format ${check ? 'check' : 'complete'} for ${path}`,
            },
          ],
        };
      } catch (error) {
        const msg = (error as Error).message;
        return {
          success: false,
          output: check
            ? `Formatting issues found in ${path}`
            : `Format error: ${msg}`,
        };
      }
    },
  };
}

// ─── 协作工具 ─────────────────────────────────────────────────────────────────

/**
 * ReviewAssignTool — GitHub PR 审查者分配
 */
export function createReviewAssignTool(): Tool {
  return {
    name: 'review_assign',
    description: 'Assign, unassign, or list reviewers for GitHub pull requests',
    params: [
      {
        name: 'action',
        type: 'string',
        description:
          'assign: add reviewer | unassign: remove reviewer | list: show current reviewers',
        required: true,
        enum: ['assign', 'unassign', 'list'],
      },
      {
        name: 'repo',
        type: 'string',
        description: 'Repository in format owner/repo (e.g., user/project)',
        required: true,
      },
      {
        name: 'prNumber',
        type: 'number',
        description: 'Pull request number (required for assign/unassign)',
        required: false,
      },
      {
        name: 'reviewer',
        type: 'string',
        description: 'GitHub username to assign/unassign as reviewer',
        required: false,
      },
    ],
    isEnabled: () => true,
    isReadOnly: (input) => (input?.action as string) === 'list',
    isDestructive: () => false,
    isConcurrencySafe: () => false,
    getInfo: function () {
      return {
        name: this.name,
        description: this.description,
        params: this.params,
        enabled: this.isEnabled(),
        readOnly: this.isReadOnly(),
        destructive: false,
        concurrencySafe: this.isConcurrencySafe(),
        deferred: false,
        alwaysLoad: false,
        interruptBehavior: 'block' as const,
      };
    },
    validateInput: (input: Record<string, unknown>): ValidationResult => {
      const action = input.action as string;
      if (!action || !['assign', 'unassign', 'list'].includes(action)) {
        return {
          result: false,
          message: 'action must be one of: assign, unassign, list',
        };
      }
      if (!input.repo || typeof input.repo !== 'string') {
        return {
          result: false,
          message: 'repo is required (format: owner/repo)',
        };
      }
      if (
        ['assign', 'unassign'].includes(action) &&
        (!input.prNumber || typeof input.prNumber !== 'number')
      ) {
        return {
          result: false,
          message: 'prNumber is required for assign/unassign actions',
        };
      }
      if (
        ['assign', 'unassign'].includes(action) &&
        (!input.reviewer || typeof input.reviewer !== 'string')
      ) {
        return {
          result: false,
          message: 'reviewer is required for assign/unassign actions',
        };
      }
      return { result: true };
    },
    execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
      const action = input.action as string;
      const repo = input.repo as string;
      const prNumber = input.prNumber as number;
      const reviewer = input.reviewer as string;

      const token = configManager.env('GITHUB_TOKEN') || configManager.env('GIT_TOKEN') || '';

      try {
        let url = '';
        let method = 'GET';
        let body: string | undefined;

        switch (action) {
          case 'assign':
            url = `https://api.github.com/repos/${repo}/pulls/${prNumber}/requested_reviewers`;
            method = 'POST';
            body = JSON.stringify({ reviewers: [reviewer] });
            break;
          case 'unassign':
            url = `https://api.github.com/repos/${repo}/pulls/${prNumber}/requested_reviewers`;
            method = 'DELETE';
            body = JSON.stringify({ reviewers: [reviewer] });
            break;
          case 'list':
            url = `https://api.github.com/repos/${repo}/pulls/${prNumber}/requested_reviewers`;
            method = 'GET';
            break;
        }

        const headers: Record<string, string> = {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Liri-Tool',
        };
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }

        const fetchOptions = {
          method,
          headers,
          body,
        };

        const response = await fetch(url, fetchOptions);

        if (!response.ok) {
          const errorBody = await response.text();
          return {
            success: false,
            output: `GitHub API error (${response.status}): ${errorBody}`,
          };
        }

        const data = await response.json();
        const output =
          action === 'list'
            ? JSON.stringify({
                reviewers: data.users?.map((u: any) => u.login) || [],
              })
            : JSON.stringify({ success: true, action, reviewer, prNumber });

        return {
          success: true,
          output,
          newMessages: [
            {
              role: 'system',
              content: `Review ${action} completed for ${repo}#${prNumber}${reviewer ? ` (${reviewer})` : ''}`,
            },
          ],
        };
      } catch (error) {
        return {
          success: false,
          output: `Review assign error: ${(error as Error).message}`,
        };
      }
    },
  };
}

/**
 * CodeReviewTool — 自动化代码审查分析
 */
export function createCodeReviewTool(): Tool {
  return {
    name: 'code_review',
    description:
      'Analyze source code for potential issues, style problems, and security concerns',
    params: [
      {
        name: 'action',
        type: 'string',
        description: 'analyze: review code snippet | check: check file at path',
        required: true,
        enum: ['analyze', 'check'],
      },
      {
        name: 'code',
        type: 'string',
        description:
          'Source code content to analyze (required for action=analyze)',
        required: false,
      },
      {
        name: 'language',
        type: 'string',
        description: 'Programming language (e.g., typescript, python, rust)',
        required: false,
      },
      {
        name: 'path',
        type: 'string',
        description: 'File path to check (required for action=check)',
        required: false,
      },
      {
        name: 'strictness',
        type: 'string',
        description: 'Review strictness: low, medium, high (default medium)',
        required: false,
        enum: ['low', 'medium', 'high'],
      },
    ],
    isEnabled: () => true,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    getInfo: function () {
      return {
        name: this.name,
        description: this.description,
        params: this.params,
        enabled: this.isEnabled(),
        readOnly: true,
        destructive: false,
        concurrencySafe: true,
        deferred: false,
        alwaysLoad: false,
        interruptBehavior: 'block' as const,
      };
    },
    validateInput: (input: Record<string, unknown>): ValidationResult => {
      const action = input.action as string;
      if (!action || !['analyze', 'check'].includes(action)) {
        return {
          result: false,
          message: 'action must be one of: analyze, check',
        };
      }
      if (action === 'analyze' && !input.code) {
        return {
          result: false,
          message: 'code is required for action=analyze',
        };
      }
      if (action === 'check' && !input.path) {
        return {
          result: false,
          message: 'path is required for action=check',
        };
      }
      return { result: true };
    },
    execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
      const action = input.action as string;

      try {
        if (action === 'check') {
          const filePath = input.path as string;
          const content = fs.readFileSync(filePath, 'utf-8');
          const language =
            (input.language as string) || detectLanguage(filePath);

          return performReview(content, language, input.strictness as string);
        }

        const code = input.code as string;
        const language = (input.language as string) || 'unknown';

        return performReview(code, language, input.strictness as string);
      } catch (error) {
        return {
          success: false,
          output: `Code review error: ${(error as Error).message}`,
        };
      }
    },
  };
}

/**
 * 执行代码审查分析
 */
function performReview(
  code: string,
  language: string,
  strictness?: string
): ToolResult {
  const issues: Array<{
    type: string;
    line?: number;
    severity: string;
    message: string;
  }> = [];
  const lines = code.split('\n');
  const threshold = strictness === 'high' ? 0 : strictness === 'low' ? 120 : 80;

  // 检查行长
  lines.forEach((line, i) => {
    if (line.length > threshold && line.trim().length > 0) {
      issues.push({
        type: 'style',
        line: i + 1,
        severity: threshold > 80 ? 'warning' : 'info',
        message: `Line too long (${line.length} > ${threshold} chars)`,
      });
    }
  });

  // 检查 TODO/FIXME
  lines.forEach((line, i) => {
    if (/\bTODO\b/i.test(line)) {
      issues.push({
        type: 'todo',
        line: i + 1,
        severity: 'info',
        message: 'Contains TODO comment',
      });
    }
    if (/\bFIXME\b/i.test(line)) {
      issues.push({
        type: 'bug',
        line: i + 1,
        severity: 'warning',
        message: 'Contains FIXME comment',
      });
    }
  });

  // 检查空 catch 块
  if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(code)) {
    issues.push({
      type: 'error_handling',
      severity: 'error',
      message:
        'Empty catch block detected — errors are being silently swallowed',
    });
  }

  // 检查 console.log
  if (/\bconsole\.(log|warn|error)\(/.test(code)) {
    issues.push({
      type: 'debugging',
      severity: strictness === 'high' ? 'error' : 'warning',
      message: 'Console statement detected — should use Logger instead',
    });
  }

  // 检查硬编码密钥模式
  const secretPatterns = [
    /(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]+['"]/i,
  ];
  for (const pattern of secretPatterns) {
    const match = code.match(pattern);
    if (match) {
      issues.push({
        type: 'security',
        severity: 'error',
        message: 'Possible hardcoded secret detected',
      });
      break;
    }
  }

  // 检查 any 类型 (TypeScript)
  if (
    (language === 'typescript' || language === 'ts') &&
    /\b:?\s*any\b/.test(code)
  ) {
    issues.push({
      type: 'typescript',
      severity: strictness === 'high' ? 'error' : 'warning',
      message:
        'Use of `any` type detected — prefer `unknown` or specific types',
    });
  }

  const severityCount = {
    error: issues.filter((i) => i.severity === 'error').length,
    warning: issues.filter((i) => i.severity === 'warning').length,
    info: issues.filter((i) => i.severity === 'info').length,
  };

  const summary = {
    language,
    totalLines: lines.length,
    issuesFound: issues.length,
    severityCount,
    score: calculateScore(issues.length, lines.length),
    issues,
  };

  return {
    success: true,
    output: JSON.stringify(summary, null, 2),
    newMessages: [
      {
        role: 'system',
        content: `Code review: ${issues.length} issues found (${severityCount.error} errors, ${severityCount.warning} warnings, ${severityCount.info} info)`,
      },
    ],
  };
}

/**
 * 计算代码质量评分
 */
function calculateScore(issueCount: number, lineCount: number): number {
  if (lineCount === 0) return 100;
  const density = issueCount / lineCount;
  if (density === 0) return 100;
  if (density < 0.05) return 90;
  if (density < 0.1) return 75;
  if (density < 0.2) return 50;
  return 25;
}

/**
 * 根据文件路径检测语言
 */
function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const extMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    rb: 'ruby',
    c: 'c',
    cpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    swift: 'swift',
    kt: 'kotlin',
    scala: 'scala',
    html: 'html',
    css: 'css',
    scss: 'scss',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    sql: 'sql',
    sh: 'shell',
    bash: 'shell',
    zig: 'zig',
  };
  return extMap[ext] || 'unknown';
}
