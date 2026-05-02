/**
 * Agent源管理器
 * 负责从不同来源加载Agent定义，支持热加载
 */

import { AgentDefinition } from '../models/types';
import { getBuiltInAgents } from '../strategies/agentStrategy';
import { loadPluginAgents } from '../../plugins/PluginLoader';
import { SettingSource } from '../../config/constants';
import { loadUserAgents, loadProjectAgents, loadManagedAgents, loadLocalAgents } from '../utils/agentLoader';
import { DirectoryWatcher, WatchEvent } from '../utils/directoryWatcher';

/**
 * Agent源类型
 */
export type AgentSource = 'built-in' | 'user' | 'project' | 'local' | 'managed' | 'plugin';

/**
 * Agent源优先级
 */
export const AGENT_SOURCE_PRIORITY: Record<AgentSource, number> = {
  'user': 1,      // 用户定义的Agent优先级最高
  'project': 2,    // 项目级Agent次之
  'managed': 3,    // 管理级Agent
  'plugin': 4,     // 插件Agent
  'local': 5,      // 本地Agent
  'built-in': 6    // 内置Agent优先级最低
};

/**
 * 热加载回调类型
 */
export type HotReloadCallback = (event: 'added' | 'updated' | 'removed', agent?: AgentDefinition) => void;

/**
 * Agent源管理器
 */
export class AgentSourceManager {
  private agents: Map<string, AgentDefinition> = new Map();
  private allAgents: AgentDefinition[] = [];
  private failedFiles: Array<{ path: string; error: string }> = [];
  private directoryWatcher: DirectoryWatcher;
  private hotReloadCallbacks: HotReloadCallback[] = [];
  private isHotReloadEnabled: boolean = false;

  constructor() {
    this.directoryWatcher = new DirectoryWatcher(1000);
    this.setupDirectoryWatcher();
  }

  /**
   * 设置目录监控
   */
  private setupDirectoryWatcher(): void {
    this.directoryWatcher.onEvent((event: WatchEvent) => {
      if (!this.isHotReloadEnabled) {
        return;
      }

      // 只处理支持的文件格式
      const supportedExtensions = ['.md', '.yaml', '.yml', '.json'];
      const isSupported = supportedExtensions.some(ext => event.filePath.endsWith(ext));
      
      if (!isSupported) {
        return;
      }

      switch (event.type) {
        case 'add':
          this.handleFileAdded(event.filePath);
          break;
        case 'change':
          this.handleFileChanged(event.filePath);
          break;
        case 'unlink':
          this.handleFileRemoved(event.filePath);
          break;
      }
    });
  }

  /**
   * 处理文件添加
   */
  private async handleFileAdded(filePath: string): Promise<void> {
    try {
      // 重新加载所有Agent
      await this.reloadAgents();
      this.notifyHotReload('added');
    } catch (error) {
      console.error(`Failed to load new agent file: ${filePath}`, error);
    }
  }

  /**
   * 处理文件修改
   */
  private async handleFileChanged(filePath: string): Promise<void> {
    try {
      await this.reloadAgents();
      this.notifyHotReload('updated');
    } catch (error) {
      console.error(`Failed to reload changed agent file: ${filePath}`, error);
    }
  }

  /**
   * 处理文件删除
   */
  private async handleFileRemoved(filePath: string): Promise<void> {
    try {
      // 移除对应的Agent
      this.allAgents = this.allAgents.filter(agent => agent.filename !== filePath);
      this.agents.forEach((agent, key) => {
        if (agent.filename === filePath) {
          this.agents.delete(key);
        }
      });
      this.notifyHotReload('removed');
    } catch (error) {
      console.error(`Failed to remove agent: ${filePath}`, error);
    }
  }

  /**
   * 通知热加载回调
   */
  private notifyHotReload(event: 'added' | 'updated' | 'removed', agent?: AgentDefinition): void {
    for (const callback of this.hotReloadCallbacks) {
      try {
        callback(event, agent);
      } catch (error) {
        console.error('Error in hot reload callback:', error);
      }
    }
  }

  /**
   * 启用热加载
   */
  enableHotReload(): void {
    this.isHotReloadEnabled = true;
    
    // 监控用户和项目Agent目录
    const userAgentsDir = require('path').join(
      process.env.HOME || process.env.USERPROFILE || '', '.py_app', 'agents'
    );
    const projectAgentsDir = require('path').join(process.cwd(), '.py_app', 'agents');
    
    this.directoryWatcher.watchDirectory(userAgentsDir);
    this.directoryWatcher.watchDirectory(projectAgentsDir);
  }

  /**
   * 禁用热加载
   */
  disableHotReload(): void {
    this.isHotReloadEnabled = false;
    this.directoryWatcher.stopAll();
  }

  /**
   * 添加热加载回调
   */
  onHotReload(callback: HotReloadCallback): void {
    this.hotReloadCallbacks.push(callback);
  }

  /**
   * 移除热加载回调
   */
  offHotReload(callback: HotReloadCallback): void {
    const index = this.hotReloadCallbacks.indexOf(callback);
    if (index !== -1) {
      this.hotReloadCallbacks.splice(index, 1);
    }
  }

  /**
   * 加载所有来源的Agent
   */
  async loadAllAgents(): Promise<void> {
    this.agents.clear();
    this.allAgents = [];
    this.failedFiles = [];

    // 1. 加载内置Agent
    await this.loadBuiltInAgents();

    // 2. 加载本地Agent
    await this.loadLocalAgents();

    // 3. 加载管理级Agent
    await this.loadManagedAgents();

    // 4. 加载项目级Agent
    await this.loadProjectAgents();

    // 5. 加载用户级Agent
    await this.loadUserAgents();

    // 6. 加载插件Agent
    await this.loadPluginAgents();

    // 按优先级排序
    this.allAgents.sort((a, b) => {
      const priorityA = AGENT_SOURCE_PRIORITY[a.source as AgentSource] || 999;
      const priorityB = AGENT_SOURCE_PRIORITY[b.source as AgentSource] || 999;
      return priorityA - priorityB;
    });
  }

  /**
   * 加载内置Agent
   */
  private async loadBuiltInAgents(): Promise<void> {
    try {
      const builtInAgents = getBuiltInAgents();
      builtInAgents.forEach(agent => {
        this.addAgent(agent);
      });
    } catch (error) {
      this.failedFiles.push({
        path: 'built-in',
        error: (error as Error).message
      });
    }
  }

  /**
   * 加载本地Agent
   */
  private async loadLocalAgents(): Promise<void> {
    try {
      const localAgents = await loadLocalAgents();
      localAgents.forEach(agent => {
        this.addAgent({ ...agent, source: 'local' as AgentSource });
      });
    } catch (error) {
      this.failedFiles.push({
        path: 'local',
        error: (error as Error).message
      });
    }
  }

  /**
   * 加载管理级Agent
   */
  private async loadManagedAgents(): Promise<void> {
    try {
      const managedAgents = await loadManagedAgents();
      managedAgents.forEach(agent => {
        this.addAgent({ ...agent, source: 'managed' as AgentSource });
      });
    } catch (error) {
      this.failedFiles.push({
        path: 'managed',
        error: (error as Error).message
      });
    }
  }

  /**
   * 加载项目级Agent
   */
  private async loadProjectAgents(): Promise<void> {
    try {
      const projectAgents = await loadProjectAgents();
      projectAgents.forEach(agent => {
        this.addAgent({ ...agent, source: 'project' as AgentSource });
      });
    } catch (error) {
      this.failedFiles.push({
        path: 'project',
        error: (error as Error).message
      });
    }
  }

  /**
   * 加载用户级Agent
   */
  private async loadUserAgents(): Promise<void> {
    try {
      const userAgents = await loadUserAgents();
      userAgents.forEach(agent => {
        this.addAgent({ ...agent, source: 'user' as AgentSource });
      });
    } catch (error) {
      this.failedFiles.push({
        path: 'user',
        error: (error as Error).message
      });
    }
  }

  /**
   * 加载插件Agent
   */
  private async loadPluginAgents(): Promise<void> {
    try {
      const pluginAgents = await loadPluginAgents();
      pluginAgents.forEach(agent => {
        this.addAgent({ ...agent, source: 'plugin' as AgentSource });
      });
    } catch (error) {
      this.failedFiles.push({
        path: 'plugin',
        error: (error as Error).message
      });
    }
  }

  /**
   * 添加Agent到管理器
   * @param agent Agent定义
   */
  private addAgent(agent: AgentDefinition): void {
    const key = `${agent.agentType}-${agent.source}`;
    
    // 检查是否已存在同类型的Agent
    // 优先级高的会覆盖优先级低的
    if (!this.agents.has(key) || 
        AGENT_SOURCE_PRIORITY[agent.source as AgentSource] < 
        AGENT_SOURCE_PRIORITY[this.agents.get(key)?.source as AgentSource]) {
      this.agents.set(key, agent);
      this.allAgents.push(agent);
    }
  }

  /**
   * 获取所有Agent
   * @returns Agent定义数组
   */
  getAllAgents(): AgentDefinition[] {
    return this.allAgents;
  }

  /**
   * 获取活动Agent（按优先级排序）
   * @returns 活动Agent定义数组
   */
  getActiveAgents(): AgentDefinition[] {
    // 去重，保留优先级最高的Agent
    const uniqueAgents = new Map<string, AgentDefinition>();
    
    this.allAgents.forEach(agent => {
      const existing = uniqueAgents.get(agent.agentType);
      if (!existing || 
          AGENT_SOURCE_PRIORITY[agent.source as AgentSource] < 
          AGENT_SOURCE_PRIORITY[existing.source as AgentSource]) {
        uniqueAgents.set(agent.agentType, agent);
      }
    });

    return Array.from(uniqueAgents.values());
  }

  /**
   * 根据类型获取Agent
   * @param agentType Agent类型
   * @returns Agent定义或undefined
   */
  getAgentByType(agentType: string): AgentDefinition | undefined {
    const activeAgents = this.getActiveAgents();
    return activeAgents.find(agent => agent.agentType === agentType);
  }

  /**
   * 根据来源获取Agent
   * @param source Agent来源
   * @returns Agent定义数组
   */
  getAgentsBySource(source: AgentSource): AgentDefinition[] {
    return this.allAgents.filter(agent => agent.source === source);
  }

  /**
   * 获取加载失败的文件
   * @returns 失败文件数组
   */
  getFailedFiles(): Array<{ path: string; error: string }> {
    return this.failedFiles;
  }

  /**
   * 重新加载所有Agent
   */
  async reloadAgents(): Promise<void> {
    await this.loadAllAgents();
  }
}