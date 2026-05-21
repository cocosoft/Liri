import { Logger, LogLevel } from '../monitoring/logs/Logger';
export type { LoggerConfig } from '../monitoring/logs/Logger';
export { Logger, LogLevel };
export const logger = new Logger({
  level: LogLevel.INFO,
});
