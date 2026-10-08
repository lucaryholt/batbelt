# Homepage

First batbelt page. Collapsible sections of URL shortcuts. Tiles open in a new tab.

UI: `/homepage/links`.

## Data

`~/.config/batbelt/homepage/config.yaml`

Empty is valid (`starred: []`, `sections: []`). Add, edit, collapse, and star persist immediately from the UI. Removing a section or shortcut asks for confirmation. **Open YAML** runs `code` on the file (needs the Cursor/VS Code `code` shell command on `PATH`).

```yaml
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
```

`logo` is optional. Shortcut and logo URLs must be `http:` or `https:`. Each section and shortcut needs a unique `id` (the UI assigns one on create). `collapsed` is written when you toggle a section so it survives reload.

A shortcut without `kind` that has a `url` is treated as `kind: url`. Folder shortcuts are no longer supported; legacy rows with `kind: dir` or `path` are rejected with a clear config error.

`starred` is a list of shortcut ids (not a section). Unknown or duplicate ids are dropped on load. New stars append last. The Starred row is hidden until at least one id still exists in a section.

## Page

- Click a section card to collapse or expand it
- Click a URL tile to open it in a new tab (`rel="noopener noreferrer"`)
- Star icon pins a shortcut to the top **Starred** row (not a section: no collapse, pencil, or `+`)
- Pencil icon opens add/edit. **Remove** lives on that edit modal and asks for confirmation
- **Add section** is in the header next to **Open YAML**
- **+** next to a section pencil adds a shortcut
- Add, edit, and star save immediately
- Broken logo URLs are hidden; the title stays

## Keyboard

- Just start typing anywhere on the page to search shortcuts, pages, and advertised actions in every other enabled module — no need to click the filter box first. Modal fields and modifier chords (⌘/⌃/⌥) are left alone
- With `typeToSearch: true` in `~/.config/batbelt/modules.yaml` (the default), the same keys from another module navigate to Links and seed the filter. Restart batbelt after changing that flag. The flag is ignored if Homepage is not enabled
- Module pages match their module title/id and page label/id/path. Results follow sidebar and page order; Homepage → Links is omitted because it is already open
- Actions match their module, label, description, and keywords. Selecting one runs its same-origin Batbelt API endpoint immediately and reports success or failure
- Each whitespace-separated token must appear in the shortcut's label or section title, so `argo` surfaces the whole Argo section and `argo dev` keeps only its DEV shortcut
- URLs are searched only when nothing matches on names, so a host like `argo.stg.example.dev` does not make every environment a hit for `dev`. Queries such as `dags` or `github` still find shortcuts by URL
- While filtering, sections without a match are hidden and collapsed sections show their matches. Clearing the filter restores the saved `collapsed` state — filtering never writes to the YAML
- Arrow keys move the highlight across the grid as it looks on screen. A starred shortcut is only visited in the **Starred** row; its copy inside the section is skipped
- **Enter** opens the highlighted shortcut in a new tab or navigates to the highlighted Batbelt page, **Backspace** deletes the last character, **Escape** clears the filter
- Opening a result, hiding the window, or switching away clears the filter so the next search starts empty
