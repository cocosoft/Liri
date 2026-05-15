/**
 * CLI Ports Manager
 * 对标OpenClaw cli/ports.ts
 * 端口检测与管理
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import * as net from 'node:net';

export interface PortInfo {
  port: number;
  inUse: boolean;
  pid?: number;
  processName?: string;
}

export interface PortRange {
  start: number;
  end: number;
}

const DEFAULT_PORT_RANGE: PortRange = { start: 1024, end: 65535 };
const WELL_KNOWN_PORTS = [80, 443, 3000, 8080, 8443, 5000, 5173, 4321, 3001];

export async function checkPort(port: number): Promise<PortInfo> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve({ port, inUse: true });
      } else if (err.code === 'EACCES') {
        resolve({ port, inUse: true });
      } else {
        resolve({ port, inUse: false });
      }
    });

    server.once('listening', () => {
      server.close();
      resolve({ port, inUse: false });
    });

    server.listen(port, '127.0.0.1');
  });
}

export async function findAvailablePort(
  preferred: number,
  range?: PortRange
): Promise<number> {
  const r = range ?? DEFAULT_PORT_RANGE;

  if (preferred >= r.start && preferred <= r.end) {
    const info = await checkPort(preferred);
    if (!info.inUse) return preferred;
  }

  for (let port = r.start; port <= Math.min(r.end, r.start + 100); port++) {
    const info = await checkPort(port);
    if (!info.inUse) return port;
  }

  for (
    let port = Math.max(r.start, preferred - 50);
    port <= Math.min(r.end, preferred + 50);
    port++
  ) {
    const info = await checkPort(port);
    if (!info.inUse) return port;
  }

  throw new AppError(
    `No available ports found in range ${r.start}-${r.end}`,
    ErrorCategory.RESOURCE,
    ErrorSeverity.HIGH,
    'RESOURCE_EXHAUSTED',
    { range: { start: r.start, end: r.end } }
  );
}

export async function findAvailablePorts(
  count: number,
  range?: PortRange
): Promise<number[]> {
  const ports: number[] = [];
  const r = range ?? DEFAULT_PORT_RANGE;

  for (let port = r.start; port <= r.end && ports.length < count; port++) {
    const info = await checkPort(port);
    if (!info.inUse) {
      ports.push(port);
    }
  }

  if (ports.length < count) {
    throw new AppError(
      `Only found ${ports.length}/${count} available ports in range ${r.start}-${r.end}`,
      ErrorCategory.RESOURCE,
      ErrorSeverity.HIGH,
      'RESOURCE_EXHAUSTED',
      { found: ports.length, required: count, range: { start: r.start, end: r.end } }
    );
  }

  return ports;
}

export async function waitForPort(
  port: number,
  timeoutMs: number = 30000,
  intervalMs: number = 500
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const info = await checkPort(port);
    if (info.inUse) return true;

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return false;
}

export async function waitForPortClose(
  port: number,
  timeoutMs: number = 30000,
  intervalMs: number = 500
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const info = await checkPort(port);
    if (!info.inUse) return true;

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return false;
}

export async function scanPorts(range?: PortRange): Promise<PortInfo[]> {
  const r = range ?? { start: 3000, end: 3010 };
  const results: PortInfo[] = [];

  for (let port = r.start; port <= r.end; port++) {
    const info = await checkPort(port);
    results.push(info);
  }

  return results;
}

export async function getWellKnownPortsStatus(): Promise<PortInfo[]> {
  const results: PortInfo[] = [];

  for (const port of WELL_KNOWN_PORTS) {
    const info = await checkPort(port);
    results.push(info);
  }

  return results;
}

export function buildPortForwardCommand(
  localPort: number,
  remoteHost: string,
  remotePort: number,
  options?: { identityFile?: string; user?: string }
): string {
  const user = options?.user ?? 'root';
  const identity = options?.identityFile ? ` -i ${options.identityFile}` : '';
  return `ssh${identity} -L ${localPort}:${remoteHost}:${remotePort} ${user}@${remoteHost}`;
}

export function parsePortMapping(
  mapping: string
): { local: number; host: string; remote: number } | null {
  const match = mapping.match(/^(\d+):([^:]+):(\d+)$/);
  if (!match) return null;

  return {
    local: parseInt(match[1], 10),
    host: match[2],
    remote: parseInt(match[3], 10),
  };
}

export function formatPortStatus(port: number, inUse: boolean): string {
  return `Port ${port}: ${inUse ? '🔴 In Use' : '🟢 Available'}`;
}
