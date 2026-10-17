export type ParticipantRole = 'caller' | 'agent' | 'supervisor';
export type SupervisorMode = 'silent_monitor' | 'whisper' | 'barge_in';

export interface BridgeParticipant {
  id: string;
  role: ParticipantRole;
  joinedAt: Date;
  supervisorMode?: SupervisorMode;
  isMuted?: boolean;
}

export interface AudioBridge {
  id: string;
  callSid: string;
  participants: Map<string, BridgeParticipant>;
  createdAt: Date;
}

export class AudioBridgeManager {
  private bridges: Map<string, AudioBridge> = new Map();

  public createBridge(bridgeId: string, callSid: string): AudioBridge {
    const bridge: AudioBridge = {
      id: bridgeId,
      callSid,
      participants: new Map(),
      createdAt: new Date(),
    };
    this.bridges.set(bridgeId, bridge);
    return bridge;
  }

  public getBridge(bridgeId: string): AudioBridge | undefined {
    return this.bridges.get(bridgeId);
  }

  public joinParticipant(
    bridgeId: string,
    participantId: string,
    role: ParticipantRole,
    supervisorMode: SupervisorMode = 'silent_monitor'
  ): BridgeParticipant {
    let bridge = this.bridges.get(bridgeId);
    if (!bridge) {
      bridge = this.createBridge(bridgeId, bridgeId);
    }

    const participant: BridgeParticipant = {
      id: participantId,
      role,
      joinedAt: new Date(),
      supervisorMode: role === 'supervisor' ? supervisorMode : undefined,
      isMuted: false,
    };

    bridge.participants.set(participantId, participant);
    return participant;
  }

  public leaveParticipant(bridgeId: string, participantId: string): boolean {
    const bridge = this.bridges.get(bridgeId);
    if (!bridge) return false;
    return bridge.participants.delete(participantId);
  }

  public setSupervisorMode(
    bridgeId: string,
    supervisorId: string,
    mode: SupervisorMode
  ): boolean {
    const bridge = this.bridges.get(bridgeId);
    if (!bridge) return false;

    const participant = bridge.participants.get(supervisorId);
    if (!participant || participant.role !== 'supervisor') return false;

    participant.supervisorMode = mode;
    return true;
  }

  /**
   * Evaluates audio routing rules for an incoming audio chunk.
   * Returns a map of participantId -> boolean (whether they receive the audio chunk).
   */
  public getRecipients(
    bridgeId: string,
    senderId: string
  ): string[] {
    const bridge = this.bridges.get(bridgeId);
    if (!bridge) return [];

    const sender = bridge.participants.get(senderId);
    if (!sender) return [];

    const recipients: string[] = [];

    for (const [id, participant] of bridge.participants.entries()) {
      if (id === senderId) continue; // Don't echo back to sender

      // 1. Audio sent by Supervisor
      if (sender.role === 'supervisor') {
        const mode = sender.supervisorMode || 'silent_monitor';
        if (mode === 'silent_monitor') {
          // Silent: supervisor audio is dropped completely
          continue;
        } else if (mode === 'whisper') {
          // Whisper: only the assigned agent hears supervisor
          if (participant.role === 'agent') {
            recipients.push(id);
          }
        } else if (mode === 'barge_in') {
          // Barge-in: all participants hear supervisor
          recipients.push(id);
        }
      }

      // 2. Audio sent by Caller
      else if (sender.role === 'caller') {
        // Both agent and supervisor hear caller
        recipients.push(id);
      }

      // 3. Audio sent by Agent
      else if (sender.role === 'agent') {
        // Both caller and supervisor hear agent
        recipients.push(id);
      }
    }

    return recipients;
  }

  /**
   * Routes an audio frame and returns recipient IDs with the forwarded chunk.
   */
  public routeAudioFrame(
    bridgeId: string,
    senderId: string,
    audioData: string | Buffer
  ): Map<string, string | Buffer> {
    const recipients = this.getRecipients(bridgeId, senderId);
    const routed = new Map<string, string | Buffer>();

    for (const recipientId of recipients) {
      routed.set(recipientId, audioData);
    }

    return routed;
  }

  public clear(): void {
    this.bridges.clear();
  }
}
