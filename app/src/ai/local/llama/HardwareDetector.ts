/**
 * HardwareDetector — 硬件检测服务
 *
 * 跨平台检测 CPU、内存、GPU 信息，用于模型智能推荐。
 * 设计文档：dev_docs/20260819/llama_cpp模型目录配置与迁移功能设计方案.md
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';

const logger = new Logger({
  level: LogLevel.INFO,
  module: 'ai:llama:hardware',
});

export interface HardwareInfo {
  platform: 'win32' | 'darwin' | 'linux';
  cpuCores: number;
  systemMemoryGB: number;
  gpu: {
    name: string | null;
    memoryGB: number;
    backend: 'cuda' | 'vulkan' | 'metal' | 'cpu' | null;
  };
  llamaCppBackend: 'cpu' | 'cuda' | 'vulkan' | 'metal';
  lastUpdated: number;
}

export interface HardwareDetectionConfig {
  forceRefresh?: boolean;
  cacheTTL?: number;
}

export class HardwareDetector {
  private cachedInfo: HardwareInfo | null = null;
  private cacheTime: number = 0;
  private readonly defaultCacheTTL: number = 3600_000;

  async detect(config: HardwareDetectionConfig = {}): Promise<HardwareInfo> {
    const { forceRefresh = false, cacheTTL = this.defaultCacheTTL } = config;
    const now = Date.now();

    if (!forceRefresh && this.cachedInfo && now - this.cacheTime < cacheTTL) {
      logger.debug('使用缓存的硬件信息', { ageMs: now - this.cacheTime });
      return this.cachedInfo;
    }

    const info = await this._doDetect();
    this.cachedInfo = info;
    this.cacheTime = now;

    return info;
  }

  private async _doDetect(): Promise<HardwareInfo> {
    const platform = process.platform as HardwareInfo['platform'];

    const [cpuCores, systemMemoryGB, gpu] = await Promise.all([
      this._detectCpuCores(),
      this._detectSystemMemory(),
      this._detectGpu(),
    ]);

    const llamaCppBackend = this._inferBackend(platform, gpu.backend);

    const info: HardwareInfo = {
      platform,
      cpuCores,
      systemMemoryGB,
      gpu,
      llamaCppBackend,
      lastUpdated: Date.now(),
    };

    logger.info('硬件检测完成', {
      platform,
      cpuCores,
      systemMemoryGB,
      gpuName: gpu.name,
      gpuMemoryGB: gpu.memoryGB,
      backend: llamaCppBackend,
    });

    return info;
  }

  private async _detectCpuCores(): Promise<number> {
    try {
      const os = await import('os');
      return os.cpus().length;
    } catch {
      return 4;
    }
  }

  private async _detectSystemMemory(): Promise<number> {
    const platform = process.platform;

    try {
      if (platform === 'win32') {
        return this._detectMemoryWindows();
      } else if (platform === 'darwin') {
        const output = execSync('sysctl hw.memsize', {
          encoding: 'utf-8',
          timeout: 5000,
        });
        const match = output.match(/hw.memsize:\s*(\d+)/);
        if (match) {
          return Math.round(parseInt(match[1]) / 1024 ** 3);
        }
      } else if (platform === 'linux') {
        const meminfo = readFileSync('/proc/meminfo', 'utf-8');
        const match = meminfo.match(/MemTotal:\s+(\d+)\s+kB/);
        if (match) {
          return Math.round(parseInt(match[1]) / (1024 * 1024));
        }
      }
    } catch (err) {
      logger.warn('内存检测失败', { error: String(err) });
    }

    return 8;
  }

  /**
   * Windows 内存检测（PowerShell，替代已弃用的 WMIC）
   */
  private _detectMemoryWindows(): number {
    try {
      // 优先使用 PowerShell（Win10+ 均可用）
      const output = execSync(
        'powershell -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).TotalVisibleMemorySize"',
        { encoding: 'utf-8', timeout: 8000 }
      );
      const kb = parseInt(output.trim());
      if (!isNaN(kb) && kb > 0) {
        return Math.round(kb / (1024 * 1024));
      }
    } catch (err) {
      logger.warn('PowerShell 内存检测失败', { error: String(err) });
    }

    try {
      // 回退：WMIC（旧版 Windows）
      const output = execSync('wmic OS get TotalVisibleMemorySize /Value', {
        encoding: 'utf-8',
        timeout: 5000,
      });
      const match = output.match(/TotalVisibleMemorySize=(\d+)/);
      if (match) {
        return Math.round(parseInt(match[1]) / (1024 * 1024));
      }
    } catch (err) {
      logger.warn('WMIC 内存检测失败', { error: String(err) });
    }

    return 8;
  }

  private async _detectGpu(): Promise<HardwareInfo['gpu']> {
    const platform = process.platform;

    try {
      if (platform === 'win32') {
        return this._detectGpuWindows();
      } else if (platform === 'darwin') {
        return this._detectGpuMacOS();
      } else if (platform === 'linux') {
        return this._detectGpuLinux();
      }
    } catch (err) {
      logger.warn('GPU 检测失败', { error: String(err) });
    }

    return { name: null, memoryGB: 0, backend: 'cpu' };
  }

  /**
   * Windows GPU 检测（PowerShell + 多 GPU + 精准显存）
   */
  private _detectGpuWindows(): HardwareInfo['gpu'] {
    const candidates: Array<{
      name: string;
      memoryGB: number;
      rawRamBytes: number;
    }> = [];

    // 1. 通过 PowerShell 获取所有 GPU
    try {
      const psOutput = execSync(
        'powershell -NoProfile -Command "Get-WmiObject Win32_VideoController | Select-Object Name, AdapterRAM | ConvertTo-Csv -NoTypeInformation"',
        { encoding: 'utf-8', timeout: 10000 }
      );

      const lines = psOutput.trim().split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('"Name"')) continue;

        // CSV format: "Name","AdapterRAM" (both fields quoted by PowerShell ConvertTo-Csv)
        const match = trimmed.match(/^"(.+)","(\d+)"$/);
        if (match) {
          const name = match[1].trim();
          const ramBytes = parseInt(match[2]);
          candidates.push({
            name,
            memoryGB: this._resolveVram(name, ramBytes),
            rawRamBytes: ramBytes,
          });
        }
      }
    } catch (err) {
      logger.warn('PowerShell GPU 检测失败', { error: String(err) });
    }

    // 2. 回退：WMIC（旧版 Windows）
    if (candidates.length === 0) {
      try {
        const wmicOutput = execSync(
          'wmic path win32_VideoController get Name,AdapterRAM /Value',
          { encoding: 'utf-8', timeout: 10000 }
        );

        // WMIC 可能返回多个 GPU，用空行分隔
        const blocks = wmicOutput.split(/\n\s*\n/);
        for (const block of blocks) {
          const nameMatch = block.match(/Name=\s*(.+)/);
          const ramMatch = block.match(/AdapterRAM=\s*(\d+)/);
          if (nameMatch) {
            const name = nameMatch[1].trim();
            const ramBytes = ramMatch ? parseInt(ramMatch[1]) : 0;
            candidates.push({
              name,
              memoryGB: this._resolveVram(name, ramBytes),
              rawRamBytes: ramBytes,
            });
          }
        }
      } catch (err) {
        logger.warn('WMIC GPU 检测失败', { error: String(err) });
      }
    }

    // 3. 未检测到任何 GPU
    if (candidates.length === 0) {
      logger.info('未检测到 GPU，使用 CPU 后端');
      return { name: null, memoryGB: 0, backend: 'cpu' };
    }

    // 4. 选择最优 GPU（显存最大的）
    candidates.sort((a, b) => b.memoryGB - a.memoryGB);
    const best = candidates[0];

    // 5. NVIDIA 优先用 nvidia-smi 获取精确显存（WMI AdapterRAM 有 32 位溢出问题）
    if (best.name?.toLowerCase().includes('nvidia')) {
      const nvidiaVram = this._getNvidiaVramGB();
      if (nvidiaVram > 0 && nvidiaVram !== best.memoryGB) {
        logger.info(
          `NVIDIA 显存校准: WMI=${best.memoryGB}GB, nvidia-smi=${nvidiaVram}GB`
        );
        best.memoryGB = nvidiaVram;
      }
    }

    logger.info('GPU 检测结果', {
      totalGpus: candidates.length,
      selectedGpu: best.name,
      selectedVramGB: best.memoryGB,
      allGpus: candidates.map((c) => `${c.name}(${c.memoryGB}GB)`).join(', '),
    });

    // 5. 推断后端
    const backend = this._inferWindowsBackend(best.name);

    return {
      name: best.name,
      memoryGB: best.memoryGB,
      backend,
    };
  }

  /**
   * 从 GPU 名称或 WMI 值推断显存大小
   * WMI 的 AdapterRAM 在部分 GPU（如 Intel Arc）上返回错误值，
   * 因此优先解析 GPU 名称中的容量标注，再回退到 WMI 值
   */
  private _resolveVram(gpuName: string, wmiRamBytes: number): number {
    // 模式: "(32GB)", "(16GB)", "(8GB)", "32GB", "16GB" 等
    const patterns = [/\((\d+)\s*GB\)/i, /(\d+)\s*GB/i];

    for (const pattern of patterns) {
      const match = gpuName.match(pattern);
      if (match) {
        const gb = parseInt(match[1]);
        if (gb > 0 && gb <= 256) {
          logger.info(`从 GPU 名称解析显存: ${gpuName} -> ${gb}GB`);
          return gb;
        }
      }
    }

    // 回退：使用 WMI 值
    if (wmiRamBytes > 0) {
      const gb = Math.round(wmiRamBytes / 1024 ** 3);
      if (gb > 0 && gb <= 256) {
        return gb;
      }
      // WMI 返回异常值（如 2GB 标记但实际更大），返回原始值近似
      return Math.max(1, gb);
    }

    return 0;
  }

  /**
   * 推断 Windows 上的 llama.cpp 后端
   */
  private _inferWindowsBackend(gpuName: string): 'cuda' | 'vulkan' | 'cpu' {
    const nameLower = gpuName.toLowerCase();

    // NVIDIA：检查 CUDA
    if (nameLower.includes('nvidia')) {
      if (this._checkNvidiaCuda()) {
        return 'cuda';
      }
      logger.info('检测到 NVIDIA GPU 但 nvidia-smi 不可用，回退 Vulkan');
      return this._checkVulkan('win32') ? 'vulkan' : 'cpu';
    }

    // Intel：Arc / HD / Iris / UHD 系列均支持 Vulkan
    if (nameLower.includes('intel')) {
      // Intel Arc 系列有独立显卡，优先 Vulkan
      if (nameLower.includes('arc')) {
        logger.info('检测到 Intel Arc GPU，使用 Vulkan 后端');
        return 'vulkan';
      }
      // Intel 核显也支持 Vulkan（Gen 8+）
      if (this._checkVulkan('win32')) {
        logger.info('检测到 Intel GPU 且 Vulkan 可用，使用 Vulkan 后端');
        return 'vulkan';
      }
      return 'cpu';
    }

    // AMD：Radeon 系列支持 Vulkan
    if (nameLower.includes('amd') || nameLower.includes('radeon')) {
      if (this._checkVulkan('win32')) {
        logger.info('检测到 AMD GPU 且 Vulkan 可用，使用 Vulkan 后端');
        return 'vulkan';
      }
      return 'cpu';
    }

    // 其他 GPU：检查 Vulkan
    if (this._checkVulkan('win32')) {
      return 'vulkan';
    }

    return 'cpu';
  }

  /**
   * 检查 NVIDIA CUDA 是否可用（Windows）
   */
  private _checkNvidiaCuda(): boolean {
    const nvidiaPaths = [
      'nvidia-smi',
      'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe',
      'C:\\Program Files\\NVIDIA Corporation\\NvCG\\nvidia-smi.exe',
      'C:\\Program Files (x86)\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe',
    ];

    for (const p of nvidiaPaths) {
      try {
        execSync(`"${p}"`, { encoding: 'utf-8', timeout: 3000 });
        logger.info(`检测到 nvidia-smi: ${p}`);
        return true;
      } catch {
        continue;
      }
    }
    return false;
  }

  /**
   * 获取 NVIDIA GPU 精确显存（GB），通过 nvidia-smi
   */
  private _getNvidiaVramGB(): number {
    const nvidiaPaths = [
      'nvidia-smi',
      'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe',
      'C:\\Program Files\\NVIDIA Corporation\\NvCG\\nvidia-smi.exe',
      'C:\\Program Files (x86)\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe',
    ];

    for (const p of nvidiaPaths) {
      try {
        const output = execSync(
          `"${p}" --query-gpu=memory.total --format=csv,noheader,nounits`,
          { encoding: 'utf-8', timeout: 5000 }
        );
        const memMB = parseFloat(output.trim());
        if (memMB > 0) {
          return Math.round(memMB / 1024);
        }
      } catch {
        continue;
      }
    }
    return 0;
  }

  /**
   * macOS GPU 检测
   */
  private _detectGpuMacOS(): HardwareInfo['gpu'] {
    try {
      const output = execSync('system_profiler SPDisplaysDataType', {
        encoding: 'utf-8',
        timeout: 10000,
      });

      const nameMatch = output.match(/Chipset Model:\s*(.+)/);
      const name = nameMatch?.[1]?.trim() || null;

      const vramMatch = output.match(/VRAM:\s*(\d+)\s*MB/);
      const memoryGB = vramMatch
        ? Math.round(parseInt(vramMatch[1]) / 1024)
        : 0;

      const backend = name ? 'metal' : 'cpu';

      return { name, memoryGB, backend };
    } catch (err) {
      logger.warn('macOS GPU 检测失败', { error: String(err) });
      return { name: null, memoryGB: 0, backend: 'cpu' };
    }
  }

  /**
   * Linux GPU 检测
   */
  private _detectGpuLinux(): HardwareInfo['gpu'] {
    // 先尝试 NVIDIA
    try {
      const output = execSync(
        'nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits',
        { encoding: 'utf-8', timeout: 5000 }
      );
      const lines = output.trim().split('\n');
      if (lines.length > 0) {
        const parts = lines[0].split(',');
        const name = parts[0]?.trim() || 'NVIDIA GPU';
        const memoryGB = parseInt(parts[1]?.trim() || '0');
        return { name, memoryGB, backend: 'cuda' };
      }
    } catch {
      // 非 NVIDIA
    }

    // 尝试 lspci
    try {
      const output = execSync("lspci | grep -i 'vga\\|3d\\|display'", {
        encoding: 'utf-8',
        timeout: 5000,
      });
      if (output) {
        const backend = this._checkVulkan('linux') ? 'vulkan' : 'cpu';
        return {
          name: output.trim(),
          memoryGB: 0,
          backend,
        };
      }
    } catch {
      // lspci 不可用
    }

    return { name: null, memoryGB: 0, backend: 'cpu' };
  }

  /**
   * 检查 Vulkan 可用性（平台感知）
   */
  private _checkVulkan(platform: string): boolean {
    // Windows：检查 DLL 和工具
    if (platform === 'win32') {
      const dllPaths = [
        'C:\\Windows\\System32\\vulkan-1.dll',
        'C:\\Windows\\SysWOW64\\vulkan-1.dll',
      ];
      for (const p of dllPaths) {
        if (existsSync(p)) {
          logger.info(`检测到 Vulkan DLL: ${p}`);
          return true;
        }
      }
      // 检查 vulkaninfo 是否可执行
      try {
        execSync('where vulkaninfo', { encoding: 'utf-8', timeout: 2000 });
        return true;
      } catch {
        // 继续
      }
      return false;
    }

    // Linux：检查 .so 文件和工具
    if (platform === 'linux') {
      const linuxPaths = [
        '/usr/lib/x86_64-linux-gnu/libvulkan.so',
        '/usr/lib/libvulkan.so',
        '/usr/local/lib/libvulkan.so',
      ];
      for (const p of linuxPaths) {
        if (existsSync(p)) return true;
      }
      try {
        execSync('which vulkaninfo', { encoding: 'utf-8', timeout: 2000 });
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }

  private _inferBackend(
    platform: string,
    gpuBackend: string | null
  ): 'cpu' | 'cuda' | 'vulkan' | 'metal' {
    if (platform === 'darwin') {
      return 'metal';
    }
    if (gpuBackend === 'cuda') {
      return 'cuda';
    }
    if (gpuBackend === 'vulkan') {
      return 'vulkan';
    }
    return 'cpu';
  }

  clearCache(): void {
    this.cachedInfo = null;
    this.cacheTime = 0;
  }
}
