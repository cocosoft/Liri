/**
 * 远程Agent执行器
 */

import { 
  RemoteAgentExecutor, 
  RemoteAgentTask, 
  RemoteExecutionResult, 
  RemoteAgentConfig,
  SessionStatus
} from './types';
import { WebSocketProtocol, HttpProtocol } from './RemoteAgentProtocol';
import { RemoteAgentProtocol, ProtocolType } from './types';

export class RemoteAgentExecutorImpl implements RemoteAgentExecutor {
  private protocol: RemoteAgentProtocol;
  private config: RemoteAgentConfig;
  private sessionStatus: SessionStatus = 'disconnected';
  private sessionId: string = '';

  constructor(config: RemoteAgentConfig) {
    this.config = config;
    this.protocol = this.createProtocol(config);
  }

  private createProtocol(config: RemoteAgentConfig): RemoteAgentProtocol {
    switch (config.protocol) {
      case 'websocket':
        return new WebSocketProtocol(config.options);
      case 'http':
      default:
        return new HttpProtocol(config.options);
    }
  }

  async connect(): Promise<void> {
    try {
      await this.protocol.connect(this.config.url);
      this.sessionStatus = 'connected';
      this.sessionId = `session_${Date.now()}`;
    } catch (error) {
      this.sessionStatus = 'error';
      throw error;
    }
  }

  disconnect(): void {
    this.protocol.disconnect();
    this.sessionStatus = 'disconnected';
    this.sessionId = '';
  }

  async execute(agentId: string, task: Omit<RemoteAgentTask, 'agentId'>): Promise<RemoteExecutionResult> {
    if (this.sessionStatus !== 'connected') {
      throw new Error('Not connected to remote agent');
    }

    const remoteTask: RemoteAgentTask = {
      ...task,
      agentId,
    };

    try {
      const result = await this.protocol.send(remoteTask);
      return {
        ...result,
        sessionId: this.sessionId,
      };
    } catch (error) {
      // 尝试重连
      if (this.config.protocol === 'websocket') {
        try {
          await this.connect();
          const result = await this.protocol.send(remoteTask);
          return {
            ...result,
            sessionId: this.sessionId,
          };
        } catch (reconnectError) {
          this.sessionStatus = 'error';
          throw reconnectError;
        }
      }
      
      throw error;
    }
  }

  getStatus(): SessionStatus {
    return this.sessionStatus;
  }

  getSessionId(): string {
    return this.sessionId;
  }
}

/**
 * 创建远程Agent执行器
 */
export function createRemoteAgentExecutor(config: RemoteAgentConfig): RemoteAgentExecutor {
  return new RemoteAgentExecutorImpl(config);
}