import { FSAccessRule, SandboxPermissions } from './SandboxTypes';

/**
 * 沙箱配置构建器
 * 按工具类型自动生成细粒度权限配置
 */
export class SandboxConfigBuilder {
  /**
   * 根据工具类型生成 SandboxPermissions
   * @param toolType 工具类型标识（如 'read', 'write', 'terminal', 'network', 'execute'）
   * @param cwd 当前工作目录（可选）
   * @returns 对应的沙箱权限配置
   */
  static fromToolType(toolType: string, cwd?: string): SandboxPermissions {
    const lowerType = toolType.toLowerCase();

    if (
      lowerType === 'read' ||
      lowerType === 'readfile' ||
      lowerType === 'file_read'
    ) {
      return SandboxConfigBuilder.readTool(cwd);
    }
    if (
      lowerType === 'write' ||
      lowerType === 'writefile' ||
      lowerType === 'file_write' ||
      lowerType === 'edit'
    ) {
      return SandboxConfigBuilder.writeTool(cwd);
    }
    if (
      lowerType === 'terminal' ||
      lowerType === 'bash' ||
      lowerType === 'execute'
    ) {
      return SandboxConfigBuilder.terminalTool(cwd);
    }
    if (
      lowerType === 'network' ||
      lowerType === 'websearch' ||
      lowerType === 'web_fetch' ||
      lowerType === 'web_search'
    ) {
      return SandboxConfigBuilder.networkTool();
    }
    if (
      lowerType === 'search' ||
      lowerType === 'grep' ||
      lowerType === 'glob'
    ) {
      return SandboxConfigBuilder.searchTool(cwd);
    }

    return SandboxConfigBuilder.defaultTool();
  }

  /**
   * 只读工具权限（read_file, search_files, grep 等）
   */
  static readTool(cwd?: string): SandboxPermissions {
    const filesystem: FSAccessRule[] = [
      { path: '/usr', permissions: ['read'], recursive: true },
      { path: '/lib', permissions: ['read'], recursive: true },
      { path: '/lib64', permissions: ['read'], recursive: true },
      { path: '/bin', permissions: ['read'], recursive: true },
    ];
    if (cwd) {
      filesystem.push({ path: cwd, permissions: ['read'], recursive: true });
    }
    return {
      filesystem,
      network: false,
      networkWhitelist: [],
      process: false,
      bwrap: true,
      timeoutMs: 30000,
    };
  }

  /**
   * 写入工具权限（write_file, edit_file 等）
   * 需要额外的工作目录写入权限
   */
  static writeTool(cwd?: string): SandboxPermissions {
    const base = SandboxConfigBuilder.readTool(cwd);
    if (cwd) {
      const existingIdx = base.filesystem.findIndex((r) => r.path === cwd);
      if (existingIdx >= 0) {
        base.filesystem[existingIdx] = {
          path: cwd,
          permissions: ['read', 'write'],
          recursive: true,
        };
      } else {
        base.filesystem.push({
          path: cwd,
          permissions: ['read', 'write'],
          recursive: true,
        });
      }
    }
    return base;
  }

  /**
   * 终端/执行工具权限（bash, terminal 等）
   * 需要进程创建 + 网络 + 完整文件系统访问
   */
  static terminalTool(cwd?: string): SandboxPermissions {
    const filesystem: FSAccessRule[] = [
      { path: '/usr', permissions: ['read'], recursive: true },
      { path: '/lib', permissions: ['read'], recursive: true },
      { path: '/lib64', permissions: ['read'], recursive: true },
      { path: '/bin', permissions: ['read'], recursive: true },
    ];
    if (cwd) {
      filesystem.push({
        path: cwd,
        permissions: ['read', 'write', 'execute'],
        recursive: true,
      });
    }
    return {
      filesystem,
      network: true,
      networkWhitelist: ['*:443', '*:80'],
      process: true,
      bwrap: true,
      memoryLimitMb: 512,
      cpuQuota: 50,
      timeoutMs: 120000,
    };
  }

  /**
   * 网络工具权限（web_search, web_fetch 等）
   * 仅网络访问，无文件系统
   */
  static networkTool(): SandboxPermissions {
    return {
      filesystem: [],
      network: true,
      networkWhitelist: ['*:443'],
      process: false,
      bwrap: true,
      timeoutMs: 60000,
    };
  }

  /**
   * 搜索工具权限（grep, glob, search 等）
   * 仅当前目录只读
   */
  static searchTool(cwd?: string): SandboxPermissions {
    const filesystem: FSAccessRule[] = [];
    if (cwd) {
      filesystem.push({ path: cwd, permissions: ['read'], recursive: true });
    }
    return {
      filesystem,
      network: false,
      networkWhitelist: [],
      process: false,
      bwrap: true,
      timeoutMs: 30000,
    };
  }

  /**
   * 默认兜底权限（严格模式）
   */
  static defaultTool(): SandboxPermissions {
    return {
      filesystem: [],
      network: false,
      networkWhitelist: [],
      process: false,
      bwrap: false,
      timeoutMs: 30000,
    };
  }
}
