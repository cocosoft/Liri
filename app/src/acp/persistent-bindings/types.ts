export interface PersistentBindingConfig {
  sessionKey: string;
  backend: string;
  runtimeSessionName: string;
  cwd?: string;
  autoResume: boolean;
  idleTimeoutMs?: number;
}

export interface PersistentBindingState {
  config: PersistentBindingConfig;
  active: boolean;
  lastActivityAt: number;
  createdAt: number;
  errorCount: number;
}
