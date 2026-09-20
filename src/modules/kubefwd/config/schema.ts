import { z } from "zod";

const port = z.number().int();

export const alternativeContextSchema = z.object({
  name: z.string(),
  context: z.string(),
});

export const presetSchema = z.object({
  name: z.string(),
  services: z.array(z.string()).default([]),
});

const sqlTapDriver = z.string().optional().default("");

const tagsSchema = z
  .union([z.array(z.string()), z.string()])
  .optional()
  .transform((v) => {
    if (v === undefined) return [];
    if (typeof v === "string") return v.trim() ? [v] : [];
    return v;
  });

export const serviceSchema = z.object({
  id: z.string().optional().default(""),
  name: z.string(),
  tags: tagsSchema,
  service_name: z.string(),
  remote_port: port,
  local_port: port,
  selected_by_default: z.boolean().optional().default(false),
  context: z.string().optional().default(""),
  namespace: z.string().optional().default(""),
  max_retries: z.number().int().optional(),
  sql_tap_port: z.number().int().optional().nullable(),
  sql_tap_driver: sqlTapDriver,
  sql_tap_grpc_port: z.number().int().optional().nullable(),
  sql_tap_http_port: z.number().int().optional().nullable(),
});

export const proxyServiceSchema = z.object({
  id: z.string().optional().default(""),
  name: z.string(),
  tags: tagsSchema,
  target_host: z.string(),
  target_port: port,
  local_port: port,
  selected_by_default: z.boolean().optional().default(false),
  proxy_pod_context: z.string().optional().default(""),
  proxy_pod_namespace: z.string().optional().default(""),
  max_retries: z.number().int().optional(),
  sql_tap_port: z.number().int().optional().nullable(),
  sql_tap_driver: sqlTapDriver,
  sql_tap_grpc_port: z.number().int().optional().nullable(),
  sql_tap_http_port: z.number().int().optional().nullable(),
});

export const rawConfigSchema = z
  .object({
    cluster_context: z.string().optional().default(""),
    cluster_name: z.string().optional().default(""),
    namespace: z.string().optional().default(""),
    max_retries: z.number().int().optional(),
    web_port: z.number().int().optional(),
    alternative_contexts: z.array(alternativeContextSchema).optional().default([]),
    presets: z.array(presetSchema).optional().default([]),
    services: z.array(serviceSchema).optional().default([]),
    proxy_pod_name: z.string().optional().default(""),
    proxy_pod_image: z.string().optional().default(""),
    proxy_pod_context: z.string().optional().default(""),
    proxy_pod_namespace: z.string().optional().default(""),
    proxy_services: z.array(proxyServiceSchema).optional().default([]),
  })
  .passthrough();
