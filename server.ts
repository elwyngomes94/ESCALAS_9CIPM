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
        quotaSettings,
        currentMonth 
      } = req.body;

      const systemInstruction = `
        Você é um Assistente de Gestão de Escalas para a Polícia Militar (9ª CIPM).
        Sua tarefa é sugerir uma escala extra (PJES/OPS) otimizada para o mês ${currentMonth}.
        
        REGRAS CRÍTICAS:
        1. SERVIÇO ORDINÁRIO: Nunca escale um policial em um dia que ele tenha serviço ordinário (conforme ordinarySchedules).
        2. CONFLITO DE HORÁRIO: Um policial não pode estar em dois serviços cujos horários se sobrepõem.
        3. COTAS DO POLICIAL: Para PJES, respeite o limite de cotas do voluntário (volunteers[].cotas). Cada serviço consome service.cotasPorServico.
        4. VAGAS DO SERVIÇO: Não exceda o número de vagas (vagasNecessarias) de cada serviço em cada dia.
        5. ANTIGUIDADE: Em caso de disputa, prefira os policiais com menor valor de "antiguidade" (mais antigos).
        6. COTAS DA UNIDADE: Respeite os limites mensais da unidade (quotaSettings) para MP, FORUM, ESCOLAR e DECRETO.
        7. ATIVAÇÃO: Respeite as datas ativas de cada serviço (activeDates ou activationType: 'ALL').
        8. PJES ÚNICO: Um policial só pode ter 1 PJES por dia.
        9. OPS: Não tem limite de cotas do policial, mas deve respeitar o limite total da unidade.
        
        FORMATO DE SAÍDA:
        Retorne um objeto JSON contendo um array "assignments", onde cada item tem:
        - policemanId
        - serviceId
        - date (YYYY-MM-DD)
        
        Seja justo na distribuição e priorize preencher todas as vagas possíveis.
      `;

      const prompt = `
        DADOS ATUAIS:
        - Voluntários: ${JSON.stringify(volunteers)}
        - Serviços Disponíveis: ${JSON.stringify(services)}
        - Escalas já existentes: ${JSON.stringify(existingEscalas)}
        - Escala Ordinária (policemanId -> dias do mês): ${JSON.stringify(ordinarySchedules)}
        - Limites da Unidade: ${JSON.stringify(quotaSettings)}
        
        Por favor, sugira as NOVAS escala para preencher as vagas ociosas.
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
                    date: { type: Type.STRING }
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

      res.json(JSON.parse(response.text || '{}'));
    } catch (error) {
      console.error("AI Scheduling Error:", error);
      res.status(500).json({ error: "Erro ao gerar escala com IA" });
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
