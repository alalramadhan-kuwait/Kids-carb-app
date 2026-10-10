// Tests for server-side helpers (supabase/functions) that have no screen of their own. Run by `npm test`.
import assert from 'node:assert/strict';
import { sensorFrom, sensorToStore, sensorReminderDue } from '../../../supabase/functions/carb-glucose/lib';

let n = 0;
const test = (name: string, fn: () => void) => { fn(); n++; console.log('  ok', name); };
console.log('sensor detection from LibreLinkUp');

const OLD = { sn: 'OLD0SERIAL', a: 1790496558, pt: 3 };   // 27 Sep 2026 08:09 UTC
const NEW = { sn: 'NEW0SERIAL', a: 1791652511, pt: 3 };   // 10 Oct 2026 17:15 UTC
const NOW = Date.UTC(2026, 9, 10, 18, 40);
const iso = (a: number) => new Date(a * 1000).toISOString();

test('a sensor change: activeSensors still lists the old one, connection has the new one → the new one', () => {
  // the shape of the real graph reply on 10 Oct 2026, serials replaced
  const reply = { connection: { sensor: NEW }, activeSensors: [{ sensor: OLD, device: {} }], graphData: [] };
  assert.deepEqual(sensorFrom(reply, NOW), { sn: 'NEW0SERIAL', started_at: iso(NEW.a) });
});
test('the newest activation wins whichever list it is in, and in any order', () => {
  assert.equal(sensorFrom({ connection: { sensor: OLD }, activeSensors: [{ sensor: NEW }] }, NOW)!.sn, 'NEW0SERIAL');
  assert.equal(sensorFrom({ activeSensors: [{ sensor: NEW }, { sensor: OLD }] }, NOW)!.sn, 'NEW0SERIAL');
  assert.equal(sensorFrom({ activeSensors: [{ sensor: OLD }, { sensor: NEW }] }, NOW)!.sn, 'NEW0SERIAL');
});
test('a candidate needs a real activation time: missing, zero, before 2017 or in the future is ignored', () => {
  assert.equal(sensorFrom({ connection: { sensor: { sn: 'X', a: 0 } } }, NOW), null);
  assert.equal(sensorFrom({ connection: { sensor: { sn: 'X' } } }, NOW), null);
  assert.equal(sensorFrom({ connection: { sensor: { sn: 'X', a: 'soon' } } }, NOW), null);
  const future = { sn: 'FUTURE', a: NOW / 1000 + 3600 };
  assert.equal(sensorFrom({ connection: { sensor: future }, activeSensors: [{ sensor: OLD }] }, NOW)!.sn, 'OLD0SERIAL', 'a time an hour ahead is not trusted');
});
test('identity: the serial when sent, else the activation time (Libre 2 may send none)', () => {
  assert.deepEqual(sensorFrom({ activeSensors: [{ sensor: { a: 1790507358, pt: 3 } }] }, NOW), { sn: 'a1790507358', started_at: '2026-09-27T11:09:18.000Z' });
  assert.equal(sensorFrom({ connection: { sensor: { sn: '  ', a: NEW.a } } }, NOW)!.sn, `a${NEW.a}`);
  assert.equal(sensorFrom([{ sensor: NEW }], NOW)!.sn, 'NEW0SERIAL', 'the connections reply (a list) still works');
});
test('never step back to an older sensor than the one stored', () => {
  assert.equal(sensorToStore({ sn: 'OLD0SERIAL', started_at: iso(OLD.a) }, iso(NEW.a)), null);
  assert.deepEqual(sensorToStore({ sn: 'NEW0SERIAL', started_at: iso(NEW.a) }, iso(OLD.a)), { sn: 'NEW0SERIAL', started_at: iso(NEW.a) });
  assert.equal(sensorToStore({ sn: 'NEW0SERIAL', started_at: iso(NEW.a) }, iso(NEW.a))!.sn, 'NEW0SERIAL', 'the same sensor is kept');
  assert.equal(sensorToStore({ sn: 'NEW0SERIAL', started_at: iso(NEW.a) }, null)!.sn, 'NEW0SERIAL', 'nothing stored yet');
  assert.equal(sensorToStore(null, iso(OLD.a)), null);
});
test('expiry reminders follow the new sensor: none left for the old one', () => {
  const newStart = iso(NEW.a);
  assert.equal(sensorReminderDue(newStart, 14, 'NEW0SERIAL', 'OLD0SERIAL:24', NOW), null, 'the new sensor has 14 days left');
  const ends = NEW.a * 1000 + 14 * 86400000;
  assert.equal(sensorReminderDue(newStart, 14, 'NEW0SERIAL', 'OLD0SERIAL:24', ends - 23 * 3600000), '24', 'its own 24-hour reminder comes later');
});

console.log(`\n${n} server tests passed`);
