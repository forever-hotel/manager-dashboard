// Test-only access to the same reviewed SQL used for manual schema setup.
// Never imported by the application or invoked during startup.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function readSchemaSection(name: string): string {
  if (!/^[a-z]+(?:-[a-z]+)*$/.test(name))
    throw new Error('Invalid schema section name');
  const sql = readFileSync(
    resolve(__dirname, '../../deploy/forever-hotel.sql'),
    'utf8',
  );
  const start = `-- BEGIN MAD SECTION: ${name}\n`;
  const end = `-- END MAD SECTION: ${name}`;
  const normalized = sql.replace(/\r\n/g, '\n');
  const offset = normalized.indexOf(start);
  const finish = normalized.indexOf(end, offset + start.length);
  if (offset < 0 || finish < 0)
    throw new Error('Required schema section is missing');
  return `BEGIN;\n${normalized.slice(offset + start.length, finish)}\nCOMMIT;`;
}
