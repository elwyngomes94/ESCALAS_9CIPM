import { GoogleGenAI, Type } from "@google/genai";
import { Policeman } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const parsePersonnelData = async (rawText: string): Promise<Omit<Policeman, 'id' | 'createdAt'>[]> => {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Extraia as informações dos policiais do seguinte texto:
    "${rawText}"
    
    Converta para um formato JSON seguindo exatamente a estrutura do schema.
    Para o campo 'graduacaoPosto', converta para um dos seguintes valores se possível: 
    'Soldado', 'Cabo', '3º Sargento', '2º Sargento', '1º Sargento', 'Subtenente', '2º Tenente', '1º Tenente', 'Capitão', 'Major', 'Tenente Coronel', 'Coronel'.
    Se não encontrar o campo 'situacao', defina como 'Ativo'.
    Se não encontrar 'numeral', deixe vazio ("").
    Se não encontrar 'antiguidade', use 0.
    Identifique se o policial é motorista (campo 'isMotorista' como boolean).`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            nomeCompleto: { type: Type.STRING, description: "Nome completo do policial" },
            nomeGuerra: { type: Type.STRING, description: "Nome de guerra do policial" },
            graduacaoPosto: { type: Type.STRING, description: "Graduação ou posto (ex: Soldado, Cabo, Sargento)" },
            matricula: { type: Type.STRING, description: "Matrícula do policial" },
            numeral: { type: Type.STRING, description: "Numeral do policial (geralmente para Praças)" },
            antiguidade: { type: Type.NUMBER, description: "Número de antiguidade na turma/graduação" },
            isMotorista: { type: Type.BOOLEAN, description: "Se o policial pertence ao quadro de motoristas" },
            situacao: { type: Type.STRING, description: "Situação (ex: Ativo, Inativo)" },
          },
          required: ["nomeCompleto", "nomeGuerra", "graduacaoPosto", "matricula", "numeral", "antiguidade", "isMotorista", "situacao"],
        },
      },
    },
  });

  const text = response.text || "[]";
  try {
    return JSON.parse(text.trim());
  } catch (e) {
    console.error("Erro ao processar JSON da IA:", e);
    return [];
  }
};
