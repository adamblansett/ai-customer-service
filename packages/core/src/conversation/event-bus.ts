import { EventEmitter } from 'node:events';

export type RealtimeEventType =
  | 'call.started'
  | 'call.updated'
  | 'message.created'
  | 'queue.updated'
  | 'appointment.booked'
  | 'payment.completed'
  | 'survey.completed'
  | 'supervisor.alert';

export interface RealtimeDashboardEvent {
  id: string;
  tenantId: string;
  type: RealtimeEventType;
  timestamp: string;
  payload: Record<string, any>;
}

/**
 * Tenant-scoped real-time pub/sub Event Bus for Server-Sent Events (SSE) dashboard push.
 */
export class RealtimeEventBus {
  private static emitter = new EventEmitter();
  private static recentEvents = new Map<string, RealtimeDashboardEvent[]>();

  public static publish(
    tenantId: string,
    type: RealtimeEventType,
    payload: Record<string, any>
  ): RealtimeDashboardEvent {
    const event: RealtimeDashboardEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      tenantId,
      type,
      timestamp: new Date().toISOString(),
      payload,
    };

    const list = this.recentEvents.get(tenantId) || [];
    list.unshift(event);
    if (list.length > 50) list.pop();
    this.recentEvents.set(tenantId, list);

    this.emitter.emit(`tenant:${tenantId}`, event);
    return event;
  }

  public static getRecentEvents(tenantId: string, limit = 20): RealtimeDashboardEvent[] {
    return (this.recentEvents.get(tenantId) || []).slice(0, limit);
  }

  public static subscribe(
    tenantId: string,
    listener: (event: RealtimeDashboardEvent) => void
  ): () => void {
    const channel = `tenant:${tenantId}`;
    this.emitter.on(channel, listener);
    return () => {
      this.emitter.off(channel, listener);
    };
  }
}
