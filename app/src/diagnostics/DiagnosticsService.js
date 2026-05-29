/**
 * 系统诊断服务
 * 实现系统诊断、安装类型检测、配置检测等功能
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, statSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir, hostname } from 'os';
import { randomUUID } from 'crypto';
import { resolveDbPath, resolveProjectRoot } from '@modules/config/paths';

const execAsync = promisify(exec);

/**
 * 诊断问题级别
 */
export const DiagnosticLevel = {
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  CRITICAL: 'critical',
};

/**
 * 诊断类别
 */
export const DiagnosticCategory = {
  SYSTEM: 'system',
  NETWORK: 'network',
  DEPENDENCIES: 'dependencies',
  CONFIGURATION: 'configuration',
  STORAGE: 'storage',
  PERFORMANCE: 'performance',
  INSTALLATION: 'installation',
};

/**
 * 安装类型
 */
export const InstallType = {
  NPM_GLOBAL: 'npm-global',
  NPM_LOCAL: 'npm-local',
  NATIVE: 'native',
  PACKAGE_MANAGER: 'package-manager',
  DEVELOPMENT: 'development',
  UNKNOWN: 'unknown',
};

/**
 * 诊断服务类
 */
class DiagnosticsService {
  constructor() {
    this.results = [];
    this.installType = InstallType.UNKNOWN;
  }

  /**
   * 获取单例实例
   */
  static getInstance() {
    if (!DiagnosticsService.instance) {
      DiagnosticsService.instance = new DiagnosticsService();
    }
    return DiagnosticsService.instance;
  }

  /**
   * 运行所有诊断
   * @returns 诊断结果列表
   */
  async runAllDiagnostics() {
    this.results = [];

    await this.checkNodeVersion();
    await this.checkNpmVersion();
    await this.checkGitVersion();
    await this.checkDependencies();
    await this.checkProjectStructure();
    await this.checkStorage();
    await this.checkNetwork();
    await this.checkInstallType();
    await this.checkMultipleInstances();
    await this.checkPerformance();
    await this.checkConfiguration();
    await this.checkEnvironmentVariables();

    return this.results;
  }

  /**
   * 按类别运行诊断
   * @param category 诊断类别
   * @returns 诊断结果列表
   */
  async runDiagnosticsByCategory(category) {
    this.results = [];

    switch (category) {
      case DiagnosticCategory.SYSTEM:
        await this.checkNodeVersion();
        await this.checkNpmVersion();
        await this.checkGitVersion();
        await this.checkPerformance();
        break;
      case DiagnosticCategory.DEPENDENCIES:
        await this.checkDependencies();
        break;
      case DiagnosticCategory.CONFIGURATION:
        await this.checkProjectStructure();
        await this.checkConfiguration();
        await this.checkEnvironmentVariables();
        break;
      case DiagnosticCategory.STORAGE:
        await this.checkStorage();
        break;
      case DiagnosticCategory.NETWORK:
        await this.checkNetwork();
        break;
      case DiagnosticCategory.PERFORMANCE:
        await this.checkPerformance();
        break;
      case DiagnosticCategory.INSTALLATION:
        await this.checkInstallType();
        await this.checkMultipleInstances();
        break;
    }

    return this.results;
  }

  /**
   * 检查安装类型
   */
  async checkInstallType() {
    try {
      const npmGlobalPrefix = await this.getNpmGlobalPrefix();
      const currentDir = resolveProjectRoot();
      const nodePath = process.execPath;

      if (npmGlobalPrefix && currentDir.startsWith(npmGlobalPrefix)) {
        this.installType = InstallType.NPM_GLOBAL;
        this.addResult({
          name: '安装类型',
          level: DiagnosticLevel.INFO,
          message: `npm全局安装: ${npmGlobalPrefix}`,
          details: { installType: this.installType, prefix: npmGlobalPrefix },
        });
      } else if (currentDir.includes('node_modules')) {
        this.installType = InstallType.NPM_LOCAL;
        this.addResult({
          name: '安装类型',
          level: DiagnosticLevel.INFO,
          message: '本地npm安装',
          details: { installType: this.installType, currentDir },
        });
      } else if (process.env.PACKAGE_MANAGER) {
        this.installType = InstallType.PACKAGE_MANAGER;
        this.addResult({
          name: '安装类型',
          level: DiagnosticLevel.INFO,
          message: `包管理器安装: ${process.env.PACKAGE_MANAGER}`,
          details: {
            installType: this.installType,
            packageManager: process.env.PACKAGE_MANAGER,
          },
        });
      } else if (
        process.env.NODE_ENV === 'development' ||
        process.argv.includes('--dev')
      ) {
        this.installType = InstallType.DEVELOPMENT;
        this.addResult({
          name: '安装类型',
          level: DiagnosticLevel.INFO,
          message: '开发模式',
          details: { installType: this.installType },
        });
      } else {
        this.installType = InstallType.UNKNOWN;
        this.addResult({
          name: '安装类型',
          level: DiagnosticLevel.WARNING,
          message: '无法确定安装类型',
          details: { installType: this.installType },
          suggestions: ['检查安装环境'],
        });
      }

      this.addResult({
        name: '安装路径',
        level: DiagnosticLevel.INFO,
        message: `Node路径: ${nodePath}`,
        details: { nodePath, npmPrefix: npmGlobalPrefix },
      });
    } catch (error) {
      this.addResult({
        name: '安装类型',
        level: DiagnosticLevel.WARNING,
        message: '无法检测安装类型',
        suggestions: ['确保npm可用'],
      });
    }
  }

  /**
   * 获取npm全局前缀
   */
  async getNpmGlobalPrefix() {
    try {
      const { stdout } = await execAsync('npm config get prefix');
      return stdout.trim();
    } catch {
      return null;
    }
  }

  /**
   * 检查多个安装实例
   */
  async checkMultipleInstances() {
    try {
      const instances = [];

      const npmGlobalPrefix = await this.getNpmGlobalPrefix();
      if (npmGlobalPrefix) {
        instances.push({
          type: 'npm-global',
          path: npmGlobalPrefix,
        });
      }

      const localNodeModules = join(resolveProjectRoot(), 'node_modules');
      if (existsSync(localNodeModules)) {
        instances.push({
          type: 'local',
          path: localNodeModules,
        });
      }

      const homeDir = homedir();
      const possiblePaths = [
        join(homeDir, '.npm'),
        join(homeDir, '.nvm'),
        join(homeDir, '.nvs'),
      ];

      for (const p of possiblePaths) {
        if (existsSync(p)) {
          instances.push({
            type: 'version-manager',
            path: p,
          });
        }
      }

      if (instances.length > 1) {
        this.addResult({
          name: '多安装实例',
          level: DiagnosticLevel.WARNING,
          message: `检测到多个安装实例: ${instances.length}个`,
          details: instances,
          suggestions: [
            '清理不需要的安装实例',
            '使用版本管理器管理Node.js版本',
          ],
        });
      } else {
        this.addResult({
          name: '多安装实例',
          level: DiagnosticLevel.INFO,
          message: '未检测到多个安装实例',
          details: instances,
        });
      }
    } catch (error) {
      this.addResult({
        name: '多安装实例检测',
        level: DiagnosticLevel.WARNING,
        message: '无法检测多个安装实例',
      });
    }
  }

  /**
   * 检查Node.js版本
   */
  async checkNodeVersion() {
    try {
      const { stdout } = await execAsync('node -v');
      const version = stdout.trim();
      const majorVersion = parseInt(version.replace('v', '').split('.')[0]);

      if (majorVersion < 18) {
        this.addResult({
          name: 'Node.js版本',
          level: DiagnosticLevel.ERROR,
          message: `Node.js版本过低: ${version}`,
          suggestions: ['请升级Node.js到18.0.0或更高版本'],
        });
      } else {
        this.addResult({
          name: 'Node.js版本',
          level: DiagnosticLevel.INFO,
          message: `Node.js版本正常: ${version}`,
        });
      }
    } catch (error) {
      this.addResult({
        name: 'Node.js版本',
        level: DiagnosticLevel.CRITICAL,
        message: 'Node.js未安装或不在PATH中',
        suggestions: ['请安装Node.js 18.0.0或更高版本'],
      });
    }
  }

  /**
   * 检查npm版本
   */
  async checkNpmVersion() {
    try {
      const { stdout } = await execAsync('npm -v');
      const version = stdout.trim();

      this.addResult({
        name: 'npm版本',
        level: DiagnosticLevel.INFO,
        message: `npm版本: ${version}`,
      });
    } catch (error) {
      this.addResult({
        name: 'npm版本',
        level: DiagnosticLevel.WARNING,
        message: 'npm未安装或不在PATH中',
      });
    }
  }

  /**
   * 检查Git版本
   */
  async checkGitVersion() {
    try {
      const { stdout } = await execAsync('git --version');
      const version = stdout.trim();

      this.addResult({
        name: 'Git版本',
        level: DiagnosticLevel.INFO,
        message: `Git版本: ${version}`,
      });
    } catch (error) {
      this.addResult({
        name: 'Git版本',
        level: DiagnosticLevel.WARNING,
        message: 'Git未安装或不在PATH中',
        suggestions: ['建议安装Git以获得更好的版本控制体验'],
      });
    }
  }

  /**
   * 检查依赖
   */
  async checkDependencies() {
    try {
      const packageJsonPath = join(resolveProjectRoot(), 'package.json');

      if (!existsSync(packageJsonPath)) {
        this.addResult({
          name: '项目依赖',
          level: DiagnosticLevel.ERROR,
          message: 'package.json文件不存在',
          suggestions: ['请在项目根目录创建package.json'],
        });
        return;
      }

      const { stdout, stderr } = await execAsync(
        'npm ls --depth=0 2>/dev/null',
        { cwd: resolveProjectRoot() }
      );

      if (stderr && stderr.includes('UNMET')) {
        this.addResult({
          name: '项目依赖',
          level: DiagnosticLevel.ERROR,
          message: '存在未安装的依赖',
          details: stderr,
          suggestions: ['运行 npm install 安装依赖'],
        });
      } else {
        this.addResult({
          name: '项目依赖',
          level: DiagnosticLevel.INFO,
          message: '所有依赖已安装',
          details: stdout.trim().split('\n').slice(0, 10),
        });
      }
    } catch (error) {
      this.addResult({
        name: '项目依赖',
        level: DiagnosticLevel.WARNING,
        message: '无法检查依赖状态',
        suggestions: ['请确保npm可用并运行 npm install'],
      });
    }
  }

  /**
   * 检查项目结构
   */
  async checkProjectStructure() {
    const requiredDirs = ['app/src', 'app/testing'];
    const missingDirs = [];

    for (const dir of requiredDirs) {
      if (!existsSync(dir)) {
        missingDirs.push(dir);
      }
    }

    if (missingDirs.length > 0) {
      this.addResult({
        name: '项目结构',
        level: DiagnosticLevel.ERROR,
        message: '缺少必要的目录',
        details: missingDirs,
        suggestions: ['请确保项目结构完整'],
      });
    } else {
      this.addResult({
        name: '项目结构',
        level: DiagnosticLevel.INFO,
        message: '项目结构正常',
      });
    }
  }

  /**
   * 检查存储
   */
  async checkStorage() {
    try {
      const dbPath = resolveDbPath();

      if (existsSync(dbPath)) {
        const stats = statSync(dbPath);
        this.addResult({
          name: '数据库',
          level: DiagnosticLevel.INFO,
          message: `数据库文件存在: ${(stats.size / 1024).toFixed(2)}KB`,
          details: { size: stats.size, modified: stats.mtime },
        });
      } else {
        this.addResult({
          name: '数据库',
          level: DiagnosticLevel.WARNING,
          message: '数据库文件不存在，将在使用时创建',
        });
      }
    } catch (error) {
      this.addResult({
        name: '存储检查',
        level: DiagnosticLevel.WARNING,
        message: '无法检查存储状态',
      });
    }
  }

  /**
   * 检查网络
   */
  async checkNetwork() {
    try {
      const testUrls = [
        { url: 'https://api.github.com', name: 'GitHub API' },
        { url: 'https://www.npmjs.com', name: 'npm registry' },
        { url: 'https://api.openai.com', name: 'OpenAI API' },
        { url: 'https://api.anthropic.com', name: 'Anthropic API' },
      ];

      for (const { url, name } of testUrls) {
        const startTime = Date.now();
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);

          const response = await fetch(url, {
            method: 'HEAD',
            signal: controller.signal,
          });

          clearTimeout(timeoutId);
          const latency = Date.now() - startTime;

          this.addResult({
            name: `网络-${name}`,
            level: DiagnosticLevel.INFO,
            message: `${name} 可达 (延迟: ${latency}ms)`,
            details: { url, latency, status: response.status },
          });
        } catch (error) {
          this.addResult({
            name: `网络-${name}`,
            level: DiagnosticLevel.WARNING,
            message: `${name} 不可达`,
            suggestions: ['检查网络连接或代理设置'],
          });
        }
      }
    } catch (error) {
      this.addResult({
        name: '网络检查',
        level: DiagnosticLevel.WARNING,
        message: '无法执行网络检查',
      });
    }
  }

  /**
   * 检查性能
   */
  async checkPerformance() {
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);

    if (heapUsedMB / heapTotalMB > 0.9) {
      this.addResult({
        name: '内存使用',
        level: DiagnosticLevel.WARNING,
        message: `内存使用率较高: ${heapUsedMB}MB / ${heapTotalMB}MB`,
        suggestions: ['考虑重启应用或清理缓存'],
      });
    } else {
      this.addResult({
        name: '内存使用',
        level: DiagnosticLevel.INFO,
        message: `内存使用正常: ${heapUsedMB}MB / ${heapTotalMB}MB`,
      });
    }

    try {
      const cpuUsage = process.cpuUsage();
      this.addResult({
        name: 'CPU使用',
        level: DiagnosticLevel.INFO,
        message: `CPU使用率: user=${cpuUsage.user}, system=${cpuUsage.system}`,
        details: cpuUsage,
      });
    } catch (error) {
      this.addResult({
        name: 'CPU使用',
        level: DiagnosticLevel.WARNING,
        message: '无法获取CPU使用率',
      });
    }

    try {
      const diskPath = resolveProjectRoot();
      this.addResult({
        name: '磁盘路径',
        level: DiagnosticLevel.INFO,
        message: `工作目录: ${diskPath}`,
        details: { path: diskPath },
      });
    } catch (error) {
      this.addResult({
        name: '磁盘路径',
        level: DiagnosticLevel.WARNING,
        message: '无法获取磁盘路径',
      });
    }
  }

  /**
   * 检查配置
   */
  async checkConfiguration() {
    const configFiles = [
      { name: 'package.json', path: join(resolveProjectRoot(), 'package.json') },
      { name: 'tsconfig.json', path: join(resolveProjectRoot(), 'tsconfig.json') },
      { name: '.env', path: join(resolveProjectRoot(), '.env') },
    ];

    for (const config of configFiles) {
      if (existsSync(config.path)) {
        this.addResult({
          name: `配置文件-${config.name}`,
          level: DiagnosticLevel.INFO,
          message: `${config.name} 存在`,
          details: { path: config.path },
        });
      } else {
        this.addResult({
          name: `配置文件-${config.name}`,
          level:
            config.name === 'package.json'
              ? DiagnosticLevel.ERROR
              : DiagnosticLevel.INFO,
          message: `${config.name} 不存在`,
        });
      }
    }
  }

  /**
   * 检查环境变量
   */
  async checkEnvironmentVariables() {
    const requiredEnvVars = ['NODE_ENV'];
    const missingEnvVars = [];

    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        missingEnvVars.push(envVar);
      }
    }

    if (missingEnvVars.length > 0) {
      this.addResult({
        name: '环境变量',
        level: DiagnosticLevel.WARNING,
        message: `缺少环境变量: ${missingEnvVars.join(', ')}`,
        suggestions: ['请在.env文件中设置必要的环境变量'],
      });
    } else {
      this.addResult({
        name: '环境变量',
        level: DiagnosticLevel.INFO,
        message: `环境变量正常: NODE_ENV=${process.env.NODE_ENV}`,
      });
    }

    this.addResult({
      name: '系统信息',
      level: DiagnosticLevel.INFO,
      message: `主机名: ${hostname()}, 主目录: ${homedir()}`,
      details: {
        hostname: hostname(),
        homedir: homedir(),
        platform: process.platform,
        arch: process.arch,
      },
    });
  }

  /**
   * 添加诊断结果
   * @param result 诊断结果
   */
  addResult(result) {
    this.results.push({
      id: randomUUID(),
      timestamp: Date.now(),
      ...result,
    });
  }

  /**
   * 获取诊断摘要
   * @returns 诊断摘要
   */
  getSummary() {
    const byLevel = {};
    const byCategory = {};

    for (const result of this.results) {
      byLevel[result.level] = (byLevel[result.level] || 0) + 1;
      byCategory[result.name.split('-')[0]] =
        (byCategory[result.name.split('-')[0]] || 0) + 1;
    }

    return {
      total: this.results.length,
      byLevel,
      byCategory,
      installType: this.installType,
    };
  }

  /**
   * 导出诊断报告
   * @param format 导出格式
   * @returns 诊断报告
   */
  exportReport(format = 'json') {
    const report = {
      timestamp: Date.now(),
      summary: this.getSummary(),
      results: this.results,
      systemInfo: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
      },
    };

    if (format === 'json') {
      return JSON.stringify(report, null, 2);
    }

    return report;
  }

  /**
   * 清除诊断结果
   */
  clearResults() {
    this.results = [];
  }
}

DiagnosticsService.instance = new DiagnosticsService();

export { DiagnosticsService };
export const diagnosticsService = DiagnosticsService.getInstance();
