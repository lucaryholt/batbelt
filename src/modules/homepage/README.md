# Homepage

First batbelt page. Collapsible sections of shortcuts that open in a new tab.

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
        label: Dev
        url: https://airflow-dev.example.com
      - id: a2
        label: Prod
        url: https://airflow-prod.example.com
```

`logo` is optional. Shortcut and logo URLs must be `http:` or `https:`. Each section and shortcut needs a unique `id` (the UI assigns one on create). `collapsed` is written when you toggle a section so it survives reload.

`starred` is a list of shortcut ids (not a section). Unknown or duplicate ids are dropped on load. New stars append last. The Starred row is hidden until at least one id still exists in a section.

## Page

- Click a section card to collapse or expand it
- Click a shortcut tile to open it in a new tab (`rel="noopener noreferrer"`)
- Star icon pins a shortcut to the top **Starred** row (not a section: no collapse, pencil, or `+`)
- Pencil icon opens add/edit. **Remove** lives on that edit modal and asks for confirmation
- **Add section** is in the header next to **Open YAML**
- **+** next to a section pencil adds a shortcut
- Add, edit, and star save immediately
- Broken logo URLs are hidden; the title stays

## Keyboard

- Just start typing anywhere on the page to filter — no need to click the filter box first. Modal fields and modifier chords (⌘/⌃/⌥) are left alone
- Each whitespace-separated token must appear in the shortcut's label or section title, so `argo` surfaces the whole Argo section and `argo dev` keeps only its DEV shortcut
- URLs are searched only when nothing matches on names, so a host like `argo.stg.gwos.dev` does not make every environment a hit for `dev`. Queries such as `dags` or `github` still find shortcuts by URL
- While filtering, sections without a match are hidden and collapsed sections show their matches. Clearing the filter restores the saved `collapsed` state — filtering never writes to the YAML
- Arrow keys move the highlight across the grid as it looks on screen. A starred shortcut is only visited in the **Starred** row; its copy inside the section is skipped
- **Enter** opens the highlighted shortcut in a new tab, **Backspace** deletes the last character, **Escape** clears the filter
- Opening a shortcut, hiding the window, or switching away clears the filter so the next search starts empty
