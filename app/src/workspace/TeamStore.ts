/**
 * 团队存储（TeamStore）
 *
 * 管理 .liri/teams/ 目录下的团队定义：
 * - 团队 CRUD
 * - 成员管理
 * - 角色权限检查
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Logger, LogLevel } from "@modules/monitoring";
import type { Team, TeamMember, TeamRole } from "@modules/workspace/types";

const logger = new Logger({ level: LogLevel.INFO });

/** 团队角色权限映射 */
const ROLE_PERMISSIONS: Record<TeamRole, string[]> = {
  owner: ["read", "write", "delete", "manage_members", "manage_team"],
  admin: ["read", "write", "manage_members"],
  member: ["read", "write"],
  viewer: ["read"],
};

/**
 * 团队存储
 */
export class TeamStore {
  private teamsDir: string;
  private cache: Map<string, Team> = new Map();

  constructor(teamsDir: string) {
    this.teamsDir = teamsDir;
    this.ensureDir();
    this.loadAll();
  }

  /**
   * 确保 teams 目录存在
   */
  private ensureDir(): void {
    if (!fs.existsSync(this.teamsDir)) {
      fs.mkdirSync(this.teamsDir, { recursive: true });
    }
  }

  /**
   * 加载所有团队
   */
  private loadAll(): void {
    try {
      const files = fs.readdirSync(this.teamsDir).filter((f) => f.endsWith(".json"));

      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(this.teamsDir, file), "utf-8");
          const team = JSON.parse(content) as Team;
          this.cache.set(team.id, team);
        } catch {
          logger.warn("加载团队文件失败", { file });
        }
      }

      logger.info("团队加载完成", { count: this.cache.size });
    } catch (err) {
      logger.error("读取团队目录失败", { error: String(err) });
    }
  }

  /**
   * 保存团队到文件
   */
  private save(team: Team): void {
    const filePath = path.join(this.teamsDir, `${team.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(team, null, 2), "utf-8");
    this.cache.set(team.id, team);
  }

  /**
   * 删除团队文件
   */
  private deleteFile(teamId: string): void {
    const filePath = path.join(this.teamsDir, `${teamId}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    this.cache.delete(teamId);
  }

  /**
   * 列出所有团队
   */
  list(workspaceId?: string): Team[] {
    const teams = Array.from(this.cache.values());
    if (workspaceId) {
      return teams.filter((t) => t.workspaceId === workspaceId);
    }
    return teams;
  }

  /**
   * 获取单个团队
   */
  get(teamId: string): Team | null {
    return this.cache.get(teamId) || null;
  }

  /**
   * 创建团队
   */
  create(team: Omit<Team, "id" | "createdAt" | "updatedAt" | "members"> & { members?: TeamMember[] }): Team {
    const newTeam: Team = {
      id: `team_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      workspaceId: team.workspaceId,
      name: team.name,
      description: team.description,
      members: team.members || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tags: team.tags,
    };

    this.save(newTeam);
    logger.info("团队已创建", { teamId: newTeam.id, name: newTeam.name });
    return newTeam;
  }

  /**
   * 更新团队基本信息
   */
  update(teamId: string, updates: Partial<Pick<Team, "name" | "description" | "tags">>): Team | null {
    const team = this.cache.get(teamId);
    if (!team) return null;

    Object.assign(team, updates, { updatedAt: new Date().toISOString() });
    this.save(team);
    return team;
  }

  /**
   * 删除团队
   */
  delete(teamId: string): boolean {
    if (!this.cache.has(teamId)) return false;

    this.deleteFile(teamId);
    logger.info("团队已删除", { teamId });
    return true;
  }

  /**
   * 添加成员
   */
  addMember(teamId: string, member: Omit<TeamMember, "joinedAt">): Team | null {
    const team = this.cache.get(teamId);
    if (!team) return null;

    // 检查是否已存在
    if (team.members.some((m) => m.id === member.id)) {
      logger.warn("成员已存在", { teamId, memberId: member.id });
      return team;
    }

    team.members.push({
      ...member,
      joinedAt: new Date().toISOString(),
    });
    team.updatedAt = new Date().toISOString();

    this.save(team);
    logger.info("成员已添加", { teamId, memberId: member.id });
    return team;
  }

  /**
   * 移除成员
   */
  removeMember(teamId: string, memberId: string): Team | null {
    const team = this.cache.get(teamId);
    if (!team) return null;

    const index = team.members.findIndex((m) => m.id === memberId);
    if (index === -1) return null;

    team.members.splice(index, 1);
    team.updatedAt = new Date().toISOString();

    this.save(team);
    logger.info("成员已移除", { teamId, memberId });
    return team;
  }

  /**
   * 更新成员角色
   */
  updateMemberRole(teamId: string, memberId: string, role: TeamRole): Team | null {
    const team = this.cache.get(teamId);
    if (!team) return null;

    const member = team.members.find((m) => m.id === memberId);
    if (!member) return null;

    member.role = role;
    team.updatedAt = new Date().toISOString();

    this.save(team);
    return team;
  }

  /**
   * 检查成员权限
   */
  hasPermission(teamId: string, memberId: string, permission: string): boolean {
    const team = this.cache.get(teamId);
    if (!team) return false;

    const member = team.members.find((m) => m.id === memberId);
    if (!member) return false;

    const allowedPermissions = ROLE_PERMISSIONS[member.role];
    return allowedPermissions.includes(permission);
  }

  /**
   * 获取成员所在的所有团队
   */
  getMemberTeams(memberId: string): Team[] {
    return Array.from(this.cache.values()).filter((t) =>
      t.members.some((m) => m.id === memberId)
    );
  }
}

/**
 * 创建 TeamStore 实例
 */
export function createTeamStore(teamsDir: string): TeamStore {
  return new TeamStore(teamsDir);
}