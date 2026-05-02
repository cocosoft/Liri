/**
 * 模块迁移工具
 * 帮助将现有模块迁移到新的模块管理系统
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * 模块迁移分析结果
 */
interface MigrationAnalysis {
  modulePath: string;
  moduleName: string;
  status: 'ready' | 'needs_work' | 'not_found';
  issues: string[];
  suggestions: string[];
  estimatedEffort: number; // 预估工作量（1-5，1为最简单）
}

/**
 * 模块迁移工具类
 */
export class ModuleMigrationTool {
  private projectRoot: string;
  
  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
  }
  
  /**
   * 分析所有模块的迁移状态
   */
  analyzeAllModules(): MigrationAnalysis[] {
    const modules = this.discoverModules();
    const analysis: MigrationAnalysis[] = [];
    
    for (const module of modules) {
      analysis.push(this.analyzeModule(module));
    }
    
    return analysis;
  }
  
  /**
   * 发现项目中的所有模块
   */
  private discoverModules(): string[] {
    const modules: string[] = [];
    const srcDir = path.join(this.projectRoot, 'src');
    
    if (!fs.existsSync(srcDir)) {
      throw new Error(`源码目录不存在: ${srcDir}`);
    }
    
    // 遍历src目录下的所有子目录
    const items = fs.readdirSync(srcDir, { withFileTypes: true });
    
    for (const item of items) {
      if (item.isDirectory()) {
        modules.push(item.name);
      }
    }
    
    return modules;
  }
  
  /**
   * 分析单个模块的迁移状态
   */
  private analyzeModule(moduleName: string): MigrationAnalysis {
    const modulePath = path.join(this.projectRoot, 'src', moduleName);
    const analysis: MigrationAnalysis = {
      modulePath,
      moduleName,
      status: 'not_found',
      issues: [],
      suggestions: [],
      estimatedEffort: 5
    };
    
    // 检查模块目录是否存在
    if (!fs.existsSync(modulePath)) {
      analysis.status = 'not_found';
      analysis.issues.push(`模块目录不存在: ${modulePath}`);
      return analysis;
    }
    
    // 检查是否有index.ts文件
    const indexPath = path.join(modulePath, 'index.ts');
    if (!fs.existsSync(indexPath)) {
      analysis.status = 'needs_work';
      analysis.issues.push(`缺少index.ts文件: ${indexPath}`);
      analysis.suggestions.push('创建index.ts文件作为模块入口');
      analysis.estimatedEffort = 3;
    } else {
      // 分析index.ts文件
      const indexContent = fs.readFileSync(indexPath, 'utf-8');
      const hasExports = this.hasExports(indexContent);
      
      if (hasExports) {
        analysis.status = 'ready';
        analysis.suggestions.push('模块已准备好迁移');
        analysis.estimatedEffort = 1;
      } else {
        analysis.status = 'needs_work';
        analysis.issues.push('index.ts文件没有导出任何内容');
        analysis.suggestions.push('在index.ts中添加模块导出');
        analysis.estimatedEffort = 2;
      }
    }
    
    // 检查模块依赖
    const dependencies = this.analyzeDependencies(modulePath);
    if (dependencies.length > 0) {
      analysis.suggestions.push(`需要处理依赖关系: ${dependencies.join(', ')}`);
      analysis.estimatedEffort = Math.max(analysis.estimatedEffort, 3);
    }
    
    // 检查导入路径
    const importIssues = this.analyzeImports(modulePath);
    if (importIssues.length > 0) {
      analysis.issues.push(...importIssues);
      analysis.suggestions.push('需要统一导入路径');
      analysis.estimatedEffort = Math.max(analysis.estimatedEffort, 4);
    }
    
    return analysis;
  }
  
  /**
   * 检查文件是否有导出
   */
  private hasExports(content: string): boolean {
    const exportPatterns = [
      /export\s+/,
      /module\.exports/,
      /export\s+default/
    ];
    
    return exportPatterns.some(pattern => pattern.test(content));
  }
  
  /**
   * 分析模块依赖
   */
  private analyzeDependencies(modulePath: string): string[] {
    const dependencies: string[] = [];
    
    // 检查package.json中的依赖
    const packageJsonPath = path.join(modulePath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        if (packageJson.dependencies) {
          Object.keys(packageJson.dependencies).forEach(dep => {
            if (dep.startsWith('@modules/')) {
              dependencies.push(dep);
            }
          });
        }
      } catch (error) {
        // 忽略解析错误
      }
    }
    
    return dependencies;
  }
  
  /**
   * 分析导入路径问题
   */
  private analyzeImports(modulePath: string): string[] {
    const issues: string[] = [];
    
    // 遍历所有TypeScript文件
    this.walkDirectory(modulePath, (filePath) => {
      if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const importIssues = this.findImportIssues(content, filePath);
        issues.push(...importIssues);
      }
    });
    
    return issues;
  }
  
  /**
   * 查找导入路径问题
   */
  private findImportIssues(content: string, filePath: string): string[] {
    const issues: string[] = [];
    const importPattern = /import\s+.*from\s+['"]([^'"]+)['"]/g;
    
    let match;
    while ((match = importPattern.exec(content)) !== null) {
      const importPath = match[1];
      
      // 检查相对路径问题
      if (importPath.startsWith('../') && importPath.split('../').length > 3) {
        issues.push(`文件 ${filePath} 使用了深度相对路径: ${importPath}`);
      }
      
      // 检查绝对路径问题
      if (importPath.startsWith('/') || importPath.startsWith('src/')) {
        issues.push(`文件 ${filePath} 使用了绝对路径: ${importPath}`);
      }
    }
    
    return issues;
  }
  
  /**
   * 遍历目录
   */
  private walkDirectory(dirPath: string, callback: (filePath: string) => void): void {
    if (!fs.existsSync(dirPath)) return;
    
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);
      
      if (item.isDirectory()) {
        this.walkDirectory(fullPath, callback);
      } else {
        callback(fullPath);
      }
    }
  }
  
  /**
   * 生成迁移报告
   */
  generateMigrationReport(analysis: MigrationAnalysis[]): string {
    let report = '# 模块迁移分析报告\n\n';
    
    // 统计信息
    const totalModules = analysis.length;
    const readyModules = analysis.filter(a => a.status === 'ready').length;
    const needsWorkModules = analysis.filter(a => a.status === 'needs_work').length;
    const notFoundModules = analysis.filter(a => a.status === 'not_found').length;
    
    report += `## 统计信息\n`;
    report += `- 总模块数: ${totalModules}\n`;
    report += `- 已就绪: ${readyModules}\n`;
    report += `- 需要修改: ${needsWorkModules}\n`;
    report += `- 未找到: ${notFoundModules}\n\n`;
    
    // 详细分析
    report += `## 详细分析\n`;
    
    for (const item of analysis) {
      report += `### ${item.moduleName}\n`;
      report += `- 状态: ${this.getStatusText(item.status)}\n`;
      report += `- 预估工作量: ${item.estimatedEffort}/5\n`;
      
      if (item.issues.length > 0) {
        report += `- 问题:\n`;
        item.issues.forEach(issue => {
          report += `  - ${issue}\n`;
        });
      }
      
      if (item.suggestions.length > 0) {
        report += `- 建议:\n`;
        item.suggestions.forEach(suggestion => {
          report += `  - ${suggestion}\n`;
        });
      }
      
      report += `\n`;
    }
    
    // 迁移建议
    report += `## 迁移建议\n`;
    report += `1. 优先迁移状态为"ready"的模块\n`;
    report += `2. 然后处理预估工作量较低的模块\n`;
    report += `3. 最后解决复杂模块的依赖问题\n`;
    report += `4. 建议分批次迁移，每次迁移2-3个模块\n`;
    
    return report;
  }
  
  /**
   * 获取状态文本
   */
  private getStatusText(status: string): string {
    switch (status) {
      case 'ready':
        return '✅ 已就绪';
      case 'needs_work':
        return '⚠️ 需要修改';
      case 'not_found':
        return '❌ 未找到';
      default:
        return '❓ 未知';
    }
  }
  
  /**
   * 创建模块迁移脚本
   */
  generateMigrationScript(moduleName: string): string {
    return `
/**
 * ${moduleName} 模块迁移脚本
 */

import { moduleRegistry } from '../modules/ModuleRegistry';
import { MODULE_DEFINITIONS } from '../modules/ModuleDefinitions';

/**
 * 迁移 ${moduleName} 模块到模块管理系统
 */
export async function migrate${this.capitalizeFirst(moduleName)}Module(): Promise<void> {
  console.log('开始迁移 ${moduleName} 模块...');
  
  try {
    // 1. 获取模块定义
    const moduleDefinition = MODULE_DEFINITIONS['${moduleName}'];
    if (!moduleDefinition) {
      throw new Error('模块定义不存在: ${moduleName}');
    }
    
    // 2. 注册模块
    moduleRegistry.register(moduleDefinition);
    console.log('模块注册完成: ${moduleName}');
    
    // 3. 初始化模块
    await moduleRegistry.initialize('${moduleName}');
    console.log('模块初始化完成: ${moduleName}');
    
    console.log('${moduleName} 模块迁移完成');
    
  } catch (error) {
    console.error('${moduleName} 模块迁移失败:', error);
    throw error;
  }
}

/**
 * 首字母大写
 */
function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// 执行迁移
// migrate${this.capitalizeFirst(moduleName)}Module().catch(console.error);
`;
  }
  
  /**
   * 首字母大写
   */
  private capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}

/**
 * 便捷迁移函数
 */
export async function migrateAllModules(): Promise<void> {
  const tool = new ModuleMigrationTool();
  const analysis = tool.analyzeAllModules();
  
  console.log('开始迁移所有模块...');
  
  // 生成迁移报告
  const report = tool.generateMigrationReport(analysis);
  const reportPath = path.join(process.cwd(), 'module_migration_report.md');
  fs.writeFileSync(reportPath, report);
  console.log(`迁移报告已生成: ${reportPath}`);
  
  // 按优先级排序（工作量从低到高）
  const sortedAnalysis = analysis
    .filter(a => a.status === 'ready' || a.status === 'needs_work')
    .sort((a, b) => a.estimatedEffort - b.estimatedEffort);
  
  // 生成迁移脚本
  for (const item of sortedAnalysis) {
    const script = tool.generateMigrationScript(item.moduleName);
    const scriptPath = path.join(process.cwd(), 'migration', `${item.moduleName}_migration.ts`);
    
    // 确保目录存在
    const scriptDir = path.dirname(scriptPath);
    if (!fs.existsSync(scriptDir)) {
      fs.mkdirSync(scriptDir, { recursive: true });
    }
    
    fs.writeFileSync(scriptPath, script);
    console.log(`迁移脚本已生成: ${scriptPath}`);
  }
  
  console.log('模块迁移准备完成，请查看迁移报告和脚本');
}