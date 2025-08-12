// eventsDb.js - patched by assistant
let eventsDbInstance = null;
const DB_NAME = "StrongmanDB_v12_Events";
const DB_VERSION = 1; // bump when schema changes

export function initEventsDB() {
  return new Promise((resolve, reject) => {
    console.log("[EventsDB] Opening DB", DB_NAME, "v", DB_VERSION);
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (e) => {
      console.error("[EventsDB] open.onerror:", e.target.error);
      reject(e.target.error);
    };

    request.onblocked = (e) => {
      console.warn("[EventsDB] open.onblocked — close other tabs/windows using this DB", e);
    };

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      const oldVersion = e.oldVersion;
      const newVersion = e.newVersion || DB_VERSION;
      console.log(`[EventsDB] onupgradeneeded from ${oldVersion} to ${newVersion}`);

      if (!db.objectStoreNames.contains('events')) {
        const store = db.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
        try {
          store.createIndex('byDate', 'date', { unique: false });
        } catch (err) {
          console.warn("[EventsDB] index creation skipped:", err);
        }
        console.log("[EventsDB] created objectStore 'events' and index 'byDate'");
      }

      // Example migration hooks:
      if (oldVersion < 2) {
        // future migrations
      }
    };

    request.onsuccess = (e) => {
      eventsDbInstance = e.target.result;
      eventsDbInstance.onversionchange = () => {
        console.warn("[EventsDB] onversionchange — closing DB and reloading");
        try { eventsDbInstance.close(); } catch(_) {}
      };
      console.log("[EventsDB] open.onsuccess — DB ready");
      resolve(eventsDbInstance);
    };
  });
}

export function getEventsStore(mode = 'readonly') {
  if (!eventsDbInstance) throw new Error("EventsDB not initialized. Call initEventsDB() first.");
  const tx = eventsDbInstance.transaction('events', mode);
  return { store: tx.objectStore('events'), tx };
}


// --- Added seed function ---
/**
 * seedEventsDatabaseIfNeeded(dbInstance, sampleData)
 * - Ensures the 'events' store contains initial data if empty.
 * - Accepts optional sampleData array of event objects (without id).
 * - Returns a Promise that resolves when seeding is done (or skipped if not needed).
 */
export function seedEventsDatabaseIfNeeded(sampleData = null) {
  return new Promise((resolve, reject) => {
    if (!eventsDbInstance) {
      reject(new Error("EventsDB not initialized. Call initEventsDB() first."));
      return;
    }
    try {
      const tx = eventsDbInstance.transaction('events', 'readwrite');
      const store = tx.objectStore('events');
      const countReq = store.count();
      countReq.onsuccess = () => {
        const count = countReq.result;
        console.log("[EventsDB] events count:", count);
        if (count > 0) {
          resolve({seeded: false, reason: "already_has_data"});
          return;
        }
        // Default sample data if not provided
        const defaults = sampleData || [
          { title: "Przykładowe wydarzenie 1", date: new Date().toISOString(), meta: {} },
          { title: "Przykładowe wydarzenie 2", date: new Date().toISOString(), meta: {} }
        ];
        let added = 0;
        defaults.forEach(item => {
          const addReq = store.add(item);
          addReq.onsuccess = () => {
            added += 1;
            if (added === defaults.length) {
              resolve({seeded: true, added});
            }
          };
          addReq.onerror = (e) => {
            console.error("[EventsDB] seed add error:", e.target.error);
            // continue but note error
          };
        });
      };
      countReq.onerror = (e) => {
        console.error("[EventsDB] count error during seed check:", e.target.error);
        reject(e.target.error);
      };
      tx.onabort = (e) => {
        console.warn("[EventsDB] transaction aborted during seeding:", e);
      };
    } catch (err) {
      reject(err);
    }
  });
}
// --- end seed function ---
