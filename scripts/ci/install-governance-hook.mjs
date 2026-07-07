#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const hookPath = path.join('.git', 'hooks', 'pre-push');
const hookBody = `#!/bin/sh
node scripts/ci/pre-push-governance.mjs
`;

fs.mkdirSync(path.dirname(hookPath), { recursive: true });
fs.writeFileSync(hookPath, hookBody, { encoding: 'utf8', mode: 0o755 });
console.log(`[governance-hook] installed ${hookPath}`);
