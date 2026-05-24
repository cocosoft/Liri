import { ACP_AGENT_INFO, ACP_PROTOCOL_VERSION } from './types.js';

export interface AcpMetaInfo {
  name: string;
  title: string;
  version: string;
  protocolVersion: string;
}

export function getAcpMetaInfo(): AcpMetaInfo {
  return {
    name: ACP_AGENT_INFO.name,
    title: ACP_AGENT_INFO.title,
    version: ACP_AGENT_INFO.version,
    protocolVersion: ACP_PROTOCOL_VERSION,
  };
}

export interface AcpCapabilityEntry {
  name: string;
  version: string;
  enabled: boolean;
}

export function createCapabilityEntry(
  name: string,
  enabled: boolean,
  version?: string
): AcpCapabilityEntry {
  return {
    name,
    version: version || '1.0',
    enabled,
  };
}
