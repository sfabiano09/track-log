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
/** One race = one track in one month, e.g. "dallas-2026-10". */
export const eventIdFor = (track, isoDate) => `${slug(track)}-${String(isoDate).slice(0, 7)}`;
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const eventLabel = (track, isoDate) => `${track} · ${MONTHS[+String(isoDate).slice(5, 7) - 1]} ${String(isoDate).slice(0, 4)}`;

function clean(e) { const o = {}; for (const [k, v] of Object.entries(e)) if (v !== undefined && !k.startsWith("_")) o[k] = v; return o; }

/** Saves (creates or replaces) one reading. Does not wait for the server: it is queued locally when offline. */
export function saveEntry(entry) {
  const eid = eventIdFor(entry.event, entry.date);
  const b = writeBatch(db);
  b.set(doc(db, "events", eid), { track: entry.event, label: eventLabel(entry.event, entry.date), month: String(entry.date).slice(0, 7),
    dates: arrayUnion(entry.date), updatedAt: serverTimestamp() }, { merge: true });
  b.set(doc(db, "events", eid, "entries", entry.id), { ...clean(entry), updatedAt: serverTimestamp() });
  return b.commit();
}
export function deleteEntry(entry) {
  return deleteDoc(doc(db, "events", eventIdFor(entry.event, entry.date), "entries", entry.id));
}
/** Live list of races, newest first. cb(events, {fromCache}) */
export function watchEvents(cb, onErr) {
  return onSnapshot(query(collection(db, "events"), orderBy("updatedAt", "desc")), { includeMetadataChanges: true },
    s => cb(s.docs.map(d => ({ id: d.id, ...d.data() })), { fromCache: s.metadata.fromCache }), onErr);
}
/** Live readings for one race. cb(entries, {pending, fromCache}) where pending = readings not yet uploaded. */
export function watchEntries(eventId, cb, onErr) {
  return onSnapshot(collection(db, "events", eventId, "entries"), { includeMetadataChanges: true },
    s => cb(s.docs.map(d => ({ ...d.data(), id: d.id, _pending: d.metadata.hasPendingWrites })),
      { pending: s.docs.filter(d => d.metadata.hasPendingWrites).length, fromCache: s.metadata.fromCache }), onErr);
}
