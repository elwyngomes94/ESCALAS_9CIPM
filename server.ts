import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { GoogleGenAI, Type } from "@google/genai";

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
        currentMonth,
        fairMode = false
      } = req.body;

      console.log(`[AI] Processing schedule for ${currentMonth}. Volunteers: ${volunteers?.length}, Services: ${services?.length}, FairMode: ${fairMode}`);

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
        7. ${fairMode 
            ? "MODO DISTRIBUIÇÃO JUSTA: IGNORE ANTIGUIDADE. Tente equilibrar a carga de trabalho de forma que o número de escalas por policial seja o mais uniforme possível (mesma quantidade para todos)." 
            : "Prioridade: Policiais mais antigos (menor valor no campo 'antiguidade')."}
        
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

  // AI Ordinary Schedule Parser Endpoint
  app.post("/api/ai/parse-ordinary", async (req, res) => {
    try {
      const { pdfBase64, mimeType = "application/pdf", policemenList, currentMonth } = req.body;

      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: "Chave da API Gemini não configurada no ambiente." });
      }

      if (!pdfBase64) {
        return res.status(400).json({ error: "Conteúdo do arquivo não fornecido." });
      }

      if (!policemenList || !Array.isArray(policemenList) || policemenList.length === 0) {
        return res.status(400).json({ error: "Lista de policiais vazia ou inválida." });
      }

      console.log(`[AI] Parsing ordinary schedule PDF/Image for month: ${currentMonth}. Total matching candidates: ${policemenList.length}`);

      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      const systemInstruction = `
        Você é um Assistente especializado em extração de dados estruturados e OCR para a 9ª CIPM.
        Sua tarefa é analisar o documento em anexo (uma escala ordinária de plantão militar para o mês ${currentMonth}) e identificar os policiais que estão escalados para serviço ordinário em cada dia do mês.

        Use esta lista oficial de policiais cadastrados no banco de dados para fazer o mapeamento dos nomes de guerra e matrículas encontrados no documento para os respectivos ID's de policial corretos:
        ${JSON.stringify(policemenList)}

        REGRAS IMPORTANTES PARA MAPEAMENTO:
        1. Ignore abreviações e patentes, tais como "SD PM", "CB PM", "3º SGT PM", "PM", "SD", "CB", "SGT" etc.
        2. Use tanto o nome de guerra quanto a matrícula como chaves de conferência.
        3. Faça correspondência aproximada (fuzzy matching). Por exemplo: "CB GOMES" ou "SD PM LUIZ GOMES" deve mapear para o policial de nome de guerra "GOMES" ou cujo nome completo contenha "Luiz Gomes".
        4. No documento, busque por tabelas, cronogramas, calendários ou listas de serviço ordinário. Para cada policial mapeado com sucesso, extraia os dias do mês (apenas os números, por exemplo, se ele trabalha nos dias 5, 10 e 15, extraia [5, 10, 15]) em que ele está escalado. Se o policial trabalha em um dia, esse número inteiro de 1 a 31 deve estar no array 'days'.
        5. Se não conseguir identificar um policial no documento, simplesmente não o inclua na lista retornada. Do mesmo modo, se um policial não tiver dias de serviço ordinário escalados, não o inclua.
      `;

      const prompt = `
        Analise a escala ordinária anexa para o mês ${currentMonth}.
        Escreva o resultado no formato JSON esperado, mapeando com precisão os dias de serviço ordinário ao ID de cada policial da lista fornecida.
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: [
          {
            inlineData: {
              mimeType: mimeType,
              data: pdfBase64
            }
          },
          {
            text: prompt
          }
        ],
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              schedules: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    policemanId: { type: Type.STRING, description: "O ID único do policial correspondente da lista oficial fornecida." },
                    days: {
                      type: Type.ARRAY,
                      items: { type: Type.INTEGER },
                      description: "Lista de dias do mês em que está escalado para o serviço ordinário, ex: [3, 4, 15]"
                    }
                  },
                  required: ["policemanId", "days"]
                }
              },
              explanation: { type: Type.STRING, description: "Breve explicação das escalas encontradas ou correspondências." }
            },
            required: ["schedules"]
          }
        }
      });

      const text = response.text || "{}";
      const parsed = JSON.parse(text);
      res.json(parsed);

    } catch (error: any) {
      console.error("[AI Parse Ordinary] Error:", error);
      res.status(500).json({ error: `Erro ao processar arquivo: ${error?.message || error}` });
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
