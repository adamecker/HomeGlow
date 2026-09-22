const path = require('path');
const googleConnection = require('../services/googleConnection');
const driveBackup = require('../services/googleDriveBackup');

module.exports = async function (fastify, opts) {
  const db = opts.db;
  const dbPath = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.resolve(__dirname, '../data/tasks.db');

  driveBackup.initAutomatedBackupScheduler(db, dbPath);

  fastify.get('/api/backup/drive/status', async (request, reply) => {
    try {
      const getSetting = (key) => {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
        return row ? row.value : null;
      };

      const enabledVal = getSetting('DRIVE_BACKUP_AUTO_ENABLED');
      return {
        autoEnabled: enabledVal === null ? true : enabledVal === 'true',
        backupTime: getSetting('DRIVE_BACKUP_TIME') || '02:00',
        serverTimezone: process.env.TZ || 'America/Los_Angeles',
      };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  fastify.post('/api/backup/drive/config', async (request, reply) => {
    const { autoEnabled, backupTime } = request.body || {};
    const upsert = db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);

    try {
      db.transaction(() => {
        if (typeof autoEnabled !== 'undefined') {
          upsert.run('DRIVE_BACKUP_AUTO_ENABLED', autoEnabled ? 'true' : 'false');
        }
        if (typeof backupTime !== 'undefined') {
          upsert.run('DRIVE_BACKUP_TIME', String(backupTime).trim());
        }
      })();
      return { success: true };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  fastify.get('/api/backup/drive/list', async (request, reply) => {
    try {
      const account = googleConnection.getConnectedAccount(db);
      if (!account) return reply.status(404).send({ error: 'No Google account connected.' });
      const files = await driveBackup.listDriveBackups(db, account.id);
      return { files };
    } catch (err) {
      fastify.log.error(`[DriveBackup] List failed: ${err.message}`);
      return reply.code(500).send({ error: err.message });
    }
  });

  fastify.post('/api/backup/drive/upload', async (request, reply) => {
    try {
      const account = googleConnection.getConnectedAccount(db);
      if (!account) return reply.status(404).send({ error: 'No Google account connected.' });
      const result = await driveBackup.uploadBackupToDrive(db, account.id, dbPath);
      return { success: true, file: result };
    } catch (err) {
      fastify.log.error(`[DriveBackup] Upload failed: ${err.message}`);
      return reply.code(500).send({ error: err.message });
    }
  });

  fastify.post('/api/backup/drive/restore', async (request, reply) => {
    const { fileId } = request.body || {};
    if (!fileId) return reply.code(400).send({ error: 'fileId is required.' });

    try {
      const account = googleConnection.getConnectedAccount(db);
      if (!account) return reply.status(404).send({ error: 'No Google account connected.' });

      await driveBackup.restoreBackupFromDrive(db, account.id, fileId, dbPath);
      return { success: true, message: 'Database restored successfully.' };
    } catch (err) {
      fastify.log.error(`[DriveBackup] Restore failed: ${err.message}`);
      return reply.code(500).send({ error: err.message });
    }
  });
};
