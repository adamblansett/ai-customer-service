import { ConversationStatus, InvalidStateTransitionError } from './types.js';

/**
 * Explicit map of permitted state transitions for conversations.
 * Terminal states ('closed', 'failed') allow no outgoing transitions.
 */
const VALID_TRANSITIONS: Record<ConversationStatus, ConversationStatus[]> = {
  active: ['waiting_agent', 'transferred', 'interrupted', 'closed', 'failed'],
  waiting_agent: ['active', 'transferred', 'interrupted', 'closed', 'failed'],
  transferred: ['closed', 'failed'],
  interrupted: ['active', 'closed', 'failed'],
  closed: [], // Terminal
  failed: [], // Terminal
};

/**
 * Validates and executes a conversation state transition.
 * Throws InvalidStateTransitionError if the transition is prohibited.
 */
export function validateStateTransition(
  currentStatus: ConversationStatus,
  targetStatus: ConversationStatus
): ConversationStatus {
  if (currentStatus === targetStatus) {
    return currentStatus;
  }

  const allowedTargets = VALID_TRANSITIONS[currentStatus];
  if (!allowedTargets || !allowedTargets.includes(targetStatus)) {
    throw new InvalidStateTransitionError(currentStatus, targetStatus);
  }

  return targetStatus;
}
