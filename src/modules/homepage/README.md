# Homepage

First batbelt page. Collapsible sections of shortcuts. URL tiles open in a new tab. Folder tiles launch VS Code or `pi` on a local directory.

UI: `/homepage/links`.

## Data

`~/.config/batbelt/homepage/config.yaml`

Empty is valid (`starred: []`, `sections: []`, `terminal: { kind: terminal-app }`). Add, edit, collapse, and star persist immediately from the UI. Removing a section or shortcut asks for confirmation. **Open YAML** runs `code` on the file (needs the Cursor/VS Code `code` shell command on `PATH`). **Pi terminal** in the header picks where `tool: pi` shortcuts open.

```yaml
terminal:
  kind: kitty-tab
  listenOn: unix:${HOME}/.cache/kitty/control
starred:
  - a1
sections:
  - id: 7c2e…
    title: Airflow
    logo: https://example.com/airflow.svg
    collapsed: false
    shortcuts:
      - id: a1
        kind: url
        label: Dev
        url: https://airflow-dev.example.com
      - id: a2
        kind: url
        label: Prod
        url: https://airflow-prod.example.com
      - id: p1
        kind: dir
        label: batbelt
        path: ~/scripts/batbelt
        tool: code
      - id: p2
        kind: dir
        label: batbelt (pi)
        path: ~/scripts/batbelt
        tool: pi
```

`logo` is optional. Shortcut and logo URLs must be `http:` or `https:`. Each section and shortcut needs a unique `id` (the UI assigns one on create). `collapsed` is written when you toggle a section so it survives reload.

A shortcut without `kind` that has a `url` is treated as `kind: url`. Missing `terminal` defaults to `terminal-app`. Folder paths may use `~`; they must be absolute after that expansion. The folder does not have to exist at save time.

`starred` is a list of shortcut ids (not a section). Unknown or duplicate ids are dropped on load. New stars append last. The Starred row is hidden until at least one id still exists in a section.

### Pi terminal

Homepage-wide. Used only when a folder shortcut has `tool: pi`.

| `kind` | What happens |
| --- | --- |
| `kitty-tab` | `kitten @ launch --type=tab --cwd=<dir> -- pi` (or `kitty @`). Needs `allow_remote_control` and `listen_on` in `kitty.conf`. Optional `listenOn` is passed as `--to` (`~` and `${HOME}` expand at launch). If remote control fails, batbelt opens a new Kitty window (`kitty --directory <dir> -e pi`) and toasts that it was a window, not a tab |
| `terminal-app` | New Terminal.app window, `cd` into the folder, `exec pi` |
| `custom` | YAML only. `argv` is spawned as-is after substituting `{path}` (absolute dir) and `{cmd}` (`pi`) inside existing tokens. No `/bin/sh -c` wrapper |

Custom example:

```yaml
terminal:
  kind: custom
  argv: ["wezterm", "cli", "spawn", "--cwd", "{path}", "--", "{cmd}"]
```

The header popover will not overwrite a custom `argv`. Use **Open YAML** to change it.

Kitty `kitty.conf` (example):

```
allow_remote_control yes
listen_on unix:${HOME}/.cache/kitty/control
```

Then set `terminal.listenOn` to that same address so batbelt can reach Kitty from outside a Kitty window. Kitty appends `-<pid>` to a unix socket path, so batbelt probes for that suffix and uses the newest match.

`kitten`/`kitty` only land on `PATH` in shells Kitty itself starts, so batbelt also looks inside `/Applications/kitty.app/Contents/MacOS` and `~/Applications/kitty.app/Contents/MacOS`.

A GUI-launched Kitty has a bare `PATH`, and `kitten @ launch` runs the program directly rather than through a shell, so batbelt passes its own `PATH` with `--env` to make `pi` (and the `node` behind it) resolvable.

## Page

- Click a section card to collapse or expand it
- Click a URL tile to open it in a new tab (`rel="noopener noreferrer"`)
- Click a folder tile (folder glyph, left accent) to launch its tool. `code` opens the GUI; `pi` uses the Pi terminal setting
- Star icon pins a shortcut to the top **Starred** row (not a section: no collapse, pencil, or `+`)
- Pencil icon opens add/edit. Kind toggle is **URL | Folder**. **Remove** lives on that edit modal and asks for confirmation (folder deletes show the path)
- **Add section** is in the header next to **Open YAML** and **Pi terminal**
- **+** next to a section pencil adds a shortcut
- Add, edit, and star save immediately
- Broken logo URLs are hidden; the title stays

## Keyboard

- Just start typing anywhere on the page to filter — no need to click the filter box first. Modal fields and modifier chords (⌘/⌃/⌥) are left alone
- With `typeToSearch: true` in `~/.config/batbelt/modules.yaml` (the default), the same keys from another module navigate to Links and seed the filter. Restart batbelt after changing that flag. The flag is ignored if Homepage is not enabled
- Each whitespace-separated token must appear in the shortcut's label or section title, so `argo` surfaces the whole Argo section and `argo dev` keeps only its DEV shortcut
- URLs and folder paths are searched only when nothing matches on names, so a host like `argo.stg.gwos.dev` does not make every environment a hit for `dev`. Queries such as `dags`, `github`, or `scripts` still find shortcuts by URL or path
- While filtering, sections without a match are hidden and collapsed sections show their matches. Clearing the filter restores the saved `collapsed` state — filtering never writes to the YAML
- Arrow keys move the highlight across the grid as it looks on screen. A starred shortcut is only visited in the **Starred** row; its copy inside the section is skipped
- **Enter** opens the highlighted shortcut (new tab or local launch), **Backspace** deletes the last character, **Escape** clears the filter
- Opening a shortcut, hiding the window, or switching away clears the filter so the next search starts empty
