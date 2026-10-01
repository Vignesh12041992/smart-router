import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { SmartRouter } from "./services/router.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = 3005;

app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

const router = new SmartRouter();
await router.init();

// 💡 MANDATORY SETUP: Replace the text below with your actual key from openrouter.ai
const API_KEY = "sk-or-v1-your-actual-free-key-here"; 

app.post("/v1/chat/completions", async (req, res) => {
  // 💡 Ensure your working OpenRouter key is inserted here
  //const API_KEY = "sk-or-v1-your-actual-free-key-here"; 

  if (API_KEY.includes("your-actual-free-key")) {
    return res.status(401).json({ 
      error: "Authentication Failed: Please configure your real API key inside src/index.ts." 
    });
  }

  try {
    const { messages } = req.body;
    const lastUserMessage = messages.filter((m: any) => m.role === "user").pop();
    const promptText = lastUserMessage ? lastUserMessage.content : "";

    // 1. Run local Laya System-1 analysis
    const routingDecision = await router.routeTask(promptText);
    
    console.log(`\n================= SYSTEM-1 ROUTER =================`);
    console.log(`💬 Prompt: "${promptText.substring(0, 45)}..."`);
    console.log(`📊 Chosen Route Strategy: ${routingDecision.modelName}`);
    console.log(`===================================================`);

    // 2. Dispatch request out to OpenRouter
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3005", 
        "X-Title": "Local Routing Proxy UI Gateway"
      },
      body: JSON.stringify({
        model: routingDecision.modelName, // Using the safe 'openrouter/free' mapping variables
        messages: messages,
        stream: false
      })
    });

    if (!response.ok) {
      const errorHtml = await response.text();
      return res.status(response.status).json({
        error: `Gateway Error (${response.status}): Endpoint rejected key credentials.`
      });
    }

    // 3. Process the clean JSON response object returned by OpenRouter
    const data = await response.json() as { model: string; choices: any[] };
    
    // 🔍 THE FIX: Extract the actual model name chosen by the OpenRouter load balancer
    const actualModelUsed = data.model || routingDecision.modelName; 
    console.log(`🎯 OpenRouter dynamically routed this prompt to: [${actualModelUsed}]`);

    // Bind the actual resolved model name to the custom headers passed back to your HTML GUI
    res.setHeader("X-Routed-Model", actualModelUsed);
    res.setHeader("X-Complexity-Score", routingDecision.complexityScore);
    res.setHeader("X-Routing-Confidence", routingDecision.routingConfidence);

    res.status(200).json(data);

  } catch (err: any) {
    console.error("🚨 Processing Exception:", err.message);
    res.status(500).json({ error: `Internal Proxy Error: ${err.message}` });
  }
});

app.listen(port, () => {
  console.log(`🌐 Visual Interface ready! Open http://localhost:${port} in your browser.`);
});



//BELOW IS THE OPENROUTER WORKING CODE

// import express from "express";
// import { SmartRouter } from "./services/router.js";

// const app = express();
// app.use(express.json());

// const router = new SmartRouter();
// await router.init();

// const API_KEY = process.env.OPENROUTER_API_KEY;

// app.post("/v1/chat/completions", async (req, res) => {
//   if (!API_KEY) {
//     console.error("🚨 Missing OPENROUTER_API_KEY env variable.");
//     return res.status(500).json({ error: "Server authentication error" });
//   }

//   try {
//     const { messages } = req.body;
//     const lastUserMessage = messages.filter((m: any) => m.role === "user").pop();
//     const promptText = lastUserMessage ? lastUserMessage.content : "";

//     // 1. Run local Laya System-1 analysis
//     const routingDecision = await router.routeTask(promptText);
    
//     console.log(`\n================= SYSTEM-1 ROUTER =================`);
//     console.log(`💬 Prompt: "${promptText.substring(0, 50)}..."`);
//     console.log(`📊 Route:  ${routingDecision.modelName} (Score: ${routingDecision.complexityScore})`);
//     console.log(`===================================================`);

//     // 2. Forward payload to OpenRouter's cloud interface
//     const response = await fetch("https://openrouter.ai", {
//       method: "POST",
//       headers: {
//         "Authorization": `Bearer ${API_KEY}`,
//         "Content-Type": "application/json",
//         "HTTP-Referer": "http://localhost:3005", 
//         "X-Title": "Local Smart Router Proxy"
//       },
//       body: JSON.stringify({
//         model: routingDecision.modelName,
//         messages: messages,
//         stream: req.body.stream ?? false
//       })
//     });

//     // 3. Pipe the response data stream directly back to the client tool
//     res.setHeader("Content-Type", response.headers.get("Content-Type") || "application/json");
//     if (response.body) {
//       const reader = response.body.getReader();
//       const decoder = new TextDecoder();
//       while (true) {
//         const { done, value } = await reader.read();
//         if (done) break;
//         res.write(decoder.decode(value));
//       }
//     }
//     res.end();

//   } catch (err: any) {
//     console.error("🚨 Gateway error:", err.message);
//     res.status(500).json({ error: "Routing failure" });
//   }
// });

// app.listen(3005, () => console.log("🚀 OpenRouter Free Gateway active on http://localhost:3005"));


// BELOW IS THE LOCAL WORKING CODE

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


// BELOW CODE IS FOR EVEROS AND FLOCKI
// import express from "express";
// import path from "path";
// import { fileURLToPath } from "url";
// import { IntelligentRouter } from "./services/router.js";

// const __dirname = path.dirname(fileURLToPath(import.meta.url));
// const app = express();
// app.use(express.json());
// app.use(express.static(path.join(__dirname, "../public")));

// const pipeline = new IntelligentRouter();
// await pipeline.init();

// app.post("/api/route", async (req, res) => {
//   const decision = await pipeline.processRequest(req.body.prompt);
//   res.json(decision);
// });

// app.post("/api/finalize", async (req, res) => {
//   const { prompt, responseText, decision } = req.body;
//   await pipeline.saveResponseToMemory(prompt, responseText, decision);
//   res.json({ status: "saved_to_everos" });
// });

// app.get("/api/stream", async (req, res) => {
//   const { model, prompt } = req.query;
//   res.setHeader("Content-Type", "text/event-stream");
//   res.setHeader("Cache-Control", "no-cache");
  
//   try {
//     const ollamaRes = await fetch("http://localhost:11434/api/generate", {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({ model, prompt: String(prompt), stream: true })
//     });

//     const reader = ollamaRes.body?.getReader();
//     const decoder = new TextDecoder();
//     if (!reader) return res.end();

//     while (true) {
//       const { done, value } = await reader.read();
//       if (done) break;
//       const chunk = decoder.decode(value);
//       const lines = chunk.split("\n");
//       for (const line of lines) {
//         if (!line.trim()) continue;
//         try {
//           const parsed = JSON.parse(line);
//           if (parsed.response) res.write(`data: ${JSON.stringify({ token: parsed.response })}\n\n`);
//         } catch {}
//       }
//     }
//   } catch {}
//   res.write("data: [DONE]\n\n");
//   res.end();
// });

// app.listen(3000, () => console.log("🌟 Pipeline Live at http://localhost:3000"));
