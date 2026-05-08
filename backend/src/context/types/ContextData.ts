//
import type { Context } from './Context';

export interface ContextData {
  type: string;
  [key: string]: unknown;
}

export function toContext(data: ContextData): Context {
  return {
    type: data.type,
    createdAt: new Date(),
    ...data,
  } as Context;
}
