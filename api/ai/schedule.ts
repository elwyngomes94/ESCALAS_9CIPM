import { Request, Response } from "express";
import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

export default async function scheduleHandler(req: Request, res: Response) {
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

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
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
      }
    });

    let text = response.text || "{}";
    
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
}
