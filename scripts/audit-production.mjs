import { spawnSync } from 'node:child_process';

const allowedAdvisories = new Map([
  [
    'https://github.com/advisories/GHSA-mh99-v99m-4gvg',
    'Inherited through Apify/Crawlee; npm offers only a breaking Apify 3-to-2 downgrade.',
  ],
]);

const npmCommand = process.platform === 'win32' ? process.env.ComSpec : 'npm';
const npmArguments = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'npm audit --omit=dev --json']
  : ['audit', '--omit=dev', '--json'];
const audit = spawnSync(npmCommand, npmArguments, {
  encoding: 'utf8',
  shell: false,
});

if (audit.error) {
  throw audit.error;
}

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  process.stderr.write(audit.stdout);
  process.stderr.write(audit.stderr);
  throw new Error('npm audit did not return valid JSON.');
}

if (report.auditReportVersion !== 2 || !report.vulnerabilities) {
  process.stderr.write(audit.stderr);
  throw new Error(`npm audit failed: ${report.message ?? 'missing vulnerability report'}`);
}

const vulnerabilities = report.vulnerabilities ?? {};
const blockingSeverities = new Set(['high', 'critical']);

function rootAdvisories(name, visited = new Set()) {
  if (visited.has(name)) return new Set();
  visited.add(name);

  const vulnerability = vulnerabilities[name];
  if (!vulnerability) return new Set();

  const roots = new Set();
  for (const cause of vulnerability.via ?? []) {
    if (typeof cause === 'string') {
      for (const root of rootAdvisories(cause, visited)) roots.add(root);
    } else if (blockingSeverities.has(cause.severity) && cause.url) {
      roots.add(cause.url);
    }
  }
  return roots;
}

const blocked = [];
const allowed = new Set();

for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
  if (!blockingSeverities.has(vulnerability.severity)) continue;

  const roots = rootAdvisories(name);
  if (roots.size === 0) {
    blocked.push(`${name}: no traceable advisory URL`);
    continue;
  }

  for (const root of roots) {
    if (allowedAdvisories.has(root)) allowed.add(root);
    else blocked.push(`${name}: ${root}`);
  }
}

if (blocked.length > 0) {
  console.error('Unapproved high or critical production vulnerabilities:');
  for (const item of [...new Set(blocked)]) console.error(`- ${item}`);
  process.exit(1);
}

if (allowed.size > 0) {
  console.log('Only explicitly reviewed upstream advisories remain:');
  for (const advisory of allowed) {
    console.log(`- ${advisory}: ${allowedAdvisories.get(advisory)}`);
  }
} else {
  console.log('No high or critical production vulnerabilities found.');
}
