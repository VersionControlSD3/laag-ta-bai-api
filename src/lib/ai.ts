import { GoogleGenAI, HarmBlockThreshold, HarmCategory, Type } from '@google/genai'
import type { ChatMessage, Landmark } from '../domain/types.js'
import { withRetry } from './retry.js'

export type Identification = { landmarkId: string | null; confidence: number }

export interface AiService {
  readonly mode: 'gemini' | 'stub'
  identifyLandmark(input: {
    image: Buffer
    mimeType: string
    candidates: Pick<Landmark, 'id' | 'name' | 'district'>[]
  }): Promise<Identification>
  chat(input: { landmark: Landmark; messages: ChatMessage[] }): Promise<string>
}

/** SRS 3.1.2.2.b: keep at least 15 exchanges (30 messages) of context. */
export const CHAT_MEMORY_MESSAGES = 30

// SRS 3.5.4.2: block harmful output.
const SAFETY_SETTINGS = [
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
].map((category) => ({ category, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE }))

// SRS 3.5.4.1: ground answers in the verified landmark record.
export function guidePrompt(landmark: Landmark): string {
  return [
    'You are "bAI", a friendly local Cebuano tour guide for the Laag ta bAI app.',
    'Answer questions about the landmark below in a warm, concise, conversational tone, using Markdown.',
    'Only state historical facts that are supported by the verified record below or are widely established.',
    'If you are not sure, say so instead of guessing. Never invent dates, names or events.',
    'Where relevant, add one short piece of trivia, a visitor etiquette reminder, or a nearby next-stop suggestion.',
    '',
    `Landmark: ${landmark.name} (${landmark.category}, ${landmark.district})`,
    `About: ${landmark.story.about}`,
    `Historical significance: ${landmark.story.significance}`,
    `Architecture: ${landmark.story.architecture}`,
    `Trivia: ${landmark.story.trivia}`,
    `Visiting hours: ${landmark.visitingHours}. Admission: ${landmark.admissionFee === 0 ? 'free' : `PHP ${landmark.admissionFee}`}.`,
  ].join('\n')
}

export function createGeminiService(apiKey: string, model: string): AiService {
  const ai = new GoogleGenAI({ apiKey })

  return {
    mode: 'gemini',
    async identifyLandmark({ image, mimeType, candidates }) {
      const list = candidates.map((c) => `- ${c.id}: ${c.name} (${c.district})`).join('\n')
      const response = await withRetry(() =>
        ai.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [
                { inlineData: { mimeType, data: image.toString('base64') } },
                {
                  text:
                    'Identify which Cebu heritage landmark from this list appears in the photo. ' +
                    'Reply with landmarkId null if none of them matches.\n' +
                    list,
                },
              ],
            },
          ],
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                landmarkId: { type: Type.STRING, nullable: true },
                confidence: { type: Type.NUMBER, description: '0 to 1' },
              },
              required: ['landmarkId', 'confidence'],
            },
            safetySettings: SAFETY_SETTINGS,
          },
        }),
      )
      const parsed = JSON.parse(response.text ?? '{}') as Partial<Identification>
      const known = candidates.some((c) => c.id === parsed.landmarkId)
      return {
        landmarkId: known ? (parsed.landmarkId ?? null) : null,
        confidence: Math.min(Math.max(Number(parsed.confidence) || 0, 0), 1),
      }
    },
    async chat({ landmark, messages }) {
      const response = await withRetry(() =>
        ai.models.generateContent({
          model,
          contents: messages.slice(-CHAT_MEMORY_MESSAGES).map((m) => ({
            role: m.role,
            parts: [{ text: m.content }],
          })),
          config: { systemInstruction: guidePrompt(landmark), safetySettings: SAFETY_SETTINGS },
        }),
      )
      return response.text?.trim() || "Pasensya, bai! I couldn't answer that one. Try asking another way."
    },
  }
}

/**
 * Used when GEMINI_API_KEY is not set (local dev, tests, CI). The scan picks the
 * closest landmark to the photo's GPS hint so the full flow can be exercised.
 */
export function createStubAiService(): AiService {
  return {
    mode: 'stub',
    async identifyLandmark({ candidates }) {
      return { landmarkId: candidates[0]?.id ?? null, confidence: 0.92 }
    },
    async chat({ landmark, messages }) {
      const question = messages.at(-1)?.content ?? ''
      return [
        `**(Stub reply — set GEMINI_API_KEY for real answers.)**`,
        '',
        `You asked: "${question}". Here's what I know about **${landmark.name}**:`,
        '',
        landmark.story.about,
        '',
        `_Trivia:_ ${landmark.story.trivia}`,
      ].join('\n')
    },
  }
}
