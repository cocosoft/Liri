//
import { AgentTool } from '../models/types';
import { AgentStrategy } from '../models/types';
import { logger } from '@modules/utils/log';

interface AgentPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  initialize(config: PluginConfig): Promise<void>;
  activate(): Promise<void>;
  deactivate(): Promise<void>;
  getTools(): AgentTool[];
  getStrategies(): AgentStrategy[];
  getExtensions(): AgentExtension[];
}

interface PluginConfig {
  [key: string]: any;
}

interface AgentExtension {
  name: string;
  description: string;
  hooks: Record<string, string>;
  execute(context: Record<string, any>): Promise<Record<string, any>>;
}

interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  edges: DependencyEdge[];
}

interface DependencyNode {
  id: string;
  plugin: AgentPlugin;
  depth: number;
  resolved: boolean;
}

interface DependencyEdge {
  from: string;
  to: string;
  type: 'required' | 'optional';
}

interface Conflict {
  type: 'version' | 'capability' | 'resource';
  plugin1Id: string;
  plugin2Id: string;
  description: string;
  severity: 'error' | 'warning';
}

interface PluginSandbox {
  id: string;
  pluginId: string;
  allowedApis: string[];
  restrictedApis: string[];
  memoryLimit: number;
  timeLimit: number;
}

interface PluginLoadResult {
  success: boolean;
  plugin?: AgentPlugin;
  error?: string;
  loadTime: number;
}

export class PluginLoader {
  private plugins: Map<string, AgentPlugin> = new Map();
  private sandboxes: Map<string, PluginSandbox> = new Map();
  private loadHistory: PluginLoadResult[] = [];
  private pluginDir: string;

  constructor(pluginDir: string = '') {
    this.pluginDir = pluginDir;
  }

  async loadPlugin(pluginPath: string): Promise<AgentPlugin> {
    const startTime = Date.now();

    try {
      const pluginModule = await this.importPlugin(pluginPath);
      const plugin = pluginModule.default || pluginModule;

      if (!this.validatePlugin(plugin)) {
        throw new Error(`Invalid plugin structure at ${pluginPath}`);
      }

      if (this.plugins.has(plugin.id)) {
        const existing = this.plugins.get(plugin.id)!;
        if (!this.isVersionCompatible(existing.version, plugin.version)) {
          throw new Error(
            `Version conflict for plugin ${plugin.id}: existing ${existing.version}, loading ${plugin.version}`
          );
        }
      }

      const conflicts = this.detectConflicts(plugin);
      const errors = conflicts.filter(c => c.severity === 'error');
      if (errors.length > 0) {
        throw new Error(
          `Plugin conflicts detected: ${errors.map(e => e.description).join(', ')}`
        );
      }

      const sandbox = this.createSandbox(plugin);
      this.sandboxes.set(plugin.id, sandbox);

      await plugin.initialize({ sandboxId: sandbox.id });
      this.plugins.set(plugin.id, plugin);

      const loadTime = Date.now() - startTime;
      this.loadHistory.push({ success: true, plugin, loadTime });
      logger.info(`Loaded plugin ${plugin.id}@${plugin.version} in ${loadTime}ms`);

      return plugin;
    } catch (error) {
      const loadTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.loadHistory.push({ success: false, error: errorMessage, loadTime });
      logger.error(`Failed to load plugin from ${pluginPath}:`, errorMessage);
      throw error;
    }
  }

  async unloadPlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      logger.warn(`Plugin ${pluginId} not found, nothing to unload`);
      return;
    }

    try {
      await plugin.deactivate();
      this.plugins.delete(pluginId);
      this.sandboxes.delete(pluginId);
      logger.info(`Unloaded plugin ${pluginId}`);
    } catch (error) {
      logger.error(`Failed to unload plugin ${pluginId}:`, error);
      throw error;
    }
  }

  async activatePlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    const deps = this.resolveDependencies(plugin);
    for (const dep of deps.nodes.values()) {
      if (dep.plugin.id !== pluginId && !dep.resolved) {
        logger.warn(`Dependency ${dep.plugin.id} not resolved for plugin ${pluginId}`);
      }
    }

    await plugin.activate();
    logger.info(`Activated plugin ${pluginId}`);
  }

  async deactivatePlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    const dependents = this.findDependents(pluginId);
    for (const depId of dependents) {
      logger.warn(`Plugin ${depId} depends on ${pluginId}, deactivating first`);
      await this.deactivatePlugin(depId);
    }

    await plugin.deactivate();
    logger.info(`Deactivated plugin ${pluginId}`);
  }

  async hotReload(pluginId: string, newPluginPath: string): Promise<AgentPlugin> {
    logger.info(`Hot reloading plugin ${pluginId} from ${newPluginPath}`);

    await this.deactivatePlugin(pluginId);
    await this.unloadPlugin(pluginId);

    const plugin = await this.loadPlugin(newPluginPath);
    await this.activatePlugin(plugin.id);

    logger.info(`Hot reloaded plugin ${pluginId} -> ${plugin.id}@${plugin.version}`);
    return plugin;
  }

  getPlugin(pluginId: string): AgentPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  getPlugins(): AgentPlugin[] {
    return Array.from(this.plugins.values());
  }

  getActivePlugins(): AgentPlugin[] {
    return Array.from(this.plugins.values());
  }

  getPluginTools(): AgentTool[] {
    const tools: AgentTool[] = [];
    for (const plugin of this.plugins.values()) {
      tools.push(...plugin.getTools());
    }
    return tools;
  }

  getPluginStrategies(): AgentStrategy[] {
    const strategies: AgentStrategy[] = [];
    for (const plugin of this.plugins.values()) {
      strategies.push(...plugin.getStrategies());
    }
    return strategies;
  }

  getLoadHistory(): PluginLoadResult[] {
    return [...this.loadHistory];
  }

  resolveDependencies(plugin: AgentPlugin): DependencyGraph {
    const graph: DependencyGraph = {
      nodes: new Map(),
      edges: [],
    };

    this.buildDependencyGraph(plugin, graph, new Set(), 0);
    return graph;
  }

  detectConflicts(plugin: AgentPlugin): Conflict[] {
    const conflicts: Conflict[] = [];

    for (const [, existing] of this.plugins) {
      if (existing.id === plugin.id) continue;

      const existingTools = existing.getTools().map(t => t.name);
      const newTools = plugin.getTools().map(t => t.name);
      const sharedTools = existingTools.filter(t => newTools.includes(t));

      if (sharedTools.length > 0) {
        conflicts.push({
          type: 'capability',
          plugin1Id: existing.id,
          plugin2Id: plugin.id,
          description: `Shared tool names: ${sharedTools.join(', ')}`,
          severity: 'warning',
        });
      }
    }

    return conflicts;
  }

  private async importPlugin(pluginPath: string): Promise<any> {
    try {
      return await import(pluginPath);
    } catch (error) {
      throw new Error(`Cannot import plugin from ${pluginPath}: ${error}`);
    }
  }

  private validatePlugin(plugin: any): plugin is AgentPlugin {
    return (
      typeof plugin.id === 'string' &&
      typeof plugin.name === 'string' &&
      typeof plugin.version === 'string' &&
      typeof plugin.initialize === 'function' &&
      typeof plugin.activate === 'function' &&
      typeof plugin.deactivate === 'function' &&
      typeof plugin.getTools === 'function' &&
      typeof plugin.getStrategies === 'function' &&
      typeof plugin.getExtensions === 'function'
    );
  }

  private isVersionCompatible(existing: string, incoming: string): boolean {
    const existingParts = existing.split('.').map(Number);
    const incomingParts = incoming.split('.').map(Number);

    for (let i = 0; i < Math.max(existingParts.length, incomingParts.length); i++) {
      const e = existingParts[i] || 0;
      const inc = incomingParts[i] || 0;
      if (inc > e) return true;
      if (inc < e) return false;
    }
    return true;
  }

  private createSandbox(plugin: AgentPlugin): PluginSandbox {
    return {
      id: `sandbox_${plugin.id}_${Date.now()}`,
      pluginId: plugin.id,
      allowedApis: ['fs.read', 'fs.write', 'network.fetch'],
      restrictedApis: ['process.exit', 'child_process'],
      memoryLimit: 50 * 1024 * 1024,
      timeLimit: 30000,
    };
  }

  private buildDependencyGraph(
    plugin: AgentPlugin,
    graph: DependencyGraph,
    visited: Set<string>,
    depth: number
  ): void {
    if (visited.has(plugin.id)) return;
    visited.add(plugin.id);

    const node: DependencyNode = {
      id: plugin.id,
      plugin,
      depth,
      resolved: this.plugins.has(plugin.id),
    };
    graph.nodes.set(plugin.id, node);

    const extensions = plugin.getExtensions();
    for (const ext of extensions) {
      for (const [, hookFn] of Object.entries(ext.hooks)) {
        const depId = hookFn.split('.')[0];
        if (depId && depId !== plugin.id && !visited.has(depId)) {
          graph.edges.push({
            from: plugin.id,
            to: depId,
            type: 'optional',
          });
        }
      }
    }
  }

  private findDependents(pluginId: string): string[] {
    const dependents: string[] = [];
    for (const [, plugin] of this.plugins) {
      const deps = this.resolveDependencies(plugin);
      for (const edge of deps.edges) {
        if (edge.to === pluginId) {
          dependents.push(plugin.id);
        }
      }
    }
    return dependents;
  }
}
