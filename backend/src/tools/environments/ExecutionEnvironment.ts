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
    throw new Error(
      'LocalExecutionEnvironment.execute() requires a concrete implementation'
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
    throw new Error(
      'DockerExecutionEnvironment.execute() requires Docker runtime'
    );
  }

  async isAvailable(): Promise<boolean> {
    return false;
  }
}
