import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
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
    dateFrom, 
    dateTo, 
    timezone = 'Europe/Madrid',
    includeComments = 'true',
    includeDescriptions = 'false' 
  } = req.query;
  
  if (!teamId || !spaceName || !dateFrom || !dateTo) {
    return res.status(400).json({ 
      error: "teamId, spaceName, dateFrom y dateTo son obligatorios" 
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
    const fromTimestamp = parseDate(dateFrom, timezone);
    const toTimestamp = parseDate(dateTo, timezone);
    
    if (!fromTimestamp || !toTimestamp) {
      return res.status(400).json({ 
        error: "Formato de fecha inválido. Use ISO (2024-01-15) o timestamp" 
      });
    }
    
    // 3. Buscar tareas actualizadas en el rango
    const tasksResponse = await cuGet("/task", {
      space_ids: [space.id],
      date_updated_gt: fromTimestamp,
      date_updated_lt: toTimestamp + (24 * 60 * 60 * 1000) // +1 día para incluir todo el día
    });
    
    if (!tasksResponse.ok) return res.status(tasksResponse.status).json(tasksResponse.data);
    
    const tasks = tasksResponse.data?.tasks || [];
    
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

/** ------------------ Start ------------------ **/
app.listen(PORT, () => console.log(`Bridge ${PORT}`));
