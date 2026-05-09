export enum CommandCategory {
  GENERAL = 'general',
  DEVELOPMENT = 'development',
  FILE_MANAGEMENT = 'file_management',
  SYSTEM = 'system',
  AI = 'ai',
  CHAT = 'chat',
  MEMORY = 'memory',
  CONFIG = 'config',
  SECURITY = 'security',
  NETWORK = 'network',
  TOOLS = 'tools',
  PLUGINS = 'plugins',
  UTILITY = 'utility',
}

export interface CommandPermission {
  role: string;
  allow: boolean;
}

export interface CommandDependency {
  name: string;
  version?: string;
  optional?: boolean;
}

export interface CommandMetadata {
  name: string;
  description: string;
  category: CommandCategory;
  version: string;
  author?: string;
  permissions?: CommandPermission[];
  dependencies?: CommandDependency[];
  tags?: string[];
  examples?: string[];
  timeout?: number;
  hidden?: boolean;
}

export interface DependencyGraph {
  nodes: Map<string, { metadata: CommandMetadata; dependents: Set<string> }>;
}

export interface IEnhancedCommandRegistry {
  register(metadata: CommandMetadata): void;
  unregister(name: string): boolean;
  get(name: string): CommandMetadata | null;
  findByCategory(category: CommandCategory): CommandMetadata[];
  findByTag(tag: string): CommandMetadata[];
  search(query: string): CommandMetadata[];
  checkPermission(name: string, role: string): boolean;
  resolveDependencies(name: string): string[];
  getDependencyGraph(): DependencyGraph;
  getCategoryTree(): Map<CommandCategory, CommandMetadata[]>;
  getAll(): CommandMetadata[];
}

export class EnhancedCommandRegistry implements IEnhancedCommandRegistry {
  private commands: Map<string, CommandMetadata> = new Map();
  private depGraph: Map<string, Set<string>> = new Map();

  register(metadata: CommandMetadata): void {
    if (this.commands.has(metadata.name)) {
      throw new Error(`Command already registered: ${metadata.name}`);
    }
    this.commands.set(metadata.name, metadata);

    if (metadata.dependencies) {
      const dependents = this.depGraph.get(metadata.name) || new Set();
      for (const dep of metadata.dependencies) {
        if (!dep.optional) {
          const deps = this.depGraph.get(dep.name) || new Set();
          deps.add(metadata.name);
          this.depGraph.set(dep.name, deps);
        }
      }
      this.depGraph.set(metadata.name, dependents);
    }
  }

  unregister(name: string): boolean {
    if (!this.commands.has(name)) return false;

    const dependents = this.depGraph.get(name);
    if (dependents && dependents.size > 0) {
      throw new Error(
        `Cannot unregister '${name}': depended on by [${[...dependents].join(', ')}]`
      );
    }

    for (const [, deps] of this.depGraph) {
      deps.delete(name);
    }
    this.depGraph.delete(name);
    this.commands.delete(name);
    return true;
  }

  get(name: string): CommandMetadata | null {
    return this.commands.get(name) || null;
  }

  findByCategory(category: CommandCategory): CommandMetadata[] {
    const result: CommandMetadata[] = [];
    for (const [, cmd] of this.commands) {
      if (cmd.category === category) result.push(cmd);
    }
    return result;
  }

  findByTag(tag: string): CommandMetadata[] {
    const result: CommandMetadata[] = [];
    for (const [, cmd] of this.commands) {
      if (cmd.tags?.includes(tag)) result.push(cmd);
    }
    return result;
  }

  search(query: string): CommandMetadata[] {
    const lower = query.toLowerCase();
    const result: CommandMetadata[] = [];
    for (const [, cmd] of this.commands) {
      if (
        cmd.name.toLowerCase().includes(lower) ||
        cmd.description.toLowerCase().includes(lower) ||
        cmd.tags?.some((t) => t.toLowerCase().includes(lower)) ||
        cmd.author?.toLowerCase().includes(lower)
      ) {
        result.push(cmd);
      }
    }
    return result;
  }

  checkPermission(name: string, role: string): boolean {
    const cmd = this.commands.get(name);
    if (!cmd || !cmd.permissions) return true;
    for (const perm of cmd.permissions) {
      if (perm.role === role) return perm.allow;
    }
    return true;
  }

  resolveDependencies(name: string): string[] {
    const resolved: string[] = [];
    const visited = new Set<string>();
    const visit = (current: string) => {
      if (visited.has(current)) return;
      visited.add(current);
      const cmd = this.commands.get(current);
      if (cmd?.dependencies) {
        for (const dep of cmd.dependencies) {
          visit(dep.name);
          if (!resolved.includes(dep.name)) resolved.push(dep.name);
        }
      }
      if (!resolved.includes(current)) resolved.push(current);
    };
    visit(name);
    return resolved;
  }

  getDependencyGraph(): DependencyGraph {
    const nodes: DependencyGraph['nodes'] = new Map();
    for (const [name, cmd] of this.commands) {
      const dependents = this.depGraph.get(name) || new Set();
      nodes.set(name, { metadata: cmd, dependents });
    }
    return { nodes };
  }

  getCategoryTree(): Map<CommandCategory, CommandMetadata[]> {
    const tree = new Map<CommandCategory, CommandMetadata[]>();
    for (const [, cmd] of this.commands) {
      const list = tree.get(cmd.category) || [];
      list.push(cmd);
      tree.set(cmd.category, list);
    }
    return tree;
  }

  getAll(): CommandMetadata[] {
    return [...this.commands.values()];
  }

  getCount(): number {
    return this.commands.size;
  }

  detectCircularDependencies(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recStack = new Set<string>();
    const path: string[] = [];

    const dfs = (name: string) => {
      if (recStack.has(name)) {
        const cycleStart = path.indexOf(name);
        if (cycleStart !== -1) {
          cycles.push(path.slice(cycleStart));
        }
        return;
      }
      if (visited.has(name)) return;

      visited.add(name);
      recStack.add(name);
      path.push(name);

      const cmd = this.commands.get(name);
      if (cmd?.dependencies) {
        for (const dep of cmd.dependencies) {
          if (this.commands.has(dep.name)) {
            dfs(dep.name);
          }
        }
      }

      path.pop();
      recStack.delete(name);
    };

    for (const [name] of this.commands) {
      dfs(name);
    }

    return cycles;
  }
}

export const enhancedCommandRegistry = new EnhancedCommandRegistry();
