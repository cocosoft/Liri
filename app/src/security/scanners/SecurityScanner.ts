/**
 * 安全扫描器
 * 负责检测和防止常见的安全漏洞
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Logger } from '../../monitoring/logs/Logger';

const logger = new Logger({ module: 'security:scanner' });

/**
 * 安全漏洞类型
 */
export enum VulnerabilityType {
  XSS = 'xss',
  SQL_INJECTION = 'sql_injection',
  COMMAND_INJECTION = 'command_injection',
  CSRF = 'csrf',
  UNVALIDATED_REDIRECT = 'unvalidated_redirect',
  SENSITIVE_DATA_EXPOSURE = 'sensitive_data_exposure',
  BROKEN_AUTHENTICATION = 'broken_authentication',
  INSECURE_DIRECT_OBJECT_REFERENCES = 'insecure_direct_object_references',
  MISSING_FUNCTION_LEVEL_ACCESS_CONTROL = 'missing_function_level_access_control',
  CROSS_SITE_SCRIPTING = 'cross_site_scripting',
  INSECURE_CONFIGURATION = 'insecure_configuration',
  INSUFFICIENT_TRANSPORT_LAYER_PROTECTION = 'insufficient_transport_layer_protection',
  UNVALIDATED_FORWARDING = 'unvalidated_forwarding',
  XXE = 'xxe',
  SSRF = 'ssrf',
  INSECURE_COOKIE = 'insecure_cookie',
  HARDCODED_SECRET = 'hardcoded_secret',
  DEPENDENCY_VULNERABILITY = 'dependency_vulnerability',
}

/**
 * 安全漏洞
 */
export interface Vulnerability {
  id: string;
  type: VulnerabilityType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  location: string;
  description: string;
  recommendation: string;
  code?: string;
  line?: number;
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
 * 安全扫描配置
 */
export interface SecurityScanConfig {
  includePaths: string[];
  excludePaths: string[];
  filePatterns: string[];
  enabledRules: VulnerabilityType[];
  maxFileSize: number;
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
 * 安全扫描器类
 */
export class SecurityScanner {
  /** 扫描路径 */
  private scanPaths: string[];
  /** 忽略路径 */
  private ignorePaths: string[];
  /** 漏洞列表 */
  private vulnerabilities: Vulnerability[] = [];

  /**
   * 构造函数
   * @param scanPaths 扫描路径
   * @param ignorePaths 忽略路径
   */
  constructor(
    scanPaths: string[] = ['./'],
    ignorePaths: string[] = ['./node_modules', './dist', './build']
  ) {
    this.scanPaths = scanPaths;
    this.ignorePaths = ignorePaths;
  }

  /**
   * 扫描项目
   * @returns 漏洞列表
   */
  async scan(): Promise<Vulnerability[]> {
    this.vulnerabilities = [];

    for (const scanPath of this.scanPaths) {
      await this.scanDirectory(scanPath);
    }

    return this.vulnerabilities;
  }

  /**
   * 扫描目录
   * @param directory 目录路径
   */
  private async scanDirectory(directory: string): Promise<void> {
    if (!fs.existsSync(directory)) {
      return;
    }

    const files = fs.readdirSync(directory);

    for (const file of files) {
      const filePath = path.join(directory, file);
      const stats = fs.statSync(filePath);

      // 检查是否需要忽略
      if (this.shouldIgnore(filePath)) {
        continue;
      }

      if (stats.isDirectory()) {
        await this.scanDirectory(filePath);
      } else if (stats.isFile()) {
        await this.scanFile(filePath);
      }
    }
  }

  /**
   * 检查是否需要忽略
   * @param filePath 文件路径
   * @returns 是否需要忽略
   */
  private shouldIgnore(filePath: string): boolean {
    for (const ignorePath of this.ignorePaths) {
      if (filePath.includes(ignorePath)) {
        return true;
      }
    }
    return false;
  }

  /**
   * 扫描文件
   * @param filePath 文件路径
   */
  private async scanFile(filePath: string): Promise<void> {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');

      // 扫描XSS漏洞
      this.scanXSS(filePath, lines);

      // 扫描SQL注入漏洞
      this.scanSqlInjection(filePath, lines);

      // 扫描命令注入漏洞
      this.scanCommandInjection(filePath, lines);

      // 扫描敏感数据暴露
      this.scanSensitiveDataExposure(filePath, lines);

      // 扫描硬编码密钥
      this.scanHardcodedSecrets(filePath, lines);

      // 扫描不安全的配置
      this.scanInsecureConfiguration(filePath, lines);
    } catch (error) {
      logger.warning(`Error scanning file ${filePath}:`, error);
    }
  }

  /**
   * 扫描XSS漏洞
   * @param filePath 文件路径
   * @param lines 文件内容行
   */
  private scanXSS(filePath: string, lines: string[]): void {
    const xssPatterns = [
      /innerHTML\s*=\s*[^;]+/g,
      /outerHTML\s*=\s*[^;]+/g,
      /document\.write\s*\(/g,
      /document\.writeln\s*\(/g,
      /eval\s*\(/g,
      /execScript\s*\(/g,
      /setTimeout\s*\(/g,
      /setInterval\s*\(/g,
      /Function\s*\(/g,
    ];

    lines.forEach((line, index) => {
      for (const pattern of xssPatterns) {
        if (pattern.test(line)) {
          this.addVulnerability({
            type: VulnerabilityType.XSS,
            severity: 'medium',
            location: filePath,
            description: '潜在的XSS漏洞',
            recommendation:
              '使用安全的DOM操作方法，如textContent或createElement',
            code: line.trim(),
            line: index + 1,
          });
          break;
        }
      }
    });
  }

  /**
   * 扫描SQL注入漏洞
   * @param filePath 文件路径
   * @param lines 文件内容行
   */
  private scanSqlInjection(filePath: string, lines: string[]): void {
    const sqlPatterns = [
      /SELECT.*FROM.*WHERE.*=/g,
      /INSERT INTO.*VALUES.*=/g,
      /UPDATE.*SET.*WHERE.*=/g,
      /DELETE FROM.*WHERE.*=/g,
      /sql.*=.*\+.*'/g,
      /sql.*=.*\+.*"/g,
    ];

    lines.forEach((line, index) => {
      for (const pattern of sqlPatterns) {
        if (pattern.test(line)) {
          this.addVulnerability({
            type: VulnerabilityType.SQL_INJECTION,
            severity: 'high',
            location: filePath,
            description: '潜在的SQL注入漏洞',
            recommendation: '使用参数化查询或ORM框架',
            code: line.trim(),
            line: index + 1,
          });
          break;
        }
      }
    });
  }

  /**
   * 扫描命令注入漏洞
   * @param filePath 文件路径
   * @param lines 文件内容行
   */
  private scanCommandInjection(filePath: string, lines: string[]): void {
    const commandPatterns = [
      /exec\s*\(/g,
      /system\s*\(/g,
      /passthru\s*\(/g,
      /shell_exec\s*\(/g,
      /popen\s*\(/g,
      /proc_open\s*\(/g,
      /child_process\.exec\s*\(/g,
      /child_process\.execSync\s*\(/g,
      /child_process\.spawn\s*\(/g,
      /child_process\.spawnSync\s*\(/g,
    ];

    lines.forEach((line, index) => {
      for (const pattern of commandPatterns) {
        if (pattern.test(line)) {
          this.addVulnerability({
            type: VulnerabilityType.COMMAND_INJECTION,
            severity: 'high',
            location: filePath,
            description: '潜在的命令注入漏洞',
            recommendation: '使用安全的命令执行方法，避免直接拼接命令',
            code: line.trim(),
            line: index + 1,
          });
          break;
        }
      }
    });
  }

  /**
   * 扫描敏感数据暴露
   * @param filePath 文件路径
   * @param lines 文件内容行
   */
  private scanSensitiveDataExposure(filePath: string, lines: string[]): void {
    const sensitivePatterns = [
      /password\s*=\s*['"].*['"]/g,
      /secret\s*=\s*['"].*['"]/g,
      /key\s*=\s*['"].*['"]/g,
      /token\s*=\s*['"].*['"]/g,
      /api_key\s*=\s*['"].*['"]/g,
      /api_secret\s*=\s*['"].*['"]/g,
      /auth\s*=\s*['"].*['"]/g,
      /credential\s*=\s*['"].*['"]/g,
    ];

    lines.forEach((line, index) => {
      for (const pattern of sensitivePatterns) {
        if (pattern.test(line)) {
          this.addVulnerability({
            type: VulnerabilityType.SENSITIVE_DATA_EXPOSURE,
            severity: 'critical',
            location: filePath,
            description: '潜在的敏感数据暴露',
            recommendation: '使用环境变量或配置文件存储敏感信息',
            code: line.trim(),
            line: index + 1,
          });
          break;
        }
      }
    });
  }

  /**
   * 扫描硬编码密钥
   * @param filePath 文件路径
   * @param lines 文件内容行
   */
  private scanHardcodedSecrets(filePath: string, lines: string[]): void {
    const secretPatterns = [
      /\b(api|secret|key|token|password|pass|pwd|auth|credential)\s*[:=]\s*['"]([^'"]{8,})['"]/gi,
      /\bJWT_SECRET\s*[:=]\s*['"]([^'"]+)['"]/g,
      /\bAPI_KEY\s*[:=]\s*['"]([^'"]+)['"]/g,
      /\bSECRET_KEY\s*[:=]\s*['"]([^'"]+)['"]/g,
      /\bPASSWORD\s*[:=]\s*['"]([^'"]+)['"]/g,
    ];

    lines.forEach((line, index) => {
      for (const pattern of secretPatterns) {
        if (pattern.test(line)) {
          this.addVulnerability({
            type: VulnerabilityType.HARDCODED_SECRET,
            severity: 'critical',
            location: filePath,
            description: '检测到硬编码密钥',
            recommendation: '使用环境变量或安全的凭据管理服务',
            code: line.trim(),
            line: index + 1,
          });
          break;
        }
      }
    });
  }

  /**
   * 扫描不安全的配置
   * @param filePath 文件路径
   * @param lines 文件内容行
   */
  private scanInsecureConfiguration(filePath: string, lines: string[]): void {
    const insecurePatterns = [
      /process\.env\.NODE_ENV\s*===\s*['"]development['"]/g,
      /debug\s*=\s*true/g,
      /production\s*=\s*false/g,
      /ssl\s*[:=]\s*false/g,
      /https\s*[:=]\s*false/g,
      /allowOrigin\s*=\s*['"]\*['"]/g,
      /CORS\s*=\s*['"]\*['"]/g,
      /cors\s*[:=]\s*{[^}]*origin:\s*['"]\*['"][^}]*}/g,
      /cookie\s*[:=]\s*{[^}]*secure:\s*false[^}]*}/g,
      /cookie\s*[:=]\s*{[^}]*httpOnly:\s*false[^}]*}/g,
      /disableHostCheck\s*=\s*true/g,
      /trustProxy\s*=\s*true/g,
    ];

    lines.forEach((line, index) => {
      for (const pattern of insecurePatterns) {
        if (pattern.test(line)) {
          this.addVulnerability({
            type: VulnerabilityType.INSECURE_CONFIGURATION,
            severity: 'low',
            location: filePath,
            description: '潜在的不安全配置',
            recommendation: '确保生产环境使用安全的配置',
            code: line.trim(),
            line: index + 1,
          });
          break;
        }
      }
    });
  }

  /**
   * 添加漏洞
   * @param vulnerability 漏洞
   */
  private addVulnerability(vulnerability: Omit<Vulnerability, 'id'>): void {
    const id = crypto
      .createHash('md5')
      .update(
        `${vulnerability.type}:${vulnerability.location}:${vulnerability.line}`
      )
      .digest('hex');
    this.vulnerabilities.push({
      id,
      ...vulnerability,
    });
  }

  /**
   * 获取漏洞统计
   * @returns 漏洞统计
   */
  getVulnerabilityStats(): Record<string, number> {
    const stats: Record<string, number> = {
      total: this.vulnerabilities.length,
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };

    for (const vuln of this.vulnerabilities) {
      stats[vuln.severity]++;
    }

    return stats;
  }

  /**
   * 生成安全报告
   * @returns 安全报告
   */
  generateReport(): string {
    const stats = this.getVulnerabilityStats();
    let report = `安全扫描报告\n`;
    report += `================\n`;
    report += `总漏洞数: ${stats.total}\n`;
    report += `低风险: ${stats.low}\n`;
    report += `中风险: ${stats.medium}\n`;
    report += `高风险: ${stats.high}\n`;
    report += `严重风险: ${stats.critical}\n\n`;

    if (this.vulnerabilities.length > 0) {
      report += `漏洞详情:\n`;
      report += `----------------\n`;

      for (const vuln of this.vulnerabilities) {
        report += `ID: ${vuln.id}\n`;
        report += `类型: ${vuln.type}\n`;
        report += `严重程度: ${vuln.severity}\n`;
        report += `位置: ${vuln.location}:${vuln.line}\n`;
        report += `描述: ${vuln.description}\n`;
        report += `建议: ${vuln.recommendation}\n`;
        if (vuln.code) {
          report += `代码: ${vuln.code}\n`;
        }
        report += `\n`;
      }
    } else {
      report += `未发现安全漏洞\n`;
    }

    return report;
  }

  /**
   * 设置扫描路径
   * @param scanPaths 扫描路径
   */
  setScanPaths(scanPaths: string[]): void {
    this.scanPaths = scanPaths;
  }

  /**
   * 设置忽略路径
   * @param ignorePaths 忽略路径
   */
  setIgnorePaths(ignorePaths: string[]): void {
    this.ignorePaths = ignorePaths;
  }

  /**
   * 获取漏洞列表
   * @returns 漏洞列表
   */
  getVulnerabilities(): Vulnerability[] {
    return this.vulnerabilities;
  }
}

/**
 * 创建安全扫描器实例
 * @param scanPaths 扫描路径
 * @param ignorePaths 忽略路径
 * @returns 安全扫描器实例
 */
export function createSecurityScanner(
  scanPaths?: string[],
  ignorePaths?: string[]
): SecurityScanner {
  return new SecurityScanner(scanPaths, ignorePaths);
}

/**
 * 全局安全扫描器实例
 */
export const securityScanner = createSecurityScanner();
