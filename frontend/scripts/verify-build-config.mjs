// Static integrity check: never import or evaluate the configuration being checked.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(resolve(directory, 'build-config-integrity.json'), 'utf8'),
);

export function verifyBuildConfig(root = resolve(directory, '..')) {
  for (const [name, expected] of Object.entries(manifest)) {
    const contents = readFileSync(resolve(root, name), 'utf8').replace(
      /\r\n/g,
      '\n',
    );
    const actual = createHash('sha256').update(contents).digest('hex');
    if (actual !== expected) {
      throw new Error(
        `Build configuration integrity failed: ${name}. Stop and review the change; do not regenerate hashes to bypass this check.`,
      );
    }
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    verifyBuildConfig();
    console.log('Reviewed build configuration hashes match.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
