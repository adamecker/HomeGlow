const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const googleConnection = require('./googleConnection');

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API_BASE = 'https://www.googleapis.com/upload/drive/v3';

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

  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    console.log('[DriveBackup] Successfully checkpointed WAL into main database.');
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
    if (uploadsDir && fs.existsSync(uploadsDir)) {
      execSync(`cp -r "${uploadsDir}" "${path.join(tmpStaging, 'uploads')}"`);
    }

    execSync(`tar -czf "${archivePath}" -C "${tmpStaging}" .`);

    const fileBuffer = fs.readFileSync(archivePath);
    const metadata = {
      name: filename,
      mimeType: 'application/gzip',
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([fileBuffer], { type: 'application/gzip' }));

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
  const isTarGz = buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;

  const dataDir = path.dirname(targetDbPath);
  const uploadsDir = resolveUploadsDir(targetDbPath);

  if (fs.existsSync(targetDbPath)) {
    fs.copyFileSync(targetDbPath, `${targetDbPath}.bak`);
  }

  if (isTarGz) {
    const tmpRestore = path.join('/tmp', `restore-staging-${Date.now()}`);
    const tmpArchive = path.join('/tmp', `restore-${Date.now()}.tar.gz`);
    try {
      fs.mkdirSync(tmpRestore, { recursive: true });
      fs.writeFileSync(tmpArchive, buffer);
      execSync(`tar -xzf "${tmpArchive}" -C "${tmpRestore}"`);

      const extractedDb = path.join(tmpRestore, 'tasks.db');
      if (fs.existsSync(extractedDb)) {
        fs.copyFileSync(extractedDb, targetDbPath);
      }

      const extractedKey = path.join(tmpRestore, '.encryption-key');
      if (fs.existsSync(extractedKey)) {
        fs.copyFileSync(extractedKey, path.join(dataDir, '.encryption-key'));
      }

      const extractedUploads = path.join(tmpRestore, 'uploads');
      if (uploadsDir && fs.existsSync(extractedUploads)) {
        if (fs.existsSync(uploadsDir)) {
          execSync(`cp -r "${uploadsDir}" "${uploadsDir}.bak"`);
        }
        execSync(`cp -r "${extractedUploads}/"* "${uploadsDir}/"`);
      }

      return { success: true };
    } finally {
      try {
        if (fs.existsSync(tmpRestore)) fs.rmSync(tmpRestore, { recursive: true, force: true });
        if (fs.existsSync(tmpArchive)) fs.unlinkSync(tmpArchive);
      } catch (_) {}
    }
  } else {
    fs.writeFileSync(targetDbPath, buffer);
    return { success: true };
  }
}

function initAutomatedBackupScheduler(db, dbPath) {
  if (backupIntervalTimer) clearInterval(backupIntervalTimer);

  let lastRunDate = null;

  backupIntervalTimer = setInterval(async () => {
    try {
      const enabledRow = db.prepare("SELECT value FROM settings WHERE key = 'DRIVE_BACKUP_AUTO_ENABLED'").get();
      const isEnabled = enabledRow ? enabledRow.value === 'true' : true;
      if (!isEnabled) return;

      const timeRow = db.prepare("SELECT value FROM settings WHERE key = 'DRIVE_BACKUP_TIME'").get();
      const targetTime = timeRow?.value || '02:00';
      const [targetH, targetM] = targetTime.split(':').map(Number);

      const tz = process.env.TZ || 'America/Los_Angeles';
      const now = new Date();
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
          console.log(`[DriveBackup] Starting scheduled full backup for ${todayStr} at ${targetTime} (${tz})...`);
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
