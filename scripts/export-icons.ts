// Writes every icon as a standalone SVG for designers and other tools: npm run icons
import { mkdirSync, writeFileSync } from 'node:fs';
import { ICONS, STATUS, iconSvg, statusSvg, type IconName, type StatusName } from '../src/icons/defs';

const NAV: IconName[] = ['home', 'history', 'meals', 'products', 'advanced', 'more'];
const nav = 'public/assets/06_navigation', status = 'public/assets/07_status';
mkdirSync(nav, { recursive: true });
mkdirSync(status, { recursive: true });

let n = 0;
for (const name of Object.keys(ICONS) as IconName[]) {
  const dir = name.startsWith('trend_') ? status : nav;
  const base = name.startsWith('trend_') ? `st_${name}` : `ic_${name}`;
  writeFileSync(`${dir}/${base}.svg`, iconSvg(name) + '\n'); n++;
  if (NAV.includes(name)) { writeFileSync(`${dir}/${base}_active.svg`, iconSvg(name, { active: true }) + '\n'); n++; }
}
for (const name of Object.keys(STATUS) as StatusName[]) { writeFileSync(`${status}/st_${name}.svg`, statusSvg(name) + '\n'); n++; }
console.log(`wrote ${n} icons`);
