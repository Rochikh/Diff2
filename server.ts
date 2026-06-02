import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

app.get("/api/health", (req, res) => {
  const distPath = path.resolve(__dirname, "dist");
  res.json({ 
    status: "ok", 
    env: process.env.NODE_ENV || "development",
    time: new Date().toISOString(),
    distExists: fs.existsSync(distPath),
    distContents: fs.existsSync(distPath) ? fs.readdirSync(distPath) : []
  });
});

app.post("/api/generate", async (req, res) => {
  try {
    const { prompt } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: "Missing prompt" });
    }

    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_API_KEY) {
      return res.status(500).json({ error: "OPENROUTER_API_KEY is not configured on the server." });
    }

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek/deepseek-v4-pro",
        messages: [
          {
            role: "system",
            content: "Tu es un assistant pédagogique expert. Tu réponds EXCLUSIVEMENT par un objet JSON valide, sans texte avant ni après, sans bloc markdown, sans commentaire. Si la consigne demande une structure précise, respecte-la à la lettre."
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.4,
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenRouter API Error:", response.status, errText);
      return res.status(response.status).json({ error: `OpenRouter API failed: ${response.statusText}` });
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    
    if (!content) {
      return res.status(500).json({ error: "No content returned from OpenRouter" });
    }

    res.json({ content });

  } catch (error) {
    console.error("Error generating content:", error);
    res.status(500).json({ error: "Internal server error during content generation" });
  }
});

// Catch-all for undefined API routes to return JSON instead of HTML
app.all("/api/*", (req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.url} non trouvée` });
});

async function startServer() {
  const mode = process.env.NODE_ENV || "development";
  console.log(`Starting server in ${mode} mode`);

  if (mode !== "production") {
    console.log("Initializing Vite middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "dist");
    console.log(`Serving static files from: ${distPath}`);
    if (!fs.existsSync(distPath)) {
      console.error("ERROR: dist directory not found! Did you run 'npm run build'?");
    }
    app.use(express.static(distPath, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".js")) {
          res.setHeader("Content-Type", "application/javascript");
        }
      }
    }));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
