const fs = require('fs');
const path = require('path');
const googleConnection = require('./googleConnection');

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API_BASE = 'https://www.googleapis.com/upload/drive/v3';

let backupIntervalTimer = null;

async function uploadBackupToDrive(db, accountId, dbPath) {
  if (!fs.existsSync(dbPath)) {
    throw new Error('Database file not found for backup.');
  }

  const accessToken = await googleConnection.getValidAccessToken(db, accountId);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `homeglow-backup-${timestamp}.db`;

  const metadata = {
    name: filename,
    mimeType: 'application/x-sqlite3',
  };

  const fileBuffer = fs.readFileSync(dbPath);
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([fileBuffer], { type: 'application/x-sqlite3' }));

  const res = await fetch(`${UPLOAD_API_BASE}/files?uploadType=multipart`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: form,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Drive backup upload failed (${res.status}): ${errText}`);
  }

  const result = await res.json();

  // Prune older backups, keeping the most recent 14 snapshots
  try {
    const files = await listDriveBackups(db, accountId);
    if (files.length > 14) {
      const toDelete = files.slice(14);
      for (const f of toDelete) {
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

async function restoreBackupFromDrive(db, accountId, fileId, targetDbPath) {
  const accessToken = await googleConnection.getValidAccessToken(db, accountId);
  const res = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to download backup file from Drive: ${errText}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());

  if (fs.existsSync(targetDbPath)) {
    fs.copyFileSync(targetDbPath, `${targetDbPath}.bak`);
  }

  fs.writeFileSync(targetDbPath, buffer);
  return { success: true };
}

function initAutomatedBackupScheduler(db, dbPath) {
  if (backupIntervalTimer) clearInterval(backupIntervalTimer);

  let lastRunDate = null;

  backupIntervalTimer = setInterval(async () => {
    try {
      const enabledRow = db.prepare("SELECT value FROM settings WHERE key = 'DRIVE_BACKUP_AUTO_ENABLED'").get();
      // Default to enabled if not explicitly disabled
      const isEnabled = enabledRow ? enabledRow.value === 'true' : true;
      if (!isEnabled) return;

      const timeRow = db.prepare("SELECT value FROM settings WHERE key = 'DRIVE_BACKUP_TIME'").get();
      const targetTime = timeRow?.value || '02:00'; // Default 2:00 AM local time
      const [targetH, targetM] = targetTime.split(':').map(Number);

      const tz = process.env.TZ || 'America/Los_Angeles';
      const now = new Date();
      // Resolve time formatted in local timezone
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const parts = formatter.formatToParts(now);
      const getPart = (type) => parts.find(p => p.type === type)?.value;
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
  restoreBackupFromDrive,
  initAutomatedBackupScheduler,
};
