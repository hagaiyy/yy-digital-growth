# dataImportSettings

A single persisted setting, not a general settings framework: the
Recent Content Limit used by the next import. MongoDB collection:
`dataImportSettings`, always exactly one document keyed by the fixed
`settingKey: "dataImport"`. Defaults to `recentContentLimit: 30` on
first read and survives a server restart.
