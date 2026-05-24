import type {
  AcpRuntime,
  AcpRuntimeHandle,
  AcpRuntimeEnsureInput,
  AcpRuntimeTurnInput,
  AcpRuntimeEvent,
  AcpRuntimeCapabilities,
  AcpRuntimeStatus,
  AcpRuntimeDoctorReport,
} from './types.js';

export interface MockAcpRuntimeOptions {
  ensureSessionResult?: AcpRuntimeHandle;
  runTurnEvents?: AcpRuntimeEvent[];
  capabilities?: AcpRuntimeCapabilities;
  status?: AcpRuntimeStatus;
  doctorResult?: AcpRuntimeDoctorReport;
  shouldFail?: boolean;
  failureMessage?: string;
}

export class MockAcpRuntime implements AcpRuntime {
  private options: MockAcpRuntimeOptions;
  public ensureSessionCalls: AcpRuntimeEnsureInput[] = [];
  public runTurnCalls: AcpRuntimeTurnInput[] = [];
  public cancelCalls: { handle: AcpRuntimeHandle; reason?: string }[] = [];
  public closeCalls: { handle: AcpRuntimeHandle; reason: string }[] = [];

  constructor(options: MockAcpRuntimeOptions = {}) {
    this.options = {
      ensureSessionResult: {
        sessionKey: 'test-session',
        backend: 'mock',
        runtimeSessionName: 'mock-runtime',
      },
      runTurnEvents: [
        { type: 'text_delta', text: 'Hello from mock' },
        { type: 'done', stopReason: 'endTurn' },
      ],
      capabilities: {
        supportsModes: true,
        supportsConfigOptions: true,
        supportsAttachments: false,
        maxPromptLength: 10000,
      },
      status: {
        connected: true,
        sessionActive: true,
        lastActivity: Date.now(),
      },
      doctorResult: {
        healthy: true,
        checks: [{ name: 'connectivity', passed: true }],
      },
      shouldFail: false,
      ...options,
    };
  }

  async ensureSession(input: AcpRuntimeEnsureInput): Promise<AcpRuntimeHandle> {
    this.ensureSessionCalls.push(input);
    if (this.options.shouldFail) {
      throw new Error(this.options.failureMessage || 'mock ensureSession failed');
    }
    return this.options.ensureSessionResult!;
  }

  async *runTurn(input: AcpRuntimeTurnInput): AsyncIterable<AcpRuntimeEvent> {
    this.runTurnCalls.push(input);
    if (this.options.shouldFail) {
      throw new Error(this.options.failureMessage || 'mock runTurn failed');
    }
    for (const event of this.options.runTurnEvents!) {
      yield event;
    }
  }

  async getCapabilities(): Promise<AcpRuntimeCapabilities> {
    return this.options.capabilities!;
  }

  async getStatus(): Promise<AcpRuntimeStatus> {
    return this.options.status!;
  }

  async setMode(): Promise<void> {}

  async setConfigOption(): Promise<void> {}

  async doctor(): Promise<AcpRuntimeDoctorReport> {
    return this.options.doctorResult!;
  }

  async cancel(input: { handle: AcpRuntimeHandle; reason?: string }): Promise<void> {
    this.cancelCalls.push(input);
  }

  async close(input: { handle: AcpRuntimeHandle; reason: string }): Promise<void> {
    this.closeCalls.push(input);
  }
}

export function createMockAcpRuntime(options?: MockAcpRuntimeOptions): MockAcpRuntime {
  return new MockAcpRuntime(options);
}

export function createMockAcpRuntimeHandle(overrides?: Partial<AcpRuntimeHandle>): AcpRuntimeHandle {
  return {
    sessionKey: 'test-session',
    backend: 'mock-backend',
    runtimeSessionName: 'mock-runtime',
    ...overrides,
  };
}

export function createMockDoctorReport(healthy: boolean = true): AcpRuntimeDoctorReport {
  return {
    healthy,
    checks: [
      {
        name: 'connectivity',
        passed: healthy,
        message: healthy ? undefined : 'connectivity check failed',
      },
    ],
  };
}
