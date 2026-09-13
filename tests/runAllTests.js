const { spawnSync } = require('child_process');
const path = require('path');

console.log('==================================================');
console.log('RUNNING WEATHERGPT COMPLETE AUTOMATED TEST SUITE');
console.log('==================================================\n');

const testFiles = [
  path.join(__dirname, 'weatherQuotaAndCache.test.js'),
  path.join(__dirname, 'weatherHistory.test.js'),
  path.join(__dirname, 'routeWeather.test.js')
];

let totalFailed = 0;

for (const file of testFiles) {
  console.log(`Executing test suite: ${path.basename(file)}`);
  const result = spawnSync(process.execPath, [file], { stdio: 'inherit', env: process.env });
  if (result.status !== 0) {
    totalFailed++;
  }
}

if (totalFailed > 0) {
  console.error(`\n[Test Runner Failure] ${totalFailed} test suite(s) failed.`);
  process.exit(1);
} else {
  console.log(`\n[Test Runner Success] All test suites passed cleanly!`);
  process.exit(0);
}