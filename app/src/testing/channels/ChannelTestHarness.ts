import { MockChannel, MockChannelConfig } from './MockChannel.js';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'testing:channels:ChannelTestHarness',
  level: LogLevel.INFO,
});

export interface TestScenario {
  name: string;
  steps: TestStep[];
  timeout?: number;
}

export interface TestStep {
  action:
    | 'send'
    | 'receive'
    | 'simulate'
    | 'connect'
    | 'disconnect'
    | 'assert'
    | 'wait';
  payload?: Record<string, unknown>;
  expect?: Record<string, unknown>;
  timeout?: number;
}

export interface TestResult {
  scenarioName: string;
  success: boolean;
  steps: Array<{
    step: number;
    action: string;
    passed: boolean;
    error?: string;
    durationMs: number;
  }>;
  totalDurationMs: number;
  error?: string;
}

export class ChannelTestHarness {
  private channels: Map<string, MockChannel> = new Map();

  createChannel(config: MockChannelConfig): MockChannel {
    if (this.channels.has(config.id)) {
      throw new Error(`Channel ${config.id} already exists`);
    }

    const channel = new MockChannel(config);

    this.channels.set(config.id, channel);

    return channel;
  }

  getChannel(channelId: string): MockChannel | undefined {
    return this.channels.get(channelId);
  }

  removeChannel(channelId: string): boolean {
    return this.channels.delete(channelId);
  }

  clear(): void {
    this.channels.clear();
  }

  async runScenario(scenario: TestScenario): Promise<TestResult> {
    const startTime = Date.now();
    const stepResults: TestResult['steps'] = [];
    let scenarioSuccess = true;

    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i];
      const stepStart = Date.now();
      let passed = true;
      let error: string | undefined;

      try {
        await this.executeStep(step, scenario.timeout);

        if (step.expect) {
          passed = await this.verifyExpectations(step.expect);
        }
      } catch (err) {
        passed = false;
        error = err instanceof Error ? err.message : String(err);
        scenarioSuccess = false;

        if (step.action !== 'assert') {
          break;
        }
      }

      stepResults.push({
        step: i + 1,
        action: step.action,
        passed,
        error,
        durationMs: Date.now() - stepStart,
      });
    }

    return {
      scenarioName: scenario.name,
      success: scenarioSuccess,
      steps: stepResults,
      totalDurationMs: Date.now() - startTime,
      error: scenarioSuccess
        ? undefined
        : `Scenario "${scenario.name}" failed at step ${stepResults.findIndex((s) => !s.passed) + 1}`,
    };
  }

  async runScenarios(scenarios: TestScenario[]): Promise<TestResult[]> {
    const results: TestResult[] = [];

    for (const scenario of scenarios) {
      const result = await this.runScenario(scenario);

      results.push(result);
    }

    return results;
  }

  getSummary(results: TestResult[]): {
    total: number;
    passed: number;
    failed: number;
    avgDurationMs: number;
  } {
    const passed = results.filter((r) => r.success).length;

    return {
      total: results.length,
      passed,
      failed: results.length - passed,
      avgDurationMs:
        results.length > 0
          ? Math.round(
              results.reduce((sum, r) => sum + r.totalDurationMs, 0) /
                results.length
            )
          : 0,
    };
  }

  private async executeStep(
    step: TestStep,
    globalTimeout?: number
  ): Promise<void> {
    const timeout = step.timeout || globalTimeout || 5000;
    const timer = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`Step timed out after ${timeout}ms`)),
        timeout
      );
    });

    await Promise.race([this.doExecuteStep(step), timer]);
  }

  private async doExecuteStep(step: TestStep): Promise<void> {
    switch (step.action) {
      case 'connect': {
        const channelId = step.payload?.channelId as string;
        const channel = this.getRequiredChannel(channelId);

        await channel.connect();
        break;
      }

      case 'disconnect': {
        const channelId = step.payload?.channelId as string;
        const channel = this.getRequiredChannel(channelId);

        await channel.disconnect();
        break;
      }

      case 'send': {
        const channelId = step.payload?.channelId as string;
        const content = step.payload?.content as string;
        const sender = step.payload?.sender as string | undefined;
        const channel = this.getRequiredChannel(channelId);

        await channel.sendMessage(content, sender);
        break;
      }

      case 'simulate': {
        const channelId = step.payload?.channelId as string;
        const content = step.payload?.content as string;
        const sender = step.payload?.sender as string | undefined;
        const channel = this.getRequiredChannel(channelId);

        channel.simulateIncoming(content, sender);
        break;
      }

      case 'receive': {
        const channelId = step.payload?.channelId as string;
        const channel = this.getRequiredChannel(channelId);

        await channel.receiveMessage();
        break;
      }

      case 'wait': {
        const ms = (step.payload?.ms as number) || 100;

        await new Promise((resolve) => setTimeout(resolve, ms));
        break;
      }

      case 'assert': {
        if (step.expect) {
          const passed = await this.verifyExpectations(step.expect);

          if (!passed) {
            throw new Error('Assertion failed');
          }
        }
        break;
      }

      default:
        throw new Error(`Unknown action: ${step.action}`);
    }
  }

  private async verifyExpectations(
    expect: Record<string, unknown>
  ): Promise<boolean> {
    for (const [key, value] of Object.entries(expect)) {
      if (key === 'channelConnected') {
        const channel = this.channels.get(value as string);

        if (!channel || !channel.isConnected) {
          return false;
        }
      } else if (key === 'messageCount') {
        const [channelId, count] = value as [string, number];
        const channel = this.channels.get(channelId);

        if (!channel || channel.messages.length !== count) {
          return false;
        }
      } else if (key === 'lastMessageContent') {
        const [channelId, content] = value as [string, string];
        const channel = this.channels.get(channelId);

        if (!channel) {
          return false;
        }

        const lastMsg = channel.messages[channel.messages.length - 1];

        if (!lastMsg || lastMsg.content !== content) {
          return false;
        }
      } else if (key === 'channelExists') {
        if (!this.channels.has(value as string)) {
          return false;
        }
      }
    }

    return true;
  }

  private getRequiredChannel(channelId: string): MockChannel {
    const channel = this.channels.get(channelId);

    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    return channel;
  }
}
