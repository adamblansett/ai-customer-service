import { Router, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { DatabaseInstance } from '@customer-service/db';
import { FlowEngine, type CallFlowGraph } from '@customer-service/core';
import { authMiddleware, requireTenantRole } from '../middleware/auth.js';

// In-memory tenant flow storage (backed by tenantId)
const tenantFlowStore: Map<string, Map<string, CallFlowGraph>> = new Map();

export function createFlowsRouter(db: DatabaseInstance): Router {
  const router = Router();

  // GET /api/v1/tenants/:tenantId/flows - List Call Flows
  router.get(
    '/:tenantId/flows',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;
      const tenantFlows = tenantFlowStore.get(tenantId);
      const flows = tenantFlows ? Array.from(tenantFlows.values()) : [];

      res.json({ flows });
    }
  );

  // POST /api/v1/tenants/:tenantId/flows - Create/Update Call Flow
  router.post(
    '/:tenantId/flows',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;
      const { name, description, startNodeId, nodes } = req.body;

      if (!name || !startNodeId || !nodes || !Array.isArray(nodes)) {
        res.status(400).json({ error: 'name, startNodeId, and nodes array are required.' });
        return;
      }

      const flowId = req.body.id || `flow_${randomUUID()}`;
      const graph: CallFlowGraph = {
        id: flowId,
        tenantId,
        name,
        description,
        startNodeId,
        nodes,
        version: 1,
        published: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      if (!tenantFlowStore.has(tenantId)) {
        tenantFlowStore.set(tenantId, new Map());
      }
      tenantFlowStore.get(tenantId)!.set(flowId, graph);

      res.status(201).json({ flow: graph });
    }
  );

  // POST /api/v1/tenants/:tenantId/flows/:flowId/test - Simulate Flow Turn
  router.post(
    '/:tenantId/flows/:flowId/test',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId, flowId } = req.params;
      const { state, input } = req.body;

      const tenantFlows = tenantFlowStore.get(tenantId);
      const graph = tenantFlows?.get(flowId);

      if (!graph) {
        res.status(404).json({ error: `Call flow ${flowId} not found.` });
        return;
      }

      const execState = state || FlowEngine.initExecution(graph);
      const step = FlowEngine.executeStep(graph, execState, input);

      res.json({ step });
    }
  );

  return router;
}
