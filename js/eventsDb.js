// js/eventsDb.js - unified Dexie-backed events store
import { showNotification } from './ui.js';
import { INITIAL_EVENTS } from './initialData.js';
import { dbAction } from './db-dexie.js';

export async function getEvents() {
  return await dbAction(null, 'events', 'readonly', async (store) => {
    // Dexie table: use toArray
    return await store.toArray();
  });
}

export async function saveEvent(eventData) {
  // if id present, use put, else add
  return await dbAction(null, 'events', 'readwrite', (store, data) => {
    if (data.id !== undefined && data.id !== null) {
      return store.put(data);
    } else {
      return store.add(data);
    }
  }, eventData);
}

export async function addEvent(eventData) {
  return await dbAction(null, 'events', 'readwrite', (store, data) => store.add(data), eventData);
}

export async function deleteEvent(id) {
  return await dbAction(null, 'events', 'readwrite', (store, key) => store.delete(key), id);
}

export async function clearEventsDatabase() {
  await dbAction(null, 'events', 'readwrite', (store) => store.clear());
  showNotification('Baza konkurencji została wyczyszczona.', 'info', 3000);
}

export async function seedEventsDatabaseIfNeeded() {
  const events = await getEvents();
  if ((!events || events.length === 0) && INITIAL_EVENTS && INITIAL_EVENTS.length > 0) {
    showNotification('Wypełniam bazę początkowymi konkurencjami...', 'info', 4000);
    await Promise.all(INITIAL_EVENTS.map(e => saveEvent(e)));
    showNotification('Baza konkurencji wypełniona domyślnymi konkurencjami.', 'success', 2500);
  }
}

export async function importEventsFromJson(jsonArray) {
  if (!Array.isArray(jsonArray)) throw new Error('importEventsFromJson expects an array');
  // optionally clear existing and add all
  await clearEventsDatabase();
  await Promise.all(jsonArray.map(e => addEvent(e)));
  showNotification('Zaimportowano konkurencje z pliku JSON.', 'success', 2500);
}
