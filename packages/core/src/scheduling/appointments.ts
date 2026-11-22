import crypto from 'node:crypto';
import { eq, and, ne } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import type { AiToolDefinition } from '../ai/types.js';
import { CalendarSyncService } from './calendar-sync.js';

export interface AvailableTimeSlot {
  slotId: string;
  date: string;
  startIso: string;
  endIso: string;
  windowLabel: string;
  availableTechnicians: string[];
}

export interface BookAppointmentInput {
  tenantId: string;
  customerId?: string;
  conversationId?: string;
  customerName: string;
  customerPhone: string;
  serviceType: string;
  scheduledStart: string;
  scheduledEnd: string;
  technicianName?: string;
  notes?: string;
}

const DEFAULT_TECHNICIANS = ['Marcus Vance', 'Elena Rostova', 'David Chen'];

const STANDARD_WINDOWS = [
  { startHour: 8, endHour: 10, label: '08:00 AM - 10:00 AM' },
  { startHour: 10, endHour: 12, label: '10:00 AM - 12:00 PM' },
  { startHour: 13, endHour: 15, label: '01:00 PM - 03:00 PM' },
  { startHour: 15, endHour: 17, label: '03:00 PM - 05:00 PM' },
];

export const APPOINTMENT_AI_TOOLS: AiToolDefinition[] = [
  {
    name: 'check_available_slots',
    description:
      'Check available technician appointment windows for a specific date (YYYY-MM-DD) before booking service.',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Target date in YYYY-MM-DD format' },
        serviceType: {
          type: 'string',
          description: 'Service category (e.g. furnace_repair, ac_tuneup, emergency_dispatch)',
        },
      },
      required: ['date'],
    },
  },
  {
    name: 'book_appointment',
    description: 'Book a confirmed technician service appointment in a conflict-free time window.',
    parameters: {
      type: 'object',
      properties: {
        customerName: { type: 'string' },
        customerPhone: { type: 'string' },
        serviceType: { type: 'string' },
        scheduledStart: { type: 'string', description: 'ISO 8601 start timestamp' },
        scheduledEnd: { type: 'string', description: 'ISO 8601 end timestamp' },
        notes: { type: 'string' },
      },
      required: ['customerName', 'customerPhone', 'serviceType', 'scheduledStart', 'scheduledEnd'],
    },
  },
  {
    name: 'reschedule_appointment',
    description: 'Reschedule an existing appointment to a new start and end time.',
    parameters: {
      type: 'object',
      properties: {
        appointmentId: { type: 'string' },
        scheduledStart: { type: 'string' },
        scheduledEnd: { type: 'string' },
      },
      required: ['appointmentId', 'scheduledStart', 'scheduledEnd'],
    },
  },
  {
    name: 'cancel_appointment',
    description: 'Cancel an existing appointment by ID.',
    parameters: {
      type: 'object',
      properties: {
        appointmentId: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['appointmentId'],
    },
  },
];

export class AppointmentScheduler {
  constructor(private db: DatabaseInstance) {}

  /**
   * Lists all appointments for a tenant, optionally filtered by status.
   */
  public async listAppointments(tenantId: string, status?: string) {
    const rows = await this.db
      .select()
      .from(schema.appointments)
      .where(
        status
          ? and(eq(schema.appointments.tenantId, tenantId), eq(schema.appointments.status, status))
          : eq(schema.appointments.tenantId, tenantId)
      );

    return rows.sort(
      (a, b) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime()
    );
  }

  /**
   * Returns conflict-free 2-hour technician dispatch slots for a given date (YYYY-MM-DD).
   */
  public async checkAvailableSlots(
    tenantId: string,
    dateStr: string
  ): Promise<AvailableTimeSlot[]> {
    const cleanDate = dateStr.slice(0, 10);
    const activeAppointments = await this.db
      .select()
      .from(schema.appointments)
      .where(
        and(
          eq(schema.appointments.tenantId, tenantId),
          ne(schema.appointments.status, 'cancelled')
        )
      );

    const slots: AvailableTimeSlot[] = [];

    for (const win of STANDARD_WINDOWS) {
      const startIso = `${cleanDate}T${String(win.startHour).padStart(2, '0')}:00:00.000Z`;
      const endIso = `${cleanDate}T${String(win.endHour).padStart(2, '0')}:00:00.000Z`;
      const winStartMs = new Date(startIso).getTime();
      const winEndMs = new Date(endIso).getTime();

      const busyTechs = new Set<string>();
      for (const appt of activeAppointments) {
        const apptStart = new Date(appt.scheduledStart).getTime();
        const apptEnd = new Date(appt.scheduledEnd).getTime();
        const overlaps = apptStart < winEndMs && apptEnd > winStartMs;
        if (overlaps) {
          busyTechs.add(appt.technicianName);
        }
      }

      const availableTechnicians = DEFAULT_TECHNICIANS.filter((t) => !busyTechs.has(t));
      if (availableTechnicians.length > 0) {
        slots.push({
          slotId: `slot_${cleanDate}_${win.startHour}`,
          date: cleanDate,
          startIso,
          endIso,
          windowLabel: win.label,
          availableTechnicians,
        });
      }
    }

    return slots;
  }

  /**
   * Books a confirmed technician appointment with conflict detection.
   */
  public async bookAppointment(input: BookAppointmentInput) {
    const startMs = new Date(input.scheduledStart).getTime();
    const endMs = new Date(input.scheduledEnd).getTime();
    if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) {
      throw new Error('Invalid appointment scheduledStart / scheduledEnd window.');
    }

    const activeAppointments = await this.db
      .select()
      .from(schema.appointments)
      .where(
        and(
          eq(schema.appointments.tenantId, input.tenantId),
          ne(schema.appointments.status, 'cancelled')
        )
      );

    const busyTechs = new Set<string>();
    for (const appt of activeAppointments) {
      const aStart = new Date(appt.scheduledStart).getTime();
      const aEnd = new Date(appt.scheduledEnd).getTime();
      if (aStart < endMs && aEnd > startMs) {
        busyTechs.add(appt.technicianName);
      }
    }

    const calendarSync = new CalendarSyncService(this.db);
    let chosenTech = input.technicianName;
    if (chosenTech) {
      if (busyTechs.has(chosenTech)) {
        throw new Error(`Technician ${chosenTech} is already booked during this time window.`);
      }
      const extConflict = await calendarSync.hasExternalBusyConflict(
        input.tenantId,
        chosenTech,
        new Date(startMs),
        new Date(endMs)
      );
      if (extConflict.conflict) {
        throw new Error(
          `Technician ${chosenTech} has an external calendar block (${extConflict.conflictingEvent?.summary || 'Busy'}) during this window.`
        );
      }
    } else {
      for (const candidate of DEFAULT_TECHNICIANS) {
        if (busyTechs.has(candidate)) continue;
        const extConflict = await calendarSync.hasExternalBusyConflict(
          input.tenantId,
          candidate,
          new Date(startMs),
          new Date(endMs)
        );
        if (!extConflict.conflict) {
          chosenTech = candidate;
          break;
        }
      }
      if (!chosenTech) {
        throw new Error('No technicians are available during the requested time window.');
      }
    }

    const [created] = await this.db
      .insert(schema.appointments)
      .values({
        id: `appt_${crypto.randomUUID()}`,
        tenantId: input.tenantId,
        customerId: input.customerId || null,
        conversationId: input.conversationId || null,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        serviceType: input.serviceType,
        technicianName: chosenTech,
        scheduledStart: new Date(input.scheduledStart),
        scheduledEnd: new Date(input.scheduledEnd),
        status: 'confirmed',
        notes: input.notes || null,
      })
      .returning();

    return created;
  }

  /**
   * Reschedules an existing appointment to a new time window.
   */
  public async rescheduleAppointment(
    tenantId: string,
    appointmentId: string,
    scheduledStart: string,
    scheduledEnd: string
  ) {
    const [updated] = await this.db
      .update(schema.appointments)
      .set({
        scheduledStart: new Date(scheduledStart),
        scheduledEnd: new Date(scheduledEnd),
        status: 'rescheduled',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.appointments.id, appointmentId),
          eq(schema.appointments.tenantId, tenantId)
        )
      )
      .returning();

    if (!updated) {
      throw new Error(`Appointment ${appointmentId} not found.`);
    }
    return updated;
  }

  /**
   * Cancels an existing appointment.
   */
  public async cancelAppointment(tenantId: string, appointmentId: string, reason?: string) {
    const [cancelled] = await this.db
      .update(schema.appointments)
      .set({
        status: 'cancelled',
        notes: reason ? `Cancelled: ${reason}` : 'Cancelled by customer',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.appointments.id, appointmentId),
          eq(schema.appointments.tenantId, tenantId)
        )
      )
      .returning();

    if (!cancelled) {
      throw new Error(`Appointment ${appointmentId} not found.`);
    }
    return cancelled;
  }
}
