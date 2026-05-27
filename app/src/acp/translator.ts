import type {
  AcpRuntime,
  AcpRuntimeHandle,
  AcpRuntimeEnsureInput,
  AcpRuntimeTurnInput,
  AcpRuntimeEvent,
  AcpRuntimeSessionMode,
  AcpRuntimePromptMode,
} from './runtime/types.js';

export class AcpGatewayAgent {
  private runtime: AcpRuntime;

  constructor(runtime: AcpRuntime) {
    this.runtime = runtime;
  }

  async ensureSession(input: AcpRuntimeEnsureInput): Promise<AcpRuntimeHandle> {
    return this.runtime.ensureSession(input);
  }

  async runTurn(
    input: AcpRuntimeTurnInput
  ): Promise<AsyncIterable<AcpRuntimeEvent>> {
    return this.runtime.runTurn(input);
  }

  async cancel(handle: AcpRuntimeHandle, reason?: string): Promise<void> {
    await this.runtime.cancel({ handle, reason });
  }

  async close(handle: AcpRuntimeHandle, reason: string): Promise<void> {
    await this.runtime.close({ handle, reason });
  }
}

export function createAcpGatewayAgent(runtime: AcpRuntime): AcpGatewayAgent {
  return new AcpGatewayAgent(runtime);
}
