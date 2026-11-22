import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';

export type CalendarProvider = 'google_calendar' | 'microsoft_365';

export interface BusyWindow {
  start: string;
  end: string;
  summary?: string;
}

export class CalendarSyncService {
  constructor(private db: DatabaseInstance) {}

  async connectCalendar(params: {
    tenantId: string;
    provider: CalendarProvider;
    calendarId: string;
    technicianName: string;
    busyWindows?: BusyWindow[];
  }) {
    const [created] = await this.db
      .insert(schema.calendarConnections)
      .values({
        id: `cal_${crypto.randomUUID()}`,
        tenantId: params.tenantId,
        provider: params.provider,
        calendarId: params.calendarId,
        technicianName: params.technicianName,
        busyWindows: params.busyWindows || [],
        syncToken: `sync_${crypto.randomBytes(8).toString('hex')}`,
        status: 'connected',
        lastSyncedAt: new Date(),
      })
      .returning();
    return created;
  }

  async listConnections(tenantId: string) {
    return this.db
      .select()
      .from(schema.calendarConnections)
      .where(eq(schema.calendarConnections.tenantId, tenantId));
  }

  /**
   * Checks whether a technician has a busy block synced from Google Calendar or Microsoft 365 Outlook
   * overlapping `[proposedStart, proposedEnd)`.
   */
  async hasExternalBusyConflict(
    tenantId: string,
    technicianName: string,
    proposedStart: Date,
    proposedEnd: Date
  ): Promise<{ conflict: boolean; conflictingEvent?: BusyWindow }> {
    const connections = await this.listConnections(tenantId);
    const techCal = connections.filter(
      (c) =>
        c.status === 'connected' &&
        c.technicianName.toLowerCase() === technicianName.toLowerCase()
    );

    for (const conn of techCal) {
      const windows = (conn.busyWindows as BusyWindow[]) || [];
      for (const win of windows) {
        const winStart = new Date(win.start);
        const winEnd = new Date(win.end);
        if (proposedStart < winEnd && proposedEnd > winStart) {
          return { conflict: true, conflictingEvent: win };
        }
      }
    }

    return { conflict: false };
  }

  /**
   * Exports all active tenant appointments as an RFC 5545 iCalendar (`.ics`) feed
   * subscribable in Google Calendar, Apple Calendar, and Microsoft Outlook.
   */
  async exportIcalFeed(tenantId: string, calendarName = 'AI Field Dispatch Schedule'): Promise<string> {
    const appts = await this.db
      .select()
      .from(schema.appointments)
      .where(eq(schema.appointments.tenantId, tenantId));

    const formatIcsDate = (d: Date) =>
      d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

    const lines: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//OpenSource AI Customer Service//Field Dispatch//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${calendarName.replace(/[\r\n]/g, ' ')}`,
    ];

    for (const appt of appts) {
      if (appt.status === 'cancelled') continue;
      lines.push(
        'BEGIN:VEVENT',
        `UID:${appt.id}@ai-customer-service.local`,
        `DTSTAMP:${formatIcsDate(new Date(appt.createdAt))}`,
        `DTSTART:${formatIcsDate(new Date(appt.scheduledStart))}`,
        `DTEND:${formatIcsDate(new Date(appt.scheduledEnd))}`,
        `SUMMARY:${appt.serviceType} - ${appt.customerName} (${appt.technicianName})`,
        `DESCRIPTION:Customer Phone: ${appt.customerPhone}${appt.notes ? ` | Notes: ${appt.notes}` : ''}`,
        `STATUS:CONFIRMED`,
        'END:VEVENT'
      );
    }

    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }
}
