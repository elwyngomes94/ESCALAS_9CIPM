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

      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: "Gemini API Key não configurada" });
      }

      const systemInstruction = `
        Você é um Assistente de Gestão de Escalas para a Polícia Militar (9ª CIPM).
        Sua tarefa é sugerir uma escala EXTRA (PJES/OPS) otimizada para o mês ${currentMonth}.
        
        REGRAS CRÍTICAS E OBRIGATÓRIAS:
        1. SERVIÇO ORDINÁRIO: Nunca escale um policial em um dia que ele tenha serviço ordinário (conforme ordinarySchedules). O policial não pode ter NENHUM serviço extra (PJES ou OPS) no dia de seu serviço ordinário.
        2. CONFLITO DE HORÁRIO: Um policial não pode estar em dois serviços cujos horários se sobrepõem. Analise rigorosamente os campos horarioInicio e horarioTermino. Se um turno termina após a meia-noite (ex: 22h às 06h), ele ocupa o horário do dia seguinte também.
        3. COTAS INDIVIDUAIS (PJES): Respeite o limite de cotas do voluntário (volunteers[].cotas). Cada serviço PJES consome a quantidade definida em "service.cotasPorServico". Se não especificado, considere 1.
        4. VAGAS DO SERVIÇO: Não exceda o número de vagas (vagasNecessarias) de cada serviço em cada dia.
        5. ANTIGUIDADE: Em caso de disputa pela mesma vaga, prefira os policiais com MENOR valor numérico em "antiguidade" (ex: 1 é mais antigo que 10).
        6. COTAS DA UNIDADE (PJES): Respeite os limites mensais da unidade (quotaSettings) para MP, FORUM, ESCOLAR e DECRETO. O somatório de todas as cotas atribuídas em cada subtipo não pode exceder o limite mensal da unidade.
        7. ATIVAÇÃO: Apenas escale em dias que o serviço está ativo. Se activationType for 'ALL', está ativo o mês todo. Se for 'SPECIFIC', verifique 'activeDates'.
        8. PJES ÚNICO: Um policial só pode ter 1 (UM) serviço do tipo PJES por dia.
        9. OPS: Não tem limite de cotas individuais do policial, mas deve respeitar o cronograma e o limite total da unidade (opsTotal).
        
        FORMATO DE SAÍDA EXCLUSIVAMENTE JSON:
        {
          "assignments": [
            { "policemanId": "ID", "serviceId": "ID", "date": "YYYY-MM-DD" }
          ],
          "explanation": "Breve justificativa das escolhas"
        }
        
        Priorize preencher as vagas dos policiais mais antigos que ainda possuem cotas disponíveis e não têm conflito.
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

      const text = response.text || '{}';
      res.json(JSON.parse(text));
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
