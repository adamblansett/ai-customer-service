export type ConversationStatus =
  | 'active'
  | 'waiting_agent'
  | 'transferred'
  | 'closed'
  | 'failed'
  | 'interrupted';

export type ChannelType = 'voice' | 'chat' | 'sms' | 'email';

export type EscalationState =
  | 'none'
  | 'requested'
  | 'in_progress'
  | 'completed'
  | 'failed';

export type SenderType = 'customer' | 'ai_agent' | 'human_agent' | 'system';

export class InvalidStateTransitionError extends Error {
  constructor(
    public readonly currentStatus: ConversationStatus,
    public readonly targetStatus: ConversationStatus,
    message?: string
  ) {
    super(
      message ||
        `Invalid state transition: Cannot transition conversation from '${currentStatus}' to '${targetStatus}'.`
    );
    this.name = 'InvalidStateTransitionError';
  }
}
