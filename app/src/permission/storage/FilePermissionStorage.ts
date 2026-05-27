/**
 * 文件权限存储
 * 使用文件系统存储权限数据
 */

import fs from 'fs';
import path from 'path';
import { resolvePermissionsDir } from '@modules/config/paths';
import type {
  PermissionStorage,
  PermissionRule,
  Role,
  User,
  Resource,
} from '../models/Permission.js';
import { RoleType, ResourceType } from '../models/Permission.js';

/**
 * 文件权限存储类
 */
export class FilePermissionStorage implements PermissionStorage {
  private storagePath: string;
  private rulesPath: string;
  private rolesPath: string;
  private usersPath: string;
  private resourcesPath: string;

  /**
   * 构造函数
   * @param storagePath 存储路径
   */
  constructor(
    storagePath: string = resolvePermissionsDir()
  ) {
    this.storagePath = storagePath;
    this.rulesPath = path.join(storagePath, 'rules.json');
    this.rolesPath = path.join(storagePath, 'roles.json');
    this.usersPath = path.join(storagePath, 'users.json');
    this.resourcesPath = path.join(storagePath, 'resources.json');
    this.initStorage();
  }

  /**
   * 初始化存储
   */
  private initStorage(): void {
    // 确保目录存在
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }

    // 初始化默认文件
    if (!fs.existsSync(this.rulesPath)) {
      fs.writeFileSync(this.rulesPath, JSON.stringify([], null, 2));
    }

    if (!fs.existsSync(this.rolesPath)) {
      const defaultRoles: Role[] = [
        {
          id: 'admin',
          name: RoleType.ADMIN,
          description: '管理员角色，拥有所有权限',
          permissions: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: 'user',
          name: RoleType.USER,
          description: '普通用户角色',
          permissions: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: 'guest',
          name: RoleType.GUEST,
          description: '访客角色，权限受限',
          permissions: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];
      fs.writeFileSync(this.rolesPath, JSON.stringify(defaultRoles, null, 2));
    }

    if (!fs.existsSync(this.usersPath)) {
      const defaultUsers: User[] = [
        {
          id: 'system',
          name: 'system',
          roles: [RoleType.SYSTEM],
          permissions: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: 'admin',
          name: 'admin',
          roles: [RoleType.ADMIN],
          permissions: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];
      fs.writeFileSync(this.usersPath, JSON.stringify(defaultUsers, null, 2));
    }

    if (!fs.existsSync(this.resourcesPath)) {
      fs.writeFileSync(this.resourcesPath, JSON.stringify([], null, 2));
    }
  }

  /**
   * 读取文件
   * @param filePath 文件路径
   * @returns 文件内容
   */
  private readFile<T>(filePath: string): T {
    if (!fs.existsSync(filePath)) {
      return [] as unknown as T;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content) as T;
  }

  /**
   * 写入文件
   * @param filePath 文件路径
   * @param data 数据
   */
  private writeFile(filePath: string, data: any): void {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  /**
   * 保存权限规则
   * @param rule 权限规则
   * @returns 规则ID
   */
  async saveRule(rule: PermissionRule): Promise<string> {
    const rules = this.readFile<PermissionRule[]>(this.rulesPath);
    rules.push(rule);
    this.writeFile(this.rulesPath, rules);
    return rule.id;
  }

  /**
   * 获取权限规则
   * @param id 规则ID
   * @returns 权限规则
   */
  async getRule(id: string): Promise<PermissionRule | null> {
    const rules = this.readFile<PermissionRule[]>(this.rulesPath);
    return rules.find((rule) => rule.id === id) || null;
  }

  /**
   * 根据资源获取权限规则
   * @param resourceId 资源ID
   * @returns 权限规则列表
   */
  async getRulesByResource(resourceId: string): Promise<PermissionRule[]> {
    const rules = this.readFile<PermissionRule[]>(this.rulesPath);
    return rules.filter((rule) => rule.resourceId === resourceId);
  }

  /**
   * 根据角色获取权限规则
   * @param roleId 角色ID
   * @returns 权限规则列表
   */
  async getRulesByRole(roleId: string): Promise<PermissionRule[]> {
    const rules = this.readFile<PermissionRule[]>(this.rulesPath);
    return rules.filter((rule) => rule.roleId === roleId);
  }

  /**
   * 根据用户获取权限规则
   * @param userId 用户ID
   * @returns 权限规则列表
   */
  async getRulesByUser(userId: string): Promise<PermissionRule[]> {
    const rules = this.readFile<PermissionRule[]>(this.rulesPath);
    return rules.filter((rule) => rule.userId === userId);
  }

  /**
   * 更新权限规则
   * @param rule 权限规则
   */
  async updateRule(rule: PermissionRule): Promise<void> {
    const rules = this.readFile<PermissionRule[]>(this.rulesPath);
    const index = rules.findIndex((r) => r.id === rule.id);
    if (index !== -1) {
      rules[index] = rule;
      this.writeFile(this.rulesPath, rules);
    }
  }

  /**
   * 删除权限规则
   * @param id 规则ID
   */
  async deleteRule(id: string): Promise<void> {
    const rules = this.readFile<PermissionRule[]>(this.rulesPath);
    const filteredRules = rules.filter((rule) => rule.id !== id);
    this.writeFile(this.rulesPath, filteredRules);
  }

  /**
   * 保存角色
   * @param role 角色
   * @returns 角色ID
   */
  async saveRole(role: Role): Promise<string> {
    const roles = this.readFile<Role[]>(this.rolesPath);
    roles.push(role);
    this.writeFile(this.rolesPath, roles);
    return role.id;
  }

  /**
   * 获取角色
   * @param id 角色ID
   * @returns 角色
   */
  async getRole(id: string): Promise<Role | null> {
    const roles = this.readFile<Role[]>(this.rolesPath);
    return roles.find((role) => role.id === id) || null;
  }

  /**
   * 根据名称获取角色
   * @param name 角色名称
   * @returns 角色
   */
  async getRoleByName(name: RoleType): Promise<Role | null> {
    const roles = this.readFile<Role[]>(this.rolesPath);
    return roles.find((role) => role.name === name) || null;
  }

  /**
   * 更新角色
   * @param role 角色
   */
  async updateRole(role: Role): Promise<void> {
    const roles = this.readFile<Role[]>(this.rolesPath);
    const index = roles.findIndex((r) => r.id === role.id);
    if (index !== -1) {
      roles[index] = role;
      this.writeFile(this.rolesPath, roles);
    }
  }

  /**
   * 删除角色
   * @param id 角色ID
   */
  async deleteRole(id: string): Promise<void> {
    const roles = this.readFile<Role[]>(this.rolesPath);
    const filteredRoles = roles.filter((role) => role.id !== id);
    this.writeFile(this.rolesPath, filteredRoles);
  }

  /**
   * 保存用户
   * @param user 用户
   * @returns 用户ID
   */
  async saveUser(user: User): Promise<string> {
    const users = this.readFile<User[]>(this.usersPath);
    users.push(user);
    this.writeFile(this.usersPath, users);
    return user.id;
  }

  /**
   * 获取用户
   * @param id 用户ID
   * @returns 用户
   */
  async getUser(id: string): Promise<User | null> {
    const users = this.readFile<User[]>(this.usersPath);
    return users.find((user) => user.id === id) || null;
  }

  /**
   * 根据名称获取用户
   * @param name 用户名称
   * @returns 用户
   */
  async getUserByName(name: string): Promise<User | null> {
    const users = this.readFile<User[]>(this.usersPath);
    return users.find((user) => user.name === name) || null;
  }

  /**
   * 更新用户
   * @param user 用户
   */
  async updateUser(user: User): Promise<void> {
    const users = this.readFile<User[]>(this.usersPath);
    const index = users.findIndex((u) => u.id === user.id);
    if (index !== -1) {
      users[index] = user;
      this.writeFile(this.usersPath, users);
    }
  }

  /**
   * 删除用户
   * @param id 用户ID
   */
  async deleteUser(id: string): Promise<void> {
    const users = this.readFile<User[]>(this.usersPath);
    const filteredUsers = users.filter((user) => user.id !== id);
    this.writeFile(this.usersPath, filteredUsers);
  }

  /**
   * 保存资源
   * @param resource 资源
   * @returns 资源ID
   */
  async saveResource(resource: Resource): Promise<string> {
    const resources = this.readFile<Resource[]>(this.resourcesPath);
    resources.push(resource);
    this.writeFile(this.resourcesPath, resources);
    return resource.id;
  }

  /**
   * 获取资源
   * @param id 资源ID
   * @returns 资源
   */
  async getResource(id: string): Promise<Resource | null> {
    const resources = this.readFile<Resource[]>(this.resourcesPath);
    return resources.find((resource) => resource.id === id) || null;
  }

  /**
   * 根据路径获取资源
   * @param path 资源路径
   * @param type 资源类型
   * @returns 资源
   */
  async getResourceByPath(
    path: string,
    type: ResourceType
  ): Promise<Resource | null> {
    const resources = this.readFile<Resource[]>(this.resourcesPath);
    return (
      resources.find(
        (resource) => resource.path === path && resource.type === type
      ) || null
    );
  }

  /**
   * 更新资源
   * @param resource 资源
   */
  async updateResource(resource: Resource): Promise<void> {
    const resources = this.readFile<Resource[]>(this.resourcesPath);
    const index = resources.findIndex((r) => r.id === resource.id);
    if (index !== -1) {
      resources[index] = resource;
      this.writeFile(this.resourcesPath, resources);
    }
  }

  /**
   * 删除资源
   * @param id 资源ID
   */
  async deleteResource(id: string): Promise<void> {
    const resources = this.readFile<Resource[]>(this.resourcesPath);
    const filteredResources = resources.filter(
      (resource) => resource.id !== id
    );
    this.writeFile(this.resourcesPath, filteredResources);
  }

  /**
   * 获取所有资源
   * @returns 资源列表
   */
  async getAllResources(): Promise<Resource[]> {
    return this.readFile<Resource[]>(this.resourcesPath);
  }

  /**
   * 获取所有角色
   * @returns 角色列表
   */
  async getAllRoles(): Promise<Role[]> {
    return this.readFile<Role[]>(this.rolesPath);
  }

  /**
   * 获取所有用户
   * @returns 用户列表
   */
  async getAllUsers(): Promise<User[]> {
    return this.readFile<User[]>(this.usersPath);
  }
}

/**
 * 创建文件权限存储实例
 * @param storagePath 存储路径
 * @returns 文件权限存储实例
 */
export function createFilePermissionStorage(
  storagePath?: string
): FilePermissionStorage {
  return new FilePermissionStorage(storagePath);
}
