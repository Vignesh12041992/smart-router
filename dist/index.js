// import { SmartRouter } from "./services/router.js";
// import { SAMPLE_TASKS } from "./config/registry.js";
// async function executeOllamaTask(model: string, prompt: string) {
//   console.log(`🤖 Executing on \x1b[36m${model}\x1b[0m...`);
//   try {
//     const response = await fetch("http://localhost:11434/api/generate", {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({
//         model: model,
//         prompt: prompt,
//         stream: true // Enables real-time streaming output in the terminal
//       })
//     });
//     if (!response.ok) throw new Error(`Ollama generation error: ${response.statusText}`);
//     if (!response.body) return;
//     const reader = response.body.getReader();
//     const decoder = new TextDecoder();
//     process.stdout.write("✨ Response: ");
//     while (true) {
//       const { done, value } = await reader.read();
//       if (done) break;
//       const chunk = decoder.decode(value, { stream: true });
//       // Ollama streams JSON lines. Parse each independent chunk line.
//       const lines = chunk.split("\n");
//       for (const line of lines) {
//         if (line.trim() === "") continue;
//         try {
//           const json = JSON.parse(line);
//           if (json.response) {
//             process.stdout.write(json.response);
//           }
//         } catch (e) {
//           // Catch occasional partial fragments silently
//         }
//       }
//     }
//     console.log("\n" + "=".repeat(60) + "\n");
//   } catch (error) {
//     console.error("\n🚨 Inference failed:", error);
//   }
// }
// async function runPipeline() {
//   console.log("🚀 Initializing Laya Decision Model Engine...");
//   const router = new SmartRouter();
//   await router.init();
//   console.log("✅ Pipeline ready.\n");
//   for (const task of SAMPLE_TASKS) {
//     console.log(`📋 Task Evaluated: [${task.title}]`);
//     console.log(`💬 User Prompt: "${task.prompt}"`);
//     // Step 1: Automatically Route Task and Score Complexity
//     const decision = await router.routeTask(task.prompt);
//     if (!decision) {
//       console.log("❌ No local Ollama models detected. Skipping execution.\n");
//       continue;
//     }
//     console.log(`📊 Complexity Score: \x1b[33m${decision.complexityScore} / 3.0\x1b[0m`);
//     console.log(`🎯 Routing Confidence: ${decision.routingConfidence}`);
//     // Step 2: Automated Handoff to Chosen Local Ollama Instance
//     await executeOllamaTask(decision.modelName, task.prompt);
//   }
//   await router.close();
// }
// runPipeline().catch(console.error);
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { SmartRouter } from "./services/router.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = 3000;
app.use(express.json());
// Serve the static frontend layout folder directly
app.use(express.static(path.join(__dirname, "../public")));
const router = new SmartRouter();
await router.init();
// Endpoint to analyze the intent configuration using Laya
app.post("/api/analyze", async (req, res) => {
    try {
        const { prompt } = req.body;
        const analysis = await router.routeTask(prompt);
        res.json(analysis);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// Endpoint streaming direct inference lines back to UI
app.get("/api/generate", async (req, res) => {
    const { model, prompt } = req.query;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    try {
        const ollamaRes = await fetch("http://localhost:11434/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model, prompt, stream: true })
        });
        if (!ollamaRes.body) {
            res.write("data: [DONE]\n\n");
            return res.end();
        }
        const reader = ollamaRes.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n");
            for (const line of lines) {
                if (!line.trim())
                    continue;
                try {
                    const json = JSON.parse(line);
                    if (json.response) {
                        // Encode safely for EventSource parsing channels
                        res.write(`data: ${JSON.stringify({ text: json.response })}\n\n`);
                    }
                }
                catch { }
            }
        }
    }
    catch (err) {
        res.write(`data: ${JSON.stringify({ error: "Inference exception" })}\n\n`);
    }
    res.write("data: [DONE]\n\n");
    res.end();
});
app.listen(port, () => {
    console.log(`🌐 Dashboard panel ready at http://localhost:${port}`);
});
