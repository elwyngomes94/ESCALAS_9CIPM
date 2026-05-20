import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { GoogleGenAI, Type } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

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
        Você é um Assistente especializado em extração de dados estruturados e OCR para a 9ª CIPM (Polícia Militar de Pernambuco).
        Sua tarefa é analisar o documento em anexo (uma escala ordinária de plantão militar para o mês ${currentMonth}) e identificar os policiais que estão escalados para serviço ordinário em cada dia do mês.

        Use esta lista oficial de policiais cadastrados no banco de dados para fazer o mapeamento dos nomes de guerra e matrículas encontrados no documento para os respectivos ID's de policial corretos:
        ${JSON.stringify(policemenList)}

        REGRAS IMPORTANTES PARA EXTRAÇÃO E MAPEAMENTO:
        1. FORMATO DO EFETIVO: 
           - O documento possui colunas denominadas "EFETIVO" e "DIAS".
           - O campo "EFETIVO" geralmente contém a graduação (ex: 3º SGT, CB PM, SD PM, etc.), a MATRÍCULA (ex: 107970-0, 117745-1, etc.) e o NOME DE GUERRA (ex: JEFFERSON, LOURENÇO, CLERIVALDO).
           - Exemplo: "3º SGT - 107970-0 - JEFFERSON", "SD PM – 125425-1 – FRANCINETE", "CB PM - 120591-9 - FRANCISCO (Mot)".
        
        2. CHAVE DE CORRESPONDÊNCIA (MATRÍCULA):
           - A matrícula é o identificador mais confiável para cada militar.
           - Para cada militar encontrado na imagem, extraia a matrícula. Remova todos os caracteres não-numéricos (traços, barras, espaços, pontos) tanto da matrícula obtida no documento quanto da lista oficial de policiais para encontrar uma correspondência exata.
           - Se a matrícula coincidir (mesmo sem o dígito verificador ou com diferencas de formatação/traços), associe ao ID desse policial.
        
        3. CHAVE SECUNDÁRIA (NOME DE GUERRA):
           - Caso a matrícula não esteja legível ou ausente, faça uma correspondência inteligente pelo Nome de Guerra (fuzzy match). 
           - Remova termos adicionais entre parênteses como "(Cmt)", "(Mot)", "(Pat)", "(Cmt/Mot)", "a contar do dia..." etc.
           - Ignore patentes/postos ("PM", "SD", "CB", "1º SGT", "2º SGT", "3º SGT", "3ª SGT", "CAP", "TEN").
        
        4. EXTRAÇÃO DOS DIAS:
           - Sob a coluna "DIAS", serão listados os dias do mês em que aquele policial está escalado.
           - Extraia todos os números inteiros válidos de 1 a 31 que representem os dias.
           - Exemplo de texto: "4, 8, 12, 16, 20, 24, 28" deve ser extraído como o array [4, 8, 12, 16, 20, 24, 28].
           - Se houver intervalos ou outros formatos, separe corretamente em dias individuais (ex: "5, 6, 7" -> [5, 6, 7]).
        
        5. Se um policial não tiver nenhuma escala ativa ou não for encontrado nenhuma associação confiável, não o inclua no JSON de retorno.
      `;

      const prompt = `
        Analise a escala ordinária anexa para o mês ${currentMonth}.
        Escreva o resultado no formato JSON esperado, mapeando com precisão os dias de serviço ordinário ao ID de cada policial da lista fornecida.
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: mimeType,
                data: pdfBase64
              }
            },
            {
              text: prompt
            }
          ]
        },
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

  // Global error handler
  app.use((err: any, req: any, res: any, next: any) => {
    console.error("[Global Error Handler]:", err);
    res.status(err.status || err.statusCode || 500).json({ 
      error: `Erro no servidor: ${err.message || err}` 
    });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
