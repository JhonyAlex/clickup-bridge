import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3107;
const CLICKUP_API = "https://api.clickup.com/api/v2";

app.use(express.json());

/** ------------------ Utils ------------------ **/
const AUTH = () => ({
  Authorization: process.env.CLICKUP_API_TOKEN,
  "Content-Type": "application/json",
});
const j = (r) => r.json().catch(() => ({}));
const q = (obj) =>
  new URLSearchParams(
    Object.fromEntries(
      Object.entries(obj || {}).filter(([, v]) => v !== undefined && v !== null && v !== "")
    )
  );
const toEpoch = (v) => {
  if (!v) return undefined;
  if (/^\d+$/.test(String(v))) return Number(v);
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d.getTime();
};
async function cuGet(path, params) {
  const url = params ? `${CLICKUP_API}${path}?${q(params)}` : `${CLICKUP_API}${path}`;
  const r = await fetch(url, { headers: AUTH() });
  return { ok: r.ok, status: r.status, data: await j(r) };
}
async function cuPost(path, body) {
  const r = await fetch(`${CLICKUP_API}${path}`, {
    method: "POST",
    headers: AUTH(),
    body: JSON.stringify(body),
  });
  return { ok: r.ok, status: r.status, data: await j(r) };
}

/** ------------------ Health & SSE ------------------ **/
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/sse", (_req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.write(`event: ready\ndata: ClickUp Bridge activo\n\n`);
});

/** ------------------ Proxy genérico /api/* ------------------ **/
app.all("/api/:path(*)", async (req, res) => {
  const path = req.params.path || "";
  const url = `${CLICKUP_API}/${path}`;
  const options = {
    method: req.method,
    headers: AUTH(),
    body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body),
  };
  try {
    const r = await fetch(url, options);
    const data = await j(r);
    res.status(r.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** ------------------ COMMANDS (por nombre, fechas, etc.) ------------------ **/

// 1) Buscar Space por nombre dentro de un Team
app.get("/commands/find_space", async (req, res) => {
  const { teamId, name } = req.query;
  if (!teamId || !name) return res.status(400).json({ error: "teamId and name are required" });
  const r = await cuGet(`/team/${teamId}/space`, { archived: "false" });
  if (!r.ok) return res.status(r.status).json(r.data);
  const needle = String(name).toLowerCase();
  const hits = (r.data?.spaces || []).filter((s) => (s?.name || "").toLowerCase().includes(needle));
  res.json({ hits });
});

// 2) Buscar Folder por nombre dentro de un Space
app.get("/commands/find_folder", async (req, res) => {
  const { spaceId, name } = req.query;
  if (!spaceId || !name) return res.status(400).json({ error: "spaceId and name are required" });
  const r = await cuGet(`/space/${spaceId}/folder`, { archived: "false" });
  if (!r.ok) return res.status(r.status).json(r.data);
  const needle = String(name).toLowerCase();
  const hits = (r.data?.folders || []).filter((f) => (f?.name || "").toLowerCase().includes(needle));
  res.json({ hits });
});

// 3) Buscar List por nombre (en Space o Folder)
app.get("/commands/find_list", async (req, res) => {
  const { spaceId, folderId, name } = req.query;
  if (!name || (!spaceId && !folderId))
    return res
      .status(400)
      .json({ error: "name and (spaceId or folderId) are required" });

  if (folderId) {
    const r = await cuGet(`/folder/${folderId}/list`, { archived: "false" });
    if (!r.ok) return res.status(r.status).json(r.data);
    const needle = String(name).toLowerCase();
    const hits = (r.data?.lists || []).filter((l) => (l?.name || "").toLowerCase().includes(needle));
    return res.json({ hits });
  }
  // listas directas en el space
  const r = await cuGet(`/space/${spaceId}/list`, { archived: "false" });
  if (!r.ok) return res.status(r.status).json(r.data);
  const needle = String(name).toLowerCase();
  const hits = (r.data?.lists || []).filter((l) => (l?.name || "").toLowerCase().includes(needle));
  res.json({ hits });
});

// 4) Buscar tareas con filtros: nombre parcial, fechas actualización, estado, asignado
app.get("/commands/search_tasks", async (req, res) => {
  const { listId, nameContains, updatedFrom, updatedTo, assignee, status, page, limit } = req.query;
  if (!listId) return res.status(400).json({ error: "listId is required" });

  const params = {
    page: page ?? undefined,
    limit: limit ?? 100,
    order_by: "updated",
    reverse: "true",
    "assignees[]": assignee ?? undefined,
    "statuses[]": status ?? undefined,
    date_updated_gt: toEpoch(updatedFrom),
    date_updated_lt: toEpoch(updatedTo),
  };

  const r = await cuGet(`/list/${listId}/task`, params);
  if (!r.ok) return res.status(r.status).json(r.data);

  let tasks = r.data?.tasks || [];
  if (nameContains) {
    const needle = String(nameContains).toLowerCase();
    tasks = tasks.filter((t) => (t?.name || "").toLowerCase().includes(needle));
  }
  res.json({ total: tasks.length, tasks });
});

// 5) Comentarios de una tarea
app.get("/commands/task_comments", async (req, res) => {
  const { taskId, limit } = req.query;
  if (!taskId) return res.status(400).json({ error: "taskId is required" });
  const r = await cuGet(`/task/${taskId}/comment`);
  if (!r.ok) return res.status(r.status).json(r.data);
  const comments = r.data?.comments || [];
  res.json({ total: comments.length, comments: limit ? comments.slice(0, Number(limit)) : comments });
});

// 6) Crear tarea con parámetros comunes
app.post("/commands/create_task", async (req, res) => {
  const { listId, name, description, assignees } = req.body || {};
  if (!listId || !name) return res.status(400).json({ error: "listId and name are required" });
  const r = await cuPost(`/list/${listId}/task`, { name, description, assignees });
  return res.status(r.status).json(r.data);
});

/** ------------------ Start ------------------ **/
app.listen(PORT, () => console.log(`Bridge ${PORT}`));
