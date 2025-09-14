openapi: 3.1.0
info:
  title: ClickUp Bridge
  version: "1.5.0"
  description: |
    🧠 **PROXY INTELIGENTE** para ClickUp con búsquedas automáticas.
    
    🚨 **REGLA IMPORTANTE**: NUNCA pidas IDs al usuario. Usa SIEMPRE los endpoints inteligentes.
    
    ✅ **ENDPOINTS RECOMENDADOS (úsalos SIEMPRE)**:
    • smart_find_folder - Busca carpetas por nombre
    • smart_create_task - Crea tareas automáticamente  
    • nlp_create_task - Crea tareas desde lenguaje natural
    • smart_find_docs - Busca documentos por nombre
    • find - Búsqueda unificada inteligente
    
servers:
  - url: https://clickup.zynodo.com
    description: "Servidor Dokploy (HTTPS público)"

paths:
  /commands/smart_find_folder:
    get:
      operationId: smartFindFolder
      summary: "🧠 Busca carpetas por NOMBRE (usa este siempre)"
      description: |
        ✅ **USA ESTE ENDPOINT** en lugar de pedir IDs al usuario.
        Busca carpetas inteligentemente por nombre con filtrado automático.
        Previene ResponseTooLargeError.
      parameters:
        - name: spaceId
          in: query
          required: true
          schema: 
            type: string
          description: "ID del espacio donde buscar"
        - name: name
          in: query
          required: true
          schema: 
            type: string
          description: "Nombre o parte del nombre de la carpeta"
        - name: limit
          in: query
          required: false
          schema: 
            type: integer
            default: 20
      responses:
        "200": 
          description: "✅ Carpetas encontradas"
        "400": 
          description: "❌ Falta el parámetro name"

  /commands/smart_create_task:
    post:
      operationId: smartCreateTask
      summary: "🧠 Crea tareas automáticamente (usa este siempre)"
      description: |
        ✅ **USA ESTE ENDPOINT** para crear tareas. Resuelve automáticamente:
        • Busca espacios, carpetas y listas por nombre
        • Convierte nombres de usuarios a IDs
        • Procesamiento de contexto natural
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [teamId, spaceName, taskName, description]
              properties:
                teamId: 
                  type: string
                spaceName: 
                  type: string
                folderNameFilter: 
                  type: string
                listNameFilter: 
                  type: string
                naturalContext: 
                  type: string
                taskName: 
                  type: string
                description: 
                  type: string
                assigneeNames: 
                  type: array
                  items: 
                    type: string
                dueDate: 
                  type: string
                priority: 
                  type: string
                  enum: [normal, low, high, urgent]
                  default: normal
      responses:
        "200": 
          description: "✅ Tarea creada automáticamente"
        "400": 
          description: "❌ Campos obligatorios faltantes"
        "404": 
          description: "❌ No se encontró espacio/carpeta/lista"

  /commands/nlp_create_task:
    post:
      operationId: nlpCreateTask
      summary: "🧠 Crea tareas desde lenguaje natural (ultra-inteligente)"
      description: |
        ✅ **ENDPOINT MÁS INTELIGENTE** - Crea tareas desde descripciones naturales.
        Extrae automáticamente: título, descripción, asignados, fechas, prioridades.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [teamId, naturalRequest]
              properties:
                teamId: 
                  type: string
                naturalRequest: 
                  type: string
                spaceName: 
                  type: string
                taskName: 
                  type: string
                description: 
                  type: string
                priority: 
                  type: string
                assigneeNames: 
                  type: array
                  items: 
                    type: string
                dueDate: 
                  type: string
      responses:
        "200": 
          description: "✅ Tarea creada con análisis NLP completo"
        "400": 
          description: "❌ Faltan campos obligatorios"
        "404": 
          description: "❌ No se pudieron resolver los recursos"

  /commands/find:
    get:
      operationId: find
      summary: "🧠 Búsqueda unificada inteligente (usa este siempre)"
      description: |
        ✅ **BÚSQUEDA UNIVERSAL** por nombre para: espacios, carpetas, listas, usuarios.
        Reemplaza múltiples endpoints básicos.
      parameters:
        - name: resource
          in: query
          required: true
          schema: 
            type: string
            enum: [space, folder, list, user]
        - name: teamId
          in: query
          required: false
          schema: 
            type: string
        - name: spaceId
          in: query
          required: false
          schema: 
            type: string
        - name: folderId
          in: query
          required: false
          schema: 
            type: string
        - name: name
          in: query
          required: true
          schema: 
            type: string
      responses:
        "200": 
          description: "✅ Recursos encontrados"

  /health:
    get:
      operationId: health
      summary: "Health check del servidor"
      responses: 
        "200": 
          description: "✅ Servidor funcionando"

  /api/team:
    get:
      operationId: listTeams
      summary: "📋 Lista equipos disponibles"
      responses: 
        "200": 
          description: "✅ Lista de equipos JSON"

  /commands/workspaces:
    get:
      operationId: getWorkspaces
      summary: "📋 Lista workspaces disponibles"
      responses: 
        "200": 
          description: "✅ Lista de workspaces"

  /commands/search_tasks:
    get:
      operationId: searchTasks
      summary: "🔍 Búsqueda avanzada de tareas"
      parameters:
        - name: teamId
          in: query
          required: false
          schema: 
            type: string
        - name: spaceId
          in: query
          required: false
          schema: 
            type: string
        - name: spaceName
          in: query
          required: false
          schema: 
            type: string
        - name: assigneeName
          in: query
          required: false
          schema: 
            type: string
        - name: nameContains
          in: query
          required: false
          schema: 
            type: string
        - name: status
          in: query
          required: false
          schema: 
            type: string
        - name: limit
          in: query
          required: false
          schema: 
            type: integer
            default: 100
      responses: 
        "200": 
          description: "✅ Lista de tareas filtradas"

  /commands/executive_report:
    get:
      operationId: executiveReport
      summary: "📊 Reporte ejecutivo con rango de fechas"
      parameters:
        - name: teamId
          in: query
          required: true
          schema: 
            type: string
        - name: spaceName
          in: query
          required: true
          schema: 
            type: string
        - name: from
          in: query
          required: true
          schema: 
            type: string
        - name: to
          in: query
          required: true
          schema: 
            type: string
        - name: timezone
          in: query
          required: false
          schema: 
            type: string
            default: "Europe/Madrid"
      responses: 
        "200": 
          description: "✅ Reporte generado"

  /commands/search_docs:
    get:
      operationId: searchDocs
      summary: "📄 Lista todos los documentos"
      parameters:
        - name: workspaceId
          in: query
          required: true
          schema: 
            type: string
        - name: limit
          in: query
          required: false
          schema: 
            type: integer
            default: 50
        - name: creator
          in: query
          required: false
          schema: 
            type: string
        - name: deleted
          in: query
          required: false
          schema: 
            type: boolean
            default: false
        - name: archived
          in: query
          required: false
          schema: 
            type: boolean
            default: false
      responses: 
        "200": 
          description: "✅ Lista de documentos"

  /commands/get_doc:
    get:
      operationId: getDoc
      summary: "📄 Obtiene detalles de un documento"
      parameters:
        - name: workspaceId
          in: query
          required: true
          schema: 
            type: string
        - name: docId
          in: query
          required: true
          schema: 
            type: string
      responses: 
        "200": 
          description: "✅ Detalles del documento"

  /commands/get_doc_pages:
    get:
      operationId: getDocPages
      summary: "📄 Obtiene contenido de páginas del documento"
      parameters:
        - name: workspaceId
          in: query
          required: true
          schema: 
            type: string
        - name: docId
          in: query
          required: true
          schema: 
            type: string
      responses: 
        "200": 
          description: "✅ Contenido de páginas del documento"

  /api/team/{teamId}/member:
    get:
      operationId: listTeamMembers
      summary: "⚠️ Lista miembros de equipo (usa /commands/find con resource=user)"
      parameters:
        - name: teamId
          in: path
          required: true
          schema: 
            type: string
      responses: 
        "200": 
          description: "Lista de miembros del equipo"

  /api/team/{teamId}/space:
    get:
      operationId: listSpaces
      summary: "⚠️ Lista espacios (usa /commands/find con resource=space)"
      parameters:
        - name: teamId
          in: path
          required: true
          schema: 
            type: string
        - name: archived
          in: query
          required: false
          schema: 
            type: boolean
            default: false
      responses: 
        "200": 
          description: "Espacios del equipo"

  /api/space/{spaceId}/folder:
    get:
      operationId: listFolders
      summary: "⚠️ PELIGROSO - causa ResponseTooLargeError (usa smart_find_folder)"
      parameters:
        - name: spaceId
          in: path
          required: true
          schema: 
            type: string
        - name: archived
          in: query
          required: false
          schema: 
            type: boolean
            default: false
      responses: 
        "200": 
          description: "Carpetas en el espacio"

  /api/list/{listId}/task:
    get:
      operationId: listTasks
      summary: "⚠️ Lista tareas (usa search_tasks para mejor filtrado)"
      parameters:
        - name: listId
          in: path
          required: true
          schema: 
            type: string
      responses: 
        "200": 
          description: "Tareas de la lista"
    post:
      operationId: createTask
      summary: "⚠️ Crea tarea básica (usa smart_create_task o nlp_create_task)"
      parameters:
        - name: listId
          in: path
          required: true
          schema: 
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [name]
              properties:
                name: 
                  type: string
                description: 
                  type: string
                assignees: 
                  type: array
                  items: 
                    type: integer
      responses: 
        "200": 
          description: "Tarea creada"

  /api/task/{taskId}:
    get:
      operationId: getTask
      summary: "📋 Obtiene detalles de tarea"
      parameters:
        - name: taskId
          in: path
          required: true
          schema: 
            type: string
      responses: 
        "200": 
          description: "Detalles completos de la tarea"
    put:
      operationId: updateTask
      summary: "📝 Actualiza una tarea"
      parameters:
        - name: taskId
          in: path
          required: true
          schema: 
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                name: 
                  type: string
                description: 
                  type: string
                status: 
                  type: string
                priority: 
                  type: integer
                assignees:
                  type: object
                  properties:
                    add: 
                      type: array
                      items: 
                        type: integer
                    rem: 
                      type: array
                      items: 
                        type: integer
                due_date: 
                  type: integer
      responses: 
        "200": 
          description: "✅ Tarea actualizada"

  /commands/task_comments:
    get:
      operationId: taskComments
      summary: "💬 Comentarios de tarea"
      parameters:
        - name: taskId
          in: query
          required: true
          schema: 
            type: string
        - name: limit
          in: query
          required: false
          schema: 
            type: integer
      responses: 
        "200": 
          description: "✅ Lista de comentarios"

components: 
  schemas: {}

security:
  - {}