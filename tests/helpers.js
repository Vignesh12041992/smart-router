import http from "node:http";

/** Starts a tiny fake Ollama server. Returns { url, close }. */
export async function fakeOllama(models = ["phi:latest", "qwen2.5-coder:7b", "deepseek-r1:8b", "llama3:latest"]) {
  const server = http.createServer((req, res) => {
    if (req.url === "/api/tags") {
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ models: models.map(name => ({ name })) }));
    }
    if (req.url === "/api/generate" && req.method === "POST") {
      let body = "";
      req.on("data", c => (body += c));
      req.on("end", () => {
        const { model } = JSON.parse(body);
        res.setHeader("Content-Type", "application/x-ndjson");
        for (const word of ["Hello ", "from ", model]) res.write(JSON.stringify({ response: word }) + "\n");
        res.end(JSON.stringify({ done: true }) + "\n");
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => server.close(r)) };
}
