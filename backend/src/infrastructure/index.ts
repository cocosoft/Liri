import { Logger, LogLevel } from '../utils/logger';
export type { LoggerConfig } from '../utils/logger';
export { Logger, LogLevel };
export const logger = new Logger({
  level: LogLevel.INFO,
  prefix: 'Infrastructure',
});
