import type { Context } from './Context';

export interface UserContext extends Context {
  id: string;
  name: string;
  email: string;
  preferences: Record<string, unknown>;
}
