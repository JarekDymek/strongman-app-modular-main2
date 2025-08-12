
// Plik: js/persistence.js (Zmieniona wersja - async IndexedDB autosave z opcją wyłączenia)
// Cel: Zarządza utrwalaniem stanu i eksportami. Autosave przeniesiony z localStorage do IndexedDB,
// co zapobiega blokowaniu głównego wątku. Dodano opcję włączenia/wyłączenia autosave.

import { getState, restoreState, resetState, state, getLogo, getEventHistory } from './state.js';
import { showNotification, showConfirmation, DOMElements, renderFinalSummary } from './ui.js';
import { clearHistory } from './history.js';
import * as CheckpointsDB from './checkpointsDb.js';

const AUTO_SAVE_DB_KEY = 'strongman_autoSave_v1';
const AUTO_SAVE_PREF_KEY = 'strongman_autosave_enabled_v1';
const THEME_KEY = 'strongmanTheme_v12';

let autoSaveTimer = null;
let autosaveEnabled = true;
const AUTOSAVE_DELAY = 1000; // ms debounce

// --- IndexedDB helper (very small key-value store) ---
function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('strongman-db', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function idbPut(key, value) {
  const db = await openIDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    const store = tx.objectStore('kv');
    const req = store.put(value, key);
    req.onsuccess = () => res(true);
    req.onerror = (e) => rej(e.target.error);
  });
}

async function idbGet(key) {
  const db = await openIDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readonly');
    const store = tx.objectStore('kv');
    const req = store.get(key);
    req.onsuccess = () => res(req.result);
    req.onerror = (e) => rej(e.target.error);
  });
}

async function idbDelete(key) {
  const db = await openIDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    const store = tx.objectStore('kv');
    const req = store.delete(key);
    req.onsuccess = () => res(true);
    req.onerror = (e) => rej(e.target.error);
  });
}

// Theme helpers (unchanged)
export function saveTheme(themeName) { localStorage.setItem(THEME_KEY, themeName); }
export function loadTheme() { return localStorage.getItem(THEME_KEY) || 'light'; }

// --- Autosave preference ---
export function setAutosaveEnabled(flag) {
  autosaveEnabled = !!flag;
  try { localStorage.setItem(AUTO_SAVE_PREF_KEY, JSON.stringify(autosaveEnabled)); } catch(e) {}
}
export function isAutosaveEnabled() {
  try {
    const raw = localStorage.getItem(AUTO_SAVE_PREF_KEY);
    if (raw === null) return true;
    autosaveEnabled = JSON.parse(raw);
    return autosaveEnabled;
  } catch(e) { return true; }
}

// --- Autosave: debounce + async IDB save ---
let autosaveSuspended = false;

export function suspendAutosave() { autosaveSuspended = true; }
export function resumeAutosave() { autosaveSuspended = false; }

export function triggerAutoSave() {
    if (!isAutosaveEnabled()) return;
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(async () => {
        try {
            // getState() returns plain object; IDB will structured-clone it async
            const stateObj = getState();
            await idbPut(AUTO_SAVE_DB_KEY, stateObj);
            const indicator = document.getElementById('saveIndicator');
            if (indicator) {
              indicator.classList.add('visible');
              setTimeout(() => indicator.classList.remove('visible'), 1200);
            }
        } catch (e) {
            console.error('Async autosave failed', e);
            showNotification("Błąd auto-zapisu (IDB).", "error");
        } finally {
            autoSaveTimer = null;
        }
    }, AUTOSAVE_DELAY);
}

// Load state from async IDB autosave (called at startup)
export async function loadStateFromAutoSave() {
    try {
        const loaded = await idbGet(AUTO_SAVE_DB_KEY);
        if (!loaded) return false;
        if (await showConfirmation("Wykryto niezakończoną sesję. Czy chcesz ją przywrócić?")) {
            restoreState(loaded);
            showNotification("Sesja została przywrócona!", "success");
            return true;
        } else {
            // user declined -> remove autosave
            await idbDelete(AUTO_SAVE_DB_KEY);
            return false;
        }
    } catch (e) {
        console.error('Failed to load autosave from IDB', e);
        return false;
    }
}

export async function clearAutoSave() {
  try { await idbDelete(AUTO_SAVE_DB_KEY); } catch(e) { console.warn('clearAutoSave failed', e); }
}

// --- Checkpoints (existing code expects CheckpointsDB usage) ---
// Forwarding to existing CheckpointsDB
export async function getCheckpoints() {
  return CheckpointsDB.getCheckpointsDB();
}
export async function deleteCheckpoint(key) {
  return CheckpointsDB.deleteCheckpoint(key);
}

// --- Import / Export functions (keep original behavior but use IDB where appropriate) ---
export async function exportStateToFile() {
    const data = getState();
    const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `strongman-state-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

export async function importStateFromFile(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const importedData = JSON.parse(e.target.result);
                if (!importedData.competitors || !importedData.eventHistory) {
                    throw new Error("Plik nie wygląda na prawidłowy plik stanu aplikacji.");
                }
                if (await showConfirmation("Czy na pewno chcesz zaimportować stan z pliku? Spowoduje to nadpisanie bieżącej sesji.")) {
                    restoreState(importedData);
                    clearHistory();
                    showNotification("Stan pomyślnie zaimportowano!", "success");
                    resolve(true);
                } else resolve(false);
            } catch(err) {
                console.error(err);
                showNotification("Błąd przy imporcie pliku.", "error");
                resolve(false);
            }
        };
        reader.readAsText(file);
    });
}

// --- Checkpoints UI & Handlers (added) ---
/*
  Functions:
   - saveCheckpoint(eventOrName): saves current state or named checkpoint
   - handleShowCheckpoints(): fetches checkpoints and displays them in the UI
   - handleCheckpointListActions(e, refreshFullUI): handles click actions in the checkpoint list (load/delete)
   - resetApplication(): resets app state and UI
*/
export async function saveCheckpoint(eventOrName) {
    try {
        // accept either (event) or (name)
        const name = (typeof eventOrName === 'string') ? eventOrName
                    : (eventOrName && eventOrName.target && eventOrName.target.getAttribute && eventOrName.target.getAttribute('data-checkpoint-name')) ? eventOrName.target.getAttribute('data-checkpoint-name')
                    : null;
        const st = getState();
        // sanitize state to avoid DataCloneError
        function sanitize(obj, _seen = new WeakSet()) {
            if (obj === null || obj === undefined) return obj;
            if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') return obj;
            if (typeof obj === 'function') return undefined;
            if (typeof obj === 'object') {
                if (_seen.has(obj)) return undefined;
                _seen.add(obj);
                // skip DOM Nodes, Events, Window
                if (typeof Node !== 'undefined' && obj instanceof Node) return undefined;
                if (typeof Event !== 'undefined' && obj instanceof Event) return undefined;
                if (typeof Window !== 'undefined' && obj instanceof Window) return undefined;
                if (Array.isArray(obj)) {
                    return obj.map(i => sanitize(i, _seen)).filter(i => i !== undefined);
                }
                const out = {};
                for (const k of Object.keys(obj)) {
                    try {
                        const v = obj[k];
                        if (typeof v === 'function') continue;
                        if (v && typeof v === 'object' && (v.nodeType || v instanceof Event || (typeof Window !== "undefined" && v instanceof Window))) continue;
                        const sv = sanitize(v, _seen);
                        if (sv !== undefined) out[k] = sv;
                    } catch (e) {
                        continue;
                    }
                }
                return out;
            }
            return undefined;
        }
        const record = {
            name: name || ('Checkpoint ' + new Date().toISOString()),
            state: sanitize(st) || {},
            timestamp: Date.now()
        };
        await CheckpointsDB.saveCheckpoint(record);
        showNotification('Punkt kontrolny zapisany.', 'success');
    } catch (err) {
        console.error('saveCheckpoint error', err);
        showNotification('Błąd zapisu punktu kontrolnego.', 'error');
        throw err;
    }
}

export async function handleShowCheckpoints() {
    try {
        const cps = await getCheckpoints();
        const list = DOMElements.checkpointList;
        const container = DOMElements.checkpointListContainer;
        if (!list || !container) {
            showNotification('Interfejs punktów kontrolnych nie znaleziony.', 'error');
            return;
        }
        list.innerHTML = cps.map(cp => {
            const when = cp.timestamp ? (new Date(cp.timestamp)).toLocaleString() : '';
            return `<li class="checkpoint-item" data-key="${cp.key || cp.key}" style="display:flex;justify-content:space-between;align-items:center;padding:6px;border-bottom:1px solid #eee;">
                <span style="flex:1">${cp.name || 'Bez nazwy'} — <small>${when}</small></span>
                <div style="display:flex;gap:8px">
                  <button data-action="load" data-key="${cp.key}" class="btn small">Wczytaj</button>
                  <button data-action="delete" data-key="${cp.key}" class="btn small danger">Usuń</button>
                </div>
            </li>`;
        }).join('');
        container.classList.add('visible');
    } catch (err) {
        console.error('handleShowCheckpoints error', err);
        showNotification('Błąd podczas pobierania punktów kontrolnych.', 'error');
    }
}

export async function handleCheckpointListActions(e, refreshFullUI) {
    try {
        const btn = e.target.closest('button');
        if (!btn) return;
        const action = btn.getAttribute('data-action');
        const key = btn.getAttribute('data-key');
        if (!action || !key) return;
        if (action === 'delete') {
            if (!await showConfirmation('Na pewno usunąć punkt kontrolny?')) return;
            await deleteCheckpoint(key);
            showNotification('Usunięto punkt kontrolny.', 'success');
            if (typeof refreshFullUI === 'function') refreshFullUI();
            return;
        }
        if (action === 'load') {
            // fetch all checkpoints and find key
            const cps = await getCheckpoints();
            const cp = cps.find(c => (c.key == key || c.key === key));
            if (!cp) {
                showNotification('Nie znaleziono punktu kontrolnego.', 'error');
                return;
            }
            // restore sanitized state
            try {
                restoreState(cp.state);
                clearHistory();
                showNotification('Punkt kontrolny wczytany.', 'success');
                if (typeof refreshFullUI === 'function') refreshFullUI();
            } catch (e) {
                console.error('restore checkpoint failed', e);
                showNotification('Błąd przy wczytywaniu punktu kontrolnego.', 'error');
            }
            return;
        }
    } catch (err) {
        console.error('handleCheckpointListActions error', err);
        showNotification('Błąd akcji na liście punktów kontrolnych.', 'error');
    }
}

export async function resetApplication() {
    try {
        if (!await showConfirmation('Czy na pewno zresetować aplikację?')) return;
        resetState();
        clearHistory();
        showNotification('Aplikacja zresetowana.', 'info');
        // trigger UI update if available
        if (typeof window.refreshFullUI === 'function') window.refreshFullUI();
    } catch (err) {
        console.error('resetApplication error', err);
        showNotification('Błąd resetu aplikacji.', 'error');
    }
}
// --- Existing persistence logic (if any) should remain above ---
// --- Added: simple IndexedDB export helper ---
export async function exportAllDB() {
  const dbName = 'StrongmanDB_v12_Competitors'; // dopasuj jeśli inna nazwa
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName);
    req.onsuccess = e => {
      const db = e.target.result;
      const tx = db.transaction(db.objectStoreNames, 'readonly');
      const out = {};
      let remaining = db.objectStoreNames.length;
      if (remaining === 0) resolve(out);
      for (let i=0;i<db.objectStoreNames.length;i++) {
        const storeName = db.objectStoreNames[i];
        out[storeName] = [];
        const store = tx.objectStore(storeName);
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = ev => {
          const cursor = ev.target.result;
          if (cursor) {
            out[storeName].push(cursor.value);
            cursor.continue();
          } else {
            remaining--;
            if (remaining === 0) resolve(out);
          }
        };
        cursorReq.onerror = err => { console.error('Export cursor error', err); reject(err); };
      }
    };
    req.onerror = e => reject(e);
  });
}

// --- End of added checkpoint handlers ---
