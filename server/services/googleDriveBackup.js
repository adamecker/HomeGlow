// Local-only feature (never upstream): nightly Google Drive backup of the
// HomeGlow data set. Each backup is a .tar.gz containing tasks.db, the
// .encryption-key (without it the DB's encrypted tokens are unrecoverable),
// and the uploads directory, uploaded to the connected Google account's
// Drive (drive.file scope: the app can only see files it created).
// Retention: newest 14 backups are kept.
//
// There is deliberately NO in-app restore: overwriting the live database
// under a running server is unsafe. To recover, download the tarball from
// Drive, stop the stack, extract it into the data directory, and start
// the stack again.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const googleConnection = require('./googleConnection');

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API_BASE = 'https://www.googleapis.com/upload/drive/v3';
const KEEP_BACKUPS = 14;

let backupIntervalTimer = null;

function resolveUploadsDir(dbPath) {
  if (fs.existsSync('/app/uploads')) {
    return '/app/uploads';
  }
  const serverUploads = path.resolve(path.dirname(dbPath), '..', 'uploads');
  if (fs.existsSync(serverUploads)) {
    return serverUploads;
  }
  return null;
}

async function uploadBackupToDrive(db, accountId, dbPath) {
  if (!fs.existsSync(dbPath)) {
    throw new Error('Database file not found for backup.');
  }

  // Flush the WAL into the main database file so the copy is consistent.
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (ckptErr) {
    console.warn('[DriveBackup] WAL checkpoint warning:', ckptErr.message);
  }

  const accessToken = await googleConnection.getValidAccessToken(db, accountId);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `homeglow-backup-${timestamp}.tar.gz`;
  const tmpStaging = path.join('/tmp', `backup-staging-${timestamp}`);
  const archivePath = path.join('/tmp', filename);

  try {
    fs.mkdirSync(tmpStaging, { recursive: true });
    fs.copyFileSync(dbPath, path.join(tmpStaging, 'tasks.db'));

    const keyPath = path.join(path.dirname(dbPath), '.encryption-key');
    if (fs.existsSync(keyPath)) {
      fs.copyFileSync(keyPath, path.join(tmpStaging, '.encryption-key'));
    }

    const uploadsDir = resolveUploadsDir(dbPath);
    if (uploadsDir) {
      fs.cpSync(uploadsDir, path.join(tmpStaging, 'uploads'), { recursive: true });
    }

    execFileSync('tar', ['-czf', archivePath, '-C', tmpStaging, '.']);

    const fileBuffer = fs.readFileSync(archivePath);
    const metadata = { name: filename, mimeType: 'application/gzip' };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([fileBuffer], { type: 'application/gzip' }));

    const res = await fetch(`${UPLOAD_API_BASE}/files?uploadType=multipart`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Google Drive backup upload failed (${res.status}): ${errText}`);
    }

    const result = await res.json();

    // Prune old backups beyond the retention count (list is newest-first).
    try {
      const files = await listDriveBackups(db, accountId);
      if (files.length > KEEP_BACKUPS) {
        for (const f of files.slice(KEEP_BACKUPS)) {
          await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(f.id)}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${accessToken}` },
          });
        }
      }
    } catch (pruneErr) {
      console.warn('[DriveBackup] Prune warning:', pruneErr.message);
    }

    return result;
  } finally {
    try {
      if (fs.existsSync(tmpStaging)) fs.rmSync(tmpStaging, { recursive: true, force: true });
      if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
    } catch (_) {}
  }
}

async function listDriveBackups(db, accountId) {
  const accessToken = await googleConnection.getValidAccessToken(db, accountId);
  const query = encodeURIComponent("name contains 'homeglow-backup-' and trashed = false");
  const res = await fetch(`${DRIVE_API_BASE}/files?q=${query}&fields=files(id,name,mimeType,createdTime,size)&orderBy=createdTime desc&pageSize=20`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to list Google Drive backups: ${errText}`);
  }

  const data = await res.json();
  return Array.isArray(data.files) ? data.files : [];
}

function initAutomatedBackupScheduler(db, dbPath) {
  if (backupIntervalTimer) clearInterval(backupIntervalTimer);

  let lastRunDate = null;

  backupIntervalTimer = setInterval(async () => {
    try {
      // Opt-in: automated backups run only when explicitly enabled.
      const enabledRow = db.prepare("SELECT value FROM settings WHERE key = 'DRIVE_BACKUP_AUTO_ENABLED'").get();
      if (!enabledRow || enabledRow.value !== 'true') return;

      const timeRow = db.prepare("SELECT value FROM settings WHERE key = 'DRIVE_BACKUP_TIME'").get();
      const targetTime = timeRow?.value || '02:00';
      const [targetH, targetM] = targetTime.split(':').map(Number);

      const tz = process.env.TZ || 'America/Los_Angeles';
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const parts = formatter.formatToParts(new Date());
      const getPart = (type) => parts.find((p) => p.type === type)?.value;
      const currentH = Number(getPart('hour'));
      const currentM = Number(getPart('minute'));
      const todayStr = `${getPart('year')}-${getPart('month')}-${getPart('day')}`;

      if (currentH === targetH && currentM === targetM && lastRunDate !== todayStr) {
        const account = googleConnection.getConnectedAccount(db);
        if (account) {
          console.log(`[DriveBackup] Starting scheduled backup for ${todayStr} at ${targetTime} (${tz})...`);
          await uploadBackupToDrive(db, account.id, dbPath);
          lastRunDate = todayStr;
          console.log('[DriveBackup] Scheduled backup finished successfully.');
        }
      }
    } catch (err) {
      console.error('[DriveBackup:Scheduler] Scheduled backup error:', err.message);
    }
  }, 45000);
}

module.exports = {
  uploadBackupToDrive,
  listDriveBackups,
  initAutomatedBackupScheduler,
};
