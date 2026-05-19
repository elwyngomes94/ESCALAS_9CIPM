import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

  // AI Scheduling Endpoint
  app.post("/api/ai/schedule", async (req, res) => {
    try {
      const { 
        volunteers, 
        services, 
        existingEscalas, 
        ordinarySchedules, 
        quotaSettings = { pjesMPTotal: 0, pjesForumTotal: 0, pjesEscolarTotal: 0, pjesDecretoTotal: 0, opsTotal: 0 },
        currentMonth 
      } = req.body;

      console.log(`[AI] Processing schedule for ${currentMonth}. Volunteers: ${volunteers?.length}, Services: ${services?.length}`);

      if (!process.env.GEMINI_API_KEY) {
        console.error("[AI] GEMINI_API_KEY is missing");
        return res.status(500).json({ error: "Chave da API Gemini não configurada no ambiente." });
      }

      const systemInstruction = `
        Você é um Assistente de Gestão de Escalas Militares (9ª CIPM).
        Sua missão: Sugerir escalas EXTRA (PJES/OPS) para as vagas ociosas do mês ${currentMonth}.
        
        REGRAS ABSOLUTAS:
        1. Use somente IDs de policiais e serviços fornecidos em 'volunteers' e 'services'.
        2. Proibido escala em dia de Serviço Ordinário do policial (verifique 'ordinarySchedules').
        3. Proibido sobreposição de horários (atente para turnos que viram o dia).
        4. Limite de 1 PJES por dia por policial.
        5. Respeite as cotas individuais do voluntário (campo 'cotas').
        6. Respeite as vagas diárias do serviço ('vagasNecessarias').
        7. Prioridade: Policiais mais antigos (menor valor no campo 'antiguidade').
        
        SAÍDA: JSON puro no formato especificado.
      `;

      const prompt = `
        DADOS PARA PROCESSAMENTO:
        - Escala Ordinária (ID -> dias ocupados): ${JSON.stringify(ordinarySchedules)}
        - Voluntários: ${JSON.stringify(volunteers)}
        - Serviços Ociosos: ${JSON.stringify(services)}
        - Escalas já Preenchidas: ${JSON.stringify(existingEscalas)}
        - Cotas da Unidade: ${JSON.stringify(quotaSettings)}
      `;

      const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash", 
        systemInstruction 
      });

      const response = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: SchemaType.OBJECT,
            properties: {
              assignments: {
                type: SchemaType.ARRAY,
                items: {
                  type: SchemaType.OBJECT,
                  properties: {
                    policemanId: { type: SchemaType.STRING },
                    serviceId: { type: SchemaType.STRING },
                    date: { type: SchemaType.STRING }
                  },
                  required: ["policemanId", "serviceId", "date"]
                }
              },
              explanation: { type: SchemaType.STRING }
            },
            required: ["assignments"]
          }
        }
      });

      const result = await response.response;
      let text = result.text() || '{}';
      
      // Clean potential markdown blocks
      text = text.replace(/```json/g, "").replace(/```/g, "").trim();
      
      console.log("[AI] Response received. Parsing...");
      
      try {
        const parsed = JSON.parse(text);
        if (!parsed.assignments) parsed.assignments = [];
        res.json(parsed);
      } catch (parseError) {
        console.error("[AI] JSON Parse Error. Content:", text.substring(0, 500));
        res.status(500).json({ error: "A IA retornou um formato de dados inválido. Tente novamente." });
      }
    } catch (error: any) {
      console.error("[AI] General Error:", error);
      const errorMessage = error?.message || "Erro desconhecido na API do Gemini";
      res.status(500).json({ error: `IA Indisponível: ${errorMessage}` });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
