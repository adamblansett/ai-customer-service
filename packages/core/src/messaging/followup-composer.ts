import { eq, asc } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import { redactSensitiveData } from '../security/redaction.js';

export interface ComposeFollowUpInput {
  tenantId: string;
  callSid: string;
  conversationId?: string;
  callerPhone: string;
  callerEmail?: string;
  businessName?: string;
}

export interface FollowUpRecapResult {
  callSid: string;
  referenceNumber: string;
  smsBody: string;
  emailSubject: string;
  emailText: string;
  emailHtml: string;
  linkedAppointmentId: string | null;
}

export class FollowUpComposer {
  constructor(private db: DatabaseInstance) {}

  /**
   * Composes a PII-redacted post-call SMS and Email summary containing the call reference,
   * any confirmed technician appointment window, quoted diagnostic rates, and a 1-click survey/reschedule link.
   */
  public async composeFollowUp(input: ComposeFollowUpInput): Promise<FollowUpRecapResult> {
    const businessName = input.businessName || 'Acme Heating & Cooling';
    const referenceNumber = `REF-${input.callSid.slice(-6).toUpperCase()}`;

    const appts = await this.db
      .select()
      .from(schema.appointments)
      .where(eq(schema.appointments.tenantId, input.tenantId));

    const matchedAppt = appts.find(
      (a) =>
        a.status !== 'cancelled' &&
        (a.customerPhone === input.callerPhone ||
          (input.conversationId && a.conversationId === input.conversationId))
    );

    let transcriptPreview = 'Thank you for speaking with our automated support team today.';
    if (input.conversationId) {
      const msgs = await this.db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, input.conversationId))
        .orderBy(asc(schema.messages.createdAt));

      if (msgs.length > 0) {
        const lastAi = [...msgs].reverse().find((m) => m.senderType !== 'customer');
        if (lastAi) {
          transcriptPreview = redactSensitiveData(lastAi.content).slice(0, 180);
        }
      }
    }

    const apptClause = matchedAppt
      ? ` Confirmed ${matchedAppt.serviceType} with ${matchedAppt.technicianName} on ${new Date(
          matchedAppt.scheduledStart
        ).toISOString().slice(0, 16).replace('T', ' ')} UTC.`
      : '';

    const manageUrl = `https://portal.acme-hvac.example.com/followup/${referenceNumber}`;

    const smsBody = `${businessName} Recap (${referenceNumber}):${apptClause} Summary: ${transcriptPreview.slice(
      0,
      90
    )} Rate or reschedule: ${manageUrl}`;

    const emailSubject = `${businessName} — Call Summary & Confirmation (${referenceNumber})`;
    const emailText = [
      `Hello,`,
      ``,
      `Thank you for contacting ${businessName}. Here is your call recap (${referenceNumber}):`,
      matchedAppt
        ? `- Confirmed Appointment: ${matchedAppt.serviceType} with ${matchedAppt.technicianName} (${new Date(
            matchedAppt.scheduledStart
          ).toISOString()})`
        : `- Call Reference: ${referenceNumber}`,
      `- Recap: ${transcriptPreview}`,
      ``,
      `Manage appointment or rate your service (1-5): ${manageUrl}`,
    ].join('\n');

    const emailHtml = `<div style="font-family:sans-serif;max-width:560px"><h2>${businessName} Call Summary (${referenceNumber})</h2><p>${transcriptPreview}</p>${
      matchedAppt
        ? `<p><strong>Confirmed Appointment:</strong> ${matchedAppt.serviceType} with ${matchedAppt.technicianName}</p>`
        : ''
    }<p><a href="${manageUrl}">Reschedule or Rate Your Experience</a></p></div>`;

    return {
      callSid: input.callSid,
      referenceNumber,
      smsBody,
      emailSubject,
      emailText,
      emailHtml,
      linkedAppointmentId: matchedAppt?.id || null,
    };
  }
}
