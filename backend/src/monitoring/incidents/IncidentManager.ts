export type IncidentSeverity = 'critical' | 'major' | 'minor' | 'warning' | 'info';

export type IncidentStatus = 'firing' | 'acknowledged' | 'investigating' | 'resolved' | 'closed';

export interface Incident {
  id: string;
  title: string;
  description: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  source: string;
  relatedAlertIds: string[];
  createdAt: number;
  acknowledgedAt?: number;
  resolvedAt?: number;
  acknowledgedBy?: string;
  resolvedBy?: string;
  resolution?: string;
  tags: string[];
}

export interface IncidentFilter {
  severity?: IncidentSeverity[];
  status?: IncidentStatus[];
  source?: string;
  startTime?: number;
  endTime?: number;
  tags?: string[];
  limit?: number;
  offset?: number;
}

export interface IncidentStats {
  total: number;
  bySeverity: Record<IncidentSeverity, number>;
  byStatus: Record<IncidentStatus, number>;
  averageResolutionTime: number;
  openCriticalCount: number;
}

export interface IIncidentManager {
  createIncident(incident: Omit<Incident, 'id' | 'createdAt'>): Incident;
  getIncident(id: string): Incident | undefined;
  updateStatus(id: string, status: IncidentStatus, meta?: { by?: string; resolution?: string }): boolean;
  listIncidents(filter?: IncidentFilter): Incident[];
  addRelatedAlert(incidentId: string, alertId: string): boolean;
  getStats(): IncidentStats;
  closeOldIncidents(maxAge: number): number;
}

let incidentCounter = 0;

function generateIncidentId(): string {
  incidentCounter++;
  return `inc_${Date.now()}_${incidentCounter}`;
}

export class IncidentManager implements IIncidentManager {
  private incidents: Map<string, Incident> = new Map();

  createIncident(data: Omit<Incident, 'id' | 'createdAt'>): Incident {
    const incident: Incident = {
      ...data,
      id: generateIncidentId(),
      createdAt: Date.now(),
    };
    this.incidents.set(incident.id, incident);
    return incident;
  }

  getIncident(id: string): Incident | undefined {
    return this.incidents.get(id);
  }

  updateStatus(id: string, status: IncidentStatus, meta?: { by?: string; resolution?: string }): boolean {
    const incident = this.incidents.get(id);
    if (!incident) return false;

    const now = Date.now();
    incident.status = status;
    if (status === 'acknowledged' && meta?.by) {
      incident.acknowledgedAt = now;
      incident.acknowledgedBy = meta.by;
    }
    if (status === 'resolved') {
      incident.resolvedAt = now;
      incident.resolvedBy = meta?.by;
      incident.resolution = meta?.resolution;
    }
    return true;
  }

  listIncidents(filter?: IncidentFilter): Incident[] {
    let results = Array.from(this.incidents.values());

    if (filter?.severity && filter.severity.length > 0) {
      results = results.filter(i => filter.severity!.includes(i.severity));
    }
    if (filter?.status && filter.status.length > 0) {
      results = results.filter(i => filter.status!.includes(i.status));
    }
    if (filter?.source) {
      results = results.filter(i => i.source === filter.source);
    }
    if (filter?.startTime !== undefined) {
      results = results.filter(i => i.createdAt >= filter.startTime!);
    }
    if (filter?.endTime !== undefined) {
      results = results.filter(i => i.createdAt <= filter.endTime!);
    }
    if (filter?.tags && filter.tags.length > 0) {
      results = results.filter(i => filter.tags!.some(t => i.tags.includes(t)));
    }

    results.sort((a, b) => b.createdAt - a.createdAt);

    if (filter?.offset) results = results.slice(filter.offset);
    if (filter?.limit) results = results.slice(0, filter.limit);

    return results;
  }

  addRelatedAlert(incidentId: string, alertId: string): boolean {
    const incident = this.incidents.get(incidentId);
    if (!incident) return false;
    if (!incident.relatedAlertIds.includes(alertId)) {
      incident.relatedAlertIds.push(alertId);
    }
    return true;
  }

  getStats(): IncidentStats {
    const severities: IncidentSeverity[] = ['critical', 'major', 'minor', 'warning', 'info'];
    const statuses: IncidentStatus[] = ['firing', 'acknowledged', 'investigating', 'resolved', 'closed'];

    const bySeverity: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    for (const s of severities) bySeverity[s] = 0;
    for (const s of statuses) byStatus[s] = 0;

    let totalResolutionTime = 0;
    let resolvedCount = 0;
    let openCriticalCount = 0;

    for (const inc of this.incidents.values()) {
      bySeverity[inc.severity] = (bySeverity[inc.severity] || 0) + 1;
      byStatus[inc.status] = (byStatus[inc.status] || 0) + 1;
      if (inc.resolvedAt && inc.acknowledgedAt) {
        totalResolutionTime += inc.resolvedAt - inc.acknowledgedAt;
        resolvedCount++;
      }
      if (inc.severity === 'critical' && inc.status !== 'resolved' && inc.status !== 'closed') {
        openCriticalCount++;
      }
    }

    return {
      total: this.incidents.size,
      bySeverity: bySeverity as Record<IncidentSeverity, number>,
      byStatus: byStatus as Record<IncidentStatus, number>,
      averageResolutionTime: resolvedCount > 0 ? Math.round(totalResolutionTime / resolvedCount) : 0,
      openCriticalCount,
    };
  }

  closeOldIncidents(maxAge: number): number {
    const now = Date.now();
    let count = 0;
    for (const [id, incident] of this.incidents) {
      if (now - incident.createdAt >= maxAge && incident.status !== 'closed') {
        incident.status = 'closed';
        count++;
      }
    }
    return count;
  }
}
