/**
 * DaemonService 跨平台守护进程服务管理
 * 支持 systemd (Linux)、launchd (macOS)、schtasks (Windows) 三平台
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('daemon:service:DaemonService');
// 阻塞源收敛：同步子进程调用改为 promisify 后的异步 exec
const execAsync = promisify(exec);

/**
 * 平台类型
 */
export type PlatformType = 'linux' | 'darwin' | 'win32';

/**
 * 服务操作
 */
export type ServiceAction =
  | 'install'
  | 'uninstall'
  | 'start'
  | 'stop'
  | 'restart'
  | 'status';

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
  /**
   * nssm.exe 路径（Windows 平台可选）
   * 提供后使用 nssm 替代 schtasks 注册为真正的 Windows 服务
   */
  nssmPath?: string;
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
 * 支持 systemd (Linux)、launchd (macOS)、schtasks (Windows) 三平台
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
   * Windows 平台优先使用 nssm（若提供了 nssmPath），否则回退 schtasks
   */
  async execute(action: ServiceAction): Promise<ServiceActionResult> {
    switch (this.platform) {
      case 'linux':
        return await this.executeSystemd(action);
      case 'darwin':
        return await this.executeLaunchd(action);
      case 'win32':
        if (this.config.nssmPath) {
          return await this.executeNssm(action);
        }
        return await this.executeSchtasks(action);
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
   * Windows 平台优先使用 nssm（若提供了 nssmPath），否则回退 schtasks
   */
  async getStatus(): Promise<ServiceStatus> {
    switch (this.platform) {
      case 'linux':
        return await this.getSystemdStatus();
      case 'darwin':
        return await this.getLaunchdStatus();
      case 'win32':
        if (this.config.nssmPath) {
          return await this.getNssmStatus();
        }
        return await this.getSchtasksStatus();
      default:
        return { running: false, enabled: false };
    }
  }

  /**
   * systemd 执行
   */
  private async executeSystemd(
    action: ServiceAction
  ): Promise<ServiceActionResult> {
    try {
      const serviceName = `${this.config.name}.service`;
      const unitPath = `/etc/systemd/system/${serviceName}`;

      switch (action) {
        case 'install':
          this.writeSystemdUnit(unitPath);
          await execAsync('systemctl daemon-reload');
          await execAsync(`systemctl enable ${serviceName}`);
          return {
            success: true,
            action,
            message: `服务 ${serviceName} 已安装`,
          };

        case 'uninstall':
          await execAsync(`systemctl stop ${serviceName}`);
          await execAsync(`systemctl disable ${serviceName}`);
          if (fs.existsSync(unitPath)) fs.unlinkSync(unitPath);
          await execAsync('systemctl daemon-reload');
          return {
            success: true,
            action,
            message: `服务 ${serviceName} 已卸载`,
          };

        case 'start':
          await execAsync(`systemctl start ${serviceName}`);
          return {
            success: true,
            action,
            message: `服务 ${serviceName} 已启动`,
          };

        case 'stop':
          await execAsync(`systemctl stop ${serviceName}`);
          return {
            success: true,
            action,
            message: `服务 ${serviceName} 已停止`,
          };

        case 'restart':
          await execAsync(`systemctl restart ${serviceName}`);
          return {
            success: true,
            action,
            message: `服务 ${serviceName} 已重启`,
          };

        case 'status':
          const status = await this.getSystemdStatus();
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
  private async executeLaunchd(
    action: ServiceAction
  ): Promise<ServiceActionResult> {
    try {
      const plistName = `dev.pyapp.${this.config.name}.plist`;
      const plistPath = path.join(
        os.homedir(),
        'Library',
        'LaunchAgents',
        plistName
      );

      switch (action) {
        case 'install':
          this.writeLaunchdPlist(plistPath);
          await execAsync(`launchctl load ${plistPath}`);
          return { success: true, action, message: `服务 ${plistName} 已安装` };

        case 'uninstall':
          await execAsync(`launchctl unload ${plistPath}`);
          if (fs.existsSync(plistPath)) fs.unlinkSync(plistPath);
          return { success: true, action, message: `服务 ${plistName} 已卸载` };

        case 'start':
          await execAsync(`launchctl start ${plistPath}`);
          return { success: true, action, message: `服务 ${plistName} 已启动` };

        case 'stop':
          await execAsync(`launchctl stop ${plistPath}`);
          return { success: true, action, message: `服务 ${plistName} 已停止` };

        case 'restart':
          await execAsync(`launchctl stop ${plistPath}`);
          await execAsync(`launchctl start ${plistPath}`);
          return { success: true, action, message: `服务 ${plistName} 已重启` };

        case 'status':
          const isRunning = await this.getLaunchdStatus();
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
  private async executeSchtasks(
    action: ServiceAction
  ): Promise<ServiceActionResult> {
    try {
      const taskName = `LIRI_${this.config.name}`;

      switch (action) {
        case 'install': {
          const xmlPath = this.writeSchtasksXml();
          await execAsync(
            `schtasks /create /xml "${xmlPath}" /tn "${taskName}" /f`,
            {
              shell: 'cmd.exe',
            }
          );
          return { success: true, action, message: `任务 ${taskName} 已创建` };
        }

        case 'uninstall':
          await execAsync(`schtasks /delete /tn "${taskName}" /f`, {
            shell: 'cmd.exe',
          });
          return { success: true, action, message: `任务 ${taskName} 已删除` };

        case 'start':
          await execAsync(`schtasks /run /tn "${taskName}"`, {
            shell: 'cmd.exe',
          });
          return { success: true, action, message: `任务 ${taskName} 已启动` };

        case 'stop':
          await execAsync(`schtasks /end /tn "${taskName}"`, {
            shell: 'cmd.exe',
          });
          return { success: true, action, message: `任务 ${taskName} 已停止` };

        case 'restart':
          await execAsync(`schtasks /end /tn "${taskName}"`, {
            shell: 'cmd.exe',
          });
          await execAsync(`schtasks /run /tn "${taskName}"`, {
            shell: 'cmd.exe',
          });
          return { success: true, action, message: `任务 ${taskName} 已重启` };

        case 'status':
          const status = await this.getSchtasksStatus();
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
   * nssm 执行 (Windows) — 注册为真正的 Windows 服务
   * 需要先通过 nssmPath 配置提供 nssm.exe 路径
   */
  private async executeNssm(
    action: ServiceAction
  ): Promise<ServiceActionResult> {
    const nssm = this.config.nssmPath!;
    const serviceName = this.config.name;

    try {
      switch (action) {
        case 'install': {
          // 安装服务并配置参数
          await execAsync(
            `"${nssm}" install "${serviceName}" "${this.config.execPath}"`,
            {
              shell: 'cmd.exe',
            }
          );

          const sets: [string, string][] = [
            ['DisplayName', this.config.displayName],
            ['Description', this.config.description],
            ['AppDirectory', this.config.workingDir],
            ['Start', 'SERVICE_AUTO_START'],
            ['AppExit', 'Default Restart'],
            ['AppRestartDelay', '5000'],
            ['AppThrottle', '1500'],
            ['AppStopMethodSkip', '0'],
            ['AppStopMethodConsole', '3000'],
            ['AppStopMethodWindow', '3000'],
            ['AppStopMethodThreads', '3000'],
            ['AppRotateFiles', '1'],
            ['AppRotateOnline', '1'],
            ['AppRotateSeconds', '86400'],
            ['AppEnvironmentExtra', 'LIRI_SERVICE_MODE=1'],
          ];

          // 设置日志路径（输出到服务可执行文件所在目录的 logs/ 下）
          const logDir = path.join(path.dirname(this.config.execPath), 'logs');
          fs.mkdirSync(logDir, { recursive: true });
          sets.push(
            ['AppStdout', path.join(logDir, 'liri-stdout.log')],
            ['AppStderr', path.join(logDir, 'liri-stderr.log')]
          );

          for (const [key, val] of sets) {
            await execAsync(`"${nssm}" set "${serviceName}" ${key} "${val}"`, {
              shell: 'cmd.exe',
            });
          }

          return {
            success: true,
            action,
            message: `服务 ${serviceName} 已安装（nssm）`,
          };
        }

        case 'uninstall': {
          await execAsync(`"${nssm}" stop "${serviceName}"`, {
            shell: 'cmd.exe',
          });
          await execAsync(`"${nssm}" remove "${serviceName}" confirm`, {
            shell: 'cmd.exe',
          });
          return {
            success: true,
            action,
            message: `服务 ${serviceName} 已卸载（nssm）`,
          };
        }

        case 'start':
          await execAsync(`"${nssm}" start "${serviceName}"`, {
            shell: 'cmd.exe',
          });
          return {
            success: true,
            action,
            message: `服务 ${serviceName} 已启动`,
          };

        case 'stop':
          await execAsync(`"${nssm}" stop "${serviceName}"`, {
            shell: 'cmd.exe',
          });
          return {
            success: true,
            action,
            message: `服务 ${serviceName} 已停止`,
          };

        case 'restart':
          await execAsync(`"${nssm}" restart "${serviceName}"`, {
            shell: 'cmd.exe',
          });
          return {
            success: true,
            action,
            message: `服务 ${serviceName} 已重启`,
          };

        case 'status': {
          const st = await this.getNssmStatus();
          return {
            success: true,
            action,
            message: st.running ? '运行中' : '已停止',
          };
        }
      }
    } catch (err) {
      return {
        success: false,
        action,
        message: `nssm 操作失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * 获取 systemd 状态
   */
  private async getSystemdStatus(): Promise<ServiceStatus> {
    try {
      const { stdout } = await execAsync(
        `systemctl is-active ${this.config.name}.service`,
        {
          encoding: 'utf-8',
        }
      );
      const output = stdout.trim();
      return { running: output === 'active', enabled: true };
    } catch {
      return { running: false, enabled: false };
    }
  }

  /**
   * 获取 launchd 状态
   */
  private async getLaunchdStatus(): Promise<ServiceStatus> {
    try {
      const { stdout } = await execAsync(
        `launchctl list | grep ${this.config.name}`,
        {
          encoding: 'utf-8',
        }
      );
      const output = stdout.toString();
      return { running: output.length > 0, enabled: true };
    } catch {
      return { running: false, enabled: false };
    }
  }

  /**
   * 获取 schtasks 状态
   * 兼容中英文系统输出：任务运行中时状态列为 "Running"（英文）或 "正在运行"（中文）
   */
  private async getSchtasksStatus(): Promise<ServiceStatus> {
    try {
      const { stdout } = await execAsync(
        `schtasks /query /tn "LIRI_${this.config.name}" /v /fo csv`,
        { encoding: 'utf-8', shell: 'cmd.exe' }
      );
      const output = stdout.toString();
      const running = output.includes('Running') || output.includes('正在运行');
      return { running, enabled: true };
    } catch {
      return { running: false, enabled: false };
    }
  }

  /**
   * 获取 nssm 服务状态
   */
  private async getNssmStatus(): Promise<ServiceStatus> {
    try {
      const nssm = this.config.nssmPath!;
      const { stdout } = await execAsync(
        `"${nssm}" status "${this.config.name}"`,
        {
          encoding: 'utf-8',
          shell: 'cmd.exe',
        }
      );
      const output = stdout.trim();
      const running = output.includes('SERVICE_RUNNING');
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
      ? Object.entries(this.config.envVars)
          .map(([k, v]) => `<key>${k}</key>\n<string>${v}</string>`)
          .join('\n')
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

    // schtasks 要求 XML 文件为 UTF-16 编码（含 BOM），否则解析失败
    fs.writeFileSync(xmlPath, '\ufeff' + xml, 'utf16le');
    return xmlPath;
  }
}
