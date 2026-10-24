// Numbered schema migrations, run by applySchemaMigrations in index.js. Each
// runs once, in ascending order, on any database whose SYSTEM_SCHEMA_ID is
// below its schemaId. Paths resolve from server/.
//
// Adam's fork renumbered upstream's shipped migrations 28-33 up to 33-39 to
// make room for local-only migrations 28 (userGoogleTasks) and 34
// (googleTasksTables). Keep the renumbering here: upstream's registry lists
// haPanels at 28, but on this branch that file lives at schema33-haPanels.js.
//
// tests/migrationRegistry.test.js checks this list against the files in this
// folder: two migrations with one number would leave a database that already
// ran either of them without the other.
module.exports = [
  { schemaId: 6, migrationPath: './migrations/migrateDeviceSchemaV6', },
  { schemaId: 7, migrationPath: './migrations/schema7-proveMigrations', },
  { schemaId: 8, migrationPath: './migrations/schema8-calendarCacheTables', },
  { schemaId: 9, migrationPath: './migrations/schema9-googleConnection', },
  { schemaId: 10, migrationPath: './migrations/schema10-googlePhotosPicker', },
  { schemaId: 11, migrationPath: './migrations/schema11-homeglowPhotos', },
  { schemaId: 12, migrationPath: './migrations/schema12-onceCompletedScheduling', },
  { schemaId: 13, migrationPath: './migrations/schema13-tabsByDefaultBackfill', },
  { schemaId: 14, migrationPath: './migrations/schema14-deviceAndTabJsonStorage', },
  { schemaId: 15, migrationPath: './migrations/schema15-choreDueTimeSound', },
  { schemaId: 16, migrationPath: './migrations/schema16-choreDueDate', },
  { schemaId: 17, migrationPath: './migrations/schema17-choreTransferSnooze', },
  { schemaId: 18, migrationPath: './migrations/schema18-pluginsTable', },
  { schemaId: 19, migrationPath: './migrations/schema19-pluginStorage', },
  { schemaId: 20, migrationPath: './migrations/schema20-choreHistoryKind', },
  { schemaId: 21, migrationPath: './migrations/schema21-prizeOffers', },
  { schemaId: 22, migrationPath: './migrations/schema22-prizeRepeatSplit', },
  { schemaId: 23, migrationPath: './migrations/schema23-userSortOrder', },
  { schemaId: 24, migrationPath: './migrations/schema24-choreIcon', },
  { schemaId: 25, migrationPath: './migrations/schema25-unifyCredentialEncryption', },
  { schemaId: 26, migrationPath: './migrations/schema26-keepLegacyTimezone', },
  { schemaId: 27, migrationPath: './migrations/schema27-choreFollowups', },
  { schemaId: 28, migrationPath: './migrations/schema28-userGoogleTasks', },
  { schemaId: 29, migrationPath: './migrations/schema29-choreCalendarMatch', },
  { schemaId: 30, migrationPath: './migrations/schema30-choreSpawn', },
  { schemaId: 31, migrationPath: './migrations/schema31-removeCalendarMatch', },
  { schemaId: 32, migrationPath: './migrations/schema32-removeSpawn', },
  { schemaId: 33, migrationPath: './migrations/schema33-haPanels', },
  { schemaId: 34, migrationPath: './migrations/schema34-googleTasksTables', },
  { schemaId: 35, migrationPath: './migrations/schema35-routines', },
  { schemaId: 36, migrationPath: './migrations/schema36-importRoutinesPlugin', },
  { schemaId: 37, migrationPath: './migrations/schema37-routineStreakBase', },
  { schemaId: 38, migrationPath: './migrations/schema38-choreExpiry', },
  { schemaId: 39, migrationPath: './migrations/schema39-deviceNotifications', },
  { schemaId: 40, migrationPath: './migrations/schema40-notificationChannels', },
  { schemaId: 41, migrationPath: './migrations/schema41-proxyWhitelistSeed', },
  { schemaId: 42, migrationPath: './migrations/schema42-prizeDescription', },
];
