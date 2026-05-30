/**
 * Example plugin for Liri
 * 包含命令和工具实现
 */

import type { Plugin, PluginContext, PluginMetadata } from '../../../src/plugins/types/Plugin';
import { PluginStatus } from '../../../src/plugins/types/Plugin';
import { HelloCommand } from './commands/HelloCommand';
import { StatusCommand } from './commands/StatusCommand';
import { GreetCommand } from './commands/GreetCommand';
import { FileInfoTool } from './tools/FileInfoTool';
import { DirSizeTool } from './tools/DirSizeTool';
import { SystemInfoTool } from './tools/SystemInfoTool';

/**
 * Example plugin class
 */
export class ExamplePlugin implements Plugin {
  /**
   * Plugin metadata
   */
  metadata: PluginMetadata = {
    name: 'example-plugin',
    version: '1.0.0',
    description: 'An example plugin for Liri with commands and tools',
    author: 'Liri Team',
    dependencies: []
  };
  
  /**
   * Plugin status
   */
  status: PluginStatus = PluginStatus.REGISTERED;
  
  /**
   * Plugin error
   */
  error?: Error;
  
  /**
   * Plugin configuration
   */
  private config: Record<string, unknown> = {};

  /**
   * Initialize the plugin
   */
  async initialize(context: PluginContext): Promise<void> {
    console.log('Example plugin initialized');
    this.status = PluginStatus.LOADED;
  }

  /**
   * Start the plugin
   */
  async start(): Promise<void> {
    console.log('Example plugin started');
    this.status = PluginStatus.ENABLED;
  }

  /**
   * Stop the plugin
   */
  async stop(): Promise<void> {
    console.log('Example plugin stopped');
    this.status = PluginStatus.DISABLED;
  }

  /**
   * Unload the plugin
   */
  async unload(): Promise<void> {
    console.log('Example plugin unloaded');
    this.status = PluginStatus.REGISTERED;
  }

  /**
   * Get commands provided by the plugin
   */
  getCommands() {
    return [
      new HelloCommand(),
      new StatusCommand(),
      new GreetCommand()
    ];
  }

  /**
   * Get tools provided by the plugin
   */
  getTools() {
    return [
      FileInfoTool,
      DirSizeTool,
      SystemInfoTool
    ];
  }
}

export default ExamplePlugin;
