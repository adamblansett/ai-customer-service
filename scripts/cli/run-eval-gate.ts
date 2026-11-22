#!/usr/bin/env node
import { getDatabase, closeDatabase, seedDatabase } from '@customer-service/db';
import { AiEvalRunner } from '@customer-service/core';

async function main() {
  const db = await getDatabase({ useEmbedded: true });
  try {
    await seedDatabase(db);
    const runner = new AiEvalRunner(db);
    const report = await runner.runEvaluationSuite('tenant_acme_hvac_001');
    console.log(JSON.stringify(report, null, 2));

    if (report.overallScorePercent < 95) {
      console.error(
        `AI Eval Regression Gate FAILED: ${report.overallScorePercent}% < 95% required threshold.`
      );
      process.exit(1);
    }
    console.log(`AI Eval Regression Gate PASSED (${report.overallScorePercent}%).`);
  } finally {
    await closeDatabase();
  }
}

main().catch((err) => {
  console.error('Eval gate error:', err);
  process.exit(1);
});
