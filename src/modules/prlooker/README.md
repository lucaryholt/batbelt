# PR Looker

Inbox of open GitHub pull requests: review requested (you and configured teams), assigned, authored, and mentioned.

UI: `/prlooker/inbox`.

## Requirements

- The [`gh`](https://cli.github.com/) CLI on `PATH`
- `gh auth login` already done for the host you use (`github.com` or Enterprise)

All GitHub traffic goes through `gh`. batbelt does not store a token.

## Data

`~/.config/batbelt/prlooker/config.yaml` (`0600`)

Empty is valid (`pollSeconds: 60`, `teams: []`). First start writes that file if it is missing. Edit on disk, then **Reload config**. The UI never writes the YAML.

**Open YAML** runs `code` on the file (needs the Cursor/VS Code `code` shell command on `PATH`).

```yaml
pollSeconds: 60
teams:
  - myorg/platform
```

`pollSeconds` must be an integer ≥ 30. `teams` are extra `review-requested:org/team` searches on the Review tab (and All).

## Page

- Health pill: `gh missing` / `not logged in` / `@login`
- **Refresh** reloads the inbox. While the Inbox page is visible and the document is visible, it also polls every `pollSeconds`
- Tabs: All · Review · Assigned · Authored · Mentioned, with counts
- Type to filter title, repo, or author (same “just start typing” habit as Homepage)
- Cards open the PR URL in a new tab (`rel="noopener noreferrer"`)
- Reason chips show why the PR is in the inbox (`review`, `team`, `assigned`, `authored`, `mentioned`)

Queries (all `--state=open --limit 50`):

| Tab | `gh search prs` |
| --- | --- |
| Review | `--review-requested=@me` plus one `review-requested:org/team` per configured team |
| Assigned | `--assignee=@me` |
| Authored | `--author=@me` |
| Mentioned | `--mentions=@me` |
| All | union of the four, deduped by URL |
