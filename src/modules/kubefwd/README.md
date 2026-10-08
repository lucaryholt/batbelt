# Kubefwd

Kubernetes port-forwards and GCP proxy connections.

UI: `/kubefwd/services`, `/kubefwd/proxy`, `/kubefwd/ports`, `/kubefwd/explore`.

Batbelt always uses **SQLite**. There is no Config or Contexts tab. YAML is a CLI import only.

## Requirements

- `kubectl` on `PATH`
- Access to the cluster in `cluster_context`
- `gcloud` (optional) for GCP discovery on Explore
- [sql-tap](https://github.com/mickamy/sql-tap) (optional) when a service sets `sql_tap_port`

## Data

Default database: `~/.config/batbelt/kubefwd.db`. Override with `--db`.

An empty database starts writable (`namespace: default`, no services). Explore and Add Service populate it.

Import an existing kubefwd YAML, then start:

```bash
npx tsx src/cli.ts --import-yaml ~/.kubefwd.yaml
```

The original kubefwd app keeps `~/.kubefwd.yaml` and its own SQLite files.

## Pages

| Page | What it does |
| --- | --- |
| **Services** | Start/stop `kubectl port-forward`. Add, edit, remove. Tag filter. |
| **Proxy** | Shared proxy pod (`alpine/socat`) to a GCP private IP (Cloud SQL, Memorystore). |
| **Port Checker** | Who is on the configured local ports; kill a process. |
| **Explore** | List cluster services and GCP projects; add them to SQLite. |

Live status is Server-Sent Events on `/api/kubefwd/state`. `--debug` writes kubectl traces to `/tmp/kubefwd-debug.log`.

`--default` starts services with `selected_by_default`. `--default-proxy` does the same for proxy services.

Kubefwd advertises **Start default services** to Homepage search. Searching for `start defaults` and selecting that action immediately calls the existing start-defaults API and reports the result.

## YAML import schema

Same fields as standalone kubefwd. `presets` are stored but unused. `alternative_contexts` round-trip in SQLite; there is no switch UI.

```yaml
cluster_context: gke_my-project_us-central1_my-cluster
cluster_name: Prod
namespace: default
max_retries: -1          # -1 infinite, 0 none, N times (backoff 1s…60s)
services:
  - name: API Server
    tags: [dev]
    service_name: api-service
    remote_port: 8080
    local_port: 8080
    selected_by_default: true
    # optional: id, context, namespace, max_retries
    # optional sql-tap: sql_tap_port, sql_tap_driver (postgres|mysql),
    #   sql_tap_grpc_port, sql_tap_http_port
proxy_pod_name: kubefwd-proxy
proxy_pod_image: alpine/socat:latest
proxy_services:
  - name: CloudSQL
    tags: [dev]
    target_host: 10.1.2.3
    target_port: 5432
    local_port: 5432
    selected_by_default: false
    proxy_pod_context: gke_my-project_us-central1_my-cluster
    proxy_pod_namespace: default
```

`name` may repeat if tag sets differ. `id` is optional; otherwise derived from name and tags.

Proxy entries need `proxy_pod_context` and `proxy_pod_namespace`. Global `proxy_pod_*` defaults apply when a field is omitted on the entry.
