import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });

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

      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: "Gemini API Key não configurada" });
      }

      const systemInstruction = `
        Você é um Assistente especializado em Gestão de Escalas Militares (9ª CIPM).
        Sua missão é sugerir uma escala EXTRA (PJES/OPS) otimizada para as vagas ociosas do mês ${currentMonth}.
        
        REGRAS DE OURO (NÃO PODEM SER VIOLADAS):
        1. IDs VÁLIDOS: Use APENAS "policemanId" e "serviceId" que foram fornecidos nos dados. Nunca invente ou use IDs de outros meses.
        2. SERVIÇO ORDINÁRIO: Proibido escalar em dia de serviço ordinário (ordinário prevalece sobre extra).
        3. CONFLITOS BI-HORÁRIOS: Proibido escalas cuja duração (inicio -> fim) se sobreponha. 
           Obs: Turnos que viram o dia (ex: 18h às 02h) ocupam o horário do dia seguinte também.
        4. LIMITE PJES POR DIA: O policial só pode fazer NO MÁXIMO 1 (um) PJES por dia.
        5. COTAS DO POLICIAL (PJES): Não exceda o campo "cotas" do voluntário.
        6. COTAS DA UNIDADE (PJES): O somatório de cotas de todos os serviços de um subtipo (MP, FORUM, ESCOLAR, DECRETO) não pode exceder o limite em quotaSettings.
        7. VAGAS: Respeite rigorosamente "vagasNecessarias" por dia. Ignore dias em que o serviço não está ativo (activationType).
        8. ANTIGUIDADE: Priorize preencher vagas com os policiais mais antigos (menor valor numérico no campo "antiguidade").
        
        Sua saída deve ser APENAS o JSON no formato:
        {
          "assignments": [
            { "policemanId": "ID_DO_POLICIAL", "serviceId": "ID_DO_SERVICO", "date": "YYYY-MM-DD" }
          ],
          "explanation": "Breve explicação sobre a otimização realizada."
        }
      `;

      const prompt = `
        DADOS PARA PROCESSAMENTO:
        - Mês: ${currentMonth}
        - Voluntários: ${JSON.stringify(volunteers)}
        - Serviços Disponíveis: ${JSON.stringify(services)}
        - Escalas já existentes (JÁ PREENCHIDAS): ${JSON.stringify(existingEscalas)}
        - Escala Ordinária (policemanId -> lista de dias do mês em que está de serviço): ${JSON.stringify(ordinarySchedules)}
        - Limites de Cotas da Unidade: ${JSON.stringify(quotaSettings)}
        
        Analise as escalas existentes e preencha as vagas OCIOSAS (vacancies) respeitando todas as regras.
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              assignments: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    policemanId: { type: Type.STRING },
                    serviceId: { type: Type.STRING },
                    date: { type: Type.STRING, description: "Format: YYYY-MM-DD" }
                  },
                  required: ["policemanId", "serviceId", "date"]
                }
              },
              explanation: { type: Type.STRING }
            },
            required: ["assignments"]
          }
        },
        contents: prompt
      });

      let text = response.text || '{}';
      // Clean potential markdown blocks
      text = text.replace(/```json/g, "").replace(/```/g, "").trim();
      
      console.log("AI Response received (length):", text.length);
      
      try {
        const parsed = JSON.parse(text);
        if (!parsed.assignments) parsed.assignments = [];
        res.json(parsed);
      } catch (parseError) {
        console.error("Failed to parse AI JSON. Content preview:", text.substring(0, 200));
        res.status(500).json({ error: "O modelo retornou um formato inválido. Tente novamente." });
      }
    } catch (error) {
      console.error("AI Scheduling Error:", error);
      res.status(500).json({ error: "Erro ao gerar escala com IA: " + (error instanceof Error ? error.message : "Desconhecido") });
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
