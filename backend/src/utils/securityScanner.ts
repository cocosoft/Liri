// @ts-nocheck
/**
 * 安全漏洞扫描模块
 * 负责检测代码和配置中的安全漏洞
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { logger } from './log.js';
import {
  securityAuditLogger,
  SecurityEventType,
  SecurityEventSeverity,
} from './securityAudit.js';

/**
 * 漏洞类型
 */
export enum VulnerabilityType {
  SQL_INJECTION = 'sql_injection',
  XSS = 'xss',
  COMMAND_INJECTION = 'command_injection',
  CSRF = 'csrf',
  XXE = 'xxe',
  SSRF = 'ssrf',
  OPEN_REDIRECT = 'open_redirect',
  INSECURE_COOKIE = 'insecure_cookie',
  HARDCODED_SECRET = 'hardcoded_secret',
  INSECURE_CONFIG = 'insecure_config',
  DEPENDENCY_VULNERABILITY = 'dependency_vulnerability',
}

/**
 * 漏洞严重程度
 */
export enum VulnerabilitySeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * 漏洞
 */
export interface Vulnerability {
  id: string;
  type: VulnerabilityType;
  severity: VulnerabilitySeverity;
  message: string;
  file: string;
  line: number;
  column: number;
  code: string;
  fix?: string;
}

/**
 * 安全扫描配置
 */
export interface SecurityScanConfig {
  includePaths: string[];
  excludePaths: string[];
  filePatterns: string[];
  enabledRules: VulnerabilityType[];
  maxFileSize: number; // 最大文件大小（字节）
}

/**
 * 安全扫描结果
 */
export interface SecurityScanResult {
  vulnerabilities: Vulnerability[];
  scannedFiles: number;
  scanTime: number;
  startTime: string;
  endTime: string;
}

/**
 * 安全漏洞扫描器
 */
export class SecurityScanner {
  private config: SecurityScanConfig;

  constructor(config: Partial<SecurityScanConfig> = {}) {
    this.config = {
      includePaths: ['.'],
      excludePaths: ['node_modules', 'dist', 'build', 'logs', '.git'],
      filePatterns: [
        '*.ts',
        '*.js',
        '*.jsx',
        '*.tsx',
        '*.json',
        '*.yml',
        '*.yaml',
      ],
      enabledRules: Object.values(VulnerabilityType),
      maxFileSize: 1024 * 1024, // 1MB
      ...config,
    };
  }

  /**
   * 生成漏洞ID
   */
  private generateVulnerabilityId(): string {
    return `VULN-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 检查文件是否应该被扫描
   */
  private shouldScanFile(filePath: string): boolean {
    // 检查是否在排除路径中
    for (const excludePath of this.config.excludePaths) {
      if (filePath.includes(excludePath)) {
        return false;
      }
    }

    // 检查文件模式
    const fileName = filePath.split('\\').pop() || '';
    return this.config.filePatterns.some((pattern) => {
      const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
      return regex.test(fileName);
    });
  }

  /**
   * 读取文件内容
   */
  private readFile(filePath: string): string | null {
    try {
      const stats = statSync(filePath);
      if (stats.size > this.config.maxFileSize) {
        logger.debug(`Skipping file ${filePath} due to size`);
        return null;
      }
      return readFileSync(filePath, 'utf8');
    } catch (error) {
      logger.error(
        `Error reading file ${filePath}: ` +
          (error instanceof Error ? error.message : String(error))
      );
      return null;
    }
  }

  /**
   * 扫描SQL注入漏洞
   */
  private scanSqlInjection(content: string, filePath: string): Vulnerability[] {
    const vulnerabilities: Vulnerability[] = [];
    const lines = content.split('\n');

    // 检测SQL注入模式
    const patterns = [
      /\bSELECT.*FROM.*WHERE.*=.*[\$\{].*\}/g,
      /\bINSERT.*INTO.*VALUES.*[\$\{].*\}/g,
      /\bUPDATE.*SET.*=.*[\$\{].*\}/g,
      /\bDELETE.*FROM.*WHERE.*=.*[\$\{].*\}/g,
      /\bEXEC.*[\$\{].*\}/g,
      /\bEXECUTE.*[\$\{].*\}/g,
      /\bsp_executesql.*[\$\{].*\}/g,
    ];

    lines.forEach((line, index) => {
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(line)) !== null) {
          vulnerabilities.push({
            id: this.generateVulnerabilityId(),
            type: VulnerabilityType.SQL_INJECTION,
            severity: VulnerabilitySeverity.HIGH,
            message: 'Potential SQL injection vulnerability',
            file: filePath,
            line: index + 1,
            column: match.index + 1,
            code: match[0],
            fix: 'Use parameterized queries instead of string concatenation',
          });
        }
      }
    });

    return vulnerabilities;
  }

  /**
   * 扫描XSS漏洞
   */
  private scanXss(content: string, filePath: string): Vulnerability[] {
    const vulnerabilities: Vulnerability[] = [];
    const lines = content.split('\n');

    // 检测XSS模式
    const patterns = [
      /\bdocument\.write\([^)]*\)/g,
      /\binnerHTML\s*=\s*[^;]+/g,
      /\bouterHTML\s*=\s*[^;]+/g,
      /\beval\([^)]*\)/g,
      /\bFunction\([^)]*\)/g,
      /\bsetTimeout\([^,]+,\s*[^)]*\)/g,
      /\bsetInterval\([^,]+,\s*[^)]*\)/g,
      /\bexecScript\([^)]*\)/g,
    ];

    lines.forEach((line, index) => {
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(line)) !== null) {
          vulnerabilities.push({
            id: this.generateVulnerabilityId(),
            type: VulnerabilityType.XSS,
            severity: VulnerabilitySeverity.MEDIUM,
            message: 'Potential XSS vulnerability',
            file: filePath,
            line: index + 1,
            column: match.index + 1,
            code: match[0],
            fix: 'Sanitize user input before rendering',
          });
        }
      }
    });

    return vulnerabilities;
  }

  /**
   * 扫描命令注入漏洞
   */
  private scanCommandInjection(
    content: string,
    filePath: string
  ): Vulnerability[] {
    const vulnerabilities: Vulnerability[] = [];
    const lines = content.split('\n');

    // 检测命令注入模式
    const patterns = [
      /\bexec\([^)]*\)/g,
      /\bspawn\([^)]*\)/g,
      /\bshellExec\([^)]*\)/g,
      /\bchild_process\.exec\([^)]*\)/g,
      /\bchild_process\.spawn\([^)]*\)/g,
      /\bchild_process\.execSync\([^)]*\)/g,
      /\bchild_process\.spawnSync\([^)]*\)/g,
      /\brequire\(['"]child_process['"]\)\.exec\([^)]*\)/g,
      /\brequire\(['"]child_process['"]\)\.spawn\([^)]*\)/g,
    ];

    lines.forEach((line, index) => {
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(line)) !== null) {
          vulnerabilities.push({
            id: this.generateVulnerabilityId(),
            type: VulnerabilityType.COMMAND_INJECTION,
            severity: VulnerabilitySeverity.HIGH,
            message: 'Potential command injection vulnerability',
            file: filePath,
            line: index + 1,
            column: match.index + 1,
            code: match[0],
            fix: 'Use parameterized commands or sanitize input',
          });
        }
      }
    });

    return vulnerabilities;
  }

  /**
   * 扫描硬编码密钥
   */
  private scanHardcodedSecrets(
    content: string,
    filePath: string
  ): Vulnerability[] {
    const vulnerabilities: Vulnerability[] = [];
    const lines = content.split('\n');

    // 检测硬编码密钥模式
    const patterns = [
      /\b(api|secret|key|token|password|pass|pwd|auth|credential)\s*[:=]\s*['"]([^'"]{8,})['"]/gi,
      /\bJWT_SECRET\s*[:=]\s*['"]([^'"]+)['"]/g,
      /\bAPI_KEY\s*[:=]\s*['"]([^'"]+)['"]/g,
      /\bSECRET_KEY\s*[:=]\s*['"]([^'"]+)['"]/g,
      /\bPASSWORD\s*[:=]\s*['"]([^'"]+)['"]/g,
    ];

    lines.forEach((line, index) => {
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(line)) !== null) {
          vulnerabilities.push({
            id: this.generateVulnerabilityId(),
            type: VulnerabilityType.HARDCODED_SECRET,
            severity: VulnerabilitySeverity.CRITICAL,
            message: 'Hardcoded secret detected',
            file: filePath,
            line: index + 1,
            column: match.index + 1,
            code: match[0],
            fix: 'Use environment variables or secure credential management',
          });
        }
      }
    });

    return vulnerabilities;
  }

  /**
   * 扫描不安全的配置
   */
  private scanInsecureConfig(
    content: string,
    filePath: string
  ): Vulnerability[] {
    const vulnerabilities: Vulnerability[] = [];
    const lines = content.split('\n');

    // 检测不安全的配置模式
    const patterns = [
      /\bdebug\s*[:=]\s*true/g,
      /\bproduction\s*[:=]\s*false/g,
      /\bssl\s*[:=]\s*false/g,
      /\bhttps\s*[:=]\s*false/g,
      /\bcors\s*[:=]\s*{[^}]*origin:\s*['"]\*['"][^}]*}/g,
      /\bcookie\s*[:=]\s*{[^}]*secure:\s*false[^}]*}/g,
      /\bcookie\s*[:=]\s*{[^}]*httpOnly:\s*false[^}]*}/g,
    ];

    lines.forEach((line, index) => {
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(line)) !== null) {
          vulnerabilities.push({
            id: this.generateVulnerabilityId(),
            type: VulnerabilityType.INSECURE_CONFIG,
            severity: VulnerabilitySeverity.MEDIUM,
            message: 'Insecure configuration detected',
            file: filePath,
            line: index + 1,
            column: match.index + 1,
            code: match[0],
            fix: 'Use secure configuration settings',
          });
        }
      }
    });

    return vulnerabilities;
  }

  /**
   * 扫描单个文件
   */
  private scanFile(filePath: string): Vulnerability[] {
    const content = this.readFile(filePath);
    if (!content) {
      return [];
    }

    const vulnerabilities: Vulnerability[] = [];

    // 执行各种漏洞扫描
    if (this.config.enabledRules.includes(VulnerabilityType.SQL_INJECTION)) {
      vulnerabilities.push(...this.scanSqlInjection(content, filePath));
    }

    if (this.config.enabledRules.includes(VulnerabilityType.XSS)) {
      vulnerabilities.push(...this.scanXss(content, filePath));
    }

    if (
      this.config.enabledRules.includes(VulnerabilityType.COMMAND_INJECTION)
    ) {
      vulnerabilities.push(...this.scanCommandInjection(content, filePath));
    }

    if (this.config.enabledRules.includes(VulnerabilityType.HARDCODED_SECRET)) {
      vulnerabilities.push(...this.scanHardcodedSecrets(content, filePath));
    }

    if (this.config.enabledRules.includes(VulnerabilityType.INSECURE_CONFIG)) {
      vulnerabilities.push(...this.scanInsecureConfig(content, filePath));
    }

    return vulnerabilities;
  }

  /**
   * 递归扫描目录
   */
  private scanDirectory(directory: string): {
    vulnerabilities: Vulnerability[];
    scannedFiles: number;
  } {
    let vulnerabilities: Vulnerability[] = [];
    let scannedFiles = 0;

    try {
      const entries = readdirSync(directory);

      for (const entry of entries) {
        const entryPath = join(directory, entry);
        const stats = statSync(entryPath);

        if (stats.isDirectory()) {
          // 递归扫描子目录
          const result = this.scanDirectory(entryPath);
          vulnerabilities = [...vulnerabilities, ...result.vulnerabilities];
          scannedFiles += result.scannedFiles;
        } else if (stats.isFile() && this.shouldScanFile(entryPath)) {
          // 扫描文件
          const fileVulnerabilities = this.scanFile(entryPath);
          vulnerabilities = [...vulnerabilities, ...fileVulnerabilities];
          scannedFiles++;
        }
      }
    } catch (error) {
      logger.error(
        `Error scanning directory ${directory}: ` +
          (error instanceof Error ? error.message : String(error))
      );
    }

    return { vulnerabilities, scannedFiles };
  }

  /**
   * 执行安全扫描
   */
  public scan(): SecurityScanResult {
    const startTime = new Date();
    let vulnerabilities: Vulnerability[] = [];
    let scannedFiles = 0;

    logger.info('Starting security vulnerability scan...');

    // 扫描包含的路径
    for (const path of this.config.includePaths) {
      if (existsSync(path)) {
        const stats = statSync(path);
        if (stats.isDirectory()) {
          const result = this.scanDirectory(path);
          vulnerabilities = [...vulnerabilities, ...result.vulnerabilities];
          scannedFiles += result.scannedFiles;
        } else if (stats.isFile() && this.shouldScanFile(path)) {
          const fileVulnerabilities = this.scanFile(path);
          vulnerabilities = [...vulnerabilities, ...fileVulnerabilities];
          scannedFiles++;
        }
      }
    }

    const endTime = new Date();
    const scanTime = endTime.getTime() - startTime.getTime();

    // 记录扫描结果
    if (vulnerabilities.length > 0) {
      securityAuditLogger.logEvent(
        SecurityEventType.SECURITY_VIOLATION,
        SecurityEventSeverity.WARNING,
        `Security scan found ${vulnerabilities.length} vulnerabilities`,
        {
          scannedFiles,
          scanTime,
          vulnerabilityCount: vulnerabilities.length,
          vulnerabilities: vulnerabilities.map((v) => ({
            id: v.id,
            type: v.type,
            severity: v.severity,
            message: v.message,
            file: v.file,
          })),
        }
      );
    } else {
      securityAuditLogger.logEvent(
        SecurityEventType.SECURITY_VIOLATION,
        SecurityEventSeverity.INFO,
        `Security scan completed successfully, no vulnerabilities found`,
        {
          scannedFiles,
          scanTime,
        }
      );
    }

    logger.info(
      `Security scan completed in ${scanTime}ms, scanned ${scannedFiles} files, found ${vulnerabilities.length} vulnerabilities`
    );

    return {
      vulnerabilities,
      scannedFiles,
      scanTime,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    };
  }

  /**
   * 生成扫描报告
   */
  public generateReport(result: SecurityScanResult): string {
    let report = `# Security Scan Report\n\n`;
    report += `## Scan Summary\n`;
    report += `- Start Time: ${result.startTime}\n`;
    report += `- End Time: ${result.endTime}\n`;
    report += `- Scan Time: ${result.scanTime}ms\n`;
    report += `- Scanned Files: ${result.scannedFiles}\n`;
    report += `- Vulnerabilities Found: ${result.vulnerabilities.length}\n\n`;

    if (result.vulnerabilities.length > 0) {
      report += `## Vulnerabilities\n\n`;

      // 按严重程度分组
      const vulnerabilitiesBySeverity = result.vulnerabilities.reduce(
        (acc, vuln) => {
          if (!acc[vuln.severity]) {
            acc[vuln.severity] = [];
          }
          acc[vuln.severity].push(vuln);
          return acc;
        },
        {} as Record<VulnerabilitySeverity, Vulnerability[]>
      );

      // 按严重程度顺序输出
      [
        VulnerabilitySeverity.CRITICAL,
        VulnerabilitySeverity.HIGH,
        VulnerabilitySeverity.MEDIUM,
        VulnerabilitySeverity.LOW,
      ].forEach((severity) => {
        const vulns = vulnerabilitiesBySeverity[severity];
        if (vulns && vulns.length > 0) {
          report += `### ${severity.toUpperCase()} (${vulns.length})\n\n`;
          vulns.forEach((vuln) => {
            report += `- **${vuln.message}** (${vuln.type})\n`;
            report += `  - File: ${vuln.file}:${vuln.line}:${vuln.column}\n`;
            report += `  - Code: ${vuln.code}\n`;
            if (vuln.fix) {
              report += `  - Fix: ${vuln.fix}\n`;
            }
            report += `\n`;
          });
        }
      });
    } else {
      report += `## Vulnerabilities\n\n`;
      report += `No vulnerabilities found.\n`;
    }

    return report;
  }
}

/**
 * 全局安全扫描器实例
 */
export const securityScanner = new SecurityScanner();
