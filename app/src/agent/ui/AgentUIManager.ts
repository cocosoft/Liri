//
import {
  AIAgent,
  AgentState,
  AgentConfig,
  AgentTask,
  AgentResponse,
} from '../models/types';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'agent:ui:agentUIManager',
  level: LogLevel.INFO,
});
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

interface AgentCommand {
  type: 'start' | 'stop' | 'pause' | 'resume' | 'configure' | 'execute';
  agentId: string;
  payload?: Record<string, unknown>;
  timestamp: number;
}

interface AgentData {
  id: string;
  name: string;
  state: AgentState;
  config: AgentConfig;
  stats: {
    tasksCompleted: number;
    tasksFailed: number;
    averageResponseTime: number;
    uptime: number;
  };
  lastActivity: number;
}

interface DashboardProps {
  agents: AgentData[];
  systemStatus: SystemStatus;
  alerts: Alert[];
}

interface SystemStatus {
  healthy: boolean;
  totalAgents: number;
  activeAgents: number;
  cpuUsage: number;
  memoryUsage: number;
  uptime: number;
}

interface Alert {
  id: string;
  type: 'info' | 'warning' | 'error';
  message: string;
  agentId?: string;
  timestamp: number;
}

interface StateCallback {
  (agentId: string, state: AgentState, data?: any): void;
}

interface EventSubscription {
  id: string;
  agentId: string;
  eventType: string;
  callback: (...args: any[]) => void;
}

export class AgentUIManager {
  private subscriptions: Map<string, EventSubscription> = new Map();
  private alerts: Alert[] = [];
  private agents: Map<string, AIAgent> = new Map();
  private commandHistory: AgentCommand[] = [];
  private maxAlerts: number = 100;
  private maxCommandHistory: number = 1000;
  private eventListeners: Map<string, Set<(...args: any[]) => void>> =
    new Map();

  registerAgent(agent: AIAgent): void {
    this.agents.set(agent.id, agent);
    this.emit('agent:registered', agent.id, agent.getInfo());
    logger.info(`Agent ${agent.id} registered with UI manager`);
  }

  unregisterAgent(agentId: string): void {
    this.agents.delete(agentId);
    this.emit('agent:unregistered', agentId);
    logger.info(`Agent ${agentId} unregistered from UI manager`);
  }

  subscribeToAgentState(agentId: string, callback: StateCallback): string {
    const subscriptionId = `sub_${agentId}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const subscription: EventSubscription = {
      id: subscriptionId,
      agentId,
      eventType: 'state_change',
      callback,
    };
    this.subscriptions.set(subscriptionId, subscription);
    return subscriptionId;
  }

  unsubscribe(subscriptionId: string): void {
    this.subscriptions.delete(subscriptionId);
  }

  async sendCommand(agentId: string, command: AgentCommand): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new AppError(
        `Agent ${agentId} not found`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    this.commandHistory.push(command);
    if (this.commandHistory.length > this.maxCommandHistory) {
      this.commandHistory = this.commandHistory.slice(-this.maxCommandHistory);
    }

    this.emit('command:sent', agentId, command);

    switch (command.type) {
      case 'start':
        agent.resume();
        break;
      case 'stop':
        agent.stop();
        break;
      case 'pause':
        agent.pause();
        break;
      case 'resume':
        agent.resume();
        break;
      case 'execute':
        if (command.payload) {
          const task: AgentTask = {
            id: `ui_${Date.now()}`,
            name:
              ((command.payload as Record<string, unknown>).name as string) ||
              'UI Task',
            description:
              ((command.payload as Record<string, unknown>)
                .description as string) || '',
            input:
              ((command.payload as Record<string, unknown>).input as Record<
                string,
                unknown
              >) || {},
          };
          const response = await agent.execute(task);
          this.emit('task:completed', agentId, response);
        }
        break;
      default:
        logger.warn(`Unknown command type: ${command.type}`);
    }
  }

  async syncAgentData(agentId: string): Promise<AgentData> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new AppError(
        `Agent ${agentId} not found`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const info = agent.getInfo();
    return {
      id: agent.id,
      name: agent.name,
      state: agent.state,
      config: agent.config,
      stats: {
        tasksCompleted: 0,
        tasksFailed: 0,
        averageResponseTime: 0,
        uptime: Date.now(),
      },
      lastActivity: Date.now(),
    };
  }

  getDashboardData(): DashboardProps {
    const agentsData: AgentData[] = [];
    for (const [, agent] of this.agents) {
      agentsData.push({
        id: agent.id,
        name: agent.name,
        state: agent.state,
        config: agent.config,
        stats: {
          tasksCompleted: 0,
          tasksFailed: 0,
          averageResponseTime: 0,
          uptime: Date.now(),
        },
        lastActivity: Date.now(),
      });
    }

    return {
      agents: agentsData,
      systemStatus: this.getSystemStatus(),
      alerts: this.getAlerts(),
    };
  }

  getSystemStatus(): SystemStatus {
    let activeAgents = 0;
    for (const [, agent] of this.agents) {
      if (agent.state === AgentState.BUSY) {
        activeAgents++;
      }
    }

    return {
      healthy: this.agents.size > 0,
      totalAgents: this.agents.size,
      activeAgents,
      cpuUsage: 0,
      memoryUsage: 0,
      uptime: Date.now(),
    };
  }

  addAlert(type: Alert['type'], message: string, agentId?: string): void {
    const alert: Alert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      type,
      message,
      agentId,
      timestamp: Date.now(),
    };

    this.alerts.push(alert);
    if (this.alerts.length > this.maxAlerts) {
      this.alerts = this.alerts.slice(-this.maxAlerts);
    }

    this.emit('alert:new', alert);
    logger[type === 'error' ? 'error' : type === 'warning' ? 'warn' : 'info'](
      `UI Alert [${type}]: ${message}${agentId ? ` (agent: ${agentId})` : ''}`
    );
  }

  getAlerts(): Alert[] {
    return [...this.alerts];
  }

  clearAlerts(): void {
    this.alerts = [];
    this.emit('alerts:cleared');
  }

  getCommandHistory(agentId?: string): AgentCommand[] {
    if (agentId) {
      return this.commandHistory.filter((c) => c.agentId === agentId);
    }
    return [...this.commandHistory];
  }

  on(event: string, listener: (...args: any[]) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener);
  }

  off(event: string, listener: (...args: any[]) => void): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  notifyStateChange(agentId: string, newState: AgentState, data?: any): void {
    for (const [, subscription] of this.subscriptions) {
      if (subscription.agentId === agentId || subscription.agentId === '*') {
        try {
          subscription.callback(agentId, newState, data);
        } catch (error) {
          logger.error(
            `State change callback failed for subscription ${subscription.id}:`,
            error as Error
          );
        }
      }
    }

    this.emit('agent:state_change', agentId, newState, data);
  }

  getRegisteredAgents(): string[] {
    return Array.from(this.agents.keys());
  }

  getAgentCount(): number {
    return this.agents.size;
  }

  shutdown(): void {
    this.subscriptions.clear();
    this.alerts = [];
    this.commandHistory = [];
    this.agents.clear();
    this.eventListeners.clear();
    logger.info('AgentUIManager shut down');
  }

  private emit(event: string, ...args: any[]): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(...args);
        } catch (error) {
          logger.error(`Event listener failed for ${event}:`, error as Error);
        }
      }
    }
  }
}
