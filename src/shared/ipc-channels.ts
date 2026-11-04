export const IPC = {
  configLoad: 'config:load',
  configSave: 'config:save',
  configImport: 'config:import',
  configExport: 'config:export',
  configResetLocalData: 'config:reset-local-data',
  configResetSettings: 'config:reset-settings',
  projectPick: 'projects:pick',
  projectAdd: 'projects:add',
  projectPickRelink: 'projects:pick-relink',
  projectRelink: 'projects:relink',
  projectScan: 'projects:scan',
  projectAvailability: 'projects:availability',
  outputPick: 'output:pick',
  conversionPreflight: 'conversion:preflight',
  conversionEnqueue: 'conversion:enqueue',
  conversionCancel: 'conversion:cancel',
  conversionList: 'conversion:list',
  conversionClear: 'conversion:clear',
  sessionLoad: 'session:load',
  sessionSave: 'session:save',
  watcherSync: 'watcher:sync',
  updateCheck: 'updater:check',
  updateDownload: 'updater:download',
  updateInstall: 'updater:install',
  appConfirmClose: 'app:confirm-close',
  appVersion: 'app:version'
} as const

export const eventChannels = [
  'config:changed',
  'watcher:changed',
  'tasks:changed',
  'updater:changed',
  'app:before-close'
] as const
