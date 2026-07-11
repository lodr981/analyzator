// Denní připomínka: když Oliver dnes nic nenahrál ani neodcvičil, pošli push.

import { listActivities, getRoutine } from './db.js';
import { sendToAll } from './push.js';

const today = () => new Date().toISOString().slice(0, 10);

export async function dailyReminderCheck() {
  const t = today();
  const acts = await listActivities().catch(() => []);
  const anyToday = acts.some(
    (a) => new Date(a.summary?.startTime || a.ts).toISOString().slice(0, 10) === t
  );
  const routine = await getRoutine().catch(() => ({}));
  const routineDone = (routine[t] || []).length;

  if (!anyToday && routineDone === 0) {
    return sendToAll({ title: 'TEMPO', body: 'Olivere, dnešní trénink ani rutinu ještě nevidím 👀 Nezapomeň! 💪' });
  }
  if (!anyToday) {
    return sendToAll({ title: 'TEMPO', body: 'Rutinu máš hotovou, ale dnešní trénink ještě nevidím. Nahraj ho 🚴' });
  }
  if (routineDone === 0) {
    return sendToAll({ title: 'TEMPO', body: 'Trénink hotový 👍 Nezapomeň ještě na denní rutinu — core a protažení. 🤸' });
  }
  return { sent: 0, skipped: true };
}
