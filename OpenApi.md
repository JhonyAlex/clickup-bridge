openapi: 3.1.0
info:
  title: ClickUp Bridge
  version: "1.1.0"
servers:
  - url: https://clickup.zynodo.com
paths:
  /health:
    get:
      operationId: health
      responses:
        "200": { description: OK }
  /api/team:
    get:
      operationId: listTeams
      responses:
        "200": { description: Teams JSON }
  /api/team/{teamId}/space:
    get:
      operationId: listSpaces
      parameters:
        - { name: teamId, in: path, required: true, schema: { type: string } }
      responses:
        "200": { description: Spaces JSON }
  /api/space/{spaceId}/list:
    get:
      operationId: listLists
      parameters:
        - { name: spaceId, in: path, required: true, schema: { type: string } }
      responses:
        "200": { description: Lists JSON }
  /api/list/{listId}/task:
    get:
      operationId: listTasks
      parameters:
        - name: listId
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Tasks JSON
    post:
      operationId: createTask
      parameters:
        - { name: listId, in: path, required: true, schema: { type: string } }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                name: { type: string }
                description: { type: string }
                assignees: { type: array, items: { type: integer } }
              required: [name]
      responses:
        "200": { description: Task JSON }
  /api/task/{taskId}:
    get:
      operationId: getTask
      parameters:
        - name: taskId
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Complete Task Details JSON (includes assignees, status, dates, attachments, etc.)
  /oauth/authorize:
    get:
      operationId: startOAuth
      responses:
        "302":
          description: Redirect to ClickUp OAuth
  /oauth/callback:
    get:
      operationId: oauthCallback
      parameters:
        - name: code
          in: query
          required: true
          schema:
            type: string
      responses:
        "200":
          description: OAuth Success
  /oauth/status:
    get:
      operationId: oauthStatus
      responses:
        "200":
          description: OAuth Authentication Status
  /commands/executive_report:
    get:
      summary: "Genera reporte ejecutivo con filtrado estricto de fechas"
      description: "Genera un reporte ejecutivo impersonal con filtrado estricto por fechas y resolución inteligente de espacios"
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
          description: "Fecha desde (ISO: 2024-01-15 o timestamp)"
        - name: to
          in: query
          required: true
          schema:
            type: string
          description: "Fecha hasta (ISO: 2024-01-15 o timestamp)"
        - name: timezone
          in: query
          required: false
          schema:
            type: string
            default: "Europe/Madrid"
          description: "Zona horaria para el reporte"
      responses:
        "200":
          description: "Reporte ejecutivo generado exitosamente"
          content:
            application/json:
              schema:
                type: object
                properties:
                  report:
                    type: object
                  metadata:
                    type: object
  /commands/create_task_validated:
    post:
      summary: "Crea tarea con validación completa de campos obligatorios"
      description: "Crea una nueva tarea validando todos los campos obligatorios y resolviendo automáticamente espacios, usuarios y listas"
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - teamId
                - spaceName
                - taskName
                - description
                - assigneeNames
                - dueDate
              properties:
                teamId:
                  type: string
                  description: "ID del equipo"
                spaceName:
                  type: string
                  description: "Nombre del espacio (obligatorio)"
                taskName:
                  type: string
                  description: "Nombre de la tarea (obligatorio)"
                description:
                  type: string
                  description: "Descripción de la tarea (obligatorio)"
                assigneeNames:
                  type: array
                  items:
                    type: string
                  description: "Array de nombres de responsables (obligatorio)"
                dueDate:
                  type: string
                  description: "Fecha límite ISO o timestamp (obligatorio)"
                priority:
                  type: string
                  enum: [urgent, high, normal, low]
                  default: normal
                folderName:
                  type: string
                  description: "Nombre de carpeta (opcional)"
                listName:
                  type: string
                  description: "Nombre de lista (opcional, usa primera disponible si no se especifica)"
                status:
                  type: string
                  default: "to do"
      responses:
        "200":
          description: "Tarea creada exitosamente"
          content:
            application/json:
              schema:
                type: object
                properties:
                  success:
                    type: boolean
                  task:
                    type: object
                  metadata:
                    type: object
        "400":
          description: "Campos obligatorios faltantes o usuarios no encontrados"
  /commands/find_space_smart:
    get:
      operationId: findSpace
      parameters:
        - { name: teamId, in: query, required: true, schema: { type: string } }
        - { name: name, in: query, required: true, schema: { type: string } }
      responses:
        "200": { description: Matched spaces }
  /commands/find_folder:
    get:
      operationId: findFolder
      parameters:
        - { name: spaceId, in: query, required: true, schema: { type: string } }
        - { name: name, in: query, required: true, schema: { type: string } }
      responses:
        "200": { description: Matched folders }
  /commands/find_list:
    get:
      operationId: findList
      parameters:
        - { name: spaceId, in: query, required: false, schema: { type: string } }
        - { name: folderId, in: query, required: false, schema: { type: string } }
        - { name: name, in: query, required: true, schema: { type: string } }
      responses:
        "200": { description: Matched lists }
  /commands/search_tasks:
    get:
      operationId: searchTasks
      parameters:
        - { name: teamId, in: query, required: false, schema: { type: string } }
        - { name: spaceId, in: query, required: false, schema: { type: string } }
        - { name: spaceName, in: query, required: false, schema: { type: string } }
        - { name: folderId, in: query, required: false, schema: { type: string } }
        - { name: listId, in: query, required: false, schema: { type: string } }
        - { name: assigneeId, in: query, required: false, schema: { type: string } }
        - { name: assigneeName, in: query, required: false, schema: { type: string } }
        - { name: nameContains, in: query, required: false, schema: { type: string } }
        - { name: updatedFrom, in: query, required: false, schema: { type: string, description: "ISO or epoch ms" } }
        - { name: updatedTo, in: query, required: false, schema: { type: string, description: "ISO or epoch ms" } }
        - { name: status, in: query, required: false, schema: { type: string } }
        - { name: page, in: query, required: false, schema: { type: string } }
        - { name: limit, in: query, required: false, schema: { type: integer, default: 100 } }
      responses:
        "200": { description: Tasks list }
  /commands/find_user:
    get:
      operationId: findUser
      parameters:
        - { name: teamId, in: query, required: true, schema: { type: string } }
        - { name: name, in: query, required: true, schema: { type: string } }
      responses:
        "200": { description: Matched users }
  /commands/task_comments:
    get:
      operationId: taskComments
      parameters:
        - { name: taskId, in: query, required: true, schema: { type: string } }
        - { name: limit, in: query, required: false, schema: { type: integer } }
      responses:
        "200": { description: Comments list }
  /commands/create_task:
    post:
      operationId: cmdCreateTask
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                listId: { type: string }
                name: { type: string }
                description: { type: string }
                assignees: { type: array, items: { type: integer } }
              required: [listId, name]
      responses:
        "200": { description: Created task }
  /commands/workspaces:
    get:
      operationId: getWorkspaces
      responses:
        "200": { description: List of workspaces }
  /commands/search_docs:
    get:
      operationId: searchDocs
      parameters:
        - { name: workspaceId, in: query, required: true, schema: { type: string } }
        - { name: limit, in: query, required: false, schema: { type: integer, default: 50 } }
        - { name: creator, in: query, required: false, schema: { type: string } }
        - { name: deleted, in: query, required: false, schema: { type: boolean, default: false } }
        - { name: archived, in: query, required: false, schema: { type: boolean, default: false } }
        - { name: parent_id, in: query, required: false, schema: { type: string } }
        - { name: parent_type, in: query, required: false, schema: { type: string } }
      responses:
        "200": { description: Documents list }
  /commands/get_doc:
    get:
      operationId: getDoc
      parameters:
        - { name: workspaceId, in: query, required: true, schema: { type: string } }
        - { name: docId, in: query, required: true, schema: { type: string } }
      responses:
        "200": { description: Document details }
  /commands/get_doc_pages:
    get:
      operationId: getDocPages
      parameters:
        - { name: workspaceId, in: query, required: true, schema: { type: string } }
        - { name: docId, in: query, required: true, schema: { type: string } }
      responses:
        "200": { description: Document pages content }
  /commands/find_docs:
    get:
      operationId: findDocs
      parameters:
        - { name: workspaceId, in: query, required: true, schema: { type: string } }
        - { name: name, in: query, required: true, schema: { type: string } }
        - { name: limit, in: query, required: false, schema: { type: integer, default: 50 } }
      responses:
        "200": { description: Matched documents }
components:
  schemas: {}
security:
  - {}
