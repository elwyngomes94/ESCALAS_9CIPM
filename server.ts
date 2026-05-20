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
      const { textToParse, policemenList, currentMonth } = req.body;

      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: "Chave da API Gemini não configurada no ambiente." });
      }

      if (!textToParse || typeof textToParse !== "string" || textToParse.trim().length === 0) {
        return res.status(400).json({ error: "O texto para análise não foi fornecido ou está vazio." });
      }

      if (!policemenList || !Array.isArray(policemenList) || policemenList.length === 0) {
        return res.status(400).json({ error: "Lista de policiais vazia ou inválida." });
      }

      console.log(`[AI] Parsing ordinary schedule text for month: ${currentMonth}. Total matching candidates: ${policemenList.length}`);

      const systemInstruction = `
        Você é um Assistente especializado em extração de dados estruturados para a 9ª CIPM (Polícia Militar de Pernambuco).
        Sua tarefa é analisar o texto de uma escala de serviço ordinária para o mês ${currentMonth} (frequentemente copiado de um documento oficial/PDF) e identificar os policiais que estão escalados para serviço ordinário em cada dia do mês.

        Use esta lista oficial de policiais cadastrados no banco de dados para fazer o mapeamento dos nomes de guerra e matrículas encontrados no texto para os respectivos ID's de policial corretos:
        ${JSON.stringify(policemenList)}

        REGRAS IMPORTANTES PARA EXTRAÇÃO E MAPEAMENTO:
        1. IDENTIFICAÇÃO DOS MILITARES:
           - Cada linha ou bloco de texto pode conter a graduação (ex: 3º SGT, CB PM, SD PM, etc.), a MATRÍCULA (ex: 107970-0, 117745-1, etc.) e o NOME DE GUERRA (ex: JEFFERSON, LOURENÇO, CLERIVALDO).
           - Exemplo de texto: "3º SGT - 107970-0 - JEFFERSON   4, 8, 12, 16, 20" ou "SD PM – 125425-1 – FRANCINETE   1, 5, 9".
        
        2. CHAVE DE CORRESPONDÊNCIA PRINCIPAL (MATRÍCULA):
           - A matrícula é o identificador mais seguro.
           - Para cada militar citado no texto, encontre a matrícula. Remova todos os caracteres não-numéricos (traços, barras, espaços, pontos) tanto da matrícula obtida no texto quanto da lista oficial para encontrar uma correspondência exata.
           - Se a matrícula coincidir (com ou sem dígito verificador), associe ao ID correto desse policial.
        
        3. CHAVE SECUNDÁRIA (NOME DE GUERRA):
           - Se a matrícula não puder ser extraída ou faltar no texto de determinado policial, tente encontrar por correspondência inteligente (fuzzy match) usando o Nome de Guerra.
           - Remova anotações extras entre parênteses como "(Cmt)", "(Mot)", "(Pat)", "(Cmt/Mot)", "a contar do dia..." etc.
           - Ignore patentes/postos ordinários ("PM", "SD", "CB", "1º SGT", "2º SGT", "3º SGT", "3ª SGT", "CAP", "TEN", "SD PM", "CB PM", "SGT PM").
        
        4. EXTRAÇÃO DOS DIAS:
           - Localize os dias associados ao policial no texto. Geralmente vêm logo ao lado do nome ou na mesma linha, separados por vírgula, espaço ou traço.
           - Extraia todos os números válidos de 1 a 31 que representem os dias daquele plantão.
           - Exemplo: "4, 8, 12, 16, 20, 24, 28" -> extraia o array [4, 8, 12, 16, 20, 24, 28].
           - Se os dias estiverem em intervalos, expanda para dias individuais se possível (ex: "5, 6, 7" -> [5, 6, 7]).
        
        5. Se um policial não tiver escalas ativas identificadas ou não for encontrado no cadastro do sistema de forma confiável, simplesmente não o inclua na lista retornada.
      `;

      const prompt = `
        Analise cuidadosamente o seguinte texto copiado da escala de serviço ordinária para o mês ${currentMonth}:
        
        --- INÍCIO DO TEXTO ---
        ${textToParse}
        --- FIM DO TEXTO ---

        Extraia todos os policiais escalados e seus respectivos dias. Retorne o resultado estritamente no esquema JSON definido.
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
              schedules: {
                type: SchemaType.ARRAY,
                items: {
                  type: SchemaType.OBJECT,
                  properties: {
                    policemanId: { type: SchemaType.STRING, description: "O ID único do policial correspondente da lista oficial fornecida." },
                    days: {
                      type: SchemaType.ARRAY,
                      items: { type: SchemaType.INTEGER },
                      description: "Lista de dias do mês em que está escalado para o serviço ordinário, ex: [3, 4, 15]"
                    }
                  },
                  required: ["policemanId", "days"]
                }
              },
              explanation: { type: SchemaType.STRING, description: "Breve explicação das escalas encontradas ou correspondências." }
            },
            required: ["schedules"]
          }
        }
      });

      const result = await response.response;
      let textContent = result.text() || '{}';
      
      // Clean potential markdown blocks
      textContent = textContent.replace(/```json/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(textContent);
      res.json(parsed);

    } catch (error: any) {
      console.error("[AI Parse Ordinary] Error:", error);
      res.status(500).json({ error: `Erro ao processar texto: ${error?.message || error}` });
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
