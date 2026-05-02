import type { Context } from './Context';

export interface TeammateContext extends Context {
  name: string;
  role: string;
  status: string;
}
