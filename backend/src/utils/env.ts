export const env = process.env;

export function getEnv(key: string, defaultValue?: string): string | undefined {
  return process.env[key] ?? defaultValue;
}

export function isEnvTruthy(key: string | undefined): boolean {
  if (!key) return false;
  return key === 'true' || key === '1' || key === 'yes';
}
