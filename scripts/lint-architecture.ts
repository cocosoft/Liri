/**
 * 架构规则检查器 (Architecture Compliance Linter)
 *
 * 在 CI 中运行：bun run scripts/lint-architecture.ts
 * AI 可在提交前手动调用检查架构合规性。
 *
 * 检查规则对应 .trae/rules/architecture-compliance.md 中的 R01-R04。
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';

// ============ 类型定义 ============

interface RuleViolation {
    ruleId: string;
    severity: 'error' | 'warning';
    file: string;
    line?: number;
    message: string;
    suggestion: string;
}

// ============ 工具函数 ============

/** 递归收集目录下所有 .ts 文件（排除 node_modules） */
function collectTsFiles(dir: string): string[] {
    const results: string[] = [];
    try {
        const entries = readdirSyncFull(dir);
        for (const entry of entries) {
            const fullPath = join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules' || entry.name === '.git') continue;
                results.push(...collectTsFiles(fullPath));
            } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
                results.push(fullPath);
            }
        }
    } catch {
        // 目录不存在时忽略
    }
    return results;
}

function readdirSyncFull(dir: string): Array<{ name: string; isDirectory: () => boolean }> {
    const fs = require('node:fs');
    return fs.readdirSync(dir, { withFileTypes: true });
}

// ============ 规则检查器 ============

class ArchitectureLinter {
    private violations: RuleViolation[] = [];
    private srcPath: string;
    private allFiles: string[] = [];
    private moduleToLayer: Map<string, string> = new Map();
    private allowedDeps: Record<string, string[]> = {};
    private layerOrder: string[] = [];

    constructor(srcPath: string) {
        this.srcPath = srcPath;
    }

    /** 加载所有源文件 */
    async loadFiles(): Promise<void> {
        this.allFiles = collectTsFiles(this.srcPath);
        console.log(`已扫描 ${this.allFiles.length} 个 TypeScript 文件`);
    }

    // ============ R01 基础设施复用 ============

    /** R01-001: 检查自建事件总线（extends EventEmitter） */
    async checkSelfBuiltEventBus(): Promise<void> {
        const skipPatterns = [
            'node:http', 'node:net', 'node:events', 'Socket', 'Server',
            'Stream', 'Readable', 'Writable', 'ChildProcess',
        ];

        for (const file of this.allFiles) {
            // 跳过标准事件总线本身和已知例外
            if (file.includes('core\\events\\EventBus') || file.includes('core/events/EventBus')) continue;

            const content = readFileSync(file, 'utf-8');

            // 跳过合法场景
            if (skipPatterns.some(p => content.includes(p))) continue;

            // 检查 extends EventEmitter
            const matches = content.match(/class\s+(\w+)\s+extends\s+EventEmitter/g);
            if (matches) {
                for (const match of matches) {
                    const className = match.match(/class\s+(\w+)/)?.[1] || 'Unknown';
                    this.violations.push({
                        ruleId: 'R01-001',
                        severity: 'error',
                        file: relative(process.cwd(), file),
                        message: `${className} 使用 extends EventEmitter 作为事件总线`,
                        suggestion: '替换为 core/events/EventBus.ts 的 EventBusImpl',
                    });
                }
            }

            // 检查自建 Map<string, Set<...>> 事件模式
            if (content.includes('Map<string, Set<') ||
                (content.includes('private events') && content.includes('Map<'))) {
                this.violations.push({
                    ruleId: 'R01-001',
                    severity: 'warning',
                    file: relative(process.cwd(), file),
                    message: '可能存在自建事件分发（Map<string, Set<...>> 模式）',
                    suggestion: '替换为 core/events/EventBus.ts 的 EventBusImpl',
                });
            }
        }
    }

    /** R01-002: 检查错误类是否继承 AppError */
    async checkErrorHierarchy(): Promise<void> {
        const stdErrors = [
            'AppError', 'NetworkError', 'FileSystemError', 'PermissionError',
            'ValidationError', 'ExecutionError', 'ConfigParseError', 'ShellError',
            'PluginError', 'ToolError', 'CacheError', 'SecurityError',
            'APIError', 'DatabaseError', 'AbortError', 'ModuleError',
            'FallbackTriggeredError', 'SafeTelemetryError',
            'MalformedCommandError', 'LightweightNetworkError', 'LightweightFileError',
            'LightweightAPIError', 'LightweightConfigError',
        ];

        for (const file of this.allFiles) {
            // 跳过标准错误定义文件
            if (file.includes('error\\types.ts') || file.includes('error/types.ts')) continue;

            const content = readFileSync(file, 'utf-8');

            // 检查1: 与标准错误类同名
            for (const errName of stdErrors) {
                if (errName === 'AppError') continue; // AppError 是基类
                const regex = new RegExp(`export\\s+(class|interface|type)\\s+${errName}\\b`);
                if (regex.test(content)) {
                    this.violations.push({
                        ruleId: 'R01-002',
                        severity: 'error',
                        file: relative(process.cwd(), file),
                        message: `错误类 ${errName} 已在 error/types.ts 中定义，禁止重复定义`,
                        suggestion: `删除此定义，改为从 @modules/error/types 导入 ${errName}`,
                    });
                }
            }

            // 检查2: 直接 extends Error（非 AppError）
            const errorMatches = content.matchAll(/export\s+class\s+(\w+)\s+extends\s+Error\b/g);
            for (const match of errorMatches) {
                const className = match[1];

                // 跳过标准错误类型文件
                if (file.includes('error\\') || file.includes('error/')) continue;
                // 跳过压缩/打包后的文件
                if (file.includes('.min.') || file.includes('.bundle.')) continue;
                // 跳过已知的标准 Error 继承
                if (['PYAppError'].includes(className)) {
                    // PYAppError 是已知的违规，已标记
                    this.violations.push({
                        ruleId: 'R01-002',
                        severity: 'error',
                        file: relative(process.cwd(), file),
                        message: `${className} 直接 extends Error（应继承 AppError）`,
                        suggestion: `改为 extends AppError（从 @modules/error/types 导入），或删除此文件合并到 error/types.ts`,
                    });
                    continue;
                }

                this.violations.push({
                    ruleId: 'R01-002',
                    severity: 'warning',
                    file: relative(process.cwd(), file),
                    message: `${className} 直接 extends Error，应继承 AppError`,
                    suggestion: `改为 extends AppError（从 @modules/error/types 导入）`,
                });
            }
        }
    }

    /** R01-003: 检查自建重试逻辑 */
    async checkSelfBuiltRetry(): Promise<void> {
        for (const file of this.allFiles) {
            // 跳过标准重试实现
            if (file.includes('query\\withRetry.ts') || file.includes('query/withRetry.ts')) continue;
            if (file.includes('utils\\withRetry.ts') || file.includes('utils/withRetry.ts')) continue;

            const content = readFileSync(file, 'utf-8');

            // 检测手写重试模式
            const hasRetryFunction = /(function|const|async)\s+\w*[Rr]etry\w*\s*[=(<]/.test(content);
            const hasRetryLoop = /for\s*\(\s*(let|const|var)\s+\w+\s*=\s*0\s*;\s*\w+\s*<\s*\w*[Rr]etry/.test(content);
            const hasRetryCount = /\bretryCount\b|\bmaxRetries\b|\bMAX_RETRIES\b/.test(content);

            if (hasRetryFunction || hasRetryLoop || hasRetryCount) {
                // 检查是否已经有 import withRetry
                if (content.includes("from '") && content.includes('withRetry')) continue;

                this.violations.push({
                    ruleId: 'R01-003',
                    severity: 'warning',
                    file: relative(process.cwd(), file),
                    message: '可能包含自建重试逻辑',
                    suggestion: '请使用 query/withRetry.ts 的 withRetry()（标准重试实现）',
                });
            }
        }
    }

    /** R01-004: 检查自建缓存 */
    async checkSelfBuiltCache(): Promise<void> {
        for (const file of this.allFiles) {
            // 跳过已知的缓存实现
            if (file.includes('cache\\') || file.includes('cache/')) continue;

            const content = readFileSync(file, 'utf-8');

            // 检测 private cache = new Map 模式
            const cachePattern = /(private|protected|public)\s+(\w*[Cc]ache\w*)\s*[=:]\s*new\s+Map\b/g;
            const matches = content.matchAll(cachePattern);
            for (const match of matches) {
                const varName = match[2];
                // 跳过非业务缓存的合理场景
                if (content.includes('CacheSystem') || content.includes('ICache')) continue;

                this.violations.push({
                    ruleId: 'R01-004',
                    severity: 'warning',
                    file: relative(process.cwd(), file),
                    message: `检测到自建缓存 \`${varName}\`（new Map 模式）`,
                    suggestion: '请改用 cache/CacheSystem.ts',
                });
            }
        }
    }

    // ============ R02 数据模型统一 ============

    /** R02-002: 检查同名导出冲突（interface / type / class / function / const） */
    async checkDuplicateTypeNames(): Promise<void> {
        const typeMap = new Map<string, Array<{ file: string; name: string; kind: string }>>();

        // 已知合法的同名类型（通道模板文件、模块入口、子模块 index 等）
        const knownSafePatterns = [
            /channels[/\\][^/\\]+[/\\](config-schema|accounts|doctor|monitor|probe|runtime|channel\.runtime)\.ts$/,
            /[/\\]index\.ts$/,
        ];

        // 常见非冲突名称（各模块自身的局部配置类型）
        const commonNames = new Set([
            'Props', 'State', 'Config', 'Options', 'Params', 'Result', 'Context',
            'Handler', 'Listener', 'Callback', 'Input', 'Output', 'Args', 'Entry',
            'Data', 'Info', 'Stats', 'Summary', 'Payload', 'Response', 'Request',
            'Status', 'Mode', 'Role', 'Event', 'Meta', 'Metadata', 'Header',
            'Item', 'Row', 'Record',
        ]);

        for (const file of this.allFiles) {
            // 跳过通道模板（同名类型是合法的接口实现）
            if (knownSafePatterns.some(p => p.test(file))) continue;

            const content = readFileSync(file, 'utf-8');

            // 提取 export interface / type / class / function / const
            const patterns = [
                { regex: /export\s+interface\s+(\w+)/g, kind: 'interface' },
                { regex: /export\s+type\s+(\w+)\s*=/g, kind: 'type' },
                { regex: /export\s+(abstract\s+)?class\s+(\w+)/g, kind: 'class', nameGroup: 2 },
                { regex: /export\s+function\s+(\w+)/g, kind: 'function' },
                { regex: /export\s+const\s+(\w+)\s*[=:]/g, kind: 'const' },
            ];

            for (const { regex, kind, nameGroup } of patterns) {
                const matches = [...content.matchAll(regex)];
                for (const match of matches) {
                    const name = match[nameGroup ?? 1];
                    if (commonNames.has(name)) continue;

                    if (!typeMap.has(name)) typeMap.set(name, []);
                    typeMap.get(name)!.push({ file, name, kind });
                }
            }
        }

        // 报告同名导出
        for (const [name, locations] of typeMap) {
            if (locations.length < 2) continue;

            // 排除所有都在同一目录下或同一模块子树中的情况
            const dirs = new Set(locations.map(l => {
                const rel = relative(this.srcPath, l.file);
                // 取前两级目录作为模块标识（如 "config/" vs "core/extensibility"）
                const parts = rel.split(/[/\\]/);
                return parts.slice(0, 2).join('/');
            }));
            if (dirs.size < 2) continue;

            const kinds = [...new Set(locations.map(l => l.kind))].join('/');
            const fileList = locations.map(l =>
                `${relative(this.srcPath, l.file)} (${l.kind})`
            ).join(', ');

            this.violations.push({
                ruleId: 'R02-002',
                severity: 'warning',
                file: fileList,
                message: `导出 "${name}" (${kinds}) 在 ${locations.length} 个不同模块中定义`,
                suggestion: '请检查这些定义是否应统一为核心数据契约（如 core/data-models.ts）或归并到单一模块',
            });
        }
    }

    /** R03-001: 检查自建基础设施 */
    async checkSelfBuiltInfrastructure(): Promise<void> {
        const infraKeywords = [
            { pattern: /class\s+(\w*EventBus\w*)/, desc: '自建 EventBus' },
            { pattern: /class\s+(\w*Cache\w*)\s*\{/, desc: '自建 Cache' },
            { pattern: /class\s+(\w*Retry\w*)/, desc: '自建 Retry' },
            { pattern: /class\s+(\w*Config\w*Manager\w*)/, desc: '自建 ConfigManager' },
            { pattern: /class\s+(\w*Health\w*Checker\w*)/, desc: '自建 HealthChecker' },
        ];

        for (const file of this.allFiles) {
            // 跳过标准实现
            if (file.includes('core\\events\\') || file.includes('core/events/')) continue;
            if (file.includes('cache\\') || file.includes('cache/')) continue;
            if (file.includes('ai\\clients\\retry') || file.includes('ai/clients/retry')) continue;
            if (file.includes('config\\') || file.includes('config/')) continue;

            const content = readFileSync(file, 'utf-8');

            for (const kw of infraKeywords) {
                if (kw.pattern.test(content)) {
                    this.violations.push({
                        ruleId: 'R03-001',
                        severity: 'warning',
                        file: relative(process.cwd(), file),
                        message: `可能包含${kw.desc}`,
                        suggestion: '如确为基础设施，请确保已获架构 review 批准',
                    });
                    break; // 每个文件只报告一次
                }
            }
        }
    }

    // ============ R04 文件组织 ============

    /** R04-001: 检查文件行数 */
    async checkFileSize(): Promise<void> {
        for (const file of this.allFiles) {
            const content = readFileSync(file, 'utf-8');
            const lines = content.split('\n').length;

            if (lines > 500) {
                this.violations.push({
                    ruleId: 'R04-001',
                    severity: 'warning',
                    file: relative(process.cwd(), file),
                    message: `文件 ${lines} 行，超过 500 行限制`,
                    suggestion: '考虑拆分为子目录下的多个文件',
                });
            }
        }
    }

    // ============ R00 分层合规 ============

    private layerExceptions: Set<string> = new Set();

    /** 加载分层例外清单 */
    async loadLayerExceptions(): Promise<void> {
        const exPath = resolve(process.cwd(), 'scripts', 'layer-exceptions.json');
        if (!existsSync(exPath)) return;

        const data = JSON.parse(readFileSync(exPath, 'utf-8'));

        // 加载批量例外
        const bulk = data.bulkExceptions || [];
        for (const ex of bulk) {
            // 检查是否已过期
            if (ex.expiresAt && new Date(ex.expiresAt) < new Date()) continue;
            this.layerExceptions.add(`${ex.ruleId}:${ex.pattern}`);
        }

        // 加载按模块例外
        const perModule = data.perModuleExceptions || [];
        for (const ex of perModule) {
            if (ex.expiresAt && new Date(ex.expiresAt) < new Date()) continue;
            this.layerExceptions.add(`${ex.ruleId}:${ex.sourceModule}:${ex.targetModule}`);
        }

        console.log(`已加载 ${this.layerExceptions.size} 条有效分层例外`);
    }

    /** 判断跨层依赖是否已被豁免 */
    isException(ruleId: string, srcModule: string, tgtModule: string): boolean {
        const srcLayer = this.moduleToLayer.get(srcModule) || '';
        const tgtLayer = this.moduleToLayer.get(tgtModule) || '';

        // 检查按模块精确例外
        if (this.layerExceptions.has(`${ruleId}:${srcModule}:${tgtModule}`)) return true;

        // 检查批量例外（按 layer 模式匹配）
        const pattern = `${srcLayer} -> ${tgtLayer}`;
        if (this.layerExceptions.has(`${ruleId}:${pattern}`)) return true;

        return false;
    }

    /** 加载分层映射配置 */
    async loadLayerMapping(): Promise<void> {
        const mappingPath = resolve(process.cwd(), 'scripts', 'modules-to-layers.json');
        if (!existsSync(mappingPath)) {
            console.warn('⚠ 警告: scripts/modules-to-layers.json 不存在，跳过分层检查');
            return;
        }
        const data = JSON.parse(readFileSync(mappingPath, 'utf-8'));
        for (const [mod, info] of Object.entries(data.modules) as [string, any][]) {
            this.moduleToLayer.set(mod, info.layer);
        }
        this.allowedDeps = data.allowedDependencies;
        this.layerOrder = data.layerOrder;
        console.log(`已加载 ${this.moduleToLayer.size} 个模块的分层映射`);
    }

    /** 从文件路径解析所属模块名 */
    resolveModuleName(filePath: string): string {
        const rel = relative(this.srcPath, filePath).replace(/\\/g, '/');
        const parts = rel.split('/');
        if (parts.length === 0) return '__root__';
        const first = parts[0];
        // 根目录文件（如 main.ts, index.ts）以文件名作为模块名
        if (first.includes('.ts') || first.includes('.tsx')) return first;
        return first;
    }

    /** 解析 import 语句，提取跨模块依赖 */
    parseModuleImports(filePath: string): Set<string> {
        const content = readFileSync(filePath, 'utf-8');
        const imports = new Set<string>();

        // 匹配 @modules/xxx 形式
        const moduleRegex = /from\s+['"]@modules\/([^'"/]+)/g;
        let match: RegExpExecArray | null;
        while ((match = moduleRegex.exec(content)) !== null) {
            imports.add(match[1]);
        }

        // 匹配相对路径 import，解析目标模块
        const relImportRegex = /from\s+['"](\.[^'"]+)['"]/g;
        while ((match = relImportRegex.exec(content)) !== null) {
            const relPath = match[1];
            // 移除尾部文件名只取目录，保证 resolve 到目录
            const resolved = resolve(dirname(filePath), relPath);
            // 只解析 src 内的相对引用
            if (resolved.startsWith(this.srcPath)) {
                const targetModule = this.resolveModuleName(resolved);
                imports.add(targetModule);
            }
        }

        return imports;
    }

    /** R00-001: 检查分层合规 */
    async checkLayerCompliance(): Promise<void> {
        await this.loadLayerMapping();
        if (this.moduleToLayer.size === 0) return;

        await this.loadLayerExceptions();

        console.log('\n运行分层合规检查 (R00-001)...');
        let checked = 0;
        let violationCount = 0;
        let exemptedCount = 0;

        for (const file of this.allFiles) {
            const srcModule = this.resolveModuleName(file);
            const srcLayer = this.moduleToLayer.get(srcModule);
            if (!srcLayer) continue;

            const allowedLayers = this.allowedDeps[srcLayer] || [];
            const targetModules = this.parseModuleImports(file);

            for (const tgtModule of targetModules) {
                if (tgtModule === srcModule) continue;
                const tgtLayer = this.moduleToLayer.get(tgtModule);
                if (!tgtLayer) continue;
                if (allowedLayers.includes(tgtLayer)) continue;

                // 检查是否被例外豁免
                if (this.isException('R00-001', srcModule, tgtModule)) {
                    exemptedCount++;
                    continue;
                }

                // 真正的跨层违规
                this.violations.push({
                    ruleId: 'R00-001',
                    severity: 'warning',
                    file: relative(process.cwd(), file),
                    message: `分层违规: ${srcModule} (${srcLayer}) → ${tgtModule} (${tgtLayer})`,
                    suggestion: `[${srcLayer}] 允许依赖: ${allowedLayers.join(', ')}，但当前依赖了 [${tgtLayer}] 的 ${tgtModule}`,
                });
                violationCount++;
            }
            checked++;
        }
        console.log(`分层检查完成: 检查 ${checked} 个文件 | 违规 ${violationCount} | 已豁免 ${exemptedCount}`);
    }

    /** 运行所有检查 */
    async runAll(): Promise<RuleViolation[]> {
        await this.loadFiles();

        console.log('\n运行架构合规检查...\n');

        await Promise.all([
            this.checkSelfBuiltEventBus(),
            this.checkErrorHierarchy(),
            this.checkSelfBuiltRetry(),
            this.checkSelfBuiltCache(),
            this.checkDuplicateTypeNames(),
            this.checkSelfBuiltInfrastructure(),
            this.checkFileSize(),
        ]);

        // 分层合规检查（需按顺序在 loadFiles 之后执行）
        await this.checkLayerCompliance();

        return this.violations;
    }
}

// ============ 主入口 ============

async function main(): Promise<void> {
    // 解析 src 路径：优先使用环境变量 PYAPP_PROJECT_DIR，其次是 cwd
    const projectDir = process.env.PYAPP_PROJECT_DIR || process.cwd();
    const srcPath = resolve(projectDir, 'app', 'src');

    if (!existsSync(srcPath)) {
        console.error(`错误: 找不到 src 目录: ${srcPath}`);
        console.error('请在项目根目录运行或设置 PYAPP_PROJECT_DIR 环境变量');
        process.exit(2);
    }

    const linter = new ArchitectureLinter(srcPath);
    const violations = await linter.runAll();

    const errors = violations.filter(v => v.severity === 'error');
    const warnings = violations.filter(v => v.severity === 'warning');

    console.log(`\n========== 架构合规检查结果 ==========`);
    console.log(`错误: ${errors.length}  警告: ${warnings.length}  总计: ${violations.length}`);
    console.log(`========================================\n`);

    // 按规则 ID 分组输出
    const byRule = new Map<string, RuleViolation[]>();
    for (const v of violations) {
        if (!byRule.has(v.ruleId)) byRule.set(v.ruleId, []);
        byRule.get(v.ruleId)!.push(v);
    }

    for (const [ruleId, items] of byRule) {
        const icon = items.every(v => v.severity === 'error') ? '❌' : '⚠️';
        console.log(`${icon} [${ruleId}] ${items.length} 条违规:`);
        for (const v of items.slice(0, 5)) {
            console.log(`  - ${v.file}`);
            console.log(`    ${v.message}`);
            console.log(`    建议: ${v.suggestion}`);
        }
        if (items.length > 5) {
            console.log(`  ... 及其他 ${items.length - 5} 条`);
        }
        console.log('');
    }

    console.log(`========================================`);
    console.log(`规则定义: .trae/rules/architecture-compliance.md`);
    console.log(`========================================\n`);

    if (errors.length > 0) {
        console.log('存在 ERROR 级别违规，请修复后重新提交。');
        process.exit(1);
    } else if (warnings.length > 0) {
        console.log('存在 WARNING 级别违规，建议在后续迭代中修复。');
        process.exit(0);
    } else {
        console.log('✅ 所有架构合规检查通过！');
        process.exit(0);
    }
}

main().catch((err: Error) => {
    console.error('检查器运行时错误:', err.message);
    process.exit(2);
});