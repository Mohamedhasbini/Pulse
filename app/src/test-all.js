// Runs every platform test. Nothing is released unless this passes.
//   docker compose exec app npm test
import { spawnSync } from 'node:child_process';
const suites = [['Client data separation', 'isolation-test.js'], ['End-to-end platform', 'smoke-test.js'], ['Client websites', 'site-test.js']];
let failed = 0;
for (const [name, file] of suites) {
  console.log(`\n=== ${name} ===`);
  const r = spawnSync(process.execPath, [new URL(file, import.meta.url).pathname], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n✗ ${failed} of ${suites.length} test suites FAILED. Do not release.` : `\n✓ All ${suites.length} test suites passed.`);
process.exit(failed ? 1 : 0);
