import { Injectable, inject, signal } from '@angular/core';
import { RuntimeConfigService } from './runtime-config.service';

/**
 * Gemini model definitions with pricing labels.
 *
 * These are the models available to the REST orchestration layer.
 * The AI client uses Gemini to:
 *   1. Plan the next UCP action from a user message (planRestAction)
 *   2. Parse delivery addresses from free-text (parseAddressWithGemini)
 *
 * Model selection affects response quality and API cost.
 */
export interface GeminiModel {
  /** API model identifier sent in the request */
  id: string;
  /** Human-readable display name */
  label: string;
  /** Cost tier label shown in the UI */
  tier: 'free' | 'cheap' | 'standard' | 'costly';
  /** Short description shown as a tooltip */
  description: string;
}

export const GEMINI_MODELS: GeminiModel[] = [
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    tier: 'free',
    description: 'Fast, smart, free tier — best for most UCP orchestration tasks'
  },
  {
    id: 'gemini-2.5-flash-lite-preview-06-17',
    label: 'Gemini 2.5 Flash Lite',
    tier: 'free',
    description: 'Lightest 2.5 model, fastest responses, free tier'
  },
  {
    id: 'gemini-2.0-flash',
    label: 'Gemini 2.0 Flash',
    tier: 'cheap',
    description: 'Previous gen Flash — stable, very cheap'
  },
  {
    id: 'gemini-2.0-flash-lite',
    label: 'Gemini 2.0 Flash Lite',
    tier: 'free',
    description: 'Smallest 2.0 model, minimal cost'
  },
  {
    id: 'gemini-1.5-flash',
    label: 'Gemini 1.5 Flash',
    tier: 'cheap',
    description: 'Stable workhorse model, very cheap'
  },
  {
    id: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    tier: 'costly',
    description: 'Most capable model — best reasoning, higher cost'
  },
  {
    id: 'gemini-1.5-pro',
    label: 'Gemini 1.5 Pro',
    tier: 'standard',
    description: 'Full Pro model — high quality, moderate cost'
  }
];

const MODEL_STORAGE_KEY = 'ucp-angular-client.geminiModel';
const DEFAULT_MODEL_ID = 'gemini-2.5-flash';

@Injectable({
  providedIn: 'root'
})
export class GeminiService {
  private runtimeConfig = inject(RuntimeConfigService);

  /** Available Gemini models for the model picker */
  readonly models = GEMINI_MODELS;

  /** Currently selected model — persisted to localStorage */
  readonly selectedModel = signal<GeminiModel>(this.loadSavedModel());

  isConfigured() {
    return !!this.runtimeConfig.geminiApiKey();
  }

  setModel(modelId: string) {
    const found = GEMINI_MODELS.find(m => m.id === modelId);
    if (found) {
      this.selectedModel.set(found);
      try {
        localStorage.setItem(MODEL_STORAGE_KEY, modelId);
      } catch {
        // localStorage not available in SSR
      }
    }
  }

  async generateResponse(systemInstruction: string, prompt: string): Promise<string> {
    const apiKey = this.runtimeConfig.geminiApiKey();

    if (!apiKey) {
      return '⚠️ System: Gemini API key is missing. Add it in the AI platform header before using REST orchestration.';
    }

    const model = this.selectedModel().id;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemInstruction }] },
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2
          }
        })
      });

      const data = await response.json();

      if (data.error) {
        console.error('Gemini API Error:', data.error);
        return `⚠️ API Error: ${data.error.message}`;
      }

      return data.candidates[0].content.parts[0].text;
    } catch (e: any) {
      console.error('Gemini Request Failed:', e);
      return `⚠️ Network Error: ${e.message}`;
    }
  }

  async parseAddressWithGemini(addressText: string): Promise<any> {
    const prompt = `
You are an address parser. Extract the components of the following address into JSON format.
If you cannot determine a field, leave it blank or make a best guess based on context.
Return ONLY JSON, no markdown formatting.

Format:
{
  "street_address": "string",
  "city": "string",
  "region": "string",
  "postal_code": "string",
  "country_code": "string" // 2-letter ISO code if known
}

Address to parse:
${addressText}
`;
    const result = await this.generateResponse('You are a structured data parser.', prompt);
    try {
      return JSON.parse(result.replace(/```json/gi, '').replace(/```/g, '').trim());
    } catch {
      return null;
    }
  }

  private loadSavedModel(): GeminiModel {
    try {
      const saved = localStorage.getItem(MODEL_STORAGE_KEY);
      if (saved) {
        const found = GEMINI_MODELS.find(m => m.id === saved);
        if (found) return found;
      }
    } catch {
      // localStorage not available
    }
    return GEMINI_MODELS.find(m => m.id === DEFAULT_MODEL_ID) ?? GEMINI_MODELS[0];
  }
}
