/**
 * 权限模型
 * 定义细粒度权限控制的核心概念
 */

/**
 * 资源类型
 */
export enum ResourceType {
  FILE = 'file',
  DIRECTORY = 'directory',
  API = 'api',
  TOOL = 'tool',
  COMMAND = 'command',
  SYSTEM = 'system',
}

/**
 * 操作类型
 */
export enum OperationType {
  READ = 'read',
  WRITE = 'write',
  EXECUTE = 'execute',
  DELETE = 'delete',
  CREATE = 'create',
  MODIFY = 'modify',
  ALL = 'all',
}

/**
 * 权限行为
 */
export enum PermissionAction {
  ALLOW = 'allow',
  DENY = 'deny',
  ASK = 'ask',
}

/**
 * 角色类型
 */
export enum RoleType {
  ADMIN = 'admin',
  USER = 'user',
  GUEST = 'guest',
  SYSTEM = 'system',
}

/**
 * 资源定义
 */
export interface Resource {
  id: string;
  type: ResourceType;
  name: string;
  path?: string;
  description?: string;
  parentId?: string;
}

/**
 * 权限规则（数据模型层）
 *
 * @remarks 本类型是 permission 模块内部的数据模型，对应数据库存储结构。
 * 对外接口应使用 @modules/permission/types/PermissionRule 领域模型。
 * {@link PermissionRule} 为领域模型规范类型，本类型为持久化模型。
 */
export interface PermissionRule {
  id: string;
  resourceId: string;
  operation: OperationType;
  action: PermissionAction;
  roleId?: string;
  userId?: string;
  condition?: string;
  priority: number;
  createdAt: number;
  updatedAt: number;
  name?: string;
  toolName?: string;
  behavior?: string;
  contentPattern?: string;
}

/**
 * 角色定义
 */
export interface Role {
  id: string;
  name: RoleType;
  description?: string;
  permissions: PermissionRule[];
  createdAt: number;
  updatedAt: number;
}

/**
 * 用户定义
 */
export interface User {
  id: string;
  name: string;
  roles: RoleType[];
  permissions: PermissionRule[];
  createdAt: number;
  updatedAt: number;
}

/**
 * 权限上下文
 */
export interface PermissionContext {
  userId?: string;
  role?: RoleType;
  resource: Resource;
  operation: OperationType;
  input?: Record<string, unknown>;
  environment?: Record<string, unknown>;
}

/**
 * 权限决策
 */
export interface PermissionDecision {
  action: PermissionAction;
  reason: string;
  ruleId?: string;
}

/**
 * 权限存储接口
 */
export interface PermissionStorage {
  saveRule(rule: PermissionRule): Promise<string>;
  getRule(id: string): Promise<PermissionRule | null>;
  getRulesByResource(resourceId: string): Promise<PermissionRule[]>;
  getRulesByRole(roleId: string): Promise<PermissionRule[]>;
  getRulesByUser(userId: string): Promise<PermissionRule[]>;
  updateRule(rule: PermissionRule): Promise<void>;
  deleteRule(id: string): Promise<void>;
  saveRole(role: Role): Promise<string>;
  getRole(id: string): Promise<Role | null>;
  getAllRoles(): Promise<Role[]>;
  getRoleByName(name: RoleType): Promise<Role | null>;
  updateRole(role: Role): Promise<void>;
  deleteRole(id: string): Promise<void>;
  saveUser(user: User): Promise<string>;
  getUser(id: string): Promise<User | null>;
  getAllUsers(): Promise<User[]>;
  getUserByName(name: string): Promise<User | null>;
  updateUser(user: User): Promise<void>;
  deleteUser(id: string): Promise<void>;
  saveResource(resource: Resource): Promise<string>;
  getResource(id: string): Promise<Resource | null>;
  getAllResources(): Promise<Resource[]>;
  getResourceByPath(path: string, type: ResourceType): Promise<Resource | null>;
  updateResource(resource: Resource): Promise<void>;
  deleteResource(id: string): Promise<void>;
}

export interface RoleStorage {
  saveRole(role: Role): Promise<string>;
  getRole(id: string): Promise<Role | null>;
  getAllRoles(): Promise<Role[]>;
  getRoleByName(name: RoleType): Promise<Role | null>;
  updateRole(role: Role): Promise<void>;
  deleteRole(id: string): Promise<void>;
}

export interface UserStorage {
  saveUser(user: User): Promise<string>;
  getUser(id: string): Promise<User | null>;
  getAllUsers(): Promise<User[]>;
  getUserByName(name: string): Promise<User | null>;
  updateUser(user: User): Promise<void>;
  deleteUser(id: string): Promise<void>;
}
