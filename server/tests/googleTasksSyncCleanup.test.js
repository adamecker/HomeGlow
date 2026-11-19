// Google Tasks sync must clean up after itself: a task deleted in Google,
// or completed and past its day, must not leave a chore behind in Admin —
// and a schedule Google no longer returns at all must be reconciled away.
// Checked chores stay on the wall until midnight: a completion recorded
// today keeps the chore visible; only once that day has passed is it deleted.
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const axios = require('axios');
const { encrypt } = require('../utils/encryption');
const { syncUserGoogleTasks } = require('../services/googleTasks');

const dateLocal = (d) => {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const todayLocal = () => dateLocal(new Date());
const yesterdayLocal = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return dateLocal(d);
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

function seedGoogleChore(db, title, googleTaskId, { visible = 1, dueDate = null } = {}) {
  const chore = db.prepare(
    'INSERT INTO chores (title, description, clam_value, icon) VALUES (?, ?, 0, ?)'
  ).run(title, null, '📋');
  const sched = db.prepare(
    'INSERT INTO chore_schedules (chore_id, user_id, crontab, duration, visible, due_date, google_task_id) VALUES (?, ?, NULL, ?, ?, ?, ?)'
  ).run(chore.lastInsertRowid, 4, 'day-of', visible, dueDate, googleTaskId);
  return { choreId: chore.lastInsertRowid, scheduleId: sched.lastInsertRowid };
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

test('a task deleted in Google removes its schedule and chore', async () => {
  const db = makeDb();
  const { choreId, scheduleId } = seedGoogleChore(db, 'Ask about team allergies', 'task-gone');
  const restore = stubTasksApi([{ id: 'task-gone', title: 'Ask about team allergies', deleted: true }]);
  try {
    const res = await syncUserGoogleTasks(db, 4);
    assert.equal(res.deleted, 1);
    assert.equal(db.prepare('SELECT id FROM chore_schedules WHERE id = ?').get(scheduleId), undefined);
    assert.equal(db.prepare('SELECT id FROM chores WHERE id = ?').get(choreId), undefined);
  } finally {
    restore();
    db.close();
  }
});

test('a task hidden in Google is deleted, not just hidden', async () => {
  const db = makeDb();
  const { choreId, scheduleId } = seedGoogleChore(db, 'Old hidden task', 'task-hidden');
  const restore = stubTasksApi([{ id: 'task-hidden', title: 'Old hidden task', hidden: true }]);
  try {
    const res = await syncUserGoogleTasks(db, 4);
    assert.equal(res.deleted, 1);
    assert.equal(db.prepare('SELECT id FROM chore_schedules WHERE id = ?').get(scheduleId), undefined);
    assert.equal(db.prepare('SELECT id FROM chores WHERE id = ?').get(choreId), undefined);
  } finally {
    restore();
    db.close();
  }
});

test('a deleted task keeps the chore when another schedule still uses it', async () => {
  const db = makeDb();
  const { choreId, scheduleId } = seedGoogleChore(db, 'Shared chore', 'task-gone');
  db.prepare(
    'INSERT INTO chore_schedules (chore_id, user_id, crontab, duration, visible, due_date, google_task_id) VALUES (?, ?, ?, ?, 1, NULL, NULL)'
  ).run(choreId, 4, '0 9 * * *', 'day-of');
  const restore = stubTasksApi([{ id: 'task-gone', title: 'Shared chore', deleted: true }]);
  try {
    const res = await syncUserGoogleTasks(db, 4);
    assert.equal(res.deleted, 1);
    assert.equal(db.prepare('SELECT id FROM chore_schedules WHERE id = ?').get(scheduleId), undefined);
    assert.notEqual(db.prepare('SELECT id FROM chores WHERE id = ?').get(choreId), undefined);
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM chore_schedules WHERE chore_id = ?').get(choreId).n,
      1
    );
  } finally {
    restore();
    db.close();
  }
});

test('a task completed in Google stays on the wall for the rest of the day', async () => {
  const db = makeDb();
  const { choreId, scheduleId } = seedGoogleChore(db, 'Ask Brynn lunch', 'task-done');
  const restore = stubTasksApi([{ id: 'task-done', title: 'Ask Brynn lunch', status: 'completed' }]);
  try {
    const res = await syncUserGoogleTasks(db, 4);
    assert.equal(res.deleted, 0);
    const sched = db.prepare('SELECT visible FROM chore_schedules WHERE id = ?').get(scheduleId);
    assert.equal(sched.visible, 1);
    assert.notEqual(db.prepare('SELECT id FROM chores WHERE id = ?').get(choreId), undefined);
    const completion = db.prepare(
      "SELECT date FROM chore_history WHERE chore_schedule_id = ? AND kind = 'completion'"
    ).get(scheduleId);
    assert.equal(completion.date, todayLocal());
  } finally {
    restore();
    db.close();
  }
});

test('a task completed in Google is deleted once its completion day has passed', async () => {
  const db = makeDb();
  const { choreId, scheduleId } = seedGoogleChore(db, 'Ask Brynn lunch', 'task-done');
  db.prepare(
    "INSERT INTO chore_history (user_id, chore_schedule_id, date, clam_value, title, kind) VALUES (?, ?, ?, 0, ?, 'completion')"
  ).run(4, scheduleId, yesterdayLocal(), 'Ask Brynn lunch');
  const restore = stubTasksApi([{ id: 'task-done', title: 'Ask Brynn lunch', status: 'completed' }]);
  try {
    const res = await syncUserGoogleTasks(db, 4);
    assert.equal(res.deleted, 1);
    assert.equal(db.prepare('SELECT id FROM chore_schedules WHERE id = ?').get(scheduleId), undefined);
    assert.equal(db.prepare('SELECT id FROM chores WHERE id = ?').get(choreId), undefined);
    // The completion record itself survives (clam totals are read from history).
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM chore_history WHERE kind = 'completion'").get().n,
      1
    );
  } finally {
    restore();
    db.close();
  }
});

test('a schedule Google no longer returns at all is reconciled away', async () => {
  const db = makeDb();
  const { choreId, scheduleId } = seedGoogleChore(db, 'Long gone task', 'task-vanished');
  const restore = stubTasksApi([]);
  try {
    const res = await syncUserGoogleTasks(db, 4);
    assert.equal(res.deleted, 1);
    assert.equal(db.prepare('SELECT id FROM chore_schedules WHERE id = ?').get(scheduleId), undefined);
    assert.equal(db.prepare('SELECT id FROM chores WHERE id = ?').get(choreId), undefined);
  } finally {
    restore();
    db.close();
  }
});

test('reconciliation spares schedules Google still returns', async () => {
  const db = makeDb();
  const kept = seedGoogleChore(db, 'Still here', 'task-kept');
  const gone = seedGoogleChore(db, 'Long gone task', 'task-vanished');
  const restore = stubTasksApi([{ id: 'task-kept', title: 'Still here', status: 'needsAction' }]);
  try {
    const res = await syncUserGoogleTasks(db, 4);
    assert.equal(res.deleted, 1);
    assert.notEqual(
      db.prepare('SELECT id FROM chore_schedules WHERE id = ?').get(kept.scheduleId),
      undefined
    );
    assert.equal(
      db.prepare('SELECT id FROM chore_schedules WHERE id = ?').get(gone.scheduleId),
      undefined
    );
  } finally {
    restore();
    db.close();
  }
});

// Google returns completed tasks with hidden: true — the production shape
// the original completed-task tests never used (they stubbed status only).
// A completed-and-hidden task must still get the till-midnight treatment,
// not the hidden-task deletion.
test('a task completed in Google stays on the wall even though Google returns it hidden', async () => {
  const db = makeDb();
  const { choreId, scheduleId } = seedGoogleChore(db, 'Ask Brynn lunch', 'task-done');
  const restore = stubTasksApi([{
    id: 'task-done',
    title: 'Ask Brynn lunch',
    status: 'completed',
    hidden: true,
    completed: new Date().toISOString(),
  }]);
  try {
    const res = await syncUserGoogleTasks(db, 4);
    assert.equal(res.deleted, 0);
    const sched = db.prepare('SELECT visible FROM chore_schedules WHERE id = ?').get(scheduleId);
    assert.equal(sched.visible, 1);
    assert.notEqual(db.prepare('SELECT id FROM chores WHERE id = ?').get(choreId), undefined);
    const completion = db.prepare(
      "SELECT date FROM chore_history WHERE chore_schedule_id = ? AND kind = 'completion'"
    ).get(scheduleId);
    assert.equal(completion.date, todayLocal());
  } finally {
    restore();
    db.close();
  }
});

test('a completed-and-hidden task is deleted once its completion day has passed', async () => {
  const db = makeDb();
  const { choreId, scheduleId } = seedGoogleChore(db, 'Ask Brynn lunch', 'task-done');
  db.prepare(
    "INSERT INTO chore_history (user_id, chore_schedule_id, date, clam_value, title, kind) VALUES (?, ?, ?, 0, ?, 'completion')"
  ).run(4, scheduleId, yesterdayLocal(), 'Ask Brynn lunch');
  const restore = stubTasksApi([{
    id: 'task-done',
    title: 'Ask Brynn lunch',
    status: 'completed',
    hidden: true,
    completed: `${yesterdayLocal()}T19:00:00.000Z`,
  }]);
  try {
    const res = await syncUserGoogleTasks(db, 4);
    assert.equal(res.deleted, 1);
    assert.equal(db.prepare('SELECT id FROM chore_schedules WHERE id = ?').get(scheduleId), undefined);
    assert.equal(db.prepare('SELECT id FROM chores WHERE id = ?').get(choreId), undefined);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM chore_history WHERE kind = 'completion'").get().n,
      1
    );
  } finally {
    restore();
    db.close();
  }
});

test('a task first seen already completed today is imported and shown checked', async () => {
  const db = makeDb();
  const restore = stubTasksApi([{
    id: 'task-new',
    title: 'Bring the black teddy bear',
    status: 'completed',
    hidden: true,
    completed: new Date().toISOString(),
    due: `${todayLocal()}T00:00:00.000Z`,
  }]);
  try {
    const res = await syncUserGoogleTasks(db, 4);
    assert.equal(res.imported, 1);
    const sched = db.prepare(
      'SELECT id, visible FROM chore_schedules WHERE google_task_id = ?'
    ).get('task-new');
    assert.notEqual(sched, undefined);
    assert.equal(sched.visible, 1);
    const completion = db.prepare(
      "SELECT date FROM chore_history WHERE chore_schedule_id = ? AND kind = 'completion'"
    ).get(sched.id);
    assert.equal(completion.date, todayLocal());
  } finally {
    restore();
    db.close();
  }
});

test('a task first seen already completed on an earlier day is not imported', async () => {
  const db = makeDb();
  const restore = stubTasksApi([{
    id: 'task-old',
    title: 'Done yesterday',
    status: 'completed',
    hidden: true,
    completed: `${yesterdayLocal()}T19:00:00.000Z`,
    due: `${yesterdayLocal()}T00:00:00.000Z`,
  }]);
  try {
    const res = await syncUserGoogleTasks(db, 4);
    assert.equal(res.imported, 0);
    assert.equal(
      db.prepare('SELECT id FROM chore_schedules WHERE google_task_id = ?').get('task-old'),
      undefined
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM chore_history WHERE kind = 'completion'").get().n,
      0
    );
  } finally {
    restore();
    db.close();
  }
});
