import { CallingHoursGuard } from '../campaigns/outbound.js';
import type {
  CallFlowGraph,
  FlowNode,
  FlowExecutionState,
  FlowStepResult,
} from './types.js';

export class FlowEngine {
  public static initExecution(
    graph: CallFlowGraph,
    initialVariables: Record<string, any> = {}
  ): FlowExecutionState {
    return {
      currentNodeId: graph.startNodeId,
      variables: { ...initialVariables },
      history: [],
      isComplete: false,
    };
  }

  public static executeStep(
    graph: CallFlowGraph,
    state: FlowExecutionState,
    userInput?: { speech?: string; digits?: string },
    currentTime: Date = new Date()
  ): FlowStepResult {
    const nodeMap = new Map<string, FlowNode>();
    for (const node of graph.nodes) {
      nodeMap.set(node.id, node);
    }

    let currentNode = nodeMap.get(state.currentNodeId);
    if (!currentNode) {
      state.isComplete = true;
      return {
        nodeId: state.currentNodeId,
        nodeType: 'hangup',
        action: 'hangup',
        promptText: 'Thank you for calling. Goodbye.',
        state,
      };
    }

    // Record incoming input if present
    if (userInput?.digits || userInput?.speech) {
      const lastHistory = state.history[state.history.length - 1];
      if (lastHistory) {
        lastHistory.input = userInput.digits || userInput.speech;
      }
    }

    // 1. Process DTMF Menu response
    if (currentNode.type === 'dtmf_menu') {
      if (userInput?.digits) {
        const chosenDigit = userInput.digits.trim();
        const matchedBranch = currentNode.branches?.find(
          (b) => b.condition === chosenDigit
        );

        const nextNodeId = matchedBranch ? matchedBranch.targetNodeId : currentNode.next;
        if (nextNodeId && nodeMap.has(nextNodeId)) {
          currentNode = nodeMap.get(nextNodeId)!;
          state.currentNodeId = nextNodeId;
        }
      } else if (userInput?.speech || userInput !== undefined) {
        const nextNodeId = currentNode.next;
        if (nextNodeId && nodeMap.has(nextNodeId)) {
          currentNode = nodeMap.get(nextNodeId)!;
          state.currentNodeId = nextNodeId;
        }
      }
    }

    // 2. Process Business Hours Check
    if (currentNode.type === 'hours_check') {
      const tz = currentNode.config.timezone || 'America/New_York';
      const hoursCheck = CallingHoursGuard.isWithinPermittedHours(tz, currentTime);
      const condition = hoursCheck.allowed ? 'open' : 'closed';

      const branch = currentNode.branches?.find((b) => b.condition === condition);
      const nextNodeId = branch ? branch.targetNodeId : currentNode.next;

      state.history.push({
        nodeId: currentNode.id,
        nodeType: 'hours_check',
        output: condition,
        timestamp: new Date().toISOString(),
      });

      if (nextNodeId && nodeMap.has(nextNodeId)) {
        currentNode = nodeMap.get(nextNodeId)!;
        state.currentNodeId = nextNodeId;
      } else {
        state.isComplete = true;
        return {
          nodeId: currentNode.id,
          nodeType: 'hangup',
          action: 'hangup',
          state,
        };
      }
    }

    // 3. Process Route Condition based on variables
    if (currentNode.type === 'route_condition') {
      const variableKey = currentNode.config.variable || 'tier';
      const actualValue = String(state.variables[variableKey] || '');
      const branch = currentNode.branches?.find((b) => b.condition === actualValue);
      const nextNodeId = branch ? branch.targetNodeId : currentNode.next;

      state.history.push({
        nodeId: currentNode.id,
        nodeType: 'route_condition',
        output: `Evaluated ${variableKey}=${actualValue}`,
        timestamp: new Date().toISOString(),
      });

      if (nextNodeId && nodeMap.has(nextNodeId)) {
        currentNode = nodeMap.get(nextNodeId)!;
        state.currentNodeId = nextNodeId;
      }
    }

    // Execute current node
    switch (currentNode.type) {
      case 'greeting': {
        const text = currentNode.config.message || 'Hello, thank you for calling.';
        state.history.push({
          nodeId: currentNode.id,
          nodeType: 'greeting',
          output: text,
          timestamp: new Date().toISOString(),
        });

        if (currentNode.next) {
          state.currentNodeId = currentNode.next;
        }

        return {
          nodeId: currentNode.id,
          nodeType: 'greeting',
          action: 'say',
          promptText: text,
          state,
        };
      }

      case 'dtmf_menu': {
        const prompt = currentNode.config.prompt || 'Please choose an option.';
        const options = currentNode.config.options || {};

        state.history.push({
          nodeId: currentNode.id,
          nodeType: 'dtmf_menu',
          output: prompt,
          timestamp: new Date().toISOString(),
        });

        return {
          nodeId: currentNode.id,
          nodeType: 'dtmf_menu',
          action: 'gather_dtmf',
          promptText: prompt,
          dtmfOptions: options,
          state,
        };
      }

      case 'ai_voice': {
        const prompt =
          currentNode.config.prompt ||
          'How can I help you today? Please speak clearly after the tone.';

        state.history.push({
          nodeId: currentNode.id,
          nodeType: 'ai_voice',
          output: prompt,
          timestamp: new Date().toISOString(),
        });

        if (currentNode.next) {
          state.currentNodeId = currentNode.next;
        }

        return {
          nodeId: currentNode.id,
          nodeType: 'ai_voice',
          action: 'gather_speech',
          promptText: prompt,
          state,
        };
      }

      case 'transfer_queue': {
        const target = currentNode.config.queueName || currentNode.config.targetPhone || 'support';
        state.isComplete = true;

        state.history.push({
          nodeId: currentNode.id,
          nodeType: 'transfer_queue',
          output: `Transferred to ${target}`,
          timestamp: new Date().toISOString(),
        });

        return {
          nodeId: currentNode.id,
          nodeType: 'transfer_queue',
          action: 'dial',
          target,
          promptText: currentNode.config.announcement || 'Please hold while we transfer you to an agent.',
          state,
        };
      }

      case 'voicemail_callback': {
        const text =
          currentNode.config.message ||
          'All agents are currently assisting other callers. We have scheduled a callback for you.';
        state.isComplete = true;

        state.history.push({
          nodeId: currentNode.id,
          nodeType: 'voicemail_callback',
          output: text,
          timestamp: new Date().toISOString(),
        });

        return {
          nodeId: currentNode.id,
          nodeType: 'voicemail_callback',
          action: 'say',
          promptText: text,
          state,
        };
      }

      case 'hangup':
      default: {
        const text = currentNode.config.message || 'Thank you for calling. Goodbye.';
        state.isComplete = true;

        state.history.push({
          nodeId: currentNode.id,
          nodeType: 'hangup',
          output: text,
          timestamp: new Date().toISOString(),
        });

        return {
          nodeId: currentNode.id,
          nodeType: 'hangup',
          action: 'hangup',
          promptText: text,
          state,
        };
      }
    }
  }
}
