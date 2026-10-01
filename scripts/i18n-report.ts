// npx tsx scripts/i18n-report.ts src/pages/More.tsx src/pages/Alerts.tsx … → i18n problems in those files only.
import { checkI18n } from '../src/i18n/check';
const want = process.argv.slice(2);
const r = checkI18n(new URL('../src/', import.meta.url).pathname);
const mine = (s: string) => !want.length || want.some((w) => s.includes(w));
let n = 0;
for (const [k, list] of Object.entries(r)) for (const s of list.filter(mine)) { console.log(k.padEnd(8), s.replace(/^.*?src\//, 'src/')); n++; }
console.log(n ? `${n} problems` : 'clean');
process.exit(n ? 1 : 0);
