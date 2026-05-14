/**
 * DaemonService 跨平台守护进程服务管理
 * 支持 systemd (Linux)、launchd (macOS)、schtasks (Windows) 三平台
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * 平台类型
 */
export type PlatformType = 'linux' | 'darwin' | 'win32';

/**
 * 服务操作
 */
export type ServiceAction = 'install' | 'uninstall' | 'start' | 'stop' | 'restart' | 'status';

/**
 * 服务配置
 */
export interface ServiceConfig {
  name: string;
  displayName: string;
  description: string;
  execPath: string;
  args: string[];
  workingDir: string;
  envVars?: Record<string, string>;
  runAs?: string;
}

/**
 * 服务状态
 */
export interface ServiceStatus {
  running: boolean;
  enabled: boolean;
  pid?: number;
  uptime?: number;
  memory?: number;
}

/**
 * 服务操作结果
 */
export interface ServiceActionResult {
  success: boolean;
  action: ServiceAction;
  message: string;
}

/**
 * 跨平台守护进程服务管理器
 */
export class DaemonService {
  private config: ServiceConfig;
  private platform: PlatformType;

  constructor(config: ServiceConfig) {
    this.config = config;
    this.platform = os.platform() as PlatformType;
  }

  /**
   * 执行服务操作
   */
  execute(action: ServiceAction): ServiceActionResult {
    switch (this.platform) {
      case 'linux':
        return this.executeSystemd(action);
      case 'darwin':
        return this.executeLaunchd(action);
      case 'win32':
        return this.executeSchtasks(action);
      default:
        return {
          success: false,
          action,
          message: `不支持的平台: ${this.platform}`,
        };
    }
  }

  /**
   * 获取服务状态
   */
  getStatus(): ServiceStatus {
    switch (this.platform) {
      case 'linux':
        return this.getSystemdStatus();
      case 'darwin':
        return this.getLaunchdStatus();
      case 'win32':
        return this.getSchtasksStatus();
      default:
        return { running: false, enabled: false };
    }
  }

  /**
   * systemd 执行
   */
  private executeSystemd(action: ServiceAction): ServiceActionResult {
    try {
      const serviceName = `${this.config.name}.service`;
      const unitPath = `/etc/systemd/system/${serviceName}`;

      switch (action) {
        case 'install':
          this.writeSystemdUnit(unitPath);
          execSync('systemctl daemon-reload', { stdio: 'pipe' });
          execSync(`systemctl enable ${serviceName}`, { stdio: 'pipe' });
          return { success: true, action, message: `服务 ${serviceName} 已安装` };

        case 'uninstall':
          execSync(`systemctl stop ${serviceName}`, { stdio: 'pipe' });
          execSync(`systemctl disable ${serviceName}`, { stdio: 'pipe' });
          if (fs.existsSync(unitPath)) fs.unlinkSync(unitPath);
          execSync('systemctl daemon-reload', { stdio: 'pipe' });
          return { success: true, action, message: `服务 ${serviceName} 已卸载` };

        case 'start':
          execSync(`systemctl start ${serviceName}`, { stdio: 'pipe' });
          return { success: true, action, message: `服务 ${serviceName} 已启动` };

        case 'stop':
          execSync(`systemctl stop ${serviceName}`, { stdio: 'pipe' });
          return { success: true, action, message: `服务 ${serviceName} 已停止` };

        case 'restart':
          execSync(`systemctl restart ${serviceName}`, { stdio: 'pipe' });
          return { success: true, action, message: `服务 ${serviceName} 已重启` };

        case 'status':
          const status = this.getSystemdStatus();
          return {
            success: true,
            action,
            message: status.running ? '运行中' : '已停止',
          };
      }
    } catch (err) {
      return {
        success: false,
        action,
        message: `systemd 操作失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * launchd 执行
   */
  private executeLaunchd(action: ServiceAction): ServiceActionResult {
    try {
      const plistName = `dev.pyapp.${this.config.name}.plist`;
      const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', plistName);

      switch (action) {
        case 'install':
          this.writeLaunchdPlist(plistPath);
          execSync(`launchctl load ${plistPath}`, { stdio: 'pipe' });
          return { success: true, action, message: `服务 ${plistName} 已安装` };

        case 'uninstall':
          execSync(`launchctl unload ${plistPath}`, { stdio: 'pipe' });
          if (fs.existsSync(plistPath)) fs.unlinkSync(plistPath);
          return { success: true, action, message: `服务 ${plistName} 已卸载` };

        case 'start':
          execSync(`launchctl start ${plistPath}`, { stdio: 'pipe' });
          return { success: true, action, message: `服务 ${plistName} 已启动` };

        case 'stop':
          execSync(`launchctl stop ${plistPath}`, { stdio: 'pipe' });
          return { success: true, action, message: `服务 ${plistName} 已停止` };

        case 'restart':
          execSync(`launchctl stop ${plistPath}`, { stdio: 'pipe' });
          execSync(`launchctl start ${plistPath}`, { stdio: 'pipe' });
          return { success: true, action, message: `服务 ${plistName} 已重启` };

        case 'status':
          const isRunning = this.getLaunchdStatus();
          return {
            success: true,
            action,
            message: isRunning.running ? '运行中' : '已停止',
          };
      }
    } catch (err) {
      return {
        success: false,
        action,
        message: `launchd 操作失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * schtasks 执行 (Windows)
   */
  private executeSchtasks(action: ServiceAction): ServiceActionResult {
    try {
      const taskName = `PYAPP_${this.config.name}`;

      switch (action) {
        case 'install': {
          const xmlPath = this.writeSchtasksXml();
          execSync(`schtasks /create /xml "${xmlPath}" /tn "${taskName}" /f`, {
            stdio: 'pipe',
            shell: 'cmd.exe',
          });
          return { success: true, action, message: `任务 ${taskName} 已创建` };
        }

        case 'uninstall':
          execSync(`schtasks /delete /tn "${taskName}" /f`, {
            stdio: 'pipe',
            shell: 'cmd.exe',
          });
          return { success: true, action, message: `任务 ${taskName} 已删除` };

        case 'start':
          execSync(`schtasks /run /tn "${taskName}"`, {
            stdio: 'pipe',
            shell: 'cmd.exe',
          });
          return { success: true, action, message: `任务 ${taskName} 已启动` };

        case 'stop':
          execSync(`schtasks /end /tn "${taskName}"`, {
            stdio: 'pipe',
            shell: 'cmd.exe',
          });
          return { success: true, action, message: `任务 ${taskName} 已停止` };

        case 'restart':
          execSync(`schtasks /end /tn "${taskName}"`, {
            stdio: 'pipe',
            shell: 'cmd.exe',
          });
          execSync(`schtasks /run /tn "${taskName}"`, {
            stdio: 'pipe',
            shell: 'cmd.exe',
          });
          return { success: true, action, message: `任务 ${taskName} 已重启` };

        case 'status':
          const status = this.getSchtasksStatus();
          return {
            success: true,
            action,
            message: status.running ? '运行中' : '已停止',
          };
      }
    } catch (err) {
      return {
        success: false,
        action,
        message: `schtasks 操作失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * 获取 systemd 状态
   */
  private getSystemdStatus(): ServiceStatus {
    try {
      const output = execSync(`systemctl is-active ${this.config.name}.service`, {
        stdio: 'pipe',
        encoding: 'utf-8',
      }).toString().trim();
      return { running: output === 'active', enabled: true };
    } catch {
      return { running: false, enabled: false };
    }
  }

  /**
   * 获取 launchd 状态
   */
  private getLaunchdStatus(): ServiceStatus {
    try {
      const output = execSync(`launchctl list | grep ${this.config.name}`, {
        stdio: 'pipe',
        encoding: 'utf-8',
      }).toString();
      return { running: output.length > 0, enabled: true };
    } catch {
      return { running: false, enabled: false };
    }
  }

  /**
   * 获取 schtasks 状态
   */
  private getSchtasksStatus(): ServiceStatus {
    try {
      const output = execSync(
        `schtasks /query /tn "PYAPP_${this.config.name}" /v /fo csv`,
        { stdio: 'pipe', encoding: 'utf-8', shell: 'cmd.exe' }
      ).toString();
      const running = output.includes('Running');
      return { running, enabled: true };
    } catch {
      return { running: false, enabled: false };
    }
  }

  /**
   * 写入 systemd unit 文件
   */
  private writeSystemdUnit(filePath: string): void {
    const envSection = this.config.envVars
      ? Object.entries(this.config.envVars)
          .map(([k, v]) => `Environment="${k}=${v}"`)
          .join('\n')
      : '';

    const unit = `[Unit]
Description=${this.config.description}
After=network.target

[Service]
Type=simple
ExecStart=${this.config.execPath} ${this.config.args.join(' ')}
WorkingDirectory=${this.config.workingDir}
${envSection}
${this.config.runAs ? `User=${this.config.runAs}` : ''}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
`;

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, unit, 'utf-8');
  }

  /**
   * 写入 launchd plist 文件
   */
  private writeLaunchdPlist(filePath: string): void {
    const envKeys = this.config.envVars
      ? Object.entries(this.config.envVars).map(
          ([k, v]) => `<key>${k}</key>\n<string>${v}</string>`
        ).join('\n')
      : '';

    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.pyapp.${this.config.name}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${this.config.execPath}</string>
    ${this.config.args.map((a) => `<string>${a}</string>`).join('\n')}
  </array>
  <key>WorkingDirectory</key>
  <string>${this.config.workingDir}</string>
  ${envKeys ? `<key>EnvironmentVariables</key>\n<dict>${envKeys}</dict>` : ''}
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
`;

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, plist, 'utf-8');
  }

  /**
   * 写入 schtasks XML
   */
  private writeSchtasksXml(): string {
    const xmlPath = path.join(os.tmpdir(), `pyapp_${this.config.name}.xml`);

    const xml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>${this.config.description}</Description>
  </RegistrationInfo>
  <Triggers>
    <BootTrigger>
      <Enabled>true</Enabled>
    </BootTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <Enabled>true</Enabled>
    <StartWhenAvailable>true</StartWhenAvailable>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${this.config.execPath}</Command>
      <Arguments>${this.config.args.join(' ')}</Arguments>
      <WorkingDirectory>${this.config.workingDir}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;

    fs.writeFileSync(xmlPath, xml, 'utf-8');
    return xmlPath;
  }
}
