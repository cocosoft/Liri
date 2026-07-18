/**
 * DaemonService 跨平台守护进程服务管理
 * 支持 systemd (Linux)、launchd (macOS)、schtasks (Windows) 三平台
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { CronScheduler } from '@modules/chronos/types';
import { globalEventBus, SystemEvents } from '@modules/core';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'daemon:service:DaemonService', level: LogLevel.INFO });

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
 * 可选管理 Chronos 调度器的进程内生命周期。
 */
export class DaemonService {
  private config: ServiceConfig;
  private platform: PlatformType;
  private chronosScheduler?: CronScheduler;

  constructor(config: ServiceConfig) {
    this.config = config;
    this.platform = os.platform() as PlatformType;
  }

  /**
   * 注册 Chronos 调度器（可选集成）
   * DaemonService 启动/停止时将同步管理 Chronos 生命周期。
   */
  registerChronosScheduler(scheduler: CronScheduler): void {
    this.chronosScheduler = scheduler;
  }

  /**
   * 执行服务操作
   * Windows 平台优先使用 nssm（若提供了 nssmPath），否则回退 schtasks
   */
  execute(action: ServiceAction): ServiceActionResult {
    switch (this.platform) {
      case 'linux':
        return this.executeSystemd(action);
      case 'darwin':
        return this.executeLaunchd(action);
      case 'win32':
        if (this.config.nssmPath) {
          return this.executeNssm(action);
        }
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
   * 执行服务操作并同步管理 Chronos 调度器生命周期
   * 在 execute() 基础上扩展 Chronos 启停管理。
   */
  executeWithChronos(action: ServiceAction): ServiceActionResult {
    if (action === 'stop' && this.chronosScheduler) {
      this.chronosScheduler.stop();
      globalEventBus.publish(SystemEvents.MODULE_INITIALIZED, {
        source: 'daemon',
        module: 'chronos',
        action: 'stop',
        timestamp: Date.now(),
      });
    }

    const result = this.execute(action);

    if (result.success) {
      if (action === 'start' && this.chronosScheduler) {
        this.chronosScheduler.start().catch((err: Error) => {
          globalEventBus.publish(SystemEvents.MODULE_ERROR, {
            source: 'daemon',
            module: 'chronos',
            action: 'start',
            error: err.message,
            timestamp: Date.now(),
          });
        });
        globalEventBus.publish(SystemEvents.MODULE_INITIALIZED, {
          source: 'daemon',
          module: 'chronos',
          action: 'start',
          timestamp: Date.now(),
        });
      }

      if (action === 'restart' && this.chronosScheduler) {
        this.chronosScheduler.start().catch((err: Error) => {
          globalEventBus.publish(SystemEvents.MODULE_ERROR, {
            source: 'daemon',
            module: 'chronos',
            action: 'restart',
            error: err.message,
            timestamp: Date.now(),
          });
        });
        globalEventBus.publish(SystemEvents.MODULE_INITIALIZED, {
          source: 'daemon',
          module: 'chronos',
          action: 'restart',
          timestamp: Date.now(),
        });
      }
    }

    return result;
  }

  /**
   * 获取服务状态
   * Windows 平台优先使用 nssm（若提供了 nssmPath），否则回退 schtasks
   */
  getStatus(): ServiceStatus {
    switch (this.platform) {
      case 'linux':
        return this.getSystemdStatus();
      case 'darwin':
        return this.getLaunchdStatus();
      case 'win32':
        if (this.config.nssmPath) {
          return this.getNssmStatus();
        }
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
          return {
            success: true,
            action,
            message: `服务 ${serviceName} 已安装`,
          };

        case 'uninstall':
          execSync(`systemctl stop ${serviceName}`, { stdio: 'pipe' });
          execSync(`systemctl disable ${serviceName}`, { stdio: 'pipe' });
          if (fs.existsSync(unitPath)) fs.unlinkSync(unitPath);
          execSync('systemctl daemon-reload', { stdio: 'pipe' });
          return {
            success: true,
            action,
            message: `服务 ${serviceName} 已卸载`,
          };

        case 'start':
          execSync(`systemctl start ${serviceName}`, { stdio: 'pipe' });
          return {
            success: true,
            action,
            message: `服务 ${serviceName} 已启动`,
          };

        case 'stop':
          execSync(`systemctl stop ${serviceName}`, { stdio: 'pipe' });
          return {
            success: true,
            action,
            message: `服务 ${serviceName} 已停止`,
          };

        case 'restart':
          execSync(`systemctl restart ${serviceName}`, { stdio: 'pipe' });
          return {
            success: true,
            action,
            message: `服务 ${serviceName} 已重启`,
          };

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
      const plistPath = path.join(
        os.homedir(),
        'Library',
        'LaunchAgents',
        plistName
      );

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
      const taskName = `LIRI_${this.config.name}`;

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
   * nssm 执行 (Windows) — 注册为真正的 Windows 服务
   * 需要先通过 nssmPath 配置提供 nssm.exe 路径
   */
  private executeNssm(action: ServiceAction): ServiceActionResult {
    const nssm = this.config.nssmPath!;
    const serviceName = this.config.name;

    try {
      switch (action) {
        case 'install': {
          // 安装服务并配置参数
          execSync(
            `"${nssm}" install "${serviceName}" "${this.config.execPath}"`,
            {
              stdio: 'pipe',
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
            execSync(`"${nssm}" set "${serviceName}" ${key} "${val}"`, {
              stdio: 'pipe',
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
          execSync(`"${nssm}" stop "${serviceName}"`, {
            stdio: 'pipe',
            shell: 'cmd.exe',
          });
          execSync(`"${nssm}" remove "${serviceName}" confirm`, {
            stdio: 'pipe',
            shell: 'cmd.exe',
          });
          return {
            success: true,
            action,
            message: `服务 ${serviceName} 已卸载（nssm）`,
          };
        }

        case 'start':
          execSync(`"${nssm}" start "${serviceName}"`, {
            stdio: 'pipe',
            shell: 'cmd.exe',
          });
          return {
            success: true,
            action,
            message: `服务 ${serviceName} 已启动`,
          };

        case 'stop':
          execSync(`"${nssm}" stop "${serviceName}"`, {
            stdio: 'pipe',
            shell: 'cmd.exe',
          });
          return {
            success: true,
            action,
            message: `服务 ${serviceName} 已停止`,
          };

        case 'restart':
          execSync(`"${nssm}" restart "${serviceName}"`, {
            stdio: 'pipe',
            shell: 'cmd.exe',
          });
          return {
            success: true,
            action,
            message: `服务 ${serviceName} 已重启`,
          };

        case 'status': {
          const st = this.getNssmStatus();
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
  private getSystemdStatus(): ServiceStatus {
    try {
      const output = execSync(
        `systemctl is-active ${this.config.name}.service`,
        {
          stdio: 'pipe',
          encoding: 'utf-8',
        }
      )
        .toString()
        .trim();
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
        `schtasks /query /tn "LIRI_${this.config.name}" /v /fo csv`,
        { stdio: 'pipe', encoding: 'utf-8', shell: 'cmd.exe' }
      ).toString();
      const running = output.includes('Running');
      return { running, enabled: true };
    } catch {
      return { running: false, enabled: false };
    }
  }

  /**
   * 获取 nssm 服务状态
   */
  private getNssmStatus(): ServiceStatus {
    try {
      const nssm = this.config.nssmPath!;
      const output = execSync(`"${nssm}" status "${this.config.name}"`, {
        stdio: 'pipe',
        encoding: 'utf-8',
        shell: 'cmd.exe',
      })
        .toString()
        .trim();
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

    fs.writeFileSync(xmlPath, xml, 'utf-8');
    return xmlPath;
  }
}
