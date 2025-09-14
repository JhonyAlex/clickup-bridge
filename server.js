import express from "express";
import fetch from "node-fetch";
const app = express();
const PORT = process.env.PORT || 3107;
const CLICKUP_API = "https://api.clickup.com/api/v2";
app.use(express.json());

app.all(/^\/api\/(.*)/, async (req, res) => {
  const path = req.params[0] || "";
  const url = new URL(`${CLICKUP_API}/${path}`);
  for (const [k, v] of Object.entries(req.query || {})) {
    if (Array.isArray(v)) v.forEach((vv) => url.searchParams.append(k, String(vv)));
    else url.searchParams.set(k, String(v));
  }
  const r = await fetch(url.toString(), {
    method: req.method,
    headers: {
      Authorization: process.env.CLICKUP_API_TOKEN,
      "Content-Type": "application/json",
    },
    body: ["GET","HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body),
  });
  const data = await r.json().catch(()=>({}));
  res.status(r.status).json(data);
});

app.get("/sse", (req,res)=>{
  res.setHeader("Content-Type","text/event-stream");
  res.write(`event: ready\ndata: ClickUp Bridge activo\n\n`);
});
app.get("/health",(req,res)=>res.json({ok:true}));
app.listen(PORT, ()=> console.log(`Bridge ${PORT}`));
