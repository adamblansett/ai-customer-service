#!/usr/bin/env node
import { getDatabase, closeDatabase, MigrationRunner, TenantRlsManager } from '@customer-service/db';

async function main() {
  const command = process.argv[2] || 'up';
  const db = await getDatabase();
  const runner = new MigrationRunner(db);

  try {
    if (command === 'up' || command === 'migrate') {
      const result = await runner.migrateUp();
      console.log(JSON.stringify({ ok: true, command: 'up', ...result }, null, 2));
    } else if (command === 'down' || command === 'rollback') {
      const result = await runner.rollbackLast();
      console.log(JSON.stringify({ ok: true, command: 'rollback', ...result }, null, 2));
    } else if (command === 'rls') {
      const result = await TenantRlsManager.applyPolicies(db);
      console.log(JSON.stringify({ ok: true, command: 'rls', ...result }, null, 2));
    } else {
      const status = await runner.status();
      console.log(JSON.stringify({ ok: true, command: 'status', ...status }, null, 2));
    }
  } finally {
    await closeDatabase();
  }
}

main().catch((err) => {
  console.error('Database migration error:', err);
  process.exit(1);
});
