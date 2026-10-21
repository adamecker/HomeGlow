import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Button, Paper, Alert, CircularProgress,
  List, ListItem, ListItemText,
  Switch, TextField, Stack
} from '@mui/material';
import { CloudUpload, Refresh, Schedule } from '@mui/icons-material';
import axios from 'axios';
import { API_BASE_URL } from '../utils/apiConfig.js';

export default function GoogleDriveBackupSection() {
  const [loading, setLoading] = useState(false);
  const [backups, setBackups] = useState([]);
  const [message, setMessage] = useState(null);

  const [autoEnabled, setAutoEnabled] = useState(false);
  const [backupTime, setBackupTime] = useState('02:00');
  const [timezone, setTimezone] = useState('');

  const fetchConfigAndBackups = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, listRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/api/backup/drive/status`),
        axios.get(`${API_BASE_URL}/api/backup/drive/list`).catch(() => ({ data: { files: [] } }))
      ]);
      setAutoEnabled(statusRes.data.autoEnabled ?? false);
      setBackupTime(statusRes.data.backupTime || '02:00');
      setTimezone(statusRes.data.serverTimezone || '');
      setBackups(listRes.data.files || []);
    } catch (err) {
      console.error('Failed to load backup data', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfigAndBackups();
  }, [fetchConfigAndBackups]);

  const handleSaveConfig = async (newEnabled, newTime) => {
    try {
      await axios.post(`${API_BASE_URL}/api/backup/drive/config`, {
        autoEnabled: typeof newEnabled === 'boolean' ? newEnabled : autoEnabled,
        backupTime: newTime || backupTime
      });
      setMessage({ type: 'success', text: 'Automated backup settings saved.' });
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to save automated schedule settings.' });
    }
  };

  const handleBackupNow = async () => {
    setLoading(true);
    setMessage(null);
    try {
      await axios.post(`${API_BASE_URL}/api/backup/drive/upload`);
      setMessage({ type: 'success', text: 'Backup successfully saved to Google Drive!' });
      fetchConfigAndBackups();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Backup failed.' });
      setLoading(false);
    }
  };

  const formatFileDate = (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return isNaN(date.getTime()) ? isoString : date.toLocaleString();
  };

  return (
    <Box sx={{ mt: 3, p: 2, border: '1px solid var(--card-border)', borderRadius: 2 }}>
      <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
        ☁️ Google Drive Backup
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Nightly snapshots of the database, encryption key, and uploads, saved to your connected
        Google Drive (newest 14 kept). If this device fails, download a backup from Drive, extract
        it into the new install's data folder while HomeGlow is stopped, then start it.
      </Typography>

      {message && <Alert severity={message.type} sx={{ mb: 2 }}>{message.text}</Alert>}

      <Stack spacing={2} sx={{ mb: 3, p: 2, bgcolor: 'rgba(255, 255, 255, 0.03)', borderRadius: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <Typography variant="subtitle2" fontWeight="600">Automated Nightly Backups</Typography>
            <Typography variant="caption" color="text.secondary">Automatically creates a backup snapshot every day</Typography>
          </Box>
          <Switch
            checked={autoEnabled}
            onChange={(e) => {
              const val = e.target.checked;
              setAutoEnabled(val);
              handleSaveConfig(val, backupTime);
            }}
          />
        </Box>

        {autoEnabled && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Schedule sx={{ opacity: 0.7 }} fontSize="small" />
            <TextField
              label="Scheduled Backup Time"
              type="time"
              size="small"
              value={backupTime}
              onChange={(e) => {
                const val = e.target.value;
                setBackupTime(val);
                handleSaveConfig(autoEnabled, val);
              }}
              InputLabelProps={{ shrink: true }}
              helperText={`Local time (default 02:00 AM ${timezone ? `in ${timezone}` : ''})`}
            />
          </Box>
        )}
      </Stack>

      <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
        <Button variant="contained" startIcon={<CloudUpload />} onClick={handleBackupNow} disabled={loading}>
          Backup Now
        </Button>
        <Button variant="outlined" startIcon={<Refresh />} onClick={fetchConfigAndBackups} disabled={loading}>
          Refresh List
        </Button>
      </Box>

      <Typography variant="subtitle2" gutterBottom>Available Cloud Backups</Typography>
      {loading && backups.length === 0 ? (
        <CircularProgress size={20} />
      ) : backups.length === 0 ? (
        <Typography variant="body2" color="text.secondary">No backups found in Google Drive.</Typography>
      ) : (
        <List dense component={Paper} variant="outlined">
          {backups.map((file) => (
            <ListItem key={file.id} divider>
              <ListItemText
                primary={file.name}
                secondary={`Created: ${formatFileDate(file.createdTime)}`}
              />
            </ListItem>
          ))}
        </List>
      )}
    </Box>
  );
}
