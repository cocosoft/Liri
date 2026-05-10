import type {
  AgentService,
  AIAgent,
  AgentTool,
  AgentStrategy,
  AgentMemory,
  AgentTask,
  AgentResponse,
} from './models/types';
import { AgentState } from './models/types';
import { createAgentService } from './services/agentService';
import { AIAgentImpl } from './agent';
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

import { AgentRunner } from './AgentRunner';
import { AgentColorManager, AGENT_COLORS } from './utils/AgentColorManager';
import type { AgentColorName } from './utils/AgentColorManager';
import {
  loadAgentsDir,
  loadUserAgents,
  loadProjectAgents,
  loadLocalAgents,
  loadManagedAgents,
} from './utils/agentLoader';

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
  // Agent Runner
  AgentRunner,
  // Agent Color
  AgentColorManager,
  AgentColorName,
  AGENT_COLORS,
  // Agent Loader
  loadAgentsDir,
  loadUserAgents,
  loadProjectAgents,
  loadLocalAgents,
  loadManagedAgents,
};

const agentService = createAgentService();
export default agentService;
