import { Router, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { eq, and, desc } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import { FlowEngine, type CallFlowGraph, type FlowNode } from '@customer-service/core';
import { authMiddleware, requireTenantRole } from '../middleware/auth.js';

export function createFlowsRouter(db: DatabaseInstance): Router {
  const router = Router();

  // GET /api/v1/tenants/:tenantId/flows - List Call Flows from PostgreSQL
  router.get(
    '/:tenantId/flows',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;

      const rows = await db
        .select()
        .from(schema.callFlows)
        .where(eq(schema.callFlows.tenantId, tenantId))
        .orderBy(desc(schema.callFlows.updatedAt));

      const flows: CallFlowGraph[] = rows.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        name: r.name,
        description: r.description || undefined,
        startNodeId: r.startNodeId,
        nodes: (r.nodes as FlowNode[]) || [],
        version: r.version,
        published: r.published,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      }));

      res.json({ flows });
    }
  );

  // POST /api/v1/tenants/:tenantId/flows - Create/Update Call Flow in PostgreSQL
  router.post(
    '/:tenantId/flows',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;
      const { id, name, description, startNodeId, nodes } = req.body;

      if (!name || !startNodeId || !nodes || !Array.isArray(nodes)) {
        res.status(400).json({ error: 'name, startNodeId, and nodes array are required.' });
        return;
      }

      const flowId = id || `flow_${randomUUID()}`;

      // Check if flow exists for upsert
      const [existing] = await db
        .select()
        .from(schema.callFlows)
        .where(and(eq(schema.callFlows.id, flowId), eq(schema.callFlows.tenantId, tenantId)));

      let saved;
      if (existing) {
        const [updated] = await db
          .update(schema.callFlows)
          .set({
            name,
            description: description || null,
            startNodeId,
            nodes,
            version: existing.version + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(schema.callFlows.id, flowId), eq(schema.callFlows.tenantId, tenantId)))
          .returning();
        saved = updated;
      } else {
        const [inserted] = await db
          .insert(schema.callFlows)
          .values({
            id: flowId,
            tenantId,
            name,
            description: description || null,
            startNodeId,
            nodes,
            version: 1,
            published: true,
          })
          .returning();
        saved = inserted;
      }

      const graph: CallFlowGraph = {
        id: saved.id,
        tenantId: saved.tenantId,
        name: saved.name,
        description: saved.description || undefined,
        startNodeId: saved.startNodeId,
        nodes: (saved.nodes as FlowNode[]) || [],
        version: saved.version,
        published: saved.published,
        createdAt: saved.createdAt.toISOString(),
        updatedAt: saved.updatedAt.toISOString(),
      };

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

      const [row] = await db
        .select()
        .from(schema.callFlows)
        .where(and(eq(schema.callFlows.id, flowId), eq(schema.callFlows.tenantId, tenantId)));

      if (!row) {
        res.status(404).json({ error: `Call flow ${flowId} not found.` });
        return;
      }

      const graph: CallFlowGraph = {
        id: row.id,
        tenantId: row.tenantId,
        name: row.name,
        description: row.description || undefined,
        startNodeId: row.startNodeId,
        nodes: (row.nodes as FlowNode[]) || [],
        version: row.version,
        published: row.published,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };

      const execState = state || FlowEngine.initExecution(graph);
      const step = FlowEngine.executeStep(graph, execState, input);

      res.json({ step });
    }
  );

  return router;
}
