// Plik: js/checkpointsDb.js
// Cel: Zarządza bazą danych IndexedDB dla punktów kontrolnych.

import { dbAction } from './db-dexie.js';


// Helper: sanitize object so it can be cloned/stored in IndexedDB.
// Removes DOM nodes, Event objects, functions, and replaces them with simple descriptors.
function sanitizeForIDB(obj, _seen = new WeakSet()) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') return obj;
    if (typeof obj === 'function') return undefined;
    if (typeof obj === 'object') {
        if (_seen.has(obj)) return undefined; // circular
        _seen.add(obj);
        // DOM nodes or Events: detect common properties
        if (typeof Node !== "undefined" && obj instanceof Node) return undefined;
        if (typeof Event !== "undefined" && obj instanceof Event) return undefined;
        // Plain Array
        if (Array.isArray(obj)) {
            return obj.map(i => sanitizeForIDB(i, _seen)).filter(i => i !== undefined);
        }
        // Plain object: copy only serializable properties
        const out = {};
        for (const k of Object.keys(obj)) {
            try {
                const v = obj[k];
                // skip functions and complex prototypes
                if (typeof v === 'function') continue;
                // skip elements that look like events or DOM refs
                if (v && typeof v === 'object' && (v.nodeType || v instanceof Element || v instanceof Window)) continue;
                const sv = sanitizeForIDB(v, _seen);
                if (sv !== undefined) out[k] = sv;
            } catch (e) {
                // skip problematic property
                continue;
            }
        }
        return out;
    }
    return undefined;
}

let checkpointsDb;
const DB_NAME = 'StrongmanCheckpointsDB';
const STORE_NAME = 'checkpoints';

export function initCheckpointsDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        
        request.onerror = function(event) {
            console.error(`Błąd bazy danych ${DB_NAME}:`, event.target.error);
            reject(event.target.error);
        };
        
        request.onsuccess = function(event) {
            checkpointsDb = event.target.result;
            resolve();
        };
        
        request.onupgradeneeded = function(event) {
            let db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'key' });
            }
        };
    });
}



// Compatibility wrappers expected by persistence.js
export async function saveCheckpoint(obj) {
    // create key if not provided
    const key = obj && obj.key ? obj.key : 'cp_' + Date.now();
    const record = { key, ...(obj || {}) };
    // use dbAction imported at top; checkpointsDb module already has dbAction available in scope
    record.state = sanitizeForIDB(record.state) || {};
        record.state = sanitizeForIDB(record.state) || {};
        return await dbAction(checkpointsDb, STORE_NAME, 'readwrite', (store, r) => store.put(r), record);
}

export async function deleteCheckpoint(key) {
    return await dbAction(checkpointsDb, STORE_NAME, 'readwrite', (store, k) => store.delete(k), key);
}

export async function saveCheckpointDB(key, data) {
    const record = { key, ...data };
    record.state = sanitizeForIDB(record.state) || {};
        record.state = sanitizeForIDB(record.state) || {};
        return await dbAction(checkpointsDb, STORE_NAME, 'readwrite', (store, r) => store.put(r), record);
}

export async function getCheckpointsDB() {
    const checkpoints = await dbAction(checkpointsDb, STORE_NAME, 'readonly', store => store.getAll());
    return checkpoints.sort((a, b) => b.key.localeCompare(a.key));
}

export async function deleteCheckpointDB(key) {
    return await dbAction(checkpointsDb, STORE_NAME, 'readwrite', (store, k) => store.delete(k), key);
}

export async function clearAllCheckpointsDB() {
    return await dbAction(checkpointsDb, STORE_NAME, 'readwrite', store => store.clear());
}