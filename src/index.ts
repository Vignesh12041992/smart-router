// import express from "express";
// import path from "path";
// import { fileURLToPath } from "url";
// import { SmartRouter } from "./services/router.js";

// const __dirname = path.dirname(fileURLToPath(import.meta.url));
// const app = express();
// const port = 3000;

// app.use(express.json());
// // Serve the static frontend layout folder directly
// app.use(express.static(path.join(__dirname, "../public")));

// const router = new SmartRouter();
// await router.init();

// // Endpoint to analyze the intent configuration using Laya
// app.post("/api/analyze", async (req, res) => {
//   try {
//     const { prompt } = req.body;
//     const analysis = await router.routeTask(prompt);
//     res.json(analysis);
//   } catch (err: any) {
//     res.status(500).json({ error: err.message });
//   }
// });

// // Endpoint streaming direct inference lines back to UI
// app.get("/api/generate", async (req, res) => {
//   const { model, prompt } = req.query;
  
//   res.setHeader("Content-Type", "text/event-stream");
//   res.setHeader("Cache-Control", "no-cache");
//   res.setHeader("Connection", "keep-alive");

//   try {
//     const ollamaRes = await fetch("http://localhost:11434/api/generate", {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({ model, prompt, stream: true })
//     });

//     if (!ollamaRes.body) {
//       res.write("data: [DONE]\n\n");
//       return res.end();
//     }

//     const reader = ollamaRes.body.getReader();
//     const decoder = new TextDecoder();

//     while (true) {
//       const { done, value } = await reader.read();
//       if (done) break;

//       const chunk = decoder.decode(value, { stream: true });
//       const lines = chunk.split("\n");

//       for (const line of lines) {
//         if (!line.trim()) continue;
//         try {
//           const json = JSON.parse(line);
//           if (json.response) {
//             // Encode safely for EventSource parsing channels
//             res.write(`data: ${JSON.stringify({ text: json.response })}\n\n`);
//           }
//         } catch {}
//       }
//     }
//   } catch (err) {
//     res.write(`data: ${JSON.stringify({ error: "Inference exception" })}\n\n`);
//   }

//   res.write("data: [DONE]\n\n");
//   res.end();
// });

// app.listen(port, () => {
//   console.log(`🌐 Dashboard panel ready at http://localhost:${port}`);
// });

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { IntelligentRouter } from "./services/router.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

const pipeline = new IntelligentRouter();
await pipeline.init();

app.post("/api/route", async (req, res) => {
  const decision = await pipeline.processRequest(req.body.prompt);
  res.json(decision);
});

app.post("/api/finalize", async (req, res) => {
  const { prompt, responseText, decision } = req.body;
  await pipeline.saveResponseToMemory(prompt, responseText, decision);
  res.json({ status: "saved_to_everos" });
});

app.get("/api/stream", async (req, res) => {
  const { model, prompt } = req.query;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  
  try {
    const ollamaRes = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: String(prompt), stream: true })
    });

    const reader = ollamaRes.body?.getReader();
    const decoder = new TextDecoder();
    if (!reader) return res.end();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      const lines = chunk.split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.response) res.write(`data: ${JSON.stringify({ token: parsed.response })}\n\n`);
        } catch {}
      }
    }
  } catch {}
  res.write("data: [DONE]\n\n");
  res.end();
});

app.listen(3000, () => console.log("🌟 Pipeline Live at http://localhost:3000"));
