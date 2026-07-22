export interface Config {
  [key: string]: unknown;
}

export interface BackendStatus {
  running: boolean;
  port: number | null;
  pid?: number | null;
  exit_code?: number | null;
  error?: string | null;
}
