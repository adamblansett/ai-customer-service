export type FlowNodeType =
  | 'greeting'
  | 'ai_voice'
  | 'dtmf_menu'
  | 'hours_check'
  | 'route_condition'
  | 'transfer_queue'
  | 'voicemail_callback'
  | 'webhook_action'
  | 'hangup';

export interface FlowNodeBranch {
  condition: string; // e.g. '1', '2', 'open', 'closed', 'vip'
  targetNodeId: string;
}

export interface FlowNode {
  id: string;
  type: FlowNodeType;
  title: string;
  config: Record<string, any>;
  next?: string;
  branches?: FlowNodeBranch[];
}

export interface CallFlowGraph {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  startNodeId: string;
  nodes: FlowNode[];
  version: number;
  published: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FlowExecutionState {
  currentNodeId: string;
  variables: Record<string, any>;
  history: Array<{
    nodeId: string;
    nodeType: FlowNodeType;
    input?: string;
    output?: string;
    timestamp: string;
  }>;
  isComplete: boolean;
}

export interface FlowStepResult {
  nodeId: string;
  nodeType: FlowNodeType;
  action: 'say' | 'gather_speech' | 'gather_dtmf' | 'dial' | 'hangup' | 'redirect';
  promptText?: string;
  target?: string;
  dtmfOptions?: Record<string, string>;
  state: FlowExecutionState;
}
