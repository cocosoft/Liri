// @ts-nocheck
/**
 * 团队助手工具
 * 提供团队文件管理、路径权限等功能
 * 参考CC源码 cc_code/backend/utils/swarm/teamHelpers.ts 实现
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { logger } from '../../utils/log';

/**
 * 团队目录配置
 */
export interface TeamDirConfig {
  /** 团队根目录 */
  rootDir: string;
  /** 团队名称 */
  teamName: string;
  /** 是否存在 */
  exists?: boolean;
}

/**
 * 团队文件信息
 */
export interface TeamFileInfo {
  /** 文件路径 */
  path: string;
  /** 文件大小 */
  size: number;
  /** 修改时间 */
  mtime: number;
  /** 是否为目录 */
  isDirectory: boolean;
}

/**
 * 团队允许路径配置
 */
export interface TeamAllowedPaths {
  /** 允许读取的路径 */
  readPaths: string[];
  /** 允许写入的路径 */
  writePaths: string[];
  /** 允许执行的路径 */
  execPaths: string[];
}

/**
 * 团队成员信息
 */
export interface TeamMember {
  /** 成员ID */
  id: string;
  /** 成员名称 */
  name: string;
  /** 成员角色 */
  role: 'leader' | 'worker';
  /** 颜色 */
  color?: string;
  /** 状态 */
  status: 'active' | 'inactive' | 'terminated';
  /** 加入时间 */
  joinedAt: number;
}

/**
 * 团队配置
 */
export interface TeamConfig {
  /** 团队ID */
  id: string;
  /** 团队名称 */
  name: string;
  /** 团队描述 */
  description?: string;
  /** 团队成员 */
  members: TeamMember[];
  /** 允许的路径 */
  allowedPaths: TeamAllowedPaths;
  /** 创建时间 */
  createdAt: number;
  /** leader ID */
  leaderId: string;
}

/**
 * 团队助手类
 */
export class TeamHelper {
  private teamDir: string;
  private teamName: string;

  constructor(teamDir: string, teamName: string) {
    this.teamDir = teamDir;
    this.teamName = teamName;
  }

  /**
   * 获取团队根目录
   */
  getTeamDir(): string {
    return this.teamDir;
  }

  /**
   * 获取团队名称
   */
  getTeamName(): string {
    return this.teamName;
  }

  /**
   * 获取团队配置路径
   */
  getConfigPath(): string {
    return join(this.teamDir, 'team.json');
  }

  /**
   * 检查团队目录是否存在
   */
  exists(): boolean {
    return existsSync(this.teamDir);
  }

  /**
   * 确保团队目录存在
   */
  ensureDir(): void {
    const { mkdirSync } = require('fs');
    mkdirSync(this.teamDir, { recursive: true });
  }

  /**
   * 读取团队配置
   */
  readTeamConfig(): TeamConfig | null {
    const configPath = this.getConfigPath();

    if (!existsSync(configPath)) {
      return null;
    }

    try {
      const content = readFileSync(configPath, 'utf-8');
      return JSON.parse(content) as TeamConfig;
    } catch (error) {
      logger.error(`Failed to read team config from ${configPath}:`, error);
      return null;
    }
  }

  /**
   * 保存团队配置
   */
  saveTeamConfig(config: TeamConfig): void {
    this.ensureDir();
    const configPath = this.getConfigPath();

    try {
      writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      logger.debug(`Saved team config to ${configPath}`);
    } catch (error) {
      logger.error(`Failed to save team config to ${configPath}:`, error);
    }
  }

  /**
   * 获取团队允许路径
   */
  getAllowedPaths(): TeamAllowedPaths | null {
    const config = this.readTeamConfig();
    return config?.allowedPaths ?? null;
  }

  /**
   * 设置团队允许路径
   */
  setAllowedPaths(paths: TeamAllowedPaths): void {
    const config = this.readTeamConfig();

    if (config) {
      config.allowedPaths = paths;
      this.saveTeamConfig(config);
    }
  }

  /**
   * 检查路径是否在允许列表中
   */
  isPathAllowed(targetPath: string, accessType: 'read' | 'write' | 'exec'): boolean {
    const paths = this.getAllowedPaths();

    if (!paths) {
      return true; // 没有配置则默认允许
    }

    const allowedList = accessType === 'read'
      ? paths.readPaths
      : accessType === 'write'
        ? paths.writePaths
        : paths.execPaths;

    if (allowedList.length === 0) {
      return false; // 明确为空表示不允许
    }

    const resolvedTarget = resolve(targetPath);

    for (const allowedPath of allowedList) {
      const resolvedAllowed = resolve(allowedPath);
      if (resolvedTarget.startsWith(resolvedAllowed)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 添加允许路径
   */
  addAllowedPath(accessType: 'read' | 'write' | 'exec', path: string): void {
    const paths = this.getAllowedPaths() || {
      readPaths: [],
      writePaths: [],
      execPaths: [],
    };

    const pathList = accessType === 'read'
      ? paths.readPaths
      : accessType === 'write'
        ? paths.writePaths
        : paths.execPaths;

    if (!pathList.includes(path)) {
      pathList.push(path);
    }

    this.setAllowedPaths(paths);
  }

  /**
   * 移除允许路径
   */
  removeAllowedPath(accessType: 'read' | 'write' | 'exec', path: string): void {
    const paths = this.getAllowedPaths();

    if (!paths) {
      return;
    }

    const pathList = accessType === 'read'
      ? paths.readPaths
      : accessType === 'write'
        ? paths.writePaths
        : paths.execPaths;

    const index = pathList.indexOf(path);
    if (index > -1) {
      pathList.splice(index, 1);
      this.setAllowedPaths(paths);
    }
  }

  /**
   * 继承Leader的允许路径
   */
  inheritLeaderPaths(leaderPaths: TeamAllowedPaths): void {
    this.setAllowedPaths(leaderPaths);
    logger.debug(`Inherited leader paths for team ${this.teamName}`);
  }

  /**
   * 获取团队成员列表
   */
  getMembers(): TeamMember[] {
    const config = this.readTeamConfig();
    return config?.members ?? [];
  }

  /**
   * 获取活跃成员列表
   */
  getActiveMembers(): TeamMember[] {
    return this.getMembers().filter(m => m.status === 'active');
  }

  /**
   * 添加团队成员
   */
  addMember(member: TeamMember): void {
    const config = this.readTeamConfig();

    if (config) {
      const existingIndex = config.members.findIndex(m => m.id === member.id);
      if (existingIndex >= 0) {
        config.members[existingIndex] = member;
      } else {
        config.members.push(member);
      }
      this.saveTeamConfig(config);
    }
  }

  /**
   * 移除团队成员
   */
  removeMember(memberId: string): void {
    const config = this.readTeamConfig();

    if (config) {
      config.members = config.members.filter(m => m.id !== memberId);
      this.saveTeamConfig(config);
    }
  }

  /**
   * 更新成员状态
   */
  updateMemberStatus(memberId: string, status: TeamMember['status']): void {
    const config = this.readTeamConfig();

    if (config) {
      const member = config.members.find(m => m.id === memberId);
      if (member) {
        member.status = status;
        this.saveTeamConfig(config);
      }
    }
  }

  /**
   * 获取团队目录下的文件列表
   */
  listFiles(subDir?: string): TeamFileInfo[] {
    const { readdirSync, statSync } = require('fs');
    const targetDir = subDir ? join(this.teamDir, subDir) : this.teamDir;

    if (!existsSync(targetDir)) {
      return [];
    }

    try {
      const entries = readdirSync(targetDir);
      return entries.map(name => {
        const fullPath = join(targetDir, name);
        const stat = statSync(fullPath);
        return {
          path: fullPath,
          size: stat.size,
          mtime: stat.mtimeMs,
          isDirectory: stat.isDirectory(),
        };
      });
    } catch (error) {
      logger.error(`Failed to list files in ${targetDir}:`, error);
      return [];
    }
  }
}

/**
 * 获取团队目录
 */
export function getTeamDir(teamName: string): string {
  const { getEnvironmentVariable } = require('../../utils/envUtils');
  const baseDir = process.env.PY_APP_TEAM_DIR || join(process.env.HOME || process.env.USERPROFILE || '', '.py_app', 'teams');
  return join(baseDir, teamName);
}

/**
 * 创建团队助手实例
 */
export function createTeamHelper(teamName: string): TeamHelper {
  const teamDir = getTeamDir(teamName);
  return new TeamHelper(teamDir, teamName);
}

/**
 * 读取团队配置
 */
export function readTeamFile(teamName: string, fileName: string): string | null {
  const helper = createTeamHelper(teamName);
  const filePath = join(helper.getTeamDir(), fileName);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * 写入团队文件
 */
export function writeTeamFile(teamName: string, fileName: string, content: string): boolean {
  const helper = createTeamHelper(teamName);
  const filePath = join(helper.getTeamDir(), fileName);

  try {
    helper.ensureDir();
    writeFileSync(filePath, content, 'utf-8');
    return true;
  } catch (error) {
    logger.error(`Failed to write team file ${filePath}:`, error);
    return false;
  }
}

/**
 * 检查团队路径权限
 */
export function checkTeamPathPermission(
  teamName: string,
  targetPath: string,
  accessType: 'read' | 'write' | 'exec'
): boolean {
  const helper = createTeamHelper(teamName);
  return helper.isPathAllowed(targetPath, accessType);
}
