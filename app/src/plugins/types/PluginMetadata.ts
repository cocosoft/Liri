/**
 * 插件元数据类型定义
 */

/**
 * 命令贡献
 */
export interface CommandContribution {
  /**
   * 命令ID
   */
  id: string;

  /**
   * 命令标题
   */
  title: string;

  /**
   * 命令分类
   */
  category?: string;

  /**
   * 命令图标
   */
  icon?: string;

  /**
   * 命令启用条件
   */
  when?: string;
}

/**
 * 工具贡献
 */
export interface ToolContribution {
  /**
   * 工具ID
   */
  id: string;

  /**
   * 工具标题
   */
  title: string;

  /**
   * 工具描述
   */
  description?: string;

  /**
   * 工具图标
   */
  icon?: string;

  /**
   * 工具命令
   */
  command?: string;
}

/**
 * 菜单项
 */
export interface MenuItem {
  /**
   * 菜单项ID
   */
  id: string;

  /**
   * 菜单项标题
   */
  title: string;

  /**
   * 菜单项命令
   */
  command?: string;

  /**
   * 菜单项启用条件
   */
  when?: string;

  /**
   * 子菜单项
   */
  items?: MenuItem[];
}

/**
 * 菜单贡献
 */
export interface MenuContribution {
  /**
   * 菜单ID
   */
  id: string;

  /**
   * 菜单标题
   */
  title: string;

  /**
   * 菜单项
   */
  items: MenuItem[];
}

/**
 * 设置贡献
 */
export interface SettingContribution {
  /**
   * 设置ID
   */
  id: string;

  /**
   * 设置标题
   */
  title: string;

  /**
   * 设置描述
   */
  description?: string;

  /**
   * 设置类型
   */
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';

  /**
   * 设置默认值
   */
  default?: unknown;

  /**
   * 设置枚举值
   */
  enum?: unknown[];

  /**
   * 设置作用域
   */
  scope?: 'global' | 'session';
}

/**
 * 插件元数据
 */
export interface PluginMetadata {
  /**
   * 插件ID
   */
  id: string;

  /**
   * 插件名称
   */
  name: string;

  /**
   * 插件版本
   */
  version: string;

  /**
   * 插件描述
   */
  description?: string;

  /**
   * 插件作者
   */
  author?: string;

  /**
   * 插件许可证
   */
  license?: string;

  /**
   * 插件主页
   */
  homepage?: string;

  /**
   * 插件仓库
   */
  repository?: string;

  /**
   * 插件依赖
   */
  dependencies?: Record<string, string>;

  /**
   * 插件对等依赖
   */
  peerDependencies?: Record<string, string>;

  /**
   * 插件引擎要求
   */
  engines?: {
    pyapp?: string;
    node?: string;
  };

  /**
   * 插件主入口
   */
  main?: string;

  /**
   * 插件入口点
   */
  entryPoint?: string;

  /**
   * 插件激活事件
   */
  activationEvents?: string[];

  /**
   * 插件贡献
   */
  contributes?: {
    commands?: CommandContribution[];
    tools?: ToolContribution[];
    menus?: MenuContribution[];
    settings?: SettingContribution[];
  };
}
