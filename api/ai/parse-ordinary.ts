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

export default async function parseOrdinaryHandler(req: Request, res: Response) {
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

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
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

    let textContent = response.text || "{}";
    
    // Clean potential markdown blocks
    textContent = textContent.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(textContent);
    res.json(parsed);

  } catch (error: any) {
    console.error("[AI Parse Ordinary] Error:", error);
    res.status(500).json({ error: `Erro ao processar texto: ${error?.message || error}` });
  }
}
