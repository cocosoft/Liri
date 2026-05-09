import type { AgentService } from './models/types';
import { createAgentService } from './services/agentService';
import { AIAgentImpl } from './agent';
import type { AIAgent } from './models/types';
import {
  AgentTool,
  AgentStrategy,
  AgentMemory,
  AgentTask,
  AgentResponse,
  AgentState,
} from './models/types';
import { GeneralAgentStrategy } from './strategies/GeneralAgentStrategy';
import { CodeAgentStrategy } from './strategies/CodeAgentStrategy';
import { ExploreAgentStrategy } from './strategies/ExploreAgentStrategy';
import { PlanAgentStrategy } from './strategies/PlanAgentStrategy';

import { MultiSourceAgentManager } from './managers/MultiSourceAgentManager';
import { PluginLoader } from './managers/PluginLoader';
import { AgentSourceManager } from './managers/AgentSourceManager';
import { AgentConfigManager } from './managers/AgentConfigManager';
import { AdvancedMemorySystem } from './memory/AdvancedMemorySystem';
import { AgentUIManager } from './ui/AgentUIManager';

import { AgentSwarmManager, SwarmCoordinator } from './swarms';
import {
  RemoteAgentExecutorImpl,
  createRemoteAgentExecutor,
  WebSocketProtocol,
  HttpProtocol,
} from './remote';

export {
  AgentService,
  createAgentService,
  AIAgent,
  AgentTool,
  AgentStrategy,
  AgentMemory,
  AgentTask,
  AgentResponse,
  AgentState,
  GeneralAgentStrategy,
  CodeAgentStrategy,
  ExploreAgentStrategy,
  PlanAgentStrategy,
  MultiSourceAgentManager,
  PluginLoader,
  AgentSourceManager,
  AgentConfigManager,
  AdvancedMemorySystem,
  AgentUIManager,
  // Swarms
  AgentSwarmManager,
  SwarmCoordinator,
  // Remote
  RemoteAgentExecutorImpl,
  createRemoteAgentExecutor,
  WebSocketProtocol,
  HttpProtocol,
};

const agentService = createAgentService();
export default agentService;
