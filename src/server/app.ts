import express from "express";
import parseOrdinaryHandler from "../../api/ai/parse-ordinary.ts";
import scheduleHandler from "../../api/ai/schedule.ts";

const app = express();

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.post("/api/ai/parse-ordinary", parseOrdinaryHandler);
app.post("/api/ai/schedule", scheduleHandler);

// Global error handler
app.use((err: any, req: any, res: any, next: any) => {
  console.error("[Global Error Handler]:", err);
  res.status(err.status || err.statusCode || 500).json({ 
    error: `Erro no servidor: ${err.message || err}` 
  });
});

export { app };
