/**
 * CA证书工具
 */

import fs from 'fs';
import path from 'path';
import { configManager } from '@modules/config';

/**
 * 查找可用的 CA 证书文件路径（供 Bun fetch 的 tls.ca 注入使用）。
 *
 * 优先从 NODE_EXTRA_CA_CERTS 环境变量读取，其次从系统默认 CA 路径查找
 * （Windows 下 Git for Windows 自带的 ca-bundle.crt）。
 *
 * 与 getCACertificates() 的区别：后者返回文件内容（供 undici dispatcher 注入），
 * 本函数返回文件路径（Bun 的 fetch tls.ca 需要 Bun.file() 路径形式）。
 *
 * @returns CA 证书文件绝对路径；未找到返回 undefined
 */
export function findCACertFilePath(): string | undefined {
  const caCertEnv = configManager.env('NODE_EXTRA_CA_CERTS');
  if (caCertEnv && fs.existsSync(caCertEnv)) {
    return caCertEnv;
  }

  for (const defaultPath of getDefaultCaCertPaths()) {
    if (fs.existsSync(defaultPath)) {
      return defaultPath;
    }
  }

  return undefined;
}

/**
 * 获取CA证书
 */
export function getCACertificates(): string[] | undefined {
  try {
    // 检查环境变量
    const caCertEnv = configManager.env('NODE_EXTRA_CA_CERTS');
    if (caCertEnv) {
      const caCertPath = caCertEnv;
      if (fs.existsSync(caCertPath)) {
        const caCert = fs.readFileSync(caCertPath, 'utf8');
        return [caCert];
      }
    }

    // 检查默认位置
    const defaultPaths = getDefaultCaCertPaths();
    for (const defaultPath of defaultPaths) {
      if (fs.existsSync(defaultPath)) {
        const caCert = fs.readFileSync(defaultPath, 'utf8');
        return [caCert];
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * 获取默认CA证书路径
 */
function getDefaultCaCertPaths(): string[] {
  const paths: string[] = [];

  switch (process.platform) {
    case 'win32':
      // Git for Windows 自带的 CA 包
      const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
      paths.push(path.join(programFiles, 'Git', 'mingw64', 'ssl', 'cert.pem'));
      paths.push(
        path.join(
          programFiles,
          'Git',
          'mingw64',
          'ssl',
          'certs',
          'ca-bundle.crt'
        )
      );
      // Git for Windows 新版（2.49+）默认安装到 usr 布局
      paths.push(path.join(programFiles, 'Git', 'usr', 'ssl', 'cert.pem'));
      paths.push(
        path.join(programFiles, 'Git', 'usr', 'ssl', 'certs', 'ca-bundle.crt')
      );
      // 32 位系统 / 非默认安装目录
      const programFilesX86 =
        process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
      paths.push(
        path.join(programFilesX86, 'Git', 'mingw64', 'ssl', 'cert.pem')
      );
      paths.push(
        path.join(
          programFilesX86,
          'Git',
          'mingw64',
          'ssl',
          'certs',
          'ca-bundle.crt'
        )
      );
      // Chocolatey / standalone curl
      paths.push('C:\\curl\\ca-bundle.crt');
      // 用户安装的证书包
      if (process.env['USERPROFILE']) {
        paths.push(
          path.join(process.env['USERPROFILE'], '.certs', 'ca-bundle.crt')
        );
      }
      break;
    case 'darwin':
      // macOS 默认证书路径
      paths.push('/etc/ssl/cert.pem');
      break;
    case 'linux':
      // Linux 默认证书路径
      paths.push('/etc/ssl/certs/ca-certificates.crt');
      paths.push('/etc/pki/tls/certs/ca-bundle.crt');
      break;
  }

  return paths;
}
