# Project-to-Text Manager — Agent Review & Validation Guide

> Purpose: Give a coding agent one authoritative Markdown file to understand the product, inspect the existing codebase, run the application, compare implementation behavior against the approved requirements, and fix gaps without inventing new product scope.

---

# 1. Your Role

You are reviewing an existing production-oriented Windows Electron application named **Project-to-Text Manager**.

Your task is **not** to redesign the product from scratch unless the existing implementation is fundamentally broken.

Your task is to:

1. inspect the repository and understand the current architecture;
2. run the application and existing tests/build checks;
3. compare actual behavior against this specification;
4. identify missing, incorrect, unsafe, inconsistent, or incomplete implementation;
5. fix implementation gaps where practical;
6. preserve working behavior that already matches the specification;
7. avoid introducing features that are outside scope;
8. report the final validation status clearly.

Treat this document as the product baseline.

Do not silently reinterpret requirements.

---

# 2. Product Overview

**Project-to-Text Manager** is a Windows-only Electron developer tool for managing multiple local source-code projects and converting selected source files into exactly one structured Markdown or TXT file.

Primary workflow:

```text
Open projects
→ switch using project tabs
→ inspect File Tree
→ adjust source selection
→ save profile
→ configure output
→ convert
→ monitor task
```

The application replaces a previous CLI workflow.

There is no CLI product requirement.

---

# 3. Mandatory Technology Stack

The application must use:

- Electron
- React
- TypeScript
- `@fluentui/react-components`
- `zustand`
- `zod`

Architecture:

- Modular Architecture

UI:

- English only
- Dark theme only
- Windows desktop only

Minimum OS:

- Windows 10 64-bit or newer

Do not introduce another competing UI component library.

Use Fluent UI as the primary UI component system.

Use Zustand for renderer-side application state where appropriate.

Use Zod for runtime validation of important persisted, imported, and IPC data contracts.

---

# 4. Explicitly Removed / Out-of-Scope Features

Do **not** implement or reintroduce:

- CLI
- Workspace
- Conversion History
- conversion history screen
- history persistence
- rerun from history
- history diff
- archived conversion outputs
- macOS support
- Linux support
- mobile support
- Git clone
- remote project import
- cloud sync
- source editor
- source preview
- custom Glob rule editor
- AI provider integrations
- token estimation
- plugin marketplace
- automatic secret redaction
- light theme
- localization
- persistent completed-task history
- per-project output directories
- multiple output files per conversion

If any of these are already present, determine whether they conflict with the approved scope and remove or isolate them appropriately.

---

# 5. Required Electron Security Model

The renderer must not have unrestricted Node.js or filesystem access.

Required boundary:

```text
React Renderer
→ constrained preload API
→ IPC
→ Electron main/background services
```

Validate:

- context isolation is enabled;
- renderer does not directly use Node filesystem APIs;
- preload exposes narrowly scoped APIs;
- important IPC payloads are validated;
- privileged operations happen outside React components;
- imported/persisted external data is validated with Zod.

Do not expose generic unrestricted filesystem methods to the renderer.

---

# 6. Network & Privacy Rules

All source processing is local.

The application must never send externally:

- source code;
- source snippets;
- project paths;
- project filenames as telemetry;
- project metadata;
- profile contents;
- selected-file data;
- source-derived data.

The only allowed network use is:

- application update checks;
- application update downloads.

Update source:

- GitHub Releases

No analytics/telemetry is required.

---

# 7. Project Management

Projects come only from local folders.

Add Project must use a Windows/Electron Folder Picker.

Do not support:

- URL import;
- Git clone;
- remote repository import;
- drag-and-drop project creation.

Each project stores at least:

- unique id;
- display name;
- normalized local path;
- detected framework;
- persisted project configuration.

Display name defaults to the folder name.

The user may rename the display name in the app.

Renaming the display name must never rename the physical folder.

Prevent duplicate projects for the same canonical/normalized Windows path.

If a project folder becomes missing or moved:

- preserve the project record;
- preserve configuration;
- mark project `Unavailable`;
- provide `Relink`;
- Relink uses Folder Picker.

Remove Project dialog:

- `Remove Project & Delete Config`
- `Remove Project & Keep Config`
- `Cancel`

Removing a project must never delete source files.

---

# 8. Groups

There is no Workspace concept.

Project organization is:

```text
Group
└── Project

Ungrouped
└── Project
```

A project may:

- belong to exactly one Group;
- or be Ungrouped.

A project must never belong to multiple Groups.

Add Project flow asks for:

- Group;
- or Ungrouped.

Group operations:

- Create
- Rename
- Delete
- Manual reorder

Projects inside Groups use manual ordering.

Move project between Groups through:

- drag-and-drop;
- context menu/project settings.

Deleting a non-empty Group:

- deletes only the Group;
- preserves projects;
- moves those projects to Ungrouped.

---

# 9. Project Tabs & Session

Projects open as VS Code-like project tabs.

Required behavior:

- selecting/opening a project opens a tab;
- selecting an already-open project focuses the existing tab;
- no duplicate tabs for the same project;
- multiple project tabs may remain open;
- closing a clean tab closes only the view;
- closing a tab does not remove the project;
- dirty tab shows a dirty indicator;
- inactive project tabs preserve runtime state;
- conversion continues when switching tabs;
- watcher continues for all open tabs.

When tab width overflows:

- use horizontal scrolling.

On application restart:

- restore all open project tabs;
- restore the last active tab.

Restore layout state:

- sidebar width/collapsed state;
- File Tree pane width/collapsed state;
- configuration pane width/collapsed state;
- bottom log panel height/collapsed state.

If a restored project path is missing:

- restore the tab;
- show `Unavailable`;
- provide `Relink`.

Startup order:

1. load/scan active project first;
2. refresh other restored project tabs in background.

---

# 10. Application Shell

Use a VS Code-inspired developer-tool layout without cloning VS Code pixel-for-pixel.

Main regions:

1. Top Menu / Title Bar
2. Left Activity Rail
3. Contextual Sidebar
4. Project Tab Bar
5. Main Project Workspace
6. Bottom Conversion Log Panel
7. Status Bar

Left Activity Rail destinations:

- Projects
- Tasks / Logs
- Settings

Do not include History.

Main Project Workspace:

- left pane: File Tree;
- right pane: project/configuration/conversion controls.

Both panes:

- resizable;
- collapsible;
- restorable.

Profile selection should use a dropdown/select rather than profile tabs.

---

# 11. Framework Detection

When adding a project:

- automatically detect framework.

If exactly one framework is detected:

- assign it automatically;
- apply its default preset automatically.

If multiple frameworks are detected:

- show the detected frameworks;
- require the user to choose one primary framework.

If none are detected:

- add project as `Generic Project`;
- apply minimal generic preset.

Users cannot freely change framework manually.

If later re-detection produces a different framework:

- switch to the detected framework;
- apply that framework preset.

---

# 12. Framework Presets

Each framework has:

- one default preset;
- a preset version.

When a newer preset exists:

- notify when the affected project is opened;
- do not automatically apply it.

If the user accepts the newer preset:

- reset selection to the new preset;
- discard previous manual overrides.

---

# 13. File Tree

The File Tree represents the project filesystem except hard-excluded paths.

Required capabilities:

- hierarchical folders/files;
- expand/collapse;
- file/folder checkbox selection;
- search by filename;
- search by relative path;
- filter by extension;
- filter by Included;
- filter by Excluded;
- binary-file state;
- hidden-file toggle;
- realtime filesystem updates.

No source preview/editor.

Search/filter changes presentation only.

Search/filter must never silently mutate selection.

---

# 14. File Tree Loading & Performance

No hard project file-count limit.

Design best-effort for very large projects.

Opening a project:

1. scan the full project;
2. render the File Tree after the scan completes.

UI rendering must use:

- lazy-loaded folder children;
- row virtualization.

Heavy filesystem work must not block the React renderer.

Do not repeatedly send the entire huge File Tree across IPC for every watcher event if incremental updates are practical.

---

# 15. Hidden Files

Provide:

`Show Hidden Files`

Default:

`On`

Hard-excluded hidden folders remain invisible even when enabled.

---

# 16. Selection Rules

Checkboxes have only two states:

- checked;
- unchecked.

Do not use an indeterminate checkbox state.

Folder behavior:

- clicking folder checkbox applies the state to selectable descendants;
- folder is checked only when all selectable descendants are selected;
- partial selection displays folder as unchecked;
- partial selection displays a badge such as `12/20 selected`.

Manual selection overrides:

- framework preset;
- `.gitignore`.

---

# 17. .gitignore

Automatically use `.gitignore` as soft exclusion rules.

`.gitignore` exclusions may be manually overridden.

Do not treat `.gitignore` as a hard exclusion boundary.

---

# 18. Hard Excludes

Built-in hard excludes include common irrelevant/generated/dependency paths such as:

- `.git`
- `node_modules`
- `dist`
- `build`
- caches
- framework-specific mandatory generated/dependency folders

Built-in hard excludes:

- are invisible in File Tree;
- cannot be selected;
- cannot be removed by the user.

User-defined additional hard excludes support:

- Global scope;
- Project scope.

Manage them in:

- Global Settings;
- Project Settings.

---

# 19. Binary Files

Binary files:

- remain visible unless path is hard-excluded;
- have disabled checkbox;
- show reason `Binary file`;
- cannot be converted.

---

# 20. Rename / Move Selection Behavior

Selection is path-based.

If a manually selected file is renamed or moved:

- old selection is lost;
- new path is evaluated again through preset and `.gitignore`.

Do not attempt inode/file-identity selection tracking.

---

# 21. Filesystem Watcher

Watcher default:

`On`

Provide a global On/Off setting.

All open project tabs remain watched.

Watch:

- create;
- delete;
- rename;
- move;
- directory changes.

Adaptive handling:

- low event volume → near realtime;
- burst → debounce/batch events.

Avoid repeated full-tree rerenders during event storms.

---

# 22. Profiles

Each project supports multiple profiles.

When project is added:

- create one default profile from the detected framework preset.

A project must always have at least one profile.

The last profile cannot be deleted.

A profile stores only:

- file/folder selection.

A profile does not own:

- output filename;
- output directory;
- output format.

Remember last active profile per project.

Switching away from a dirty profile requires:

- Save
- Discard
- Cancel

---

# 23. Dirty State & Save Model

Selection changes do not auto-save.

Dirty state must be visible.

Closing a dirty project tab:

- Save
- Discard
- Cancel

Closing the application with dirty projects:

- Save All
- Discard All
- Cancel Exit

Only saved profile state is restored after restart.

Do not restore unsaved selection changes.

---

# 24. Output Formats

Every conversion creates exactly one output file.

Supported formats:

- Markdown `.md`
- TXT `.txt`

Default when application starts:

- Markdown

Output format does not persist across app restarts.

Profiles do not own output format.

Markdown and TXT share the same logical document structure.

Markdown:

- headings;
- fenced code blocks.

TXT:

- plain headers;
- fixed separators.

No custom output templates.

No custom separators.

---

# 25. Output Document Structure

Output begins with a Project Tree.

Project Tree:

- root = Project Display Name;
- includes only selected/included items;
- excludes unselected files.

Use `/` path separators in output.

Never place absolute source project paths in output.

Each file section contains:

- relative path;
- fixed header/separator;
- exact source content.

---

# 26. Source Integrity

Source content must remain unchanged.

Do not:

- remove comments;
- remove blank lines;
- reformat;
- minify;
- rewrite;
- optimize;
- redact secrets;
- normalize code style.

---

# 27. Output Filename

Default filename:

`Project Name + Profile Name`

Sanitize for Windows filenames.

Example:

```text
HomeXIQ-Default.md
```

If the filename has never been manually customized:

- switching profile updates the default filename.

After the user manually customizes the filename:

- remember the custom basename at project scope;
- switching profiles no longer changes it.

Switching TXT ↔ Markdown:

- preserve basename;
- update extension only.

---

# 28. Output Directory

Use one Global Output Directory.

Default:

```text
Documents/Project-to-Text
```

Changing it affects all projects immediately.

No per-project output directories.

---

# 29. Output Collision

If target file exists:

- ask before overwrite.

If overwrite is rejected:

- generate a unique filename.

Example:

```text
project.md
project (1).md
project (2).md
```

Parallel tasks must never write the same physical output file.

---

# 30. Encoding

Encoding strategy:

1. BOM-aware handling where relevant;
2. UTF-8 first;
3. detect common alternative text encodings.

If any selected file cannot be read:

- fail the entire conversion.

Do not silently skip unreadable selected files.

---

# 31. Large Files

No hard file-size limit.

Very large text files:

- generate preflight warning;
- still remain convertible.

---

# 32. Symlink / Junction

Follow symlink/junction only when the resolved target is inside the project root.

Never follow an external target.

Prevent:

- cycles;
- duplicate physical-file processing.

---

# 33. Conversion Ordering

Use stable File Tree/path ordering.

For unchanged inputs and selections, output should be deterministic.

---

# 34. Convert Flow

When user clicks Convert:

1. snapshot relevant selection/config;
2. run preflight;
3. stop on blocking error;
4. otherwise start or enqueue based on runtime concurrency.

Do not add an unnecessary generic confirmation step.

---

# 35. Preflight Validation

Validate:

- selected file existence;
- readability;
- encoding;
- binary status;
- symlink/junction rules;
- output target;
- filesystem baseline;
- secret patterns;
- large-file warning.

Errors block conversion.

Warnings do not automatically block conversion.

---

# 36. Secret Detection

Detect warning patterns such as:

- API keys;
- tokens;
- passwords;
- credentials;
- private-key-like content.

Secret handling:

- warning only;
- no automatic redaction;
- no source modification;
- no dedicated blocking confirmation.

Show warnings in:

- preflight result;
- detailed task log.

Sensitive files such as `.env` are not automatically excluded only because they are sensitive.

They follow normal selection rules.

---

# 37. Filesystem Consistency During Conversion

Preflight creates the relevant filesystem baseline.

If a selected file changes during conversion:

- abort the conversion;
- cleanup incomplete output;
- require rerun.

Do not create mixed-state output.

---

# 38. Conversion Progress

Show:

- overall percentage;
- current file;
- processed count;
- total count.

Example:

```text
72%
src/features/device/device_service.ts
108 / 150 files
```

---

# 39. Cancellation

Running conversion has immediate Cancel.

No second confirmation.

Cancel must:

- stop processing safely;
- cleanup incomplete output;
- mark task cancelled.

---

# 40. Task Queue

Support multiple global conversion tasks.

Queue:

- FIFO;
- no reorder;
- no priority.

Queued task supports:

- Cancel only.

A queued task uses the exact snapshot captured when Convert was clicked.

Later UI changes must not mutate queued tasks.

---

# 41. Per-Project Running Constraint

Each project may have at most one running conversion task.

If Convert is clicked while that project already has a running task, show:

- `Cancel Current`
- `Queue New`
- `Cancel Action`

`Queue New` snapshots configuration immediately.

---

# 42. Concurrency

Default:

`Auto`

Compute Auto concurrency once at application startup based on available CPU/resources.

Keep it fixed for the app session.

Settings options:

- Auto
- 1
- 2
- 4
- 8

Use a preset/dropdown control.

---

# 43. Task Panel

Task Panel shows queued/running tasks.

When a task:

- succeeds;
- fails;
- is cancelled;

remove it from Task Panel immediately.

Do not turn the Task Panel into a history screen.

---

# 44. Task Logs

Provide detailed logs during task lifetime.

Logs may include absolute local paths for diagnostics.

Logs do not persist after task completion.

---

# 45. Notifications

On conversion completion/failure:

- show in-app notification;
- optionally show Windows notification.

Windows Notifications setting:

- default On.

No required success actions such as:

- Open File
- Open Folder
- Convert Again

---

# 46. Closing the App

If running/queued tasks exist:

- ask for confirmation;
- if exit proceeds:
  - cancel running tasks;
  - remove queued tasks;
  - cleanup incomplete output;
  - close.

If dirty projects exist:

- Save All
- Discard All
- Cancel Exit

Handle both task-exit and dirty-exit flows predictably.

---

# 47. Local Persistence

Store app-managed configuration under the Windows user profile.

Do not create Project-to-Text configuration files in source repositories.

Persist:

- projects;
- groups;
- ordering;
- profiles;
- saved selections;
- project display names;
- remembered custom output filenames;
- hard excludes;
- settings;
- session state.

Persist session state separately from exportable configuration.

Use versioned Zod schemas.

---

# 48. Configuration Export

Export Entire App Configuration includes:

- projects;
- groups;
- profiles;
- settings;
- project-specific config.

Do not export runtime session state:

- open tabs;
- active tab;
- pane widths;
- collapsed states.

Use a versioned schema validated by Zod.

---

# 49. Configuration Import

Before import:

- parse safely;
- validate schema;
- validate schema version;
- validate integrity;
- reject unsafe configuration/path data;
- reject incompatible versions with a clear error.

If valid:

- ask for confirmation;
- replace all existing configuration.

Do not merge.

---

# 50. Reset Settings

Provide `Reset Settings`.

It resets application settings while preserving:

- projects;
- groups;
- profiles.

Do not interpret this action as Reset Local Data.

---

# 51. Corrupt Data Recovery

If local app data is corrupt during startup:

do not silently wipe it.

Show recovery options:

- `Reset Local Data`
- `Import Config`

---

# 52. Windows Distribution

Distribution:

- Installer EXE only.

Installation:

- per-user;
- no administrator privilege requirement.

Installer:

- Start Menu shortcut;
- optional Desktop shortcut.

No file associations.

---

# 53. Application Updates

Use GitHub Releases.

Update flow:

1. check for update;
2. download update;
3. ask before installation/restart.

Never silently install/restart.

Network use remains update-only.

---

# 54. Major Version Updates

Major update behavior:

- reset all local application configuration;
- no automatic backup.

Before installation:

- clearly warn that local configuration will be reset;
- require explicit user confirmation.

---

# 55. Settings Baseline

## General

- Global Output Directory

Default:

`Documents/Project-to-Text`

## File Handling

- Show Hidden Files
- Filesystem Watcher
- Global hard excludes

Defaults:

- Show Hidden Files = On
- Watcher = On

## Project Settings

- project-specific hard excludes

## Conversion

- Auto
- 1
- 2
- 4
- 8

Default:

- Auto

## Notifications

- Windows Notifications On/Off

Default:

- On

## Data

- Export Configuration
- Import Configuration
- Reset Settings

Dark theme and English language are fixed product rules, not user settings.

---

# 56. Zustand Expectations

Do not create one giant global store.

Prefer modular stores/slices for concerns such as:

- shell/session state;
- project tabs;
- projects/groups UI state;
- active project state;
- File Tree presentation state;
- profile dirty state;
- task runtime projection;
- settings.

Use selectors to reduce unnecessary React rerenders.

Do not treat renderer Zustand state as the authoritative filesystem/task execution engine.

Main/background services should own privileged runtime work.

---

# 57. Zod Expectations

Use Zod for important runtime contracts such as:

- project records;
- groups;
- profiles;
- settings;
- persisted configuration;
- imported configuration;
- exported configuration;
- schema versions;
- framework detection result;
- preset definitions when loaded externally/persisted;
- relevant IPC payloads;
- updater metadata where validation is valuable.

Do not trust imported JSON simply because parsing succeeds.

---

# 58. Fluent UI Expectations

Use `@fluentui/react-components` as the primary UI system.

Use Fluent UI for appropriate:

- buttons;
- menus;
- dialogs;
- tooltips;
- inputs;
- dropdowns;
- checkboxes;
- badges;
- progress indicators;
- toast/notification UI;
- switches;
- context menus.

Custom layout primitives are acceptable for IDE-style panes/tabs/tree layouts where Fluent UI does not directly provide the needed structure.

Visual goal:

- compact;
- developer-oriented;
- dark;
- information-dense;
- clear selected/hover/focus states;
- keyboard-friendly.

---

# 59. Core Acceptance Checklist

During review, explicitly verify each of these.

## Project & Groups

- [ ] Add Project uses Folder Picker.
- [ ] Duplicate canonical path is prevented.
- [ ] Project display name defaults from folder.
- [ ] Display name can be renamed without renaming folder.
- [ ] Missing project becomes Unavailable.
- [ ] Relink works.
- [ ] Remove Project supports Delete Config / Keep Config / Cancel.
- [ ] Group is optional.
- [ ] Project belongs to at most one Group.
- [ ] Ungrouped exists.
- [ ] Groups support create/rename/delete/manual reorder.
- [ ] Project ordering is manual.
- [ ] Drag-and-drop project movement works.
- [ ] Context-menu project movement works.
- [ ] Deleting Group moves projects to Ungrouped.

## Frameworks & Presets

- [ ] Framework detection runs when adding project.
- [ ] One detected framework is assigned automatically.
- [ ] Multiple detections require primary selection.
- [ ] No detection creates Generic Project.
- [ ] Default preset is applied.
- [ ] Preset version is tracked.
- [ ] New preset notification appears when affected project opens.
- [ ] Accepting new preset resets selection/manual overrides.
- [ ] User cannot arbitrarily choose unrelated framework.

## File Tree & Selection

- [ ] Full scan occurs before first complete tree render.
- [ ] Lazy folder loading exists.
- [ ] Row virtualization exists.
- [ ] Hard-excluded paths never appear.
- [ ] Hidden files default to visible.
- [ ] Hidden-file toggle works.
- [ ] Search filename/path works.
- [ ] Extension filter works.
- [ ] Included/Excluded filters work.
- [ ] Search/filter do not mutate selection.
- [ ] File checkboxes are 2-state.
- [ ] Folder partial state uses unchecked + x/y badge.
- [ ] Folder click affects descendants.
- [ ] Manual selection overrides preset.
- [ ] Manual selection overrides `.gitignore`.
- [ ] Binary file remains visible with disabled checkbox.
- [ ] Binary file shows `Binary file`.
- [ ] Rename/move causes path-based selection reevaluation.

## Watcher

- [ ] Watcher defaults On.
- [ ] Watcher global setting works.
- [ ] All open tabs remain watched.
- [ ] Create/delete/rename/move update state.
- [ ] Burst events are batched/debounced.

## Profiles & Dirty State

- [ ] Default profile is created.
- [ ] Multiple profiles are supported.
- [ ] Last remaining profile cannot be deleted.
- [ ] Profile stores selection only.
- [ ] Last active profile is remembered.
- [ ] Selection changes create dirty state.
- [ ] Changes do not auto-save.
- [ ] Switching dirty profile asks Save/Discard/Cancel.
- [ ] Closing dirty tab asks Save/Discard/Cancel.
- [ ] Exiting with dirty projects asks Save All/Discard All/Cancel Exit.
- [ ] Unsaved changes are not restored after restart.

## Tabs & Session

- [ ] Project opens in a tab.
- [ ] Existing project tab is focused instead of duplicated.
- [ ] Closing clean tab does not remove project.
- [ ] Dirty indicator works.
- [ ] Horizontal tab overflow works.
- [ ] Previous open tabs restore after restart.
- [ ] Active tab restores.
- [ ] Pane sizes/collapse state restore.
- [ ] Missing restored project opens as Unavailable.
- [ ] Active project loads before background tabs.

## Output

- [ ] One output file per conversion.
- [ ] Markdown is default after app restart.
- [ ] TXT is supported.
- [ ] Profile does not own output format.
- [ ] Markdown uses headings/fenced code blocks.
- [ ] TXT uses plain separators.
- [ ] Project Tree is first.
- [ ] Project Tree shows only included items.
- [ ] Project Tree root uses display name.
- [ ] Output paths use `/`.
- [ ] Absolute source paths do not appear in document.
- [ ] Source content remains exact.
- [ ] Default filename uses Project + Profile.
- [ ] Filename tracks profile until manually customized.
- [ ] Customized filename persists at project scope.
- [ ] Switching format changes extension only.
- [ ] Global output directory default is correct.
- [ ] No per-project output directories exist.
- [ ] Collision asks before overwrite.
- [ ] Reject overwrite generates `(1)`, `(2)`, etc.
- [ ] Parallel tasks never write same physical path.

## Encoding / Files / Links

- [ ] UTF-8-first encoding works.
- [ ] Common alternate encodings are supported.
- [ ] Unreadable selected file fails entire conversion.
- [ ] Large file warns but does not block.
- [ ] External symlink/junction target is not followed.
- [ ] Link cycles are prevented.
- [ ] Duplicate physical processing is prevented.

## Preflight & Conversion

- [ ] Convert captures snapshot first.
- [ ] Preflight validates all required conditions.
- [ ] Valid conversion starts without redundant confirmation.
- [ ] Secret warning does not block.
- [ ] Secret content is not redacted.
- [ ] Sensitive files are not automatically hard-excluded solely for sensitivity.
- [ ] Filesystem baseline is established.
- [ ] Source mutation during conversion aborts task.
- [ ] Partial output is cleaned after failure/cancel/mutation.
- [ ] Progress percentage works.
- [ ] Current file is shown.
- [ ] Processed/total count works.
- [ ] Cancel is immediate and requires no second confirmation.

## Queue & Concurrency

- [ ] FIFO queue.
- [ ] Queue cannot be reordered.
- [ ] No priority system.
- [ ] Queued task supports Cancel only.
- [ ] Queued task snapshot cannot mutate afterward.
- [ ] At most one running task per project.
- [ ] Second Convert shows Cancel Current / Queue New / Cancel Action.
- [ ] Auto concurrency exists.
- [ ] Auto concurrency is computed once per app session.
- [ ] Manual options are 1/2/4/8.
- [ ] Completed/failed/cancelled task disappears from Task Panel immediately.
- [ ] Completed task is not persisted as history.

## Logs & Notifications

- [ ] Detailed task logs exist.
- [ ] Task logs are runtime-only.
- [ ] Logs may contain local absolute paths.
- [ ] In-app completion/failure notification exists.
- [ ] Windows notification exists.
- [ ] Windows notification defaults On.
- [ ] Windows notification setting works.

## Persistence / Import / Export

- [ ] App config is stored under Windows user profile.
- [ ] No app config is written into source project folders.
- [ ] Zod validates persisted structures.
- [ ] Export includes projects/groups/profiles/settings/project config.
- [ ] Export excludes tabs/layout runtime state.
- [ ] Import validates schema/version/integrity.
- [ ] Incompatible config is rejected clearly.
- [ ] Unsafe config/path values are rejected.
- [ ] Import requires confirmation.
- [ ] Valid import replaces current configuration.
- [ ] Import does not merge.
- [ ] Reset Settings preserves projects/groups/profiles.
- [ ] Corrupt startup data shows Reset Local Data / Import Config.

## Electron Security / Privacy

- [ ] Renderer does not directly access filesystem.
- [ ] contextIsolation is enabled.
- [ ] preload API is constrained.
- [ ] IPC contracts are appropriately validated.
- [ ] Source processing remains local.
- [ ] No project/source telemetry exists.
- [ ] Network use is update-only.

## Installer / Updater

- [ ] Windows Installer EXE is configured.
- [ ] Installation is per-user.
- [ ] Admin privileges are not required by default.
- [ ] Start Menu shortcut exists.
- [ ] Desktop shortcut is optional.
- [ ] No file association.
- [ ] GitHub Releases update check works.
- [ ] Update can download.
- [ ] User is asked before install/restart.
- [ ] Major update clearly warns config reset.
- [ ] Major update requires explicit confirmation.
- [ ] No automatic backup before major reset.

---

# 60. Required Review Procedure

Do not claim the app is correct from static inspection alone.

Perform the following process.

## Phase A — Repository Inspection

Inspect:

- `package.json`;
- Electron entry points;
- preload;
- renderer entry;
- build configuration;
- installer configuration;
- tests;
- project modules;
- state management;
- persistence;
- updater;
- conversion engine.

Identify the actual project structure before modifying it.

Do not assume filenames or frameworks that are not present.

## Phase B — Dependency Verification

Confirm the repository actually uses:

- Electron;
- React;
- TypeScript;
- `@fluentui/react-components`;
- `zustand`;
- `zod`.

Check for obsolete or conflicting UI/state libraries.

A dependency existing in `package.json` does not prove it is correctly integrated.

## Phase C — Static Architecture Audit

Trace:

```text
Renderer
→ preload
→ IPC
→ main/services
```

Check whether privileged operations bypass this boundary.

Inspect business logic placement.

Look for oversized components/stores/services that violate maintainability.

Do not refactor merely for aesthetic reasons if behavior and maintainability are already good.

## Phase D — Install & Quality Checks

Use the repository's existing package manager.

Determine it from lockfiles and project metadata.

Run the appropriate equivalents of:

```text
install dependencies
typecheck
lint
unit tests
integration tests
build
```

Do not invent commands before checking `package.json` scripts.

Record every failing command and root cause.

## Phase E — Run the Application

Run the development application.

Confirm:

- Electron window launches;
- no fatal main-process error;
- renderer loads;
- no obvious preload/IPC errors;
- application is usable;
- core navigation renders correctly.

Inspect runtime console/main-process errors where available.

## Phase F — Functional Validation

Test the critical workflows with realistic temporary/local sample projects.

At minimum validate:

1. Add Project
2. Framework detection
3. Generic Project fallback
4. Groups
5. Project tabs
6. File Tree
7. Manual selection
8. `.gitignore` override
9. hard excludes
10. binary files
11. profiles
12. dirty state
13. conversion to Markdown
14. conversion to TXT
15. overwrite collision
16. cancellation
17. queueing
18. concurrent tasks across projects
19. file mutation during conversion
20. persistence/restart
21. missing-folder Relink
22. config export/import
23. Settings reset

Updater/installer behavior may be validated through configuration/tests when a full release environment is unavailable, but do not mark it fully runtime-verified unless it actually was.

## Phase G — Compare Against This Checklist

For every requirement classify:

- `PASS`
- `PARTIAL`
- `FAIL`
- `NOT TESTED`

Do not mark `PASS` without sufficient evidence.

## Phase H — Fix

Fix confirmed implementation gaps where possible.

Prioritize:

1. crashes/data loss;
2. security boundary violations;
3. incorrect conversion output;
4. source integrity;
5. persistence corruption;
6. task/concurrency correctness;
7. selection correctness;
8. UX requirement mismatches;
9. performance;
10. cosmetic issues.

After each meaningful fix, rerun relevant tests.

## Phase I — Regression Check

Before finishing, rerun the strongest available combination of:

- typecheck;
- tests;
- build;
- critical runtime workflow.

Do not report completion while known blocking failures remain without explicitly documenting them.

---

# 61. Expected Final Agent Report

At the end of the audit, provide a concise structured report.

Use this format:

```markdown
# Validation Result

## Overall Status
PASS / PASS WITH ISSUES / FAIL

## Commands Executed
- command
- command

## Build & Test Status
- TypeScript:
- Lint:
- Unit tests:
- Integration tests:
- Build:
- App launch:

## Requirement Coverage
- Passed:
- Partial:
- Failed:
- Not tested:

## Critical Issues Found
1. ...
2. ...

## Fixes Applied
1. ...
2. ...

## Remaining Issues
1. ...
2. ...

## Runtime Validation Performed
- ...

## Security Review
- Renderer filesystem access:
- Preload/API exposure:
- IPC validation:
- Network/privacy:

## Final Assessment
State whether the current application behavior is consistent with this specification and what, if anything, still prevents production readiness.
```

Do not hide failed checks.

Do not claim something was tested if it was only inferred from source code.

---

# 62. Review Principles

Use these rules throughout the audit:

- Preserve correct existing code.
- Do not rewrite the whole application unnecessarily.
- Do not add speculative features.
- Do not reintroduce Workspace.
- Do not add Conversion History.
- Do not add CLI.
- Do not weaken Electron isolation.
- Do not silently skip broken requirements.
- Do not change approved product behavior merely because another UX seems preferable.
- Prefer focused fixes over unrelated refactors.
- Keep source conversion deterministic.
- Never modify source-file content during conversion.
- Never allow incomplete output to survive cancellation/failure.
- Never expose project/source data through network telemetry.
- Validate persisted/imported data rather than trusting it.
- Distinguish static verification from runtime verification.
- Distinguish untested behavior from working behavior.

The goal is not merely for the code to compile.

The goal is for the actual Windows desktop application to behave coherently and safely according to this specification.
