# ClickUp Bridge — Instrucciones para Agentes de Codificación

## Resumen
- Proxy HTTP mínimo entre ChatGPT y ClickUp v2.
- Nodo único `server.js` con Express 5 y `node-fetch`.
- Endpoints: `/api/*` (proxy), `/sse` (evento ready), `/health` (sonda).

## Arquitectura y Flujo
- Entrada → `server.js` (Express) → ClickUp API (`https://api.clickup.com/api/v2`).
- Ruta proxy: RegExp `/^\/api\/(.*)/` captura el resto del path y reenvía el querystring.
- Autenticación: añade `Authorization: <CLICKUP_API_TOKEN>` desde env; el cliente NO debe enviar token.
- Cuerpo: sólo para métodos no `GET/HEAD`, se envía JSON (`Content-Type: application/json`).

## Comportamientos Clave
- Responde con el mismo status que ClickUp; si el body no es JSON, retorna `{}`.
- No hay reintentos, ni rate limiting, ni OAuth (token estático por entorno).
- SSE: emite `event: ready` una vez al conectar.

## Archivos Clave
- `server.js`: lógica del proxy y endpoints utilitarios.
- `package.json`: `"type":"module"`, Express 5, `node-fetch@^3`, script `start`.
- `Dockerfile`: `node:20-alpine`, `npm ci || npm i`, expone `3107`, healthcheck `/health`.
- `.dockerignore`: excluye `.git`, `.gitignore`, `README.md`.

## Variables de Entorno
- `CLICKUP_API_TOKEN`: token de ClickUp para cabecera `Authorization` (obligatorio para `/api/*`).
- `PORT` (opcional, por defecto `3107`).

## Patrones y Convenciones
- Mantén la ruta proxy como RegExp; Express 5 cambió el parser y patrones como `/api/*` o `:path(*)` fallan.
- Encabezados: hoy se fija `Content-Type: application/json`. Si ClickUp requiere `multipart/form-data` u otros, añade manejo específico por endpoint.
- Querystring: se preserva y reenvía tal cual.

## Ejemplos Útiles
- GET: `curl "http://localhost:3107/api/team"`
- POST: `curl -X POST "http://localhost:3107/api/list/{LIST_ID}/task" -H "Content-Type: application/json" -d '{"name":"Demo"}'`
- SSE: `curl -N http://localhost:3107/sse`
Nota: el servidor debe tener `CLICKUP_API_TOKEN` exportado; el cliente no envía token.

## Limitaciones Actuales
- Sin validación de entrada, ni logging estructurado, ni caché.
- Respuestas se devuelven “tal cual”; los agentes deben manejar errores de ClickUp directamente.

## Docker
- Build: `docker build -t clickup-bridge .`
- Run: `docker run -e CLICKUP_API_TOKEN=... -p 3107:3107 clickup-bridge`

## Notas para Evolución
- Si agregas middleware (CORS, logging, rate limit), ubícalo antes del bloque `(/^\/api\/(.*)/)`.
- Para soportar otros content-types, detecta `req.headers['content-type']` y ajusta `headers`/`body`.