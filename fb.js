// Shared Firebase connection for Track Log Live (phone) and Track Info (team page).
// The config below only identifies the project; data is protected by the
// Firestore rules (read: any signed-in login, write: the Edit login only).
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, setDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, arrayUnion, writeBatch } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDwOMi5iZjscZZf27CEwoX5ADFpoadrt3w",
  authDomain: "tasca-racing-track-log.firebaseapp.com",
  projectId: "tasca-racing-track-log",
  storageBucket: "tasca-racing-track-log.firebasestorage.app",
  messagingSenderId: "862056424342",
  appId: "1:862056424342:web:69b63a4fdaea29e590f3b7"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// Local cache: readings saved with no signal are kept on the device and upload on their own later.
const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

export const EDIT = "edit@tracklog.team", VIEW = "view@tracklog.team";
const isBadPassword = e => /invalid-credential|wrong-password|user-not-found|invalid-login|invalid-email/.test(e && e.code || "");

/** Signs in with one of the two team passwords. Resolves "edit" or "view"; rejects with code "bad-password". */
export async function login(password) {
  try { await signInWithEmailAndPassword(auth, EDIT, password); return "edit"; }
  catch (e) { if (!isBadPassword(e)) throw e; }
  try { await signInWithEmailAndPassword(auth, VIEW, password); return "view"; }
  catch (e) { if (isBadPassword(e)) { const err = new Error("That password didn't match."); err.code = "bad-password"; throw err; } throw e; }
}
export const logout = () => signOut(auth);
export const roleOf = user => !user ? null : user.email === EDIT ? "edit" : "view";
/** Calls back with "edit", "view" or null whenever the sign-in changes (including on page load). */
export function watchRole(cb) { return onAuthStateChanged(auth, u => cb(roleOf(u))); }

const slug = s => String(s || "track").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** One race = one track in one race week (Wednesday to the next Tuesday), e.g. "las-vegas-2026-10-28".
    Keeps a Thu-Sun race together even when it crosses into a new month, and a Monday rain day with it. */
export function raceWeek(isoDate) {
  const d = new Date(String(isoDate) + "T12:00:00Z"), back = (d.getUTCDay() - 3 + 7) % 7;
  d.setUTCDate(d.getUTCDate() - back); return d.toISOString().slice(0, 10);
}
export const eventIdFor = (track, isoDate) => `${slug(track)}-${raceWeek(isoDate)}`;
/** The id races had before race weeks (track + month); still read so older readings stay reachable. */
export const legacyEventIdFor = (track, isoDate) => `${slug(track)}-${String(isoDate).slice(0, 7)}`;
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const md = iso => `${MONTHS[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}`;
/** "Las Vegas · Oct 29 – Nov 1" from the race's dates. */
export function raceLabel(track, dates) {
  const ds = [...new Set(dates || [])].sort(); if (!ds.length) return track;
  const a = ds[0], b = ds[ds.length - 1];
  return `${track} · ${a === b ? md(a) : a.slice(0, 7) === b.slice(0, 7) ? md(a) + "–" + +b.slice(8, 10) : md(a) + " – " + md(b)}, ${b.slice(0, 4)}`;
}
export const eventLabel = (track, isoDate) => raceLabel(track, [isoDate]);

function clean(e) { const o = {}; for (const [k, v] of Object.entries(e)) if (v !== undefined && !k.startsWith("_")) o[k] = v; return o; }

/** Saves (creates or replaces) one reading. Does not wait for the server: it is queued locally when offline. */
export function saveEntry(entry) {
  const eid = eventIdFor(entry.event, entry.date);
  const b = writeBatch(db);
  // a reading stored under an older race id moves to its race week when it's saved again
  if (entry._eid && entry._eid !== eid) b.delete(doc(db, "events", entry._eid, "entries", entry.id));
  b.set(doc(db, "events", eid), { track: entry.event, label: eventLabel(entry.event, entry.date), month: String(entry.date).slice(0, 7),
    dates: arrayUnion(entry.date), updatedAt: serverTimestamp() }, { merge: true });
  b.set(doc(db, "events", eid, "entries", entry.id), { ...clean(entry), updatedAt: serverTimestamp() });
  return b.commit();
}
export function deleteEntry(entry) {
  return deleteDoc(doc(db, "events", entry._eid || eventIdFor(entry.event, entry.date), "entries", entry.id));
}
/** Saves many readings (an import) in groups, reporting progress. */
export async function saveMany(entries, onProgress) {
  const groups = new Map();
  for (const e of entries) { const id = eventIdFor(e.event, e.date); if (!groups.has(id)) groups.set(id, []); groups.get(id).push(e); }
  let done = 0;
  for (const [eid, list] of groups) {
    const first = list[0];
    for (let i = 0; i < list.length; i += 400) {            // Firestore allows 500 writes per batch
      const b = writeBatch(db), part = list.slice(i, i + 400);
      b.set(doc(db, "events", eid), { track: first.event, label: raceLabel(first.event, list.map(e => e.date)), month: String(first.date).slice(0, 7),
        dates: arrayUnion(...new Set(list.map(e => e.date))), updatedAt: serverTimestamp() }, { merge: true });
      for (const e of part) b.set(doc(db, "events", eid, "entries", e.id), { ...clean(e), updatedAt: serverTimestamp() });
      await b.commit(); done += part.length; onProgress && onProgress(done, entries.length);
    }
  }
}
/** Live list of races, newest first. cb(events, {fromCache}) */
export function watchEvents(cb, onErr) {
  return onSnapshot(query(collection(db, "events"), orderBy("updatedAt", "desc")), { includeMetadataChanges: true },
    s => cb(s.docs.map(d => ({ id: d.id, ...d.data() })), { fromCache: s.metadata.fromCache }), onErr);
}
/** Live readings for one race. cb(entries, {pending, fromCache}) where pending = readings not yet uploaded. */
export function watchEntries(eventId, cb, onErr) {
  return onSnapshot(collection(db, "events", eventId, "entries"), { includeMetadataChanges: true },
    s => cb(s.docs.map(d => ({ ...d.data(), id: d.id, _eid: eventId, _pending: d.metadata.hasPendingWrites })),
      { pending: s.docs.filter(d => d.metadata.hasPendingWrites).length, fromCache: s.metadata.fromCache }), onErr);
}
