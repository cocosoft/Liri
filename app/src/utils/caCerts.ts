/**
 * CA证书工具
 */

import fs from 'fs';
import path from 'path';
import { configManager } from '@modules/config';

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
