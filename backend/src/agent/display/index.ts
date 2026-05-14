/**
 * Agent Display
 * 对标OpenClaw agents/tool-images.ts
 * 工具图片展示
 */

export interface ToolImage {
  name: string;
  type: 'emoji' | 'symbol' | 'ascii' | 'label';
  value: string;
  description?: string;
}

export interface ToolDisplayConfig {
  showIcons?: boolean;
  showColors?: boolean;
  compact?: boolean;
  maxDescriptionLength?: number;
}

const TOOL_IMAGES: Record<string, ToolImage> = {
  ReadFileTool: { name: 'Read', type: 'emoji', value: '📖', description: 'Read file contents' },
  WriteFileTool: { name: 'Write', type: 'emoji', value: '✏️', description: 'Write file contents' },
  EditFileTool: { name: 'Edit', type: 'emoji', value: '🔧', description: 'Edit file contents' },
  FileSearchTool: { name: 'Search', type: 'emoji', value: '🔍', description: 'Search file contents' },
  BashTool: { name: 'Bash', type: 'emoji', value: '💻', description: 'Execute bash commands' },
  WebFetchTool: { name: 'Fetch', type: 'emoji', value: '🌐', description: 'Fetch web content' },
  WebSearchTool: { name: 'Search', type: 'emoji', value: '🔎', description: 'Search the web' },
  LSPTool: { name: 'LSP', type: 'emoji', value: '📐', description: 'Language server operations' },
  AgentTool: { name: 'Agent', type: 'emoji', value: '🤖', description: 'Spawn sub-agent' },
  SessionsTool: { name: 'Sessions', type: 'emoji', value: '🔄', description: 'Manage sessions' },
  ScriptsTool: { name: 'Scripts', type: 'emoji', value: '📜', description: 'Manage scripts' },
};

const TOOL_SYMBOLS: Record<string, string> = {
  ReadFileTool: 'R',
  WriteFileTool: 'W',
  EditFileTool: 'E',
  FileSearchTool: 'S',
  BashTool: '>_',
  WebFetchTool: 'www',
  WebSearchTool: '?',
  LSPTool: '{}',
  AgentTool: 'AI',
  SessionsTool: '~>',
  ScriptsTool: '$',
};

export class ToolImageManager {
  private config: Required<ToolDisplayConfig>;
  private customImages: Map<string, ToolImage> = new Map();

  constructor(config?: ToolDisplayConfig) {
    this.config = {
      showIcons: config?.showIcons ?? true,
      showColors: config?.showColors ?? true,
      compact: config?.compact ?? false,
      maxDescriptionLength: config?.maxDescriptionLength ?? 50,
    };
  }

  getImage(toolName: string): ToolImage | undefined {
    return this.customImages.get(toolName) ?? TOOL_IMAGES[toolName];
  }

  setImage(toolName: string, image: ToolImage): void {
    this.customImages.set(toolName, image);
  }

  removeImage(toolName: string): boolean {
    return this.customImages.delete(toolName);
  }

  getDisplayString(toolName: string): string {
    if (!this.config.showIcons) return toolName;

    const image = this.getImage(toolName);
    if (!image) return toolName;

    if (this.config.compact) {
      const symbol = TOOL_SYMBOLS[toolName] ?? toolName[0];
      return `[${symbol}]`;
    }

    return `${image.value} ${image.name}`;
  }

  getDescription(toolName: string): string {
    const image = this.getImage(toolName);
    if (!image?.description) return toolName;

    const desc = image.description;
    if (desc.length > this.config.maxDescriptionLength) {
      return `${desc.slice(0, this.config.maxDescriptionLength)}...`;
    }

    return desc;
  }

  formatToolList(toolNames: string[]): string {
    const maxNameLen = Math.max(...toolNames.map((n) => n.length));

    const formatted = toolNames.map((name) => {
      const image = this.getDisplayString(name);
      const desc = this.getDescription(name);
      return `  ${image.padEnd(maxNameLen + 4)} ${desc}`;
    });

    return formatted.join('\n');
  }

  listAllImages(): ToolImage[] {
    const all = new Map<string, ToolImage>();

    for (const [name, image] of Object.entries(TOOL_IMAGES)) {
      all.set(name, image);
    }

    for (const [name, image] of this.customImages) {
      all.set(name, image);
    }

    return Array.from(all.values());
  }

  reset(): void {
    this.customImages.clear();
  }

  getConfig(): Readonly<Required<ToolDisplayConfig>> {
    return { ...this.config };
  }

  updateConfig(config: Partial<ToolDisplayConfig>): void {
    Object.assign(this.config, config);
  }
}

export function formatToolStatus(
  toolName: string,
  status: 'running' | 'success' | 'error' | 'idle',
  duration?: number,
): string {
  const statusSymbols: Record<string, string> = {
    running: '🔄',
    success: '✅',
    error: '❌',
    idle: '⏸️',
  };

  const symbol = statusSymbols[status] ?? '❓';
  const durationStr = duration !== undefined ? ` (${duration}ms)` : '';

  return `${symbol} ${toolName}${durationStr}`;
}

export function createToolImageManager(config?: ToolDisplayConfig): ToolImageManager {
  return new ToolImageManager(config);
}
