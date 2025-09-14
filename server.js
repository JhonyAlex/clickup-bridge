import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { readFileSync } from 'fs';
import https from "https";
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3107;
const CLICKUP_API = "https://api.clickup.com/api/v2";

app.use(express.json());

/** ------------------ OAuth State ------------------ **/
let OAUTH_ACCESS_TOKEN = null;

/** ------------------ Utils ------------------ **/
const AUTH = () => ({
  Authorization: OAUTH_ACCESS_TOKEN ? `Bearer ${OAUTH_ACCESS_TOKEN}` : process.env.CLICKUP_API_TOKEN,
  "Content-Type": "application/json",
});
const j = (r) => r.json().catch(() => ({}));
const q = (params = {}) => {
  const searchParams = new URLSearchParams();
  for (const key in params) {
    const value = params[key];
    if (value !== undefined && value !== null && value !== "") {
      if (Array.isArray(value)) {
        value.forEach((v) => searchParams.append(key, v));
      } else {
        searchParams.set(key, value);
      }
    }
  }
  return searchParams;
};
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

/** ------------------ OpenAPI Endpoint ------------------ **/
// Servir el OpenAPI YAML desde el archivo OpenApi.md
app.get("/openapi.yaml", (req, res) => {
  console.log("OpenAPI endpoint hit");
  try {
    const openApiContent = readFileSync('OpenApi.md', 'utf8');
    console.log("File read successfully, length:", openApiContent.length);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(openApiContent);
  } catch (e) {
    console.error('Error reading OpenAPI file:', e);
    res.status(500).json({ error: "OpenAPI specification not found", details: e.message });
  }
});

// Test endpoint
app.get("/test-openapi", (req, res) => {
  res.json({ message: "Test endpoint works" });
});

/** ------------------ OAuth Endpoints ------------------ **/

// Iniciar flujo OAuth
app.get("/oauth/authorize", (req, res) => {
  const authUrl = `https://app.clickup.com/api?client_id=${process.env.CLICKUP_CLIENT_ID}&redirect_uri=https://clickup.zynodo.com/oauth/callback`;
  res.redirect(authUrl);
});

// Callback OAuth - intercambiar código por access token
app.get("/oauth/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).json({ error: "No authorization code received" });
  }

  try {
    const tokenResponse = await fetch("https://api.clickup.com/api/v2/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.CLICKUP_CLIENT_ID,
        client_secret: process.env.CLICKUP_CLIENT_SECRET,
        code: code,
      }),
    });

    const tokenData = await tokenResponse.json();
    if (tokenData.access_token) {
      OAUTH_ACCESS_TOKEN = tokenData.access_token;
      res.json({ 
        success: true, 
        message: "OAuth authentication successful",
        expires_in: tokenData.expires_in 
      });
    } else {
      res.status(400).json({ error: "Failed to get access token", details: tokenData });
    }
  } catch (error) {
    res.status(500).json({ error: "OAuth callback failed", details: error.message });
  }
});

// Endpoint para verificar estado OAuth
app.get("/oauth/status", (req, res) => {
  res.json({ 
    authenticated: !!OAUTH_ACCESS_TOKEN,
    token_available: !!OAUTH_ACCESS_TOKEN 
  });
});

/** ------------------ Proxy genérico /api/* ------------------ **/
app.all(/^\/api\/(.*)/, async (req, res) => {
  const path = req.params[0] || "";
  const queryString = req.url.includes('?') ? req.url.split('?')[1] : '';
  const url = queryString ? `${CLICKUP_API}/${path}?${queryString}` : `${CLICKUP_API}/${path}`;
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

// Mapeo de alias para espacios comunes
const SPACE_ALIASES = {
  'pigmea': 'PIGMEA S.L.',
  'pigmea sl': 'PIGMEA S.L.',
  'pigmea s.l.': 'PIGMEA S.L.',
  'pigmea s.l': 'PIGMEA S.L.',
  'cambio digital': 'Cambio Digital',
  'cd': 'Cambio Digital'
};

// Función para normalizar nombres de espacios
function normalizeSpaceName(name) {
  if (!name) return '';
  const normalized = String(name).toLowerCase().trim();
  return SPACE_ALIASES[normalized] || name;
}

// 0) Buscar Space INTELIGENTE con alias automático
app.get("/commands/find_space_smart", async (req, res) => {
  const { teamId, name } = req.query;
  if (!teamId || !name) return res.status(400).json({ error: "teamId and name are required" });
  
  try {
    const r = await cuGet(`/team/${teamId}/space`, { archived: "false" });
    if (!r.ok) return res.status(r.status).json(r.data);
    
    const originalName = String(name);
    const normalizedName = normalizeSpaceName(originalName);
    
    // Buscar primero con el nombre normalizado
    let needle = normalizedName.toLowerCase();
    let hits = (r.data?.spaces || []).filter((s) => (s?.name || "").toLowerCase().includes(needle));
    
    // Si no encuentra con el alias, buscar con el nombre original
    if (hits.length === 0 && normalizedName !== originalName) {
      needle = originalName.toLowerCase();
      hits = (r.data?.spaces || []).filter((s) => (s?.name || "").toLowerCase().includes(needle));
    }
    
    res.json({ 
      hits, 
      searched_as: normalizedName !== originalName ? normalizedName : originalName,
      alias_used: normalizedName !== originalName 
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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

// 4) Búsqueda avanzada de tareas
app.get("/commands/search_tasks", async (req, res) => {
  const {
    teamId,
    spaceId: initialSpaceId,
    spaceName,
    folderId,
    listId,
    assigneeId,
    assigneeName, // No usado directamente, pero podría ser para futuro find_user
    updatedFrom,
    updatedTo,
    status,
    nameContains,
    page, // page se maneja a nivel de lista, no global
    limit,
  } = req.query;

  if (!teamId && spaceName) {
    return res.status(400).json({ error: "teamId is required when using spaceName" });
  }
  if (!initialSpaceId && !spaceName && !folderId && !listId) {
    return res
      .status(400)
      .json({ error: "one of spaceId, spaceName, folderId or listId is required" });
  }

  try {
    let spaceId = initialSpaceId;
    // 1. Resolver spaceId si se proveyó spaceName
    if (spaceName && !spaceId) {
      const r = await cuGet(`/team/${teamId}/space`, { archived: "false" });
      if (!r.ok) return res.status(r.status).json(r.data);
      const needle = String(spaceName).toLowerCase();
      const foundSpace = (r.data?.spaces || []).find((s) =>
        (s?.name || "").toLowerCase().includes(needle)
      );
      if (!foundSpace) return res.status(404).json({ error: `Space '${spaceName}' not found` });
      spaceId = foundSpace.id;
    }

    // 2. Recolectar todas las listas a consultar
    const listsToFetch = [];
    if (listId) {
      // Si se da una lista, solo consultamos esa. Asumimos que es válida.
      // Para obtener el nombre, podríamos hacer un GET, pero lo omitimos por eficiencia.
      listsToFetch.push({ id: listId, name: "Unknown List" });
    } else if (folderId) {
      const r = await cuGet(`/folder/${folderId}/list`, { archived: "false" });
      if (!r.ok) return res.status(r.status).json(r.data);
      (r.data?.lists || []).forEach((l) => listsToFetch.push({ id: l.id, name: l.name }));
    } else if (spaceId) {
      // Listas directas del espacio
      const rLists = await cuGet(`/space/${spaceId}/list`, { archived: "false" });
      if (rLists.ok && rLists.data?.lists) {
        rLists.data.lists.forEach((l) => listsToFetch.push({ id: l.id, name: l.name }));
      }
      // Listas dentro de carpetas del espacio
      const rFolders = await cuGet(`/space/${spaceId}/folder`, { archived: "false" });
      if (rFolders.ok && rFolders.data?.folders) {
        for (const folder of rFolders.data.folders) {
          const rFolderLists = await cuGet(`/folder/${folder.id}/list`, { archived: "false" });
          if (rFolderLists.ok && rFolderLists.data?.lists) {
            rFolderLists.data.lists.forEach((l) => listsToFetch.push({ id: l.id, name: l.name }));
          }
        }
      }
    }

    if (listsToFetch.length === 0) {
      return res.json({ total: 0, tasks: [] });
    }

    // 3. Consultar tareas para cada lista en paralelo
    const taskParams = {
      page: page ?? undefined, // ClickUp usa 'page' como un índice, no como paginación real
      limit: Math.min(Number.isFinite(Number(limit)) ? Number(limit) : 100, 200),
      order_by: "updated",
      reverse: "true",
      "assignees[]": assigneeId?.split?.(","),
      "statuses[]": status,
      ...(toEpoch(updatedFrom) ? { date_updated_gt: toEpoch(updatedFrom) } : {}),
      ...(toEpoch(updatedTo) ? { date_updated_lt: toEpoch(updatedTo) } : {}),
      ...(status ? {} : { include_closed: true }), // si no se filtra por estado, incluir cerradas
    };

    const promises = listsToFetch.map((list) =>
      cuGet(`/list/${list.id}/task`, taskParams).then((r) => {
        if (!r.ok) return [];
        const tasks = r.data?.tasks || [];
        return tasks.map((t) => ({ ...t, _list: { id: list.id, name: list.name } }));
      })
    );

    let allTasks = (await Promise.all(promises)).flat();

    // 4. Filtrar en memoria si es necesario
    if (nameContains) {
      const needle = String(nameContains).toLowerCase();
      allTasks = allTasks.filter((t) => (t?.name || "").toLowerCase().includes(needle));
    }

    res.json({ total: allTasks.length, tasks: allTasks });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** ------------------ CREACIÓN DE TAREAS VALIDADA ------------------ **/

// Endpoint para crear tareas con validación completa
app.post("/commands/create_task_validated", async (req, res) => {
  const { 
    spaceName,
    teamId,
    taskName,
    description,
    assigneeNames, // Array de nombres de usuarios
    dueDate,
    priority = 'normal',
    folderName,
    listName,
    status = 'to do'
  } = req.body || {};
  
  // 1. Validaciones obligatorias
  const errors = [];
  if (!teamId) errors.push("teamId es obligatorio");
  if (!spaceName) errors.push("spaceName (espacio) es obligatorio");
  if (!taskName) errors.push("taskName (nombre de tarea) es obligatorio");
  if (!description) errors.push("description (descripción) es obligatoria");
  if (!assigneeNames || assigneeNames.length === 0) errors.push("assigneeNames (responsables) es obligatorio");
  if (!dueDate) errors.push("dueDate (fecha límite) es obligatoria");
  
  if (errors.length > 0) {
    return res.status(400).json({ 
      error: "Campos obligatorios faltantes", 
      missing_fields: errors 
    });
  }

  try {
    // 2. Resolver espacio con alias
    const normalizedSpaceName = normalizeSpaceName(spaceName);
    const spaceResponse = await cuGet(`/team/${teamId}/space`, { archived: "false" });
    if (!spaceResponse.ok) return res.status(spaceResponse.status).json(spaceResponse.data);
    
    const spaces = (spaceResponse.data?.spaces || []).filter(s => 
      (s?.name || "").toLowerCase().includes(normalizedSpaceName.toLowerCase())
    );
    
    if (spaces.length === 0) {
      return res.status(404).json({ 
        error: `Espacio '${spaceName}' no encontrado (buscado como '${normalizedSpaceName}')` 
      });
    }
    
    const space = spaces[0];
    
    // 3. Resolver usuarios/responsables
    const teamResponse = await cuGet(`/team/${teamId}`);
    if (!teamResponse.ok) return res.status(teamResponse.status).json(teamResponse.data);
    
    const allMembers = teamResponse.data?.team?.members || [];
    const assigneeIds = [];
    const notFound = [];
    
    for (const assigneeName of assigneeNames) {
      const member = allMembers.find(m => 
        m.user && (
          (m.user.username || "").toLowerCase().includes(assigneeName.toLowerCase()) ||
          (m.user.email || "").toLowerCase().includes(assigneeName.toLowerCase())
        )
      );
      
      if (member) {
        assigneeIds.push(member.user.id);
      } else {
        notFound.push(assigneeName);
      }
    }
    
    if (notFound.length > 0) {
      return res.status(400).json({ 
        error: "Algunos responsables no fueron encontrados", 
        not_found: notFound 
      });
    }
    
    // 4. Buscar carpeta si se especifica
    let targetFolderId = null;
    if (folderName) {
      const foldersResponse = await cuGet(`/space/${space.id}/folder`, { archived: "false" });
      if (foldersResponse.ok) {
        const folders = (foldersResponse.data?.folders || []).filter(f => 
          (f?.name || "").toLowerCase().includes(folderName.toLowerCase())
        );
        if (folders.length > 0) {
          targetFolderId = folders[0].id;
        }
      }
    }
    
    // 5. Buscar lista
    let targetListId = null;
    const listsPath = targetFolderId ? `/folder/${targetFolderId}/list` : `/space/${space.id}/list`;
    const listsResponse = await cuGet(listsPath, { archived: "false" });
    
    if (listsResponse.ok) {
      const lists = listsResponse.data?.lists || [];
      
      if (listName) {
        // Buscar lista específica
        const matchingLists = lists.filter(l => 
          (l?.name || "").toLowerCase().includes(listName.toLowerCase())
        );
        if (matchingLists.length > 0) {
          targetListId = matchingLists[0].id;
        }
      } else {
        // Usar primera lista disponible
        if (lists.length > 0) {
          targetListId = lists[0].id;
        }
      }
    }
    
    if (!targetListId) {
      return res.status(404).json({ 
        error: `No se encontró lista válida${listName ? ` con nombre '${listName}'` : ''} en ${targetFolderId ? 'carpeta' : 'espacio'}` 
      });
    }
    
    // 6. Parsear fecha límite
    const dueDateTimestamp = parseDate(dueDate);
    if (!dueDateTimestamp) {
      return res.status(400).json({ 
        error: "Formato de fecha límite inválido. Use ISO (2024-01-15) o timestamp" 
      });
    }
    
    // 7. Crear tarea
    const taskData = {
      name: taskName,
      description: description,
      assignees: assigneeIds,
      due_date: dueDateTimestamp,
      priority: priority === 'urgent' ? 1 : priority === 'high' ? 2 : priority === 'low' ? 4 : 3
    };
    
    const createResponse = await cuPost(`/list/${targetListId}/task`, taskData);
    
    if (createResponse.ok) {
      res.json({
        success: true,
        task: createResponse.data,
        metadata: {
          space_used: space.name,
          assignees_resolved: assigneeNames,
          due_date_formatted: formatDate(dueDateTimestamp),
          folder_used: targetFolderId ? folderName : null,
          list_used: targetListId
        }
      });
    } else {
      res.status(createResponse.status).json(createResponse.data);
    }
    
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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

// 7) Buscar usuarios por nombre dentro de un equipo
app.get("/commands/find_user", async (req, res) => {
  const { teamId, name } = req.query;
  if (!teamId || !name) return res.status(400).json({ error: "teamId and name are required" });

  try {
    const r = await cuGet(`/team/${teamId}`);
    if (!r.ok) return res.status(r.status).json(r.data);

    const needle = String(name).toLowerCase();
    const hits = (r.data?.team?.members || [])
      .map((m) => m.user)
      .filter(
        (u) =>
          u &&
          ((u.username || "").toLowerCase().includes(needle) ||
            (u.email || "").toLowerCase().includes(needle))
      )
      .map((u) => ({ id: u.id, username: u.username, email: u.email }));

    res.json({ hits });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** ------------------ INFORMES EJECUTIVOS MEJORADOS ------------------ **/

// Función para convertir fechas con zona horaria (España por defecto)
function parseDate(dateStr, timezone = 'Europe/Madrid') {
  if (!dateStr) return undefined;
  
  // Si ya es un timestamp
  if (/^\d+$/.test(String(dateStr))) {
    return Number(dateStr);
  }
  
  // Intentar parsear como fecha ISO
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return undefined;
  
  // Convertir a timestamp UTC
  return date.getTime();
}

// Función para formatear fecha en zona horaria específica
function formatDate(timestamp, timezone = 'Europe/Madrid') {
  if (!timestamp) return 'fecha no disponible';
  
  const date = new Date(timestamp);
  return date.toLocaleDateString('es-ES', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long', 
    day: 'numeric'
  });
}

// Endpoint para informes ejecutivos con filtro estricto por fechas
app.get("/commands/executive_report", async (req, res) => {
  const { 
    teamId, 
    spaceName, 
    from, 
    to, 
    timezone = 'Europe/Madrid',
    includeComments = 'true',
    includeDescriptions = 'false' 
  } = req.query;
  
  if (!teamId || !spaceName || !from || !to) {
    return res.status(400).json({ 
      error: "teamId, spaceName, from y to son obligatorios" 
    });
  }

  try {
    // 1. Resolver espacio con sistema de alias
    const normalizedSpaceName = normalizeSpaceName(spaceName);
    const spaceResponse = await cuGet(`/team/${teamId}/space`, { archived: "false" });
    if (!spaceResponse.ok) return res.status(spaceResponse.status).json(spaceResponse.data);
    
    const spaces = (spaceResponse.data?.spaces || []).filter(s => 
      (s?.name || "").toLowerCase().includes(normalizedSpaceName.toLowerCase())
    );
    
    if (spaces.length === 0) {
      return res.status(404).json({ 
        error: `No se encontró el espacio '${spaceName}' (buscado como '${normalizedSpaceName}')` 
      });
    }
    
    const space = spaces[0];
    
    // 2. Parsear fechas
    const fromTimestamp = parseDate(from, timezone);
    const toTimestamp = parseDate(to, timezone);
    
    if (!fromTimestamp || !toTimestamp) {
      return res.status(400).json({ 
        error: "Formato de fecha inválido. Use ISO (2024-01-15) o timestamp" 
      });
    }
    
    // 3. Buscar tareas actualizadas en el rango por listas del espacio
    const listsResponse = await cuGet(`/space/${space.id}/list`, { archived: "false" });
    if (!listsResponse.ok) return res.status(listsResponse.status).json(listsResponse.data);
    
    const lists = listsResponse.data?.lists || [];
    let allTasks = [];
    
    // Obtener tareas de cada lista
    for (const list of lists) {
      const tasksResponse = await cuGet(`/list/${list.id}/task`, {
        include_closed: "true",
        date_updated_gt: fromTimestamp,
        date_updated_lt: toTimestamp + (24 * 60 * 60 * 1000)
      });
      
      if (tasksResponse.ok) {
        allTasks.push(...(tasksResponse.data?.tasks || []));
      }
    }
    
    // Filtrar tareas por fecha de actualización
    const tasks = allTasks.filter(task => {
      const updatedDate = parseInt(task.date_updated);
      return updatedDate >= fromTimestamp && updatedDate <= (toTimestamp + (24 * 60 * 60 * 1000));
    });
    
    // 4. Generar informe con estilo impersonal
    const report = {
      period: {
        from: formatDate(fromTimestamp, timezone),
        to: formatDate(toTimestamp, timezone),
        timezone: timezone
      },
      space: {
        name: space.name,
        searched_as: normalizedSpaceName,
        alias_used: normalizedSpaceName !== spaceName
      },
      summary: {
        total_tasks_updated: tasks.length,
        tasks_by_status: {}
      },
      activities: []
    };
    
    // 5. Procesar cada tarea
    for (const task of tasks) {
      const status = task.status?.status || 'sin estado';
      report.summary.tasks_by_status[status] = (report.summary.tasks_by_status[status] || 0) + 1;
      
      const activity = {
        task_id: task.id,
        task_name: task.name,
        status: status,
        updated_date: formatDate(task.date_updated, timezone),
        assignees: task.assignees?.map(a => a.username) || [],
        action: `Se actualizó la tarea "${task.name}"`
      };
      
      // 6. Agregar comentarios si están en el rango y se solicitan
      if (includeComments === 'true') {
        const commentsResponse = await cuGet(`/task/${task.id}/comment`);
        if (commentsResponse.ok) {
          const comments = (commentsResponse.data?.comments || []).filter(comment => {
            const commentDate = parseInt(comment.date);
            return commentDate >= fromTimestamp && commentDate <= toTimestamp + (24 * 60 * 60 * 1000);
          });
          
          if (comments.length > 0) {
            activity.comments = comments.map(c => ({
              text: c.comment_text || c.comment,
              author: c.user?.username || 'Usuario desconocido',
              date: formatDate(parseInt(c.date), timezone)
            }));
          }
        }
      }
      
      report.activities.push(activity);
    }
    
    res.json(report);
    
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 7) Buscar usuarios por nombre dentro de un equipo (DUPLICADO - REMOVIDO)
app.get("/commands/find_user", async (req, res) => {
  const { teamId, name } = req.query;
  if (!teamId || !name) {
    return res.status(400).json({ error: "teamId and name are required" });
  }

  try {
    // La API de ClickUp no tiene un endpoint para buscar usuarios por nombre.
    // Obtenemos los detalles del equipo, que incluye la lista de miembros.
    const r = await cuGet(`/team/${teamId}`);
    if (!r.ok) return res.status(r.status).json(r.data);

    const needle = String(name).toLowerCase();
    const members = r.data?.team?.members || [];
    const hits = members
      .map((m) => m.user)
      .filter(
        (u) =>
          u &&
          ((u.username || "").toLowerCase().includes(needle) ||
            (u.email || "").toLowerCase().includes(needle))
      )
      .map((u) => ({ id: u.id, username: u.username, email: u.email }));

    res.json({ hits });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** ------------------ SMART SEARCH ENDPOINTS (Anti-ResponseTooLargeError) ------------------ **/

// Endpoint inteligente para buscar carpetas que evita ResponseTooLargeError
app.get("/commands/smart_find_folder", async (req, res) => {
  const { spaceId, name, limit = 20 } = req.query;
  
  if (!spaceId) {
    return res.status(400).json({ error: "spaceId is required" });
  }
  
  try {
    // Si no hay filtro de nombre, solo devolver las primeras carpetas sin buscar todo
    if (!name) {
      return res.status(400).json({ 
        error: "name filter is required to prevent ResponseTooLargeError",
        suggestion: "Use 'name' parameter to filter folders (e.g., 'Super', 'Client', etc.)"
      });
    }
    
    // Intento optimizado: buscar con filtro aplicado
    const needle = String(name).toLowerCase();
    
    // Usar el endpoint existente que ya maneja bien los filtros
    const r = await cuGet(`/space/${spaceId}/folder`, { 
      archived: "false",
      limit: Math.min(parseInt(limit) || 20, 100)
    });
    
    if (!r.ok) {
      // Si falla por ResponseTooLargeError, sugerir filtros más específicos
      if (r.status === 413 || (r.data && String(r.data).includes("ResponseTooLargeError"))) {
        return res.status(413).json({
          error: "ResponseTooLargeError: too many folders in space",
          suggestion: `Try a more specific search term. Current filter: "${name}"`,
          solutions: [
            "Use more specific keywords (e.g., instead of 'Super' try 'Super Genéricos')",
            "Add additional filters to narrow down results",
            "Contact admin to organize folders better"
          ]
        });
      }
      return res.status(r.status).json(r.data);
    }
    
    // Filtrar en memoria para búsqueda inteligente
    const hits = (r.data?.folders || []).filter((f) => 
      (f?.name || "").toLowerCase().includes(needle)
    );
    
    res.json({ 
      hits,
      total: hits.length,
      searched_term: name,
      space_id: spaceId,
      suggestion: hits.length === 0 ? "Try a different search term or check folder names" : null
    });
    
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Endpoint inteligente para crear tareas con búsqueda automática MEJORADO
app.post("/commands/smart_create_task", async (req, res) => {
  const { 
    teamId,
    spaceName,
    folderNameFilter, // Filtro específico manual
    listNameFilter,   // Filtro específico manual
    taskName,
    description,
    assigneeNames,
    dueDate,
    priority = 'normal',
    // NUEVO: Contexto natural para extracción automática
    naturalContext    // Ej: "crea una tarea en clientes, somos puertas"
  } = req.body || {};
  
  // Validaciones básicas
  if (!teamId || !spaceName || !taskName || !description) {
    return res.status(400).json({ 
      error: "teamId, spaceName, taskName y description son obligatorios" 
    });
  }

  try {
    // 1. Buscar espacio
    const normalizedSpaceName = normalizeSpaceName(spaceName);
    const spaceResponse = await cuGet(`/team/${teamId}/space`, { archived: "false" });
    if (!spaceResponse.ok) return res.status(spaceResponse.status).json(spaceResponse.data);
    
    const spaces = (spaceResponse.data?.spaces || []).filter(s => 
      (s?.name || "").toLowerCase().includes(normalizedSpaceName.toLowerCase())
    );
    
    if (spaces.length === 0) {
      return res.status(404).json({ 
        error: `Espacio '${spaceName}' no encontrado` 
      });
    }
    
    const space = spaces[0];
    
    // 2. LÓGICA INTELIGENTE: Extraer términos de búsqueda automáticamente
    let smartFolderTerms = [];
    let smartListTerms = [];
    
    if (naturalContext) {
      // Extraer palabras clave del contexto natural
      const contextWords = naturalContext
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ') // Remover puntuación
        .split(/\s+/)
        .filter(word => 
          word.length > 2 && // Palabras de más de 2 caracteres
          !['crea', 'crear', 'una', 'tarea', 'en', 'el', 'la', 'los', 'las', 'de', 'del', 'con', 'para', 'por', 'que', 'como', 'cuando', 'donde'].includes(word)
        );
      
      // Los primeros términos significativos se usan para carpetas
      smartFolderTerms = contextWords.slice(0, 3);
      smartListTerms = ['tarea', 'task', 'proyecto', 'list']; // Términos comunes para listas
    }
    
    // 3. Buscar carpeta con múltiples estrategias
    let targetFolderId = null;
    let folderSearchResult = null;
    
    // Estrategia 1: Filtro manual especificado
    if (folderNameFilter) {
      try {
        const folderSearchResponse = await cuGet(`/space/${space.id}/folder`, { archived: "false" });
        
        if (folderSearchResponse.ok) {
          const folders = (folderSearchResponse.data?.folders || []).filter(f => 
            (f?.name || "").toLowerCase().includes(folderNameFilter.toLowerCase())
          );
          
          if (folders.length > 0) {
            targetFolderId = folders[0].id;
            folderSearchResult = {
              found: true,
              folder_name: folders[0].name,
              search_strategy: "manual_filter",
              search_term: folderNameFilter
            };
          }
        }
      } catch (error) {
        // Continuar con otras estrategias
      }
    }
    
    // Estrategia 2: Búsqueda inteligente con contexto natural
    if (!targetFolderId && smartFolderTerms.length > 0) {
      try {
        const folderSearchResponse = await cuGet(`/space/${space.id}/folder`, { archived: "false" });
        
        if (folderSearchResponse.ok) {
          const folders = folderSearchResponse.data?.folders || [];
          
          // Buscar con cada término extraído
          for (const term of smartFolderTerms) {
            const matchingFolders = folders.filter(f => 
              (f?.name || "").toLowerCase().includes(term.toLowerCase())
            );
            
            if (matchingFolders.length > 0) {
              targetFolderId = matchingFolders[0].id;
              folderSearchResult = {
                found: true,
                folder_name: matchingFolders[0].name,
                search_strategy: "smart_extraction",
                search_term: term,
                extracted_terms: smartFolderTerms,
                natural_context: naturalContext
              };
              break;
            }
          }
          
          // Si no encuentra con términos individuales, probar combinaciones
          if (!targetFolderId && smartFolderTerms.length > 1) {
            const combinedTerm = smartFolderTerms.join(' ');
            const combinedFolders = folders.filter(f => {
              const folderName = (f?.name || "").toLowerCase();
              return smartFolderTerms.some(term => folderName.includes(term.toLowerCase()));
            });
            
            if (combinedFolders.length > 0) {
              targetFolderId = combinedFolders[0].id;
              folderSearchResult = {
                found: true,
                folder_name: combinedFolders[0].name,
                search_strategy: "smart_combination",
                search_terms: smartFolderTerms,
                natural_context: naturalContext
              };
            }
          }
        }
      } catch (error) {
        folderSearchResult = {
          found: false,
          error: "Error en búsqueda inteligente",
          search_strategy: "smart_extraction_failed",
          extracted_terms: smartFolderTerms
        };
      }
    }
    
    // Estrategia 3: Si no encuentra nada, no usar carpeta específica
    if (!folderSearchResult) {
      folderSearchResult = {
        found: false,
        search_strategy: "none",
        message: "No se especificó filtro de carpeta, usando espacio raíz"
      };
    }
    
    // 4. Buscar lista con lógica similar
    let targetListId = null;
    let listSearchResult = null;
    
    const listsPath = targetFolderId ? `/folder/${targetFolderId}/list` : `/space/${space.id}/list`;
    const listsResponse = await cuGet(listsPath, { archived: "false" });
    
    if (listsResponse.ok) {
      const lists = listsResponse.data?.lists || [];
      
      // Estrategia 1: Filtro manual
      if (listNameFilter) {
        const matchingLists = lists.filter(l => 
          (l?.name || "").toLowerCase().includes(listNameFilter.toLowerCase())
        );
        
        if (matchingLists.length > 0) {
          targetListId = matchingLists[0].id;
          listSearchResult = {
            found: true,
            list_name: matchingLists[0].name,
            search_strategy: "manual_filter",
            search_term: listNameFilter
          };
        }
      }
      
      // Estrategia 2: Búsqueda inteligente
      if (!targetListId && naturalContext) {
        for (const term of smartListTerms) {
          const matchingLists = lists.filter(l => 
            (l?.name || "").toLowerCase().includes(term.toLowerCase())
          );
          
          if (matchingLists.length > 0) {
            targetListId = matchingLists[0].id;
            listSearchResult = {
              found: true,
              list_name: matchingLists[0].name,
              search_strategy: "smart_extraction",
              search_term: term
            };
            break;
          }
        }
      }
      
      // Estrategia 3: Usar primera lista disponible
      if (!targetListId && lists.length > 0) {
        targetListId = lists[0].id;
        listSearchResult = {
          found: true,
          list_name: lists[0].name,
          search_strategy: "auto_select_first",
          auto_selected: true
        };
      }
    }
    
    if (!targetListId) {
      return res.status(404).json({ 
        error: "No se encontró lista válida",
        folder_search: folderSearchResult,
        list_search: { found: false, error: "No lists available" }
      });
    }
    
    // 5. Resolver usuarios si se especifican
    let assigneeIds = [];
    let assigneeSearchResult = null;
    
    if (assigneeNames && assigneeNames.length > 0) {
      const teamResponse = await cuGet(`/team/${teamId}`);
      if (teamResponse.ok) {
        const allMembers = teamResponse.data?.team?.members || [];
        const notFound = [];
        
        for (const assigneeName of assigneeNames) {
          const member = allMembers.find(m => 
            m.user && (
              (m.user.username || "").toLowerCase().includes(assigneeName.toLowerCase()) ||
              (m.user.email || "").toLowerCase().includes(assigneeName.toLowerCase())
            )
          );
          
          if (member) {
            assigneeIds.push(member.user.id);
          } else {
            notFound.push(assigneeName);
          }
        }
        
        assigneeSearchResult = {
          resolved: assigneeIds.length,
          not_found: notFound
        };
      }
    }
    
    // 6. Crear tarea
    const taskData = {
      name: taskName,
      description: description,
      ...(assigneeIds.length > 0 && { assignees: assigneeIds }),
      ...(dueDate && { due_date: parseDate(dueDate) }),
      priority: priority === 'urgent' ? 1 : priority === 'high' ? 2 : priority === 'low' ? 4 : 3
    };
    
    const createResponse = await cuPost(`/list/${targetListId}/task`, taskData);
    
    res.status(createResponse.status).json({
      ...createResponse.data,
      search_metadata: {
        space_used: space.name,
        folder_search: folderSearchResult,
        list_search: listSearchResult,
        assignee_search: assigneeSearchResult,
        intelligence_used: !!naturalContext,
        extracted_terms: naturalContext ? smartFolderTerms : null
      }
    });
    
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Endpoint inteligente para buscar documentos con filtros automáticos
app.get("/commands/smart_find_docs", async (req, res) => {
  const { workspaceId, nameFilter, limit = 25 } = req.query;
  
  if (!workspaceId) {
    return res.status(400).json({ error: "workspaceId is required" });
  }
  
  if (!nameFilter) {
    return res.status(400).json({ 
      error: "nameFilter is required to prevent ResponseTooLargeError",
      suggestion: "Use 'nameFilter' parameter to search documents (e.g., 'report', 'manual', etc.)"
    });
  }

  try {
    // Buscar con límite para evitar ResponseTooLargeError
    const r = await cuGetV3(`/workspaces/${workspaceId}/docs`, { 
      limit: Math.min(parseInt(limit) || 25, 50),
      deleted: false,
      archived: false
    });
    
    if (!r.ok) {
      if (r.status === 413 || (r.data && String(r.data).includes("ResponseTooLargeError"))) {
        return res.status(413).json({
          error: "ResponseTooLargeError: too many documents in workspace",
          suggestion: `Try a more specific filter. Current: "${nameFilter}"`,
          solutions: [
            "Use more specific keywords",
            "Contact admin to organize documents better",
            "Use date ranges if available"
          ]
        });
      }
      return res.status(r.status).json(r.data);
    }

    // Filtrar en memoria
    const needle = String(nameFilter).toLowerCase();
    const hits = (r.data.docs || []).filter(doc => 
      (doc.name || "").toLowerCase().includes(needle)
    );

    res.json({ 
      hits,
      total: hits.length,
      searched_term: nameFilter,
      workspace_id: workspaceId,
      suggestion: hits.length === 0 ? "Try a different search term" : null
    });
    
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Endpoint ULTRA INTELIGENTE para procesamiento de lenguaje natural
app.post("/commands/nlp_create_task", async (req, res) => {
  const { 
    teamId,
    naturalRequest, // Ej: "crea una tarea en clientes, somos puertas, asignar a juan, urgente"
    // Campos opcionales que override el NLP
    spaceName,
    taskName,
    description,
    priority,
    assigneeNames,
    dueDate
  } = req.body || {};
  
  if (!teamId || !naturalRequest) {
    return res.status(400).json({ 
      error: "teamId y naturalRequest son obligatorios",
      example: "naturalRequest: 'crea una tarea en clientes, somos puertas, revisar propuesta, asignar a juan'"
    });
  }

  try {
    // ANÁLISIS NLP DEL TEXTO NATURAL
    const nlpResult = parseNaturalRequest(naturalRequest);
    
    // Combinar datos extraídos con override manual
    const finalData = {
      teamId,
      spaceName: spaceName || nlpResult.spaceName || 'clientes',
      naturalContext: naturalRequest,
      taskName: taskName || nlpResult.taskName || 'Tarea extraída automáticamente',
      description: description || nlpResult.description || `Tarea creada desde: "${naturalRequest}"`,
      priority: priority || nlpResult.priority || 'normal',
      assigneeNames: assigneeNames || nlpResult.assigneeNames || [],
      dueDate: dueDate || nlpResult.dueDate
    };
    
    // Usar el endpoint inteligente existente
    const smartRequest = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(finalData)
    };
    
    // Llamar internamente al endpoint smart_create_task
    const internalUrl = `http://localhost:${PORT}/commands/smart_create_task`;
    const response = await fetch(internalUrl, smartRequest);
    const result = await response.json();
    
    // Agregar metadatos de NLP
    if (response.ok && result.search_metadata) {
      result.search_metadata.nlp_analysis = nlpResult;
      result.search_metadata.original_request = naturalRequest;
    }
    
    res.status(response.status).json(result);
    
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Función para parsear peticiones en lenguaje natural
function parseNaturalRequest(text) {
  const normalizedText = text.toLowerCase().trim();
  
  // Extraer espacio (clientes, proyectos, etc.)
  let spaceName = null;
  const spacePatterns = [
    /(?:en |del |espacio |space )([\w\s]+?)(?:,|\s+(?:crear|crea|para|asign|urgente|normal|baj|alt))/g,
    /(?:clientes?|cliente)/g,
    /(?:proyectos?|proyecto)/g,
    /(?:ventas?|venta)/g
  ];
  
  for (const pattern of spacePatterns) {
    const match = pattern.exec(normalizedText);
    if (match) {
      spaceName = match[1] ? match[1].trim() : match[0].trim();
      break;
    }
  }
  
  // Extraer términos para carpetas (empresas, nombres de clientes)
  const folderTerms = [];
  const excludeWords = ['crea', 'crear', 'una', 'tarea', 'en', 'el', 'la', 'los', 'las', 'de', 'del', 'con', 'para', 'por', 'que', 'como', 'cuando', 'donde', 'asignar', 'asignado', 'urgente', 'normal', 'baja', 'alta', 'prioridad'];
  
  // Buscar nombres propios o términos únicos
  const words = normalizedText
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => 
      word.length > 2 && 
      !excludeWords.includes(word) &&
      !/^\d+$/.test(word) // No números
    );
  
  // Los primeros 2-3 términos significativos después del espacio son candidatos a carpeta
  const spaceIndex = words.findIndex(w => ['en', 'del', 'espacio'].includes(w));
  if (spaceIndex >= 0 && spaceIndex < words.length - 1) {
    folderTerms.push(...words.slice(spaceIndex + 2, spaceIndex + 5));
  } else {
    folderTerms.push(...words.slice(0, 3));
  }
  
  // Extraer nombre de tarea
  let taskName = null;
  const taskPatterns = [
    /(?:tarea|task)[\s:]+"([^"]+)"/g,
    /(?:para|sobre|revisar|crear|hacer|trabajar en)\s+([\w\s]+?)(?:,|\s+(?:asign|urgent|normal|baj|alt|$))/g
  ];
  
  for (const pattern of taskPatterns) {
    const match = pattern.exec(normalizedText);
    if (match && match[1]) {
      taskName = match[1].trim();
      break;
    }
  }
  
  // Extraer descripción automática
  let description = `Tarea creada automáticamente desde: "${text}"`;
  if (folderTerms.length > 0) {
    description += `\nCliente/Carpeta: ${folderTerms.join(', ')}`;
  }
  
  // Extraer prioridad
  let priority = 'normal';
  if (/urgente?|urgent|alta?|high/i.test(normalizedText)) {
    priority = 'urgent';
  } else if (/baja?|low/i.test(normalizedText)) {
    priority = 'low';
  }
  
  // Extraer asignados
  const assigneeNames = [];
  const assigneePatterns = [
    /(?:asignar?|asignado)\s+a\s+([\w\s,]+?)(?:,|\s+(?:urgent|normal|baj|alt|$))/g,
    /(?:para|@)\s*([\w\.]+@[\w\.]+)/g, // emails
    /(?:para|@)\s*([\w]+)(?:\s|$|,)/g  // usernames
  ];
  
  for (const pattern of assigneePatterns) {
    let match;
    while ((match = pattern.exec(normalizedText)) !== null) {
      if (match[1]) {
        // Separar múltiples nombres
        const names = match[1].split(',').map(n => n.trim()).filter(n => n.length > 0);
        assigneeNames.push(...names);
      }
    }
  }
  
  // Extraer fecha límite
  let dueDate = null;
  const datePatterns = [
    /(?:para|fecha|límite|deadline)\s*:?\s*(\d{4}-\d{2}-\d{2})/g,
    /(?:para|fecha|límite|deadline)\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/g,
    /(?:mañana|tomorrow)/g,
    /(?:próxima semana|next week)/g
  ];
  
  for (const pattern of datePatterns) {
    const match = pattern.exec(normalizedText);
    if (match) {
      if (match[1]) {
        dueDate = match[1];
      } else if (match[0].includes('mañana')) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        dueDate = tomorrow.toISOString().split('T')[0];
      } else if (match[0].includes('próxima') || match[0].includes('next')) {
        const nextWeek = new Date();
        nextWeek.setDate(nextWeek.getDate() + 7);
        dueDate = nextWeek.toISOString().split('T')[0];
      }
      break;
    }
  }
  
  return {
    spaceName,
    folderTerms,
    taskName,
    description,
    priority,
    assigneeNames,
    dueDate,
    confidence: {
      space: spaceName ? 0.8 : 0.2,
      folder: folderTerms.length > 0 ? 0.9 : 0.1,
      task: taskName ? 0.9 : 0.3,
      assignee: assigneeNames.length > 0 ? 0.8 : 0.0,
      priority: priority !== 'normal' ? 0.7 : 0.3,
      date: dueDate ? 0.9 : 0.0
    }
  };
}

/** ------------------ DOCS ENDPOINTS (API v3) ------------------ **/

// Función auxiliar para API v3 (documentos)
const CLICKUP_API_V3 = "https://api.clickup.com/api/v3";
async function cuGetV3(path, params) {
  const url = params ? `${CLICKUP_API_V3}${path}?${q(params)}` : `${CLICKUP_API_V3}${path}`;
  const r = await fetch(url, { headers: AUTH() });
  return { ok: r.ok, status: r.status, data: await j(r) };
}

// 1) Obtener workspaces (necesario para buscar documentos)
app.get("/commands/workspaces", async (req, res) => {
  try {
    const r = await cuGet("/team");
    if (!r.ok) return res.status(r.status).json(r.data);
    
    // Extraer workspaces de teams
    const workspaces = [];
    if (r.data.teams) {
      for (const team of r.data.teams) {
        workspaces.push({
          id: team.id,
          name: team.name,
          type: "team"
        });
      }
    }
    
    res.json({ workspaces });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2) Buscar documentos en un workspace
app.get("/commands/search_docs", async (req, res) => {
  const { workspaceId, limit = 50, creator, deleted = false, archived = false, parent_id, parent_type } = req.query;
  
  if (!workspaceId) {
    return res.status(400).json({ error: "workspaceId is required" });
  }

  try {
    const params = {
      limit: Math.min(parseInt(limit) || 50, 100),
      deleted: deleted === 'true',
      archived: archived === 'true'
    };
    
    if (creator) params.creator = creator;
    if (parent_id) params.parent_id = parent_id;
    if (parent_type) params.parent_type = parent_type;

    const r = await cuGetV3(`/workspaces/${workspaceId}/docs`, params);
    res.status(r.status).json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3) Obtener detalles de un documento específico
app.get("/commands/get_doc", async (req, res) => {
  const { workspaceId, docId } = req.query;
  
  if (!workspaceId || !docId) {
    return res.status(400).json({ error: "workspaceId and docId are required" });
  }

  try {
    const r = await cuGetV3(`/workspaces/${workspaceId}/docs/${docId}`);
    res.status(r.status).json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 4) Obtener páginas de un documento (contenido)
app.get("/commands/get_doc_pages", async (req, res) => {
  const { workspaceId, docId } = req.query;
  
  if (!workspaceId || !docId) {
    return res.status(400).json({ error: "workspaceId and docId are required" });
  }

  try {
    const r = await cuGetV3(`/workspaces/${workspaceId}/docs/${docId}/pages`);
    res.status(r.status).json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 5) Buscar documentos por nombre (comando de alto nivel)
app.get("/commands/find_docs", async (req, res) => {
  const { workspaceId, name, limit = 50 } = req.query;
  
  if (!workspaceId || !name) {
    return res.status(400).json({ error: "workspaceId and name are required" });
  }

  try {
    // Buscar todos los documentos
    const r = await cuGetV3(`/workspaces/${workspaceId}/docs`, { 
      limit: Math.min(parseInt(limit) || 50, 100)
    });
    
    if (!r.ok) return res.status(r.status).json(r.data);

    // Filtrar por nombre
    const needle = String(name).toLowerCase();
    const hits = (r.data.docs || []).filter(doc => 
      (doc.name || "").toLowerCase().includes(needle)
    );

    res.json({ hits, total: hits.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 7) ENDPOINT DE BÚSQUEDA UNIFICADA INTELIGENTE (Anti-ResponseTooLargeError)
app.get("/commands/find", async (req, res) => {
  const { 
    teamId,
    workspaceId,  // Para documentos
    query,        // Término de búsqueda obligatorio
    type = 'all', // 'spaces', 'folders', 'lists', 'tasks', 'users', 'docs', 'all'
    limit = 20    // Límite por tipo
  } = req.query;
  
  if (!query) {
    return res.status(400).json({ 
      error: "query parameter is required to prevent ResponseTooLargeError",
      example: "/commands/find?query=client&type=all&teamId=123",
      supported_types: ['spaces', 'folders', 'lists', 'tasks', 'users', 'docs', 'all']
    });
  }
  
  if (type !== 'docs' && !teamId) {
    return res.status(400).json({ error: "teamId is required for non-doc searches" });
  }
  
  if (type === 'docs' && !workspaceId) {
    return res.status(400).json({ error: "workspaceId is required for document searches" });
  }

  try {
    const results = {};
    const searchTerm = String(query).toLowerCase();
    const searchLimit = Math.min(parseInt(limit) || 20, 50);
    
    // SPACES
    if (type === 'all' || type === 'spaces') {
      try {
        const normalizedQuery = normalizeSpaceName(query);
        const spaceResponse = await cuGet(`/team/${teamId}/space`, { archived: "false" });
        if (spaceResponse.ok) {
          results.spaces = (spaceResponse.data?.spaces || [])
            .filter(s => (s?.name || "").toLowerCase().includes(normalizedQuery.toLowerCase()))
            .slice(0, searchLimit)
            .map(s => ({ id: s.id, name: s.name, type: 'space' }));
        }
      } catch (e) {
        results.spaces = { error: e.message };
      }
    }
    
    // USERS
    if (type === 'all' || type === 'users') {
      try {
        const teamResponse = await cuGet(`/team/${teamId}`);
        if (teamResponse.ok) {
          results.users = (teamResponse.data?.team?.members || [])
            .map(m => m.user)
            .filter(u => u && (
              (u.username || "").toLowerCase().includes(searchTerm) ||
              (u.email || "").toLowerCase().includes(searchTerm)
            ))
            .slice(0, searchLimit)
            .map(u => ({ id: u.id, username: u.username, email: u.email, type: 'user' }));
        }
      } catch (e) {
        results.users = { error: e.message };
      }
    }
    
    // DOCS (solo si se proporciona workspaceId)
    if ((type === 'all' || type === 'docs') && workspaceId) {
      try {
        const docsResponse = await cuGetV3(`/workspaces/${workspaceId}/docs`, { 
          limit: searchLimit,
          deleted: false,
          archived: false
        });
        if (docsResponse.ok) {
          results.docs = (docsResponse.data.docs || [])
            .filter(d => (d.name || "").toLowerCase().includes(searchTerm))
            .slice(0, searchLimit)
            .map(d => ({ id: d.id, name: d.name, creator: d.creator, type: 'document' }));
        }
      } catch (e) {
        results.docs = { error: e.message };
      }
    }
    
    // FOLDERS, LISTS, TASKS (requieren más contexto, solo si se especifica explícitamente)
    if (type === 'folders' || type === 'lists' || type === 'tasks') {
      results.message = `Para buscar ${type}, usa los endpoints específicos: smart_find_folder, find_list, search_tasks`;
      results.suggestion = "Estos tipos requieren spaceId/folderId para evitar ResponseTooLargeError";
    }
    
    // Calcular totales
    const totalResults = Object.values(results)
      .filter(r => Array.isArray(r))
      .reduce((sum, arr) => sum + arr.length, 0);
    
    res.json({
      query: query,
      total_results: totalResults,
      search_type: type,
      limit_per_type: searchLimit,
      results,
      suggestion: totalResults === 0 ? "Try a different search term or check spelling" : null
    });
    
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** ------------------ Start ------------------ **/
const httpsOptions = {
  key: readFileSync("key.pem"),
  cert: readFileSync("cert.pem"),
};
https.createServer(httpsOptions, app).listen(PORT, () => {
  console.log(`Bridge HTTPS running on port ${PORT}`);
});
