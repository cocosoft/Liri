import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  mock,
  afterEach,
} from 'bun:test';
import {
  AdvancedStreamingProcessor,
  StreamState,
} from './streaming/AdvancedStreamingProcessor';
import type {
  StreamChunk,
  StreamSession,
} from './streaming/AdvancedStreamingProcessor';
import { SmartToolIntegrator } from './tool/SmartToolIntegrator';
import type { SmartTool, ToolContext } from './tool/SmartToolIntegrator';
import {
  CompleteSecuritySystem,
  SecurityLevel,
} from './security/CompleteSecuritySystem';
import type {
  AuditRecord,
  SecurityCheckResult,
} from './security/CompleteSecuritySystem';
import { ChatEcosystem } from './ecosystem/ChatEcosystem';
import type { Extension } from './ecosystem/ChatEcosystem';

describe('AdvancedStreamingProcessor', () => {
  let processor: AdvancedStreamingProcessor;

  beforeEach(() => {
    processor = new AdvancedStreamingProcessor(10, 100);
  });

  afterEach(() => {
    const sessions = processor.getAllSessions();
    for (const s of sessions) {
      processor.removeSession(s.id);
    }
  });

  it('creates stream session', () => {
    const id = processor.createSession({ user: 'test' });
    expect(id).toBeTruthy();
    const session = processor.getSession(id);
    expect(session).not.toBeNull();
    expect(session!.state).toBe(StreamState.ACTIVE);
    expect(session!.metadata?.user).toBe('test');
  });

  it('processes chunks correctly', () => {
    const id = processor.createSession();
    processor.processChunk(id, 'Hello ');
    processor.processChunk(id, 'World');
    const session = processor.getSession(id)!;
    expect(session.chunks.length).toBe(2);
    expect(session.chunks[0].content).toBe('Hello ');
    expect(session.chunks[1].content).toBe('World');
  });

  it('pauses and resumes stream', () => {
    const id = processor.createSession();
    expect(processor.pauseStream(id)).toBe(true);
    processor.processChunk(id, 'Buffered');
    const session = processor.getSession(id)!;
    expect(session.state).toBe(StreamState.PAUSED);
    expect(session.buffer.length).toBe(1);

    expect(processor.resumeStream(id)).toBe(true);
    const resumed = processor.getSession(id)!;
    expect(resumed.state).toBe(StreamState.ACTIVE);
    expect(resumed.chunks.length).toBe(1);
    expect(resumed.chunks[0].content).toBe('Buffered');
    expect(resumed.buffer.length).toBe(0);
  });

  it('cancels stream', () => {
    const id = processor.createSession();
    processor.processChunk(id, 'data');
    expect(processor.cancelStream(id)).toBe(true);
    const session = processor.getSession(id)!;
    expect(session.state).toBe(StreamState.CANCELLED);

    processor.processChunk(id, 'after cancel');
    expect(session.chunks.length).toBe(1);
  });

  it('completes stream and notifies listeners', () => {
    const id = processor.createSession();
    let completed = false;
    processor.onComplete((session) => {
      completed = true;
    });
    processor.processChunk(id, 'data');
    expect(processor['completeStream'](id)).toBe(true);
    expect(completed).toBe(true);
    const session = processor.getSession(id)!;
    expect(session.state).toBe(StreamState.COMPLETED);
    expect(session.metrics.endTime).toBeGreaterThan(0);
  });

  it('tracks stream metrics', async () => {
    const id = processor.createSession();
    processor.processChunk(id, 'Hello World');
    processor.processChunk(id, 'Foo Bar');
    await new Promise((r) => setTimeout(r, 5));
    processor['completeStream'](id);
    const metrics = processor.getSessionMetrics(id)!;
    expect(metrics.totalChunks).toBe(2);
    expect(metrics.totalBytes).toBe('Hello WorldFoo Bar'.length);
    expect(metrics.duration).toBeGreaterThan(0);
  });

  it('handles chunk and error callbacks', () => {
    const id = processor.createSession();
    const chunks: StreamChunk[] = [];
    processor.onChunk((chunk) => chunks.push(chunk));
    processor.processChunk(id, 'A');
    processor.processChunk(id, 'B');
    expect(chunks.length).toBe(2);
  });

  it('manages sessions with max limit', () => {
    const smallProcessor = new AdvancedStreamingProcessor(2);
    const id1 = smallProcessor.createSession();
    const id2 = smallProcessor.createSession();
    const id3 = smallProcessor.createSession();
    expect(smallProcessor.getAllSessions().length).toBe(2);
    expect(smallProcessor.getSession(id1)).toBeNull();
  });

  it('clears completed sessions', () => {
    const id1 = processor.createSession();
    const id2 = processor.createSession();
    processor['completeStream'](id1);
    processor.cancelStream(id2);
    const cleared = processor.clearCompletedSessions();
    expect(cleared).toBe(2);
    expect(processor.getAllSessions().length).toBe(0);
  });

  it('handles state change events', () => {
    const id = processor.createSession();
    const changes: Array<{ from: StreamState; to: StreamState }> = [];
    processor.onStateChange((sessionId, oldState, newState) => {
      changes.push({ from: oldState, to: newState });
    });
    processor.pauseStream(id);
    processor.resumeStream(id);
    processor.cancelStream(id);
    expect(changes.length).toBe(3);
    expect(changes[0].to).toBe(StreamState.PAUSED);
    expect(changes[1].to).toBe(StreamState.ACTIVE);
    expect(changes[2].to).toBe(StreamState.CANCELLED);
  });
});

describe('SmartToolIntegrator', () => {
  let integrator: SmartToolIntegrator;
  let testTool: SmartTool;

  beforeEach(() => {
    integrator = new SmartToolIntegrator(100, 5000, 1);
    testTool = {
      name: 'echo',
      description: 'Echoes input',
      version: '1.0.0',
      parameters: { message: { type: 'string', required: true } },
      execute: async (args) => ({ echoed: args.message }),
      validate: (args) => (args.message ? null : 'message is required'),
      timeout: 1000,
    };
  });

  afterEach(() => {
    integrator.clearCache();
    integrator.unregisterTool('echo');
  });

  it('registers and retrieves tool', () => {
    integrator.registerTool(testTool);
    const tool = integrator.getTool('echo');
    expect(tool).not.toBeNull();
    expect(tool!.name).toBe('echo');
  });

  it('throws on duplicate registration', () => {
    integrator.registerTool(testTool);
    expect(() => integrator.registerTool(testTool)).toThrow(
      'already registered'
    );
  });

  it('executes tool successfully', async () => {
    integrator.registerTool(testTool);
    const result = await integrator.executeTool(
      'echo',
      { message: 'hello' },
      { sessionId: 's1' }
    );
    expect(result.success).toBe(true);
    expect(result.result.echoed).toBe('hello');
    expect(result.executionTime).toBeGreaterThanOrEqual(0);
  });

  it('returns error for unknown tool', async () => {
    const result = await integrator.executeTool('unknown', {}, {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('validates tool parameters', async () => {
    integrator.registerTool(testTool);
    const result = await integrator.executeTool('echo', {}, {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Validation error');
  });

  it('retries on failure', async () => {
    const flakyTool: SmartTool = {
      name: 'flaky',
      description: 'Flaky tool',
      version: '1.0.0',
      parameters: {},
      execute: async () => {
        throw new Error('temporary');
      },
      timeout: 100,
    };
    integrator.registerTool(flakyTool);
    const result = await integrator.executeTool('flaky', {}, {});
    expect(result.success).toBe(false);
    expect(result.retryCount).toBe(1);
    integrator.unregisterTool('flaky');
  });

  it('executes multiple tools sequentially', async () => {
    integrator.registerTool(testTool);
    const results = await integrator.executeMultiple(
      [
        { name: 'echo', args: { message: 'a' } },
        { name: 'echo', args: { message: 'b' } },
      ],
      {}
    );
    expect(results.length).toBe(2);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(true);
  });

  it('validates tool compatibility', () => {
    integrator.registerTool(testTool);
    const report = integrator.validateCompatibility('echo', {});
    expect(report.compatible).toBe(true);
    expect(report.toolName).toBe('echo');
  });

  it('reports compatibility issues for missing context', () => {
    const ctxTool: SmartTool = {
      name: 'ctx_tool',
      description: 'Needs context',
      version: '1.0.0',
      parameters: {},
      execute: async () => ({}),
      requiredContext: ['userId', 'token'],
    };
    integrator.registerTool(ctxTool);
    const report = integrator.validateCompatibility('ctx_tool', {
      sessionId: 's1',
    });
    expect(report.compatible).toBe(false);
    expect(report.missingContext).toContain('userId');
    expect(report.missingContext).toContain('token');
    integrator.unregisterTool('ctx_tool');
  });

  it('recommends tools based on context', () => {
    integrator.registerTool(testTool);
    const ctxTool: SmartTool = {
      name: 'ctx_tool',
      description: 'Needs userId',
      version: '1.0.0',
      parameters: {},
      execute: async () => ({}),
      requiredContext: ['userId'],
    };
    integrator.registerTool(ctxTool);
    const recommended = integrator.getRecommendedTools({ userId: 'u1' }, 5);
    expect(recommended).toContain('ctx_tool');
    integrator.unregisterTool('ctx_tool');
  });

  it('tracks tool usage metrics', async () => {
    integrator.registerTool(testTool);
    await integrator.executeTool('echo', { message: 'a' }, {});
    await integrator.executeTool('echo', { message: 'b' }, {});
    const metrics = integrator.getToolUsageMetrics();
    expect(metrics.totalExecutions).toBe(2);
    expect(metrics.successfulExecutions).toBe(2);
    expect(metrics.byTool['echo'].total).toBe(2);
  });

  it('caches tool results', async () => {
    integrator.registerTool(testTool);
    const r1 = await integrator.executeTool(
      'echo',
      { message: 'cache' },
      { sessionId: 's1' }
    );
    const r2 = await integrator.executeTool(
      'echo',
      { message: 'cache' },
      { sessionId: 's1' }
    );
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
  });

  it('clears cache', () => {
    integrator.registerTool(testTool);
    const cleared = integrator.clearCache();
    expect(cleared).toBeGreaterThanOrEqual(0);
  });
});

describe('CompleteSecuritySystem', () => {
  let security: CompleteSecuritySystem;

  beforeEach(() => {
    security = new CompleteSecuritySystem(
      { enabled: true, enableAuditLog: true, enableContentFilter: true },
      100,
      100
    );
  });

  it('passes clean messages', async () => {
    const result = await security.checkMessageSecurity('Hello, how are you?');
    expect(result.passed).toBe(true);
    expect(result.category).toBe('clean');
  });

  it('blocks malicious content', async () => {
    const result = await security.checkMessageSecurity(
      '<script>alert("xss")</script>'
    );
    expect(result.passed).toBe(false);
    expect(result.details.length).toBeGreaterThan(0);
  });

  it('blocks SQL injection patterns', async () => {
    const result = await security.checkMessageSecurity('DROP TABLE users;');
    expect(result.passed).toBe(false);
  });

  it('blocks dangerous commands', async () => {
    const result = await security.checkMessageSecurity('Run: rm -rf /');
    expect(result.passed).toBe(false);
  });

  it('blocks code injection like eval', async () => {
    const result = await security.checkMessageSecurity('eval(someCode)');
    expect(result.passed).toBe(false);
  });

  it('rejects oversized input', async () => {
    const big = 'x'.repeat(200000);
    const result = await security.checkMessageSecurity(big);
    expect(result.passed).toBe(false);
  });

  it('detects dangerous tool commands', async () => {
    const result = await security.checkToolSecurity('shell', {
      cmd: 'rm -rf /',
    });
    expect(result.passed).toBe(false);
    expect(result.level).toBe(SecurityLevel.CRITICAL);
  });

  it('audits actions and retrieves logs', () => {
    security.auditAction({
      sessionId: 's1',
      action: 'send',
      actor: 'user1',
      target: 'msg1',
      result: 'allowed',
      level: SecurityLevel.LOW,
      details: 'OK',
    });
    security.auditAction({
      sessionId: 's1',
      action: 'delete',
      actor: 'user1',
      target: 'msg2',
      result: 'blocked',
      level: SecurityLevel.HIGH,
      details: 'Blocked',
    });
    const logs = security.getAuditLogs();
    expect(logs.length).toBe(2);
    const blocked = security.getAuditLogs({ result: 'blocked' });
    expect(blocked.length).toBe(1);
  });

  it('enforces rate limiting', () => {
    const sessionId = 'rate_test_session';
    expect(security.isRateLimited(sessionId)).toBe(false);
    for (let i = 0; i < 100; i++) {
      security.auditAction({
        sessionId,
        action: 'send',
        actor: 'u',
        target: 't',
        result: 'blocked',
        level: SecurityLevel.HIGH,
        details: '',
      });
    }
    expect(security.isRateLimited(sessionId)).toBe(true);
  });

  it('generates security report', async () => {
    await security.checkMessageSecurity('clean text');
    await security.checkMessageSecurity('<script>evil</script>');
    const report = security.getSecurityReport();
    expect(report.totalChecks).toBe(2);
    expect(report.passedChecks).toBe(1);
    expect(report.failedChecks).toBe(1);
    expect(report.securityScore).toBe(50);
  });

  it('updates config dynamically', () => {
    security.updateConfig({ enabled: false });
    const result = security.checkMessageSecurity('<script>alert(1)</script>');
    expect(result).resolves.toHaveProperty('passed', true);
  });

  it('checks session security', async () => {
    const result = await security.checkSessionSecurity('clean_session');
    expect(result.passed).toBe(true);
  });
});

describe('ChatEcosystem', () => {
  let ecosystem: ChatEcosystem;

  beforeEach(() => {
    ecosystem = new ChatEcosystem(100);
  });

  it('registers and retrieves extension', () => {
    const ext: Extension = {
      id: 'ext1',
      name: 'Logger',
      version: '1.0.0',
      description: 'Logs messages',
      hooks: {
        beforeSendMessage: async (ctx: any) => {
          console.log(ctx);
        },
      },
      priority: 10,
    };
    ecosystem.registerExtension(ext);
    const retrieved = ecosystem.getExtension('ext1');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.name).toBe('Logger');
  });

  it('throws on duplicate extension', () => {
    const ext: Extension = {
      id: 'dup',
      name: 'Dup',
      version: '1.0.0',
      description: '',
      hooks: {},
      priority: 0,
    };
    ecosystem.registerExtension(ext);
    expect(() => ecosystem.registerExtension(ext)).toThrow(
      'already registered'
    );
  });

  it('unregisters extension and removes hooks', () => {
    const ext: Extension = {
      id: 'ext2',
      name: 'Temp',
      version: '1.0.0',
      description: '',
      hooks: { beforeSendMessage: async () => {} },
      priority: 0,
    };
    ecosystem.registerExtension(ext);
    expect(ecosystem.unregisterExtension('ext2')).toBe(true);
    expect(ecosystem.getExtension('ext2')).toBeNull();
    expect(ecosystem.unregisterExtension('nonexistent')).toBe(false);
  });

  it('executes hooks in priority order', async () => {
    const results: number[] = [];
    const extLow: Extension = {
      id: 'low',
      name: 'Low',
      version: '1.0.0',
      description: '',
      hooks: {
        testHook: async () => {
          results.push(1);
        },
      },
      priority: 1,
    };
    const extHigh: Extension = {
      id: 'high',
      name: 'High',
      version: '1.0.0',
      description: '',
      hooks: {
        testHook: async () => {
          results.push(10);
        },
      },
      priority: 10,
    };
    ecosystem.registerExtension(extLow);
    ecosystem.registerExtension(extHigh);
    await ecosystem.executeHook('testHook', {});
    expect(results[0]).toBe(10);
    expect(results[1]).toBe(1);
  });

  it('finds extensions by hook', () => {
    const ext: Extension = {
      id: 'ext3',
      name: 'HookTest',
      version: '1.0.0',
      description: '',
      hooks: {
        beforeSendMessage: async () => {},
        afterSendMessage: async () => {},
      },
      priority: 0,
    };
    ecosystem.registerExtension(ext);
    const found = ecosystem.getExtensionsByHook('beforeSendMessage');
    expect(found.length).toBe(1);
    expect(found[0].id).toBe('ext3');
  });

  it('emits and listens to events', () => {
    const received: string[] = [];
    const unsubscribe = ecosystem.onEvent((event) => {
      received.push(event.type);
    });
    ecosystem.emitEvent('test.event', 'tester', { key: 'val' });
    expect(received).toContain('test.event');
    unsubscribe();
    ecosystem.emitEvent('after.unsub', 'tester', {});
    expect(received.length).toBe(1);
  });

  it('tracks ecosystem metrics', async () => {
    await new Promise((r) => setTimeout(r, 5));
    const ext: Extension = {
      id: 'metric_ext',
      name: 'Metric',
      version: '1.0.0',
      description: '',
      hooks: { beforeSendMessage: async () => {} },
      priority: 0,
    };
    ecosystem.registerExtension(ext);
    ecosystem.emitEvent('msg.sent', 'user1', {});
    const metrics = ecosystem.getMetrics();
    expect(metrics.totalExtensions).toBe(1);
    expect(metrics.totalHooks).toBeGreaterThanOrEqual(1);
    expect(metrics.totalEvents).toBeGreaterThanOrEqual(1);
    expect(metrics.uptime).toBeGreaterThan(0);
  });

  it('handles hook execution errors gracefully', async () => {
    const ext: Extension = {
      id: 'err_ext',
      name: 'ErrorProne',
      version: '1.0.0',
      description: '',
      hooks: {
        beforeSendMessage: async () => {
          throw new Error('hook error');
        },
      },
      priority: 0,
    };
    ecosystem.registerExtension(ext);
    const results = await ecosystem.executeHook('beforeSendMessage', {});
    expect(results.length).toBe(1);
    expect(results[0].error).toBe('hook error');
  });
});

describe('Chat Module Integration', () => {
  it('integrates streaming, tools, and security', async () => {
    const processor = new AdvancedStreamingProcessor();
    const integrator = new SmartToolIntegrator();
    const security = new CompleteSecuritySystem();

    const sessionId = processor.createSession({ role: 'assistant' });

    const secCheck = await security.checkMessageSecurity(
      'Hello, calculate 2+2'
    );
    expect(secCheck.passed).toBe(true);

    const calcTool: SmartTool = {
      name: 'calculator',
      description: 'Simple calculator',
      version: '1.0.0',
      parameters: { expr: { type: 'string', required: true } },
      execute: async (args) => ({ result: eval(args.expr) }),
      timeout: 1000,
    };
    integrator.registerTool(calcTool);

    processor.processChunk(sessionId, 'Calculating...');
    const toolResult = await integrator.executeTool(
      'calculator',
      { expr: '2+2' },
      { sessionId }
    );
    expect(toolResult.success).toBe(true);
    expect(toolResult.result.result).toBe(4);

    processor['completeStream'](sessionId);
    const metrics = processor.getSessionMetrics(sessionId);
    expect(metrics!.totalChunks).toBe(1);
    expect(metrics!.totalBytes).toBeGreaterThan(0);
  });

  it('ecosystem extends processing pipeline', async () => {
    const ecosystem = new ChatEcosystem();
    const plugin: Extension = {
      id: 'plugin1',
      name: 'StreamPlugin',
      version: '1.0.0',
      description: 'Extends stream processing',
      hooks: {
        beforeProcessStream: async (ctx) => ({ ...ctx, augmented: true }),
        onStreamChunk: async (ctx) => ctx,
      },
      priority: 5,
    };
    ecosystem.registerExtension(plugin);
    const results = await ecosystem.executeHook('beforeProcessStream', {
      data: 'test',
    });
    expect(results.length).toBe(1);
    expect(ecosystem.getExtensionsByHook('onStreamChunk').length).toBe(1);
  });
});
