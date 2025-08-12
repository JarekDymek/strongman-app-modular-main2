/* db-dexie.js - wrapper using Dexie.js providing same API as original js/db.js */
import Dexie from 'https://cdn.jsdelivr.net/npm/dexie@3.2.2/dist/dexie.mjs';
import { showNotification } from './ui.js';
import { INITIAL_COMPETITORS } from './initialData.js';

const DB_NAME = 'StrongmanDB_v12_Competitors';
const DB_VERSION = 2;

const db = new Dexie(DB_NAME);
db.version(DB_VERSION).stores({
  competitors: '++id, name' // auto-increment id and index on name
});

export function dbAction(dbInstance, storeName, mode, action, data) {
  // For compatibility; action receives Dexie table instead of IDBObjectStore
  return new Promise(async (resolve, reject) => {
    try {
      if (!db) return reject('Baza danych nie jest zainicjowana.');
      const table = db.table(storeName);
      const result = await action(table, data);
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

export async function initDB() {
  await db.open();
  await seedCompetitorsDatabaseIfNeeded();
  return db;
}

export async function getCompetitors() {
  const all = await db.table('competitors').toArray();
  return all.sort((a,b) => (a.name||'').localeCompare(b.name||'', 'pl'));
}

export async function getCompetitorById(id) {
  return await db.table('competitors').get(Number(id));
}

export async function saveCompetitor(competitorData) {
  if (competitorData.id) {
    const id = Number(competitorData.id);
    await db.table('competitors').update(id, competitorData);
    return id;
  } else {
    const newId = await db.table('competitors').add(competitorData);
    return newId;
  }
}

export async function deleteCompetitor(id) {
  await db.table('competitors').delete(Number(id));
  return true;
}

export async function seedCompetitorsDatabaseIfNeeded() {
  const count = await db.table('competitors').count();
  if (count === 0 && Array.isArray(INITIAL_COMPETITORS) && INITIAL_COMPETITORS.length) {
    await db.table('competitors').bulkAdd(INITIAL_COMPETITORS.map(c => ({...c})));
    showNotification('Wczytano początkową listę zawodników', 'info');
  }
}

export async function toBase64(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = e => reject(e);
    reader.readAsDataURL(file);
  });
}

export async function importCompetitorsFromJson(jsonData) {
  if (!Array.isArray(jsonData)) throw new Error('Nieprawidłowy format JSON');
  await db.table('competitors').clear();
  await db.table('competitors').bulkAdd(jsonData.map(c => ({...c})));
  showNotification('Baza zawodników zaimportowana.', 'success');
  return true;
}

export async function exportCompetitorsToJson() {
  const competitors = await getCompetitors();
  const dataStr = JSON.stringify(competitors, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'strongman_baza_zawodnikow.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showNotification('Baza zawodników wyeksportowana.', 'success');
}
