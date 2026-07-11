// Web Push (PWA notifikace). VAPID klíče se vygenerují jednou a uloží do DB,
// takže není potřeba nic ručně nastavovat. Rozesílá notifikace a čistí mrtvé odběry.

import webpush from 'web-push';
import { getSetting, setSetting, listPushSubs, removePushSub } from './db.js';

let ready = false;
let publicKey = null;

export async function initPush() {
  try {
    let keys = await getSetting('vapid');
    if (!keys?.publicKey || !keys?.privateKey) {
      keys = webpush.generateVAPIDKeys();
      await setSetting('vapid', keys);
    }
    publicKey = keys.publicKey;
    const contact = process.env.PUSH_CONTACT || 'mailto:tempo@example.com';
    webpush.setVapidDetails(contact, keys.publicKey, keys.privateKey);
    ready = true;
    console.log('Push: připraveno');
  } catch (err) {
    console.error('Push init selhal:', err.message);
  }
}

export function pushReady() {
  return ready;
}
export function vapidPublicKey() {
  return publicKey;
}

// Rozešle notifikaci všem odběrům; mrtvé odběry (404/410) smaže.
export async function sendToAll(payload) {
  if (!ready) return { sent: 0 };
  const subs = await listPushSubs();
  let sent = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload));
        sent++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await removePushSub(sub.endpoint);
        } else {
          console.error('push send error:', err.statusCode || err.message);
        }
      }
    })
  );
  return { sent };
}
