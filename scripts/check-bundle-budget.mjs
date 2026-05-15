import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const DIST_ASSETS_DIR = path.resolve('dist-react', 'assets');
const KB = 1024;

const budgets = [
  { pattern: /^index-[\w-]+\.js$/, maxKb: 1600, label: 'app entry chunk' },
  { pattern: /^editor\.api2-[\w-]+\.js$/, maxKb: 4000, label: 'Monaco editor API chunk' },
  { pattern: /^ts\.worker-[\w-]+\.js$/, maxKb: 7500, label: 'TypeScript worker chunk' },
  { pattern: /^css\.worker-[\w-]+\.js$/, maxKb: 1200, label: 'CSS worker chunk' },
  { pattern: /^html\.worker-[\w-]+\.js$/, maxKb: 850, label: 'HTML worker chunk' },
  { pattern: /^json\.worker-[\w-]+\.js$/, maxKb: 500, label: 'JSON worker chunk' },
  { pattern: /^xterm-[\w-]+\.js$/, maxKb: 350, label: 'xterm chunk' },
];

const DEFAULT_JS_BUDGET_KB = 600;

function budgetFor(fileName) {
  return budgets.find((budget) => budget.pattern.test(fileName)) || {
    maxKb: DEFAULT_JS_BUDGET_KB,
    label: 'JavaScript chunk',
  };
}

function formatKb(bytes) {
  return `${Math.round(bytes / KB)} kB`;
}

if (!existsSync(DIST_ASSETS_DIR)) {
  console.error('dist-react/assets does not exist. Run `npx vite build` before checking bundle budgets.');
  process.exit(1);
}

const jsFiles = readdirSync(DIST_ASSETS_DIR)
  .filter((fileName) => fileName.endsWith('.js'))
  .sort();

const failures = [];
const measured = [];

for (const fileName of jsFiles) {
  const filePath = path.join(DIST_ASSETS_DIR, fileName);
  const size = statSync(filePath).size;
  const budget = budgetFor(fileName);
  const maxBytes = budget.maxKb * KB;

  measured.push({ fileName, size, budget });

  if (size > maxBytes) {
    failures.push({
      fileName,
      size,
      label: budget.label,
      maxKb: budget.maxKb,
    });
  }
}

if (failures.length > 0) {
  console.error('Bundle budget check failed:');
  for (const failure of failures) {
    console.error(
      `- ${failure.fileName} (${failure.label}) is ${formatKb(failure.size)}, budget ${failure.maxKb} kB`,
    );
  }
  process.exit(1);
}

const largest = [...measured]
  .sort((a, b) => b.size - a.size)
  .slice(0, 8)
  .map((entry) => `${entry.fileName} ${formatKb(entry.size)} / ${entry.budget.maxKb} kB`);

console.log('Bundle budget check passed.');
console.log('Largest chunks:');
for (const line of largest) {
  console.log(`- ${line}`);
}
