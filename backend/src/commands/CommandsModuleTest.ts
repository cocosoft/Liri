// @ts-nocheck
import { describe, it, expect, beforeEach } from 'bun:test';
import { EnhancedCommandRegistry, CommandCategory } from './registry/EnhancedCommandRegistry';
import type { CommandMetadata } from './registry/EnhancedCommandRegistry';
import { CommandPipeline, PipelineStage } from './pipeline/CommandPipeline';
import type { PipelineMiddleware, PipelineContext } from './pipeline/CommandPipeline';
import { AdvancedCommandHistory } from './history/AdvancedCommandHistory';
import type { HistoryEntry } from './history/AdvancedCommandHistory';

describe('EnhancedCommandRegistry', () => {
  let registry: EnhancedCommandRegistry;

  beforeEach(() => {
    registry = new EnhancedCommandRegistry();
  });

  it('registers and retrieves command metadata', () => {
    const cmd: CommandMetadata = {
      name: 'test-cmd',
      description: 'A test command',
      category: CommandCategory.UTILITY,
      version: '1.0.0',
    };
    registry.register(cmd);
    expect(registry.get('test-cmd')).not.toBeNull();
    expect(registry.get('test-cmd')!.description).toBe('A test command');
  });

  it('throws on duplicate registration', () => {
    const cmd: CommandMetadata = { name: 'dup', description: 'dup', category: CommandCategory.GENERAL, version: '1.0.0' };
    registry.register(cmd);
    expect(() => registry.register(cmd)).toThrow('already registered');
  });

  it('unregisters command', () => {
    const cmd: CommandMetadata = { name: 'temp', description: 'temp', category: CommandCategory.GENERAL, version: '1.0.0' };
    registry.register(cmd);
    expect(registry.unregister('temp')).toBe(true);
    expect(registry.get('temp')).toBeNull();
    expect(registry.unregister('nonexistent')).toBe(false);
  });

  it('finds commands by category', () => {
    const cmd1: CommandMetadata = { name: 'dev1', description: 'dev1', category: CommandCategory.DEVELOPMENT, version: '1.0.0' };
    const cmd2: CommandMetadata = { name: 'dev2', description: 'dev2', category: CommandCategory.DEVELOPMENT, version: '1.0.0' };
    const cmd3: CommandMetadata = { name: 'sys1', description: 'sys1', category: CommandCategory.SYSTEM, version: '1.0.0' };
    registry.register(cmd1);
    registry.register(cmd2);
    registry.register(cmd3);
    const devCmds = registry.findByCategory(CommandCategory.DEVELOPMENT);
    expect(devCmds.length).toBe(2);
    expect(devCmds.map(c => c.name)).toContain('dev1');
    expect(devCmds.map(c => c.name)).toContain('dev2');
  });

  it('finds commands by tag', () => {
    const cmd: CommandMetadata = {
      name: 'tagged-cmd', description: 'tagged', category: CommandCategory.UTILITY, version: '1.0.0',
      tags: ['network', 'http'],
    };
    registry.register(cmd);
    const found = registry.findByTag('network');
    expect(found.length).toBe(1);
    expect(found[0].name).toBe('tagged-cmd');
  });

  it('searches commands by query', () => {
    const cmd: CommandMetadata = { name: 'git-commit', description: 'Commit changes to git', category: CommandCategory.DEVELOPMENT, version: '1.0.0' };
    registry.register(cmd);
    const results = registry.search('commit');
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('git-commit');
  });

  it('checks permissions', () => {
    const cmd: CommandMetadata = {
      name: 'admin-only', description: 'admin', category: CommandCategory.SYSTEM, version: '1.0.0',
      permissions: [{ role: 'admin', allow: true }, { role: 'user', allow: false }],
    };
    registry.register(cmd);
    expect(registry.checkPermission('admin-only', 'admin')).toBe(true);
    expect(registry.checkPermission('admin-only', 'user')).toBe(false);
    expect(registry.checkPermission('admin-only', 'guest')).toBe(true);
  });

  it('resolves dependencies in order', () => {
    const base: CommandMetadata = { name: 'base', description: 'base', category: CommandCategory.GENERAL, version: '1.0.0' };
    const child: CommandMetadata = {
      name: 'child', description: 'child', category: CommandCategory.GENERAL, version: '1.0.0',
      dependencies: [{ name: 'base' }, { name: 'util' }],
    };
    const util: CommandMetadata = { name: 'util', description: 'util', category: CommandCategory.GENERAL, version: '1.0.0' };
    registry.register(base);
    registry.register(util);
    registry.register(child);
    const deps = registry.resolveDependencies('child');
    expect(deps).toContain('base');
    expect(deps).toContain('util');
    expect(deps[deps.length - 1]).toBe('child');
  });

  it('prevents unregister when dependents exist', () => {
    const base: CommandMetadata = { name: 'base', description: 'base', category: CommandCategory.GENERAL, version: '1.0.0' };
    const child: CommandMetadata = {
      name: 'child', description: 'child', category: CommandCategory.GENERAL, version: '1.0.0',
      dependencies: [{ name: 'base' }],
    };
    registry.register(base);
    registry.register(child);
    expect(() => registry.unregister('base')).toThrow('depended on by');
  });

  it('detects circular dependencies', () => {
    const a: CommandMetadata = {
      name: 'a', description: 'a', category: CommandCategory.GENERAL, version: '1.0.0',
      dependencies: [{ name: 'b' }],
    };
    const b: CommandMetadata = {
      name: 'b', description: 'b', category: CommandCategory.GENERAL, version: '1.0.0',
      dependencies: [{ name: 'a' }],
    };
    registry.register(a);
    registry.register(b);
    const cycles = registry.detectCircularDependencies();
    expect(cycles.length).toBeGreaterThan(0);
  });

  it('builds category tree', () => {
    const cmd: CommandMetadata = { name: 'cfg', description: 'cfg', category: CommandCategory.CONFIG, version: '1.0.0' };
    registry.register(cmd);
    const tree = registry.getCategoryTree();
    const configCmds = tree.get(CommandCategory.CONFIG);
    expect(configCmds).not.toBeUndefined();
    expect(configCmds!.length).toBe(1);
  });

  it('lists all commands', () => {
    registry.register({ name: 'a', description: 'a', category: CommandCategory.GENERAL, version: '1.0.0' });
    registry.register({ name: 'b', description: 'b', category: CommandCategory.GENERAL, version: '1.0.0' });
    expect(registry.getAll().length).toBe(2);
  });
});

describe('CommandPipeline', () => {
  let pipeline: CommandPipeline;

  beforeEach(() => {
    pipeline = new CommandPipeline();
  });

  it('executes empty pipeline', async () => {
    const result = await pipeline.execute('test', '');
    expect(result.success).toBe(true);
  });

  it('executes middleware in stage order', async () => {
    const order: string[] = [];
    pipeline.use({
      id: 'validate', stage: PipelineStage.PRE_VALIDATE, priority: 10,
      handler: async (ctx, next) => { order.push('validate'); await next(); },
    });
    pipeline.use({
      id: 'execute', stage: PipelineStage.EXECUTE, priority: 10,
      handler: async (ctx, next) => { order.push('execute'); ctx.result = 'done'; await next(); },
    });
    pipeline.use({
      id: 'log', stage: PipelineStage.POST_LOG, priority: 10,
      handler: async (ctx, next) => { order.push('log'); await next(); },
    });
    await pipeline.execute('test', '');
    expect(order).toEqual(['validate', 'execute', 'log']);
  });

  it('passes context through pipeline', async () => {
    pipeline.use({
      id: 'enrich', stage: PipelineStage.PRE_PROCESS, priority: 10,
      handler: async (ctx, next) => {
        ctx.parsedArgs.enriched = true;
        await next();
      },
    });
    pipeline.use({
      id: 'exec', stage: PipelineStage.EXECUTE, priority: 10,
      handler: async (ctx, next) => {
        ctx.result = { enriched: ctx.parsedArgs.enriched };
        await next();
      },
    });
    const result = await pipeline.execute('test', '', {});
    expect(result.success).toBe(true);
    expect(result.result?.enriched).toBe(true);
  });

  it('aborts pipeline when ctx.abort is set', async () => {
    pipeline.use({
      id: 'auth', stage: PipelineStage.PRE_AUTHORIZE, priority: 10,
      handler: async (ctx, next) => {
        ctx.abort = true;
        ctx.abortReason = 'Not authorized';
      },
    });
    const result = await pipeline.execute('test', '');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Not authorized');
  });

  it('handles middleware errors gracefully', async () => {
    pipeline.use({
      id: 'failing', stage: PipelineStage.EXECUTE, priority: 10,
      handler: async (_ctx, _next) => { throw new Error('Middleware error'); },
    });
    const result = await pipeline.execute('test', '');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Middleware error');
  });

  it('executes middleware by priority order', async () => {
    const values: number[] = [];
    pipeline.use({
      id: 'low', stage: PipelineStage.PRE_PROCESS, priority: 1,
      handler: async (ctx, next) => { values.push(1); await next(); },
    });
    pipeline.use({
      id: 'high', stage: PipelineStage.PRE_PROCESS, priority: 100,
      handler: async (ctx, next) => { values.push(100); await next(); },
    });
    await pipeline.execute('test', '');
    expect(values).toEqual([100, 1]);
  });

  it('removes middleware by id', () => {
    pipeline.use({
      id: 'removable', stage: PipelineStage.PRE_VALIDATE, priority: 10,
      handler: async (ctx, next) => { await next(); },
    });
    expect(pipeline.remove('removable')).toBe(true);
    expect(pipeline.remove('nonexistent')).toBe(false);
    expect(pipeline.getMiddlewares().length).toBe(0);
  });

  it('rejects middleware with unknown stage', () => {
    expect(() => pipeline.use({
      id: 'bad', stage: 'unknown' as PipelineStage, priority: 10,
      handler: async (ctx, next) => { await next(); },
    })).toThrow('Unknown');
  });

  it('tracks stage durations', async () => {
    pipeline.use({
      id: 'slow', stage: PipelineStage.PRE_VALIDATE, priority: 10,
      handler: async (ctx, next) => { await new Promise(r => setTimeout(r, 2)); await next(); },
    });
    const result = await pipeline.execute('test', '');
    expect(result.stages.length).toBeGreaterThan(0);
    const preValidateStage = result.stages.find(s => s.stage === PipelineStage.PRE_VALIDATE);
    expect(preValidateStage).not.toBeUndefined();
    expect(preValidateStage!.duration).toBeGreaterThan(0);
  });
});

describe('AdvancedCommandHistory', () => {
  let history: AdvancedCommandHistory;

  beforeEach(() => {
    history = new AdvancedCommandHistory(1000);
  });

  it('records and queries entries', () => {
    history.record({ command: 'git', args: 'status', timestamp: 1000, success: true });
    history.record({ command: 'ls', args: '-la', timestamp: 2000, success: true });
    expect(history.getTotalCount()).toBe(2);
    const results = history.query({});
    expect(results.length).toBe(2);
  });

  it('filters by command name', () => {
    history.record({ command: 'git', args: 'status', timestamp: 1000, success: true });
    history.record({ command: 'npm', args: 'install', timestamp: 2000, success: true });
    const results = history.query({ command: 'git' });
    expect(results.length).toBe(1);
    expect(results[0].command).toBe('git');
  });

  it('filters by success status', () => {
    history.record({ command: 'ok', args: '', timestamp: 1000, success: true });
    history.record({ command: 'fail', args: '', timestamp: 2000, success: false });
    const fails = history.query({ success: false });
    expect(fails.length).toBe(1);
    expect(fails[0].command).toBe('fail');
  });

  it('filters by date range', () => {
    history.record({ command: 'old', args: '', timestamp: 100, success: true });
    history.record({ command: 'mid', args: '', timestamp: 200, success: true });
    history.record({ command: 'new', args: '', timestamp: 300, success: true });
    const results = history.query({ fromDate: 150, toDate: 250 });
    expect(results.length).toBe(1);
    expect(results[0].command).toBe('mid');
  });

  it('filters by text search', () => {
    history.record({ command: 'git', args: 'commit -m "init"', timestamp: 1000, success: true });
    history.record({ command: 'npm', args: 'run build', timestamp: 2000, success: true });
    const results = history.query({ text: 'commit' });
    expect(results.length).toBe(1);
  });

  it('generates command stats', () => {
    history.record({ command: 'git', args: 'status', timestamp: 100, success: true, duration: 10 });
    history.record({ command: 'git', args: 'add', timestamp: 200, success: true, duration: 5 });
    history.record({ command: 'git', args: 'commit', timestamp: 300, success: false, duration: 50 });
    const stats = history.getStats('git');
    expect(stats.length).toBe(1);
    expect(stats[0].totalExecutions).toBe(3);
    expect(stats[0].successfulExecutions).toBe(2);
    expect(stats[0].failedExecutions).toBe(1);
    expect(stats[0].avgDuration).toBeCloseTo(21.67, 0);
  });

  it('generates stats for all commands', () => {
    history.record({ command: 'git', args: '', timestamp: 100, success: true });
    history.record({ command: 'npm', args: '', timestamp: 200, success: true });
    const stats = history.getStats();
    expect(stats.length).toBe(2);
  });

  it('tracks trends over time intervals', async () => {
    const now = Date.now();
    history.record({ command: 'git', args: '', timestamp: now - 5000, success: true, duration: 10 });
    history.record({ command: 'npm', args: '', timestamp: now - 1000, success: true, duration: 20 });
    const trends = history.getTrends(10000, 2);
    expect(trends.length).toBe(2);
    const nonEmpty = trends.filter(t => t.totalCommands > 0);
    expect(nonEmpty.length).toBeGreaterThan(0);
  });

  it('manages favorites', () => {
    history.record({ command: 'git', args: '', timestamp: 100, success: true });
    expect(history.toggleFavorite('git')).toBe(true);
    expect(history.getFavorites().length).toBe(1);
    expect(history.toggleFavorite('git')).toBe(false);
    expect(history.getFavorites().length).toBe(0);
  });

  it('gets replay sequence', () => {
    history.record({ command: 'cmd1', args: '', timestamp: 100, success: true });
    history.record({ command: 'cmd2', args: '', timestamp: 200, success: true });
    history.record({ command: 'cmd3', args: '', timestamp: 300, success: true });
    const sequence = history.getReplaySequence(150, 250);
    expect(sequence.length).toBe(1);
    expect(sequence[0].command).toBe('cmd2');
  });

  it('clears all entries', () => {
    history.record({ command: 'a', args: '', timestamp: 100, success: true });
    history.record({ command: 'b', args: '', timestamp: 200, success: true });
    const cleared = history.clear();
    expect(cleared).toBe(2);
    expect(history.getTotalCount()).toBe(0);
  });

  it('supports pagination in queries', () => {
    for (let i = 0; i < 10; i++) {
      history.record({ command: `cmd${i}`, args: '', timestamp: i * 100, success: true });
    }
    const page1 = history.query({}, 3, 0);
    const page2 = history.query({}, 3, 3);
    expect(page1.length).toBe(3);
    expect(page2.length).toBe(3);
    expect(page1[0].command).not.toBe(page2[0].command);
  });
});

describe('Commands Integration', () => {
  it('integrates registry, pipeline, and history', async () => {
    const registry = new EnhancedCommandRegistry();
    const pipeline = new CommandPipeline();
    const history = new AdvancedCommandHistory();

    const cmd: CommandMetadata = {
      name: 'greet',
      description: 'Greets the user',
      category: CommandCategory.UTILITY,
      version: '1.0.0',
    };
    registry.register(cmd);

    pipeline.use({
      id: 'validate', stage: PipelineStage.PRE_VALIDATE, priority: 10,
      handler: async (ctx, next) => {
        if (!registry.get(ctx.commandName)) {
          ctx.abort = true;
          ctx.abortReason = `Unknown command: ${ctx.commandName}`;
          return;
        }
        await next();
      },
    });

    pipeline.use({
      id: 'exec', stage: PipelineStage.EXECUTE, priority: 10,
      handler: async (ctx, next) => {
        ctx.result = `Hello, ${ctx.args || 'World'}!`;
        await next();
      },
    });

    pipeline.use({
      id: 'record', stage: PipelineStage.POST_LOG, priority: 10,
      handler: async (ctx, next) => {
        history.record({
          command: ctx.commandName,
          args: ctx.args,
          timestamp: Date.now(),
          success: true,
          duration: ctx.duration,
        });
        await next();
      },
    });

    const result1 = await pipeline.execute('greet', 'Alice', {});
    expect(result1.success).toBe(true);
    expect(result1.result).toBe('Hello, Alice!');

    const result2 = await pipeline.execute('unknown', '');
    expect(result2.success).toBe(false);
    expect(result2.error).toContain('Unknown command');

    expect(history.getTotalCount()).toBe(1);
    expect(history.query({ command: 'greet' }).length).toBe(1);
  });
});
