import { describe, it, expect, beforeEach } from 'vitest';
import {
  DncRegistry,
  CallingHoursGuard,
  OutboundCampaignManager,
  type CampaignRecipient,
} from '../campaigns/index.js';

describe('Outbound Proactive Notification Campaigns Suite', () => {
  const tenantId = 'tenant_campaign_test_123';

  beforeEach(() => {
    DncRegistry.clearForTesting();
  });

  describe('DncRegistry', () => {
    it('registers and checks numbers on the DNC list', () => {
      expect(DncRegistry.isListed(tenantId, '+15551234567')).toBe(false);

      DncRegistry.addNumber(tenantId, '+15551234567', 'Customer requested no more calls');
      expect(DncRegistry.isListed(tenantId, '+15551234567')).toBe(true);

      // Normalization check (e.g. 10 digit without +1)
      expect(DncRegistry.isListed(tenantId, '5551234567')).toBe(true);

      const list = DncRegistry.listNumbers(tenantId);
      expect(list).toHaveLength(1);
      expect(list[0].phoneNumber).toBe('+15551234567');

      // Removal
      const removed = DncRegistry.removeNumber(tenantId, '+15551234567');
      expect(removed).toBe(true);
      expect(DncRegistry.isListed(tenantId, '+15551234567')).toBe(false);
    });

    it('accurately identifies opt-out keywords like STOP, UNSUBSCRIBE, and DO NOT CALL', () => {
      expect(DncRegistry.checkOptOutKeywords('STOP')).toBe(true);
      expect(DncRegistry.checkOptOutKeywords('stop')).toBe(true);
      expect(DncRegistry.checkOptOutKeywords('Please UNSUBSCRIBE me immediately')).toBe(true);
      expect(DncRegistry.checkOptOutKeywords('Please do not call this number again')).toBe(true);
      expect(DncRegistry.checkOptOutKeywords('CANCEL')).toBe(true);

      // Normal messages that contain similar words should not trigger false positives
      expect(DncRegistry.checkOptOutKeywords('Can you stop by tomorrow at 2pm?')).toBe(false);
      expect(DncRegistry.checkOptOutKeywords('My air conditioning won\'t stop blowing warm air')).toBe(false);
    });
  });

  describe('CallingHoursGuard', () => {
    it('permits calls during daytime hours and blocks during late night hours', () => {
      // 2:00 PM (14:00) EDT on 2026-10-15 (18:00 UTC)
      const afternoonTime = new Date('2026-10-15T18:00:00.000Z');
      const checkAfternoon = CallingHoursGuard.isWithinPermittedHours('America/New_York', afternoonTime);
      expect(checkAfternoon.allowed).toBe(true);
      expect(checkAfternoon.currentHour).toBe(14);

      // 3:00 AM (03:00) EDT on 2026-10-15 (07:00 UTC)
      const midnightTime = new Date('2026-10-15T07:00:00.000Z');
      const checkNight = CallingHoursGuard.isWithinPermittedHours('America/New_York', midnightTime);
      expect(checkNight.allowed).toBe(false);
      expect(checkNight.currentHour).toBe(3);
      expect(checkNight.reason).toContain('outside TCPA permitted calling window');
    });
  });

  describe('OutboundCampaignManager', () => {
    const manager = new OutboundCampaignManager();

    it('interpolates template tags for recipients', () => {
      const recipient: CampaignRecipient = {
        recipientPhone: '+15559876543',
        recipientName: 'Alice Johnson',
        customVariables: {
          appointmentTime: 'Tomorrow at 10:00 AM',
          technician: 'Dave',
        },
      };

      const template = 'Hello {{name}}! Your HVAC service with technician {{technician}} is confirmed for {{appointmentTime}}.';
      const rendered = manager.renderTemplate(template, recipient);

      expect(rendered).toBe('Hello Alice Johnson! Your HVAC service with technician Dave is confirmed for Tomorrow at 10:00 AM.');
    });

    it('dispatches campaign while strictly enforcing DNC and calling hours restrictions', async () => {
      // Pre-register one recipient on the DNC list
      DncRegistry.addNumber(tenantId, '+15550000002', 'Prior opt-out');

      const recipients: CampaignRecipient[] = [
        {
          recipientPhone: '+15550000001',
          recipientName: 'Bob Smith',
          recipientTimezone: 'America/New_York',
        },
        {
          recipientPhone: '+15550000002', // Blocked by DNC
          recipientName: 'Charlie Brown',
          recipientTimezone: 'America/New_York',
        },
        {
          recipientPhone: '+15550000003', // Blocked if outside calling hours
          recipientName: 'Diana Prince',
          recipientTimezone: 'America/New_York',
        },
      ];

      // Test during daytime (14:00 EDT)
      const daytime = new Date('2026-10-15T18:00:00.000Z');
      const resultDay = await manager.dispatchCampaign(
        {
          tenantId,
          campaignName: 'Seasonal Maintenance Reminder',
          channel: 'sms',
          messageTemplate: 'Hi {{name}}, scheduling is now open for fall heating inspections!',
          recipients,
        },
        daytime
      );

      expect(resultDay.totalRecipients).toBe(3);
      expect(resultDay.dispatchedCount).toBe(2);
      expect(resultDay.blockedDncCount).toBe(1);
      expect(resultDay.blockedHoursCount).toBe(0);

      const dncOutcome = resultDay.recipientOutcomes.find((o) => o.recipientPhone === '+15550000002');
      expect(dncOutcome?.status).toBe('skipped_dnc');

      // Test during nighttime (03:00 EDT)
      const nighttime = new Date('2026-10-15T07:00:00.000Z');
      const resultNight = await manager.dispatchCampaign(
        {
          tenantId,
          campaignName: 'Late Night Alert',
          channel: 'sms',
          messageTemplate: 'Hi {{name}}, message',
          recipients,
        },
        nighttime
      );

      expect(resultNight.dispatchedCount).toBe(0);
      expect(resultNight.blockedDncCount).toBe(1);
      expect(resultNight.blockedHoursCount).toBe(2);
    });
  });
});
