// A Google task with no deadline must not get a due date on the wall.
// The sync used to stamp `today` when task.due was absent
// (targetDueDate = dueDate || today), so a dateless task showed
// "Due <today>" and got re-stamped every morning. The sync function is
// exercised directly with a stubbed Tasks API and an in-memory DB.
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const axios = require('axios');
const { encrypt } = require('../utils/encryption');
const { syncUserGoogleTasks } = require('../services/googleTasks');

const todayLocal = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE chores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT, description TEXT, clam_value INTEGER DEFAULT 0, icon TEXT
    );
    CREATE TABLE chore_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chore_id INTEGER NOT NULL, user_id INTEGER, crontab TEXT,
      duration TEXT, visible INTEGER NOT NULL DEFAULT 1,
      due_date TEXT, google_task_id TEXT
    );
    CREATE TABLE chore_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, chore_schedule_id INTEGER,
      date TEXT NOT NULL, clam_value INTEGER NOT NULL DEFAULT 0,
      title TEXT, kind TEXT
    );
    CREATE TABLE user_google_tasks_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE, google_email TEXT,
      refresh_token_enc TEXT NOT NULL, access_token_enc TEXT,
      token_expiry TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare(
    'INSERT INTO user_google_tasks_accounts (user_id, google_email, refresh_token_enc, access_token_enc, token_expiry) VALUES (?, ?, ?, ?, ?)'
  ).run(4, 'dad@example.com', encrypt('fake-refresh'), encrypt('fake-access'), '2099-01-01T00:00:00.000Z');
  return db;
}

// The Tasks API is stubbed at the axios layer: one list, whatever tasks the
// test at hand wants to return.
function stubTasksApi(taskItems) {
  const origGet = axios.get;
  const origPost = axios.post;
  axios.get = async (url) => {
    if (url.includes('/users/@me/lists')) return { data: { items: [{ id: '@default' }] } };
    if (url.includes('/lists/') && url.includes('/tasks')) return { data: { items: taskItems } };
    throw new Error(`unexpected GET ${url}`);
  };
  axios.post = async () => { throw new Error('unexpected POST: token should still be fresh'); };
  return () => { axios.get = origGet; axios.post = origPost; };
}

test('a task with no due date is imported with a null due_date', async () => {
  const db = makeDb();
  const restore = stubTasksApi([
    { id: 'task-nodate', title: 'Fix wood projects', notes: 'Bar stool, kids stool', status: 'needsAction' },
  ]);
  try {
    const res = await syncUserGoogleTasks(db, 4);
    assert.equal(res.imported, 1);
    const row = db.prepare(
      'SELECT cs.due_date, cs.visible FROM chore_schedules cs WHERE cs.google_task_id = ?'
    ).get('task-nodate');
    assert.equal(row.due_date, null);
    assert.equal(row.visible, 1);
  } finally {
    restore();
    db.close();
  }
});

test('an existing schedule is cleared to null when its task loses its due date', async () => {
  const db = makeDb();
  const chore = db.prepare(
    'INSERT INTO chores (title, description, clam_value, icon) VALUES (?, ?, 0, ?)'
  ).run('Fix wood projects', 'Bar stool, kids stool', '📋');
  // Prod state before the fix: the sync had stamped today onto the row.
  db.prepare(
    'INSERT INTO chore_schedules (chore_id, user_id, crontab, duration, visible, due_date, google_task_id) VALUES (?, ?, NULL, ?, 1, ?, ?)'
  ).run(chore.lastInsertRowid, 4, 'day-of', todayLocal(), 'task-nodate');
  const restore = stubTasksApi([
    { id: 'task-nodate', title: 'Fix wood projects', notes: 'Bar stool, kids stool', status: 'needsAction' },
  ]);
  try {
    const res = await syncUserGoogleTasks(db, 4);
    assert.equal(res.updated, 1);
    const row = db.prepare(
      'SELECT due_date, visible FROM chore_schedules WHERE google_task_id = ?'
    ).get('task-nodate');
    assert.equal(row.due_date, null);
    assert.equal(row.visible, 1);
  } finally {
    restore();
    db.close();
  }
});

test('a dated task keeps its real due date', async () => {
  const db = makeDb();
  const restore = stubTasksApi([
    { id: 'task-dated', title: 'Refill insulin', status: 'needsAction', due: '2026-11-01T00:00:00.000Z' },
    { id: 'task-future', title: 'Someday later', status: 'needsAction', due: '2099-06-01T00:00:00.000Z' },
  ]);
  try {
    const res = await syncUserGoogleTasks(db, 4);
    assert.equal(res.imported, 1);
    const dated = db.prepare(
      'SELECT due_date, visible FROM chore_schedules WHERE google_task_id = ?'
    ).get('task-dated');
    assert.equal(dated.due_date, '2026-11-01');
    assert.equal(dated.visible, 1);
    const future = db.prepare(
      'SELECT id FROM chore_schedules WHERE google_task_id = ?'
    ).get('task-future');
    assert.equal(future, undefined);
  } finally {
    restore();
    db.close();
  }
});
