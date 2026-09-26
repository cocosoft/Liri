import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools\environments\ExecutionEnvironment');

export interface ToolExecutionEnvironment {
  readonly id: string;
  readonly name: string;

  execute(
    command: string,
    args: string[],
    options?: ExecuteOptions
  ): Promise<ExecuteResult>;
  isAvailable(): Promise<boolean>;
  cleanup(): Promise<void>;
}

export interface ExecuteOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  /**
   * 输出上限（软截断）。
   *
   * ⚠️ **B1 豁免（2026-09-26）**：本字段**当前无任何实现读取**（`LocalExecutionEnvironment.execute`
   * 直接抛未实现；`DockerExecutionEnvironment` 亦未读），属"声明了但没接"——按《Liri 优化方案》
   * B1 验收的"要么读 policy、要么**显式豁免并注明理由**"在此**显式豁免**：本抽象层（`tools/environments`）
   * 与 `app/src/sandbox/` 的沙箱后端不是同一条执行路径，贸然接线会产生第二套输出上限来源。
   * 输出上限的唯一来源见 `sandbox/SandboxPolicy.ts` 的 `MAX_OUTPUT_BYTES_SOFT/HARD`。
   */
  maxOutputBytes?: number;
  stdin?: string;
}

export interface ExecuteResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
}

export abstract class BaseExecutionEnvironment implements ToolExecutionEnvironment {
  abstract readonly id: string;
  abstract readonly name: string;

  abstract execute(
    command: string,
    args: string[],
    options?: ExecuteOptions
  ): Promise<ExecuteResult>;
  abstract isAvailable(): Promise<boolean>;

  async cleanup(): Promise<void> {}
}

export class LocalExecutionEnvironment extends BaseExecutionEnvironment {
  readonly id = 'local';
  readonly name = 'Local';

  async execute(
    command: string,
    args: string[],
    options?: ExecuteOptions
  ): Promise<ExecuteResult> {
    throw new AppError(
      'LocalExecutionEnvironment.execute() requires a concrete implementation',
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      'NOT_IMPLEMENTED'
    );
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}

export class DockerExecutionEnvironment extends BaseExecutionEnvironment {
  readonly id = 'docker';
  readonly name = 'Docker Container';

  private image: string;

  constructor(image = 'python:3.12-slim') {
    super();
    this.image = image;
  }

  async execute(
    command: string,
    args: string[],
    options?: ExecuteOptions
  ): Promise<ExecuteResult> {
    throw new AppError(
      'DockerExecutionEnvironment.execute() requires Docker runtime',
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      'NOT_IMPLEMENTED'
    );
  }

  async isAvailable(): Promise<boolean> {
    return false;
  }
}
