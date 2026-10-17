import { describe, it, expect, beforeEach } from 'vitest';
import { AudioBridgeManager } from '../telephony/index.js';

describe('WebRTC Audio Bridge & Supervisor Coaching Modes Suite', () => {
  let bridgeManager: AudioBridgeManager;
  const bridgeId = 'bridge_call_9901';

  beforeEach(() => {
    bridgeManager = new AudioBridgeManager();
    bridgeManager.createBridge(bridgeId, 'CA_test_call_sid_123');
    bridgeManager.joinParticipant(bridgeId, 'caller_p1', 'caller');
    bridgeManager.joinParticipant(bridgeId, 'agent_p2', 'agent');
    bridgeManager.joinParticipant(bridgeId, 'sup_p3', 'supervisor', 'silent_monitor');
  });

  it('routes caller and agent speech to supervisor in silent monitor mode', () => {
    // Caller speaks -> both Agent and Supervisor should receive
    const callerRecipients = bridgeManager.getRecipients(bridgeId, 'caller_p1');
    expect(callerRecipients).toContain('agent_p2');
    expect(callerRecipients).toContain('sup_p3');
    expect(callerRecipients).not.toContain('caller_p1');

    // Agent speaks -> both Caller and Supervisor should receive
    const agentRecipients = bridgeManager.getRecipients(bridgeId, 'agent_p2');
    expect(agentRecipients).toContain('caller_p1');
    expect(agentRecipients).toContain('sup_p3');

    // Supervisor speaks in silent_monitor -> no one should receive
    const supRecipients = bridgeManager.getRecipients(bridgeId, 'sup_p3');
    expect(supRecipients).toHaveLength(0);
  });

  it('routes supervisor speech exclusively to agent in whisper coaching mode', () => {
    bridgeManager.setSupervisorMode(bridgeId, 'sup_p3', 'whisper');

    const recipients = bridgeManager.getRecipients(bridgeId, 'sup_p3');
    expect(recipients).toHaveLength(1);
    expect(recipients).toContain('agent_p2');
    expect(recipients).not.toContain('caller_p1'); // Caller must never hear whisper
  });

  it('routes supervisor speech to all parties in barge_in mode', () => {
    bridgeManager.setSupervisorMode(bridgeId, 'sup_p3', 'barge_in');

    const recipients = bridgeManager.getRecipients(bridgeId, 'sup_p3');
    expect(recipients).toHaveLength(2);
    expect(recipients).toContain('caller_p1');
    expect(recipients).toContain('agent_p2');
  });

  it('handles participant leave cleanly', () => {
    const removed = bridgeManager.leaveParticipant(bridgeId, 'sup_p3');
    expect(removed).toBe(true);

    const bridge = bridgeManager.getBridge(bridgeId);
    expect(bridge?.participants.has('sup_p3')).toBe(false);

    const callerRecipients = bridgeManager.getRecipients(bridgeId, 'caller_p1');
    expect(callerRecipients).toEqual(['agent_p2']);
  });
});
