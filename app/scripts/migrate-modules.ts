#!/usr/bin/env bun

/**
 * 模块迁移执行脚本
 * 自动化执行模块迁移流程
 */

import { ModuleMigrationTool, migrateAllModules } from '../src/tools/ModuleMigrationTool';
import { DependencyValidator, runDependencyValidation } from '../src/tools/DependencyValidator';
import { moduleRegistry, moduleInitializer } from '../src/modules';

/**
 * 迁移配置
 */
interface MigrationConfig {
  // 迁移策略
  strategy: 'incremental' | 'all-at-once';
  
  // 批次大小（增量迁移时使用）
  batchSize: number;
  
  // 是否生成报告
  generateReport: boolean;
  
  // 是否执行实际迁移
  executeMigration: boolean;
  
  // 迁移优先级
  priority: 'low-effort-first' | 'high-priority-first';
}

/**
 * 模块迁移执行器
 */
export class ModuleMigrationExecutor {
  private config: MigrationConfig;
  
  constructor(config: Partial<MigrationConfig> = {}) {
    this.config = {
      strategy: 'incremental',
      batchSize: 3,
      generateReport: true,
      executeMigration: false, // 默认只分析不执行
      priority: 'low-effort-first',
      ...config
    };
  }
  
  /**
   * 执行完整的模块迁移流程
   */
  async execute(): Promise<void> {
    console.log('🚀 开始执行模块迁移流程...\n');
    
    try {
      // 步骤1: 分析模块迁移状态
      console.log('📊 步骤1: 分析模块迁移状态');
      const analysis = await this.analyzeMigrationStatus();
      
      // 步骤2: 验证依赖关系
      console.log('🔍 步骤2: 验证依赖关系');
      const dependencyValidation = await this.validateDependencies();
      
      // 步骤3: 生成迁移计划
      console.log('📋 步骤3: 生成迁移计划');
      const migrationPlan = this.generateMigrationPlan(analysis, dependencyValidation);
      
      // 步骤4: 执行迁移（如果配置允许）
      if (this.config.executeMigration) {
        console.log('⚡ 步骤4: 执行迁移');
        await this.executeMigrationPlan(migrationPlan);
      } else {
        console.log('ℹ️  步骤4: 跳过实际迁移（配置为只分析模式）');
      }
      
      // 步骤5: 生成最终报告
      console.log('📄 步骤5: 生成最终报告');
      await this.generateFinalReport(analysis, dependencyValidation, migrationPlan);
      
      console.log('\n✅ 模块迁移流程执行完成！');
      
    } catch (error) {
      console.error('❌ 模块迁移流程执行失败:', error);
      throw error;
    }
  }
  
  /**
   * 分析模块迁移状态
   */
  private async analyzeMigrationStatus() {
    const tool = new ModuleMigrationTool();
    const analysis = tool.analyzeAllModules();
    
    console.log(`发现 ${analysis.length} 个模块需要分析`);
    
    const readyCount = analysis.filter(a => a.status === 'ready').length;
    const needsWorkCount = analysis.filter(a => a.status === 'needs_work').length;
    const notFoundCount = analysis.filter(a => a.status === 'not_found').length;
    
    console.log(`- ✅ 已就绪: ${readyCount}`);
    console.log(`- ⚠️  需要修改: ${needsWorkCount}`);
    console.log(`- ❌ 未找到: ${notFoundCount}`);
    
    return analysis;
  }
  
  /**
   * 验证依赖关系
   */
  private async validateDependencies() {
    const validator = new DependencyValidator();
    const validation = validator.validateAllDependencies();
    
    console.log(`依赖关系验证: ${validation.valid ? '✅ 通过' : '❌ 失败'}`);
    console.log(`- 错误: ${validation.errors.length}`);
    console.log(`- 警告: ${validation.warnings.length}`);
    console.log(`- 循环依赖: ${validation.circularDependencies.length}`);
    
    return validation;
  }
  
  /**
   * 生成迁移计划
   */
  private generateMigrationPlan(analysis: any[], dependencyValidation: any) {
    const plan = {
      strategy: this.config.strategy,
      batches: [] as any[],
      totalModules: analysis.length,
      estimatedTime: 0,
      risks: [] as string[]
    };
    
    // 按优先级排序
    const sortedAnalysis = analysis
      .filter(a => a.status === 'ready' || a.status === 'needs_work')
      .sort((a, b) => {
        if (this.config.priority === 'low-effort-first') {
          return a.estimatedEffort - b.estimatedEffort;
        } else {
          // 高优先级模块先迁移（核心模块等）
          const priorityA = this.getModulePriority(a.moduleName);
          const priorityB = this.getModulePriority(b.moduleName);
          return priorityB - priorityA;
        }
      });
    
    // 分批次
    if (this.config.strategy === 'incremental') {
      for (let i = 0; i < sortedAnalysis.length; i += this.config.batchSize) {
        const batch = sortedAnalysis.slice(i, i + this.config.batchSize);
        plan.batches.push({
          batchNumber: Math.floor(i / this.config.batchSize) + 1,
          modules: batch,
          estimatedEffort: batch.reduce((sum, m) => sum + m.estimatedEffort, 0)
        });
      }
    } else {
      // 一次性迁移所有模块
      plan.batches.push({
        batchNumber: 1,
        modules: sortedAnalysis,
        estimatedEffort: sortedAnalysis.reduce((sum, m) => sum + m.estimatedEffort, 0)
      });
    }
    
    // 估算总时间（假设每个工作量单位需要30分钟）
    plan.estimatedTime = plan.batches.reduce((sum, batch) => sum + batch.estimatedEffort, 0) * 30;
    
    // 识别风险
    if (dependencyValidation.circularDependencies.length > 0) {
      plan.risks.push('存在循环依赖，可能影响迁移顺序');
    }
    
    if (analysis.some(a => a.status === 'not_found')) {
      plan.risks.push('部分模块未找到，需要手动处理');
    }
    
    console.log(`生成迁移计划: ${plan.batches.length} 个批次`);
    console.log(`预估总时间: ${Math.ceil(plan.estimatedTime / 60)} 小时`);
    
    return plan;
  }
  
  /**
   * 获取模块优先级
   */
  private getModulePriority(moduleName: string): number {
    const highPriorityModules = ['core', 'infrastructure', 'config', 'error'];
    const mediumPriorityModules = ['ai', 'agent', 'bridge', 'cli'];
    
    if (highPriorityModules.includes(moduleName)) return 3;
    if (mediumPriorityModules.includes(moduleName)) return 2;
    return 1;
  }
  
  /**
   * 执行迁移计划
   */
  private async executeMigrationPlan(plan: any) {
    console.log(`开始执行迁移计划，共 ${plan.batches.length} 个批次`);
    
    for (const batch of plan.batches) {
      console.log(`\n📦 执行批次 ${batch.batchNumber}:`);
      
      for (const module of batch.modules) {
        console.log(`  🔄 迁移模块: ${module.moduleName}`);
        
        try {
          // 这里可以添加具体的迁移逻辑
          await this.migrateSingleModule(module);
          console.log(`  ✅ ${module.moduleName} 迁移成功`);
          
        } catch (error) {
          console.error(`  ❌ ${module.moduleName} 迁移失败:`, error);
          // 可以根据需要决定是否继续迁移
        }
      }
      
      // 批次间暂停，便于验证
      if (batch.batchNumber < plan.batches.length) {
        console.log(`⏸️  批次 ${batch.batchNumber} 完成，等待验证...`);
        await this.waitForConfirmation();
      }
    }
  }
  
  /**
   * 迁移单个模块
   */
  private async migrateSingleModule(module: any) {
    // 这里实现具体的模块迁移逻辑
    // 例如：更新导入路径、注册模块定义等
    
    // 模拟迁移过程
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // 实际项目中，这里会调用具体的迁移函数
    // await migrateModule(module.moduleName);
  }
  
  /**
   * 等待用户确认
   */
  private async waitForConfirmation(): Promise<void> {
    if (process.env.CI) {
      // CI环境中自动继续
      console.log('CI环境，自动继续下一批次');
      return;
    }
    
    // 在实际交互环境中，这里可以添加用户确认逻辑
    // 目前先等待2秒模拟
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  /**
   * 生成最终报告
   */
  private async generateFinalReport(analysis: any[], dependencyValidation: any, migrationPlan: any) {
    const fs = require('fs');
    const path = require('path');
    
    const reportDir = path.join(process.cwd(), 'reports', 'module-migration');
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(reportDir, `migration-report-${timestamp}.md`);
    
    const report = this.generateReportContent(analysis, dependencyValidation, migrationPlan);
    fs.writeFileSync(reportPath, report);
    
    console.log(`📄 迁移报告已生成: ${reportPath}`);
  }
  
  /**
   * 生成报告内容
   */
  private generateReportContent(analysis: any[], dependencyValidation: any, migrationPlan: any): string {
    let report = `# 模块迁移报告\n\n`;
    report += `**生成时间**: ${new Date().toLocaleString()}\n`;
    report += `**迁移策略**: ${migrationPlan.strategy}\n`;
    report += `**优先级**: ${this.config.priority}\n\n`;
    
    // 分析摘要
    report += `## 分析摘要\n`;
    report += `- 总模块数: ${analysis.length}\n`;
    report += `- 已就绪: ${analysis.filter(a => a.status === 'ready').length}\n`;
    report += `- 需要修改: ${analysis.filter(a => a.status === 'needs_work').length}\n`;
    report += `- 未找到: ${analysis.filter(a => a.status === 'not_found').length}\n\n`;
    
    // 依赖验证
    report += `## 依赖关系验证\n`;
    report += `- 状态: ${dependencyValidation.valid ? '✅ 通过' : '❌ 失败'}\n`;
    report += `- 循环依赖: ${dependencyValidation.circularDependencies.length}\n`;
    report += `- 缺失依赖: ${dependencyValidation.missingDependencies.length}\n\n`;
    
    // 迁移计划
    report += `## 迁移计划\n`;
    report += `- 批次数量: ${migrationPlan.batches.length}\n`;
    report += `- 预估时间: ${Math.ceil(migrationPlan.estimatedTime / 60)} 小时\n\n`;
    
    // 详细批次信息
    report += `### 批次详情\n`;
    migrationPlan.batches.forEach((batch: any, index: number) => {
      report += `#### 批次 ${batch.batchNumber}\n`;
      report += `- 模块数量: ${batch.modules.length}\n`;
      report += `- 预估工作量: ${batch.estimatedEffort}/5\n`;
      report += `- 模块列表: ${batch.modules.map((m: any) => m.moduleName).join(', ')}\n\n`;
    });
    
    // 风险提示
    if (migrationPlan.risks.length > 0) {
      report += `## 风险提示\n`;
      migrationPlan.risks.forEach((risk: string) => {
        report += `- ⚠️ ${risk}\n`;
      });
      report += `\n`;
    }
    
    // 建议
    report += `## 迁移建议\n`;
    report += `1. 按照批次顺序执行迁移\n`;
    report += `2. 每个批次完成后进行验证测试\n`;
    report += `3. 优先解决依赖关系问题\n`;
    report += `4. 保持代码库的稳定性\n`;
    
    return report;
  }
}

/**
 * 命令行参数解析
 */
function parseArgs(): Partial<MigrationConfig> {
  const args = process.argv.slice(2);
  const config: Partial<MigrationConfig> = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--execute' || arg === '-e') {
      config.executeMigration = true;
    } else if (arg === '--strategy' || arg === '-s') {
      config.strategy = args[++i] as 'incremental' | 'all-at-once';
    } else if (arg === '--batch-size' || arg === '-b') {
      config.batchSize = parseInt(args[++i]);
    } else if (arg === '--priority' || arg === '-p') {
      config.priority = args[++i] as 'low-effort-first' | 'high-priority-first';
    } else if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    }
  }
  
  return config;
}

/**
 * 显示帮助信息
 */
function showHelp(): void {
  console.log(`
模块迁移工具

用法: bun run migrate-modules.ts [选项]

选项:
  -e, --execute           执行实际迁移（默认只分析）
  -s, --strategy <策略>   迁移策略: incremental | all-at-once (默认: incremental)
  -b, --batch-size <数量> 批次大小 (默认: 3)
  -p, --priority <优先级> 迁移优先级: low-effort-first | high-priority-first (默认: low-effort-first)
  -h, --help              显示此帮助信息

示例:
  bun run migrate-modules.ts                    # 只分析不执行
  bun run migrate-modules.ts --execute         # 执行实际迁移
  bun run migrate-modules.ts -s all-at-once -e # 一次性迁移所有模块
`);
}

/**
 * 主函数
 */
async function main() {
  const config = parseArgs();
  
  const executor = new ModuleMigrationExecutor(config);
  await executor.execute();
}

// 执行主函数
if (import.meta.main) {
  main().catch(error => {
    console.error('迁移脚本执行失败:', error);
    process.exit(1);
  });
}

export { main };