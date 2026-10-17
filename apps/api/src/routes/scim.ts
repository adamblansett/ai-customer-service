import { Router, Request, Response } from 'express';
import type { DatabaseInstance } from '@customer-service/db';
import { ScimProvisioner } from '@customer-service/core';
import { authMiddleware, requireTenantRole } from '../middleware/auth.js';

export function createScimRouter(db: DatabaseInstance): Router {
  const router = Router();
  const provisioner = new ScimProvisioner(db);

  // Set SCIM Content-Type header on all responses
  router.use((_req, res, next) => {
    res.setHeader('Content-Type', 'application/scim+json');
    next();
  });

  // GET /api/v1/scim/v2/:tenantId/Users - List Users (RFC 7644)
  router.get(
    '/:tenantId/Users',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;
      const startIndex = parseInt(req.query.startIndex as string, 10) || 1;
      const count = parseInt(req.query.count as string, 10) || 50;

      try {
        const list = await provisioner.listUsers(tenantId, startIndex, count);
        res.status(200).json(list);
      } catch (err: any) {
        res.status(500).json({
          schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
          status: '500',
          detail: err.message || 'SCIM user listing failed',
        });
      }
    }
  );

  // GET /api/v1/scim/v2/:tenantId/Users/:id - Get User by ID
  router.get(
    '/:tenantId/Users/:id',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId, id } = req.params;

      try {
        const user = await provisioner.getUser(tenantId, id);
        if (!user) {
          res.status(404).json({
            schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
            status: '404',
            detail: `User ${id} not found`,
          });
          return;
        }

        res.status(200).json(user);
      } catch (err: any) {
        res.status(500).json({
          schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
          status: '500',
          detail: err.message,
        });
      }
    }
  );

  // POST /api/v1/scim/v2/:tenantId/Users - Create / Provision User
  router.post(
    '/:tenantId/Users',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;

      try {
        const created = await provisioner.createUser(tenantId, req.body);
        res.status(201).json(created);
      } catch (err: any) {
        res.status(400).json({
          schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
          status: '400',
          detail: err.message || 'SCIM user creation failed',
        });
      }
    }
  );

  // PATCH /api/v1/scim/v2/:tenantId/Users/:id - Patch User (Deactivation/Role change)
  router.patch(
    '/:tenantId/Users/:id',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId, id } = req.params;
      const operations = req.body.Operations || [];

      try {
        const patched = await provisioner.patchUser(tenantId, id, operations);
        res.status(200).json(patched);
      } catch (err: any) {
        res.status(400).json({
          schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
          status: '400',
          detail: err.message,
        });
      }
    }
  );

  // DELETE /api/v1/scim/v2/:tenantId/Users/:id - Deprovision User
  router.delete(
    '/:tenantId/Users/:id',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId, id } = req.params;

      try {
        const deleted = await provisioner.deleteUser(tenantId, id);
        if (!deleted) {
          res.status(404).json({
            schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
            status: '404',
            detail: `User ${id} not found for deletion`,
          });
          return;
        }

        res.status(204).send();
      } catch (err: any) {
        res.status(500).json({
          schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
          status: '500',
          detail: err.message,
        });
      }
    }
  );

  return router;
}
