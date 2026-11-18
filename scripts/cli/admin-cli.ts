#!/usr/bin/env node
/**
 * Interactive CLI Admin, QA Benchmark & Key Rotation Tool
 * Usage:
 *   npm run cli -- status
 *   npm run cli -- eval [tenantId]
 *   npm run cli -- wfm-forecast [callsPerHour] [ahtSeconds]
 *   npm run cli -- rotate-keys
 */

import { getDatabase, seedDatabase, closeDatabase } from '@customer-service/db';
import {
  AiEvalRunner,
  WorkforceManager,
  BUILT_IN_OPEN_WEIGHT_MODELS,
  BUILT_IN_STT_MODELS,
  BUILT_IN_TTS_MODELS,
  BUILT_IN_VISION_MODELS,
  encryptCredential,
  decryptCredential,
} from '@customer-service/core';

async function main() {
  const [command = 'status', arg1, arg2] = process.argv.slice(2);
  const db = await getDatabase({ useEmbedded: !process.env.DATABASE_URL });
  const seeded = await seedDatabase(db);

  if (command === 'status') {
    console.log('===============================================================');
    console.log(' AI Customer Service & Contact Center Platform — Admin CLI');
    console.log('===============================================================');
    console.log(`Active Default Tenant : ${seeded.tenant1Id}`);
    console.log(
      `Built-In LLM Presets  : ${Object.keys(BUILT_IN_OPEN_WEIGHT_MODELS).join(', ')}`
    );
    console.log(`Built-In STT Presets  : ${Object.keys(BUILT_IN_STT_MODELS).join(', ')}`);
    console.log(`Built-In TTS Presets  : ${Object.keys(BUILT_IN_TTS_MODELS).join(', ')}`);
    console.log(`Built-In Vision Models: ${Object.keys(BUILT_IN_VISION_MODELS).join(', ')}`);
  } else if (command === 'eval') {
    const tenantId = arg1 || seeded.tenant1Id;
    const runner = new AiEvalRunner(db);
    const report = await runner.runEvaluationSuite(tenantId);
    console.log(`\nGolden QA & Red-Team Suite (${report.activeModel}) — Score: ${report.overallScorePercent}% (${report.passedCount}/${report.totalCount})`);
    for (const r of report.results) {
      console.log(`  [${r.passed ? 'PASS' : 'FAIL'}] ${r.name} (${r.latencyMs}ms) -> ${r.details}`);
    }
  } else if (command === 'wfm-forecast') {
    const callsPerHour = Number(arg1 || 120);
    const ahtSeconds = Number(arg2 || 180);
    const wfm = new WorkforceManager(db);
    const forecast = wfm.calculateErlangCStaffing({ callsPerHour, averageHandleTimeSeconds: ahtSeconds });
    console.log('\nErlang-C Staffing Forecast (80/20 SLA):');
    console.log(JSON.stringify(forecast, null, 2));
  } else if (command === 'rotate-keys') {
    const sampleEncrypted = encryptCredential(JSON.stringify({ apiKey: 'sk-sample-key' }), undefined, 1);
    const decrypted = decryptCredential(sampleEncrypted);
    const rotated = encryptCredential(decrypted, undefined, 2);
    console.log(
      `Rotated AES-256-GCM master key (v1 -> v${rotated.keyVersion}). Verified tag: ${rotated.authTag.slice(0, 12)}...`
    );
  } else {
    console.log(`Unknown command '${command}'. Supported: status | eval | wfm-forecast | rotate-keys`);
  }

  await closeDatabase();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
