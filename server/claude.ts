import Anthropic from '@anthropic-ai/sdk';

// <important_do_not_delete>
// Switched to Sonnet 4.6 on 2026-05-17 — Opus 4.5 was accurate but too expensive (~$0.50/PDF).
// Sonnet 4.6 is ~5x cheaper with much better OCR than Sonnet 4.
const DEFAULT_MODEL_STR = "claude-sonnet-4-6";
// </important_do_not_delete>

// Validate API key exists and is valid format
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const API_KEY_VALID = ANTHROPIC_API_KEY && 
                      ANTHROPIC_API_KEY.startsWith('sk-ant-') && 
                      ANTHROPIC_API_KEY.length > 20;

if (!API_KEY_VALID) {
  const errorMsg = `
╔═══════════════════════════════════════════════════════════╗
║  ⚠️  ANTHROPIC_API_KEY NOT CONFIGURED                    ║
╚═══════════════════════════════════════════════════════════╝

The ANTHROPIC_API_KEY environment variable is not set or invalid.

To fix this:
1. Go to https://console.anthropic.com/ to get your API key
2. Set it as the ANTHROPIC_API_KEY environment variable on the server
3. Restart the server process

Claude Vision API endpoints will return 503 until this is configured.
`.trim();
  
  console.error(errorMsg);
}

// Only initialize if we have a valid key
const anthropic = API_KEY_VALID 
  ? new Anthropic({ apiKey: ANTHROPIC_API_KEY })
  : null;

/**
 * Check if Claude API is properly configured
 */
export function isConfigured(): boolean {
  return !!API_KEY_VALID;
}

/**
 * Throw error if API key is not configured
 */
function ensureConfigured() {
  if (!isConfigured()) {
    throw new Error('ANTHROPIC_API_KEY is not configured. Set it as an environment variable on the server and restart the process.');
  }
}

/**
 * Analyze an image or PDF using Claude Vision API
 * Supports images, PDFs, invoices, documents, etc.
 */
export async function analyzeImage(
  base64Image: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | 'application/pdf' = 'image/jpeg',
  customPrompt?: string
): Promise<string> {
  ensureConfigured();
  
  const defaultPrompt = "Analyze this image in detail and describe its key elements, context, and any notable aspects.";
  
  if (!anthropic) {
    throw new Error('Anthropic client not initialized - API key not configured');
  }

  const stream = anthropic.messages.stream({
    model: DEFAULT_MODEL_STR,
    max_tokens: 4096,
    messages: [{
      role: "user",
      content: [
        {
          type: "text",
          text: customPrompt || defaultPrompt
        },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: mediaType as any, // Anthropic SDK types don't include PDF yet, but API supports it
            data: base64Image
          }
        }
      ]
    }]
  });
  const response = await stream.finalMessage();

  return response.content[0].type === 'text' ? response.content[0].text : '';
}

/**
 * Analyze multiple images or PDFs
 */
export async function analyzeMultipleImages(
  images: Array<{ base64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | 'application/pdf' }>,
  customPrompt?: string
): Promise<string> {
  ensureConfigured();
  
  const defaultPrompt = "Analyze these images in sequence and provide a comprehensive description of all content.";
  
  const content: Anthropic.MessageParam['content'] = [
    {
      type: "text",
      text: customPrompt || defaultPrompt
    },
    ...images.map(img => ({
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: img.mediaType as any, // Anthropic SDK types don't include PDF yet, but API supports it
        data: img.base64
      }
    }))
  ];

  if (!anthropic) {
    throw new Error('Anthropic client not initialized - API key not configured');
  }

  const stream = anthropic.messages.stream({
    model: DEFAULT_MODEL_STR,
    max_tokens: 8192,
    messages: [{
      role: "user",
      content
    }]
  });
  const response = await stream.finalMessage();

  return response.content[0].type === 'text' ? response.content[0].text : '';
}

/**
 * Extract structured data from an invoice/document image or PDF
 */
export async function extractInvoiceData(
  base64Image: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | 'application/pdf' = 'image/jpeg'
): Promise<any> {
  ensureConfigured();
  
  const prompt = `Analyze this invoice/document image and extract the following information in JSON format:
{
  "invoice_number": "string or null",
  "invoice_date": "YYYY-MM-DD or null",
  "shipper": "string or null",
  "amount": "number or null",
  "currency": "string or null",
  "items": [
    {
      "description": "string",
      "quantity": "number",
      "unit_price": "number",
      "total": "number"
    }
  ],
  "total_amount": "number or null",
  "additional_info": "any other relevant information"
}

Return ONLY the JSON object, no additional text.`;

  if (!anthropic) {
    throw new Error('Anthropic client not initialized - API key not configured');
  }

  const stream = anthropic.messages.stream({
    model: DEFAULT_MODEL_STR,
    max_tokens: 4096,
    messages: [{
      role: "user",
      content: [
        {
          type: "text",
          text: prompt
        },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: mediaType as any, // Anthropic SDK types don't include PDF yet, but API supports it
            data: base64Image
          }
        }
      ]
    }]
  });
  const response = await stream.finalMessage();

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  
  try {
    return JSON.parse(text);
  } catch (error) {
    // If response isn't pure JSON, try to extract it
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('Failed to parse JSON response from Claude');
  }
}

/**
 * Ask Claude to answer questions about an image or PDF
 */
export async function askAboutImage(
  base64Image: string,
  question: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | 'application/pdf' = 'image/jpeg'
): Promise<string> {
  ensureConfigured();
  
  if (!anthropic) {
    throw new Error('Anthropic client not initialized - API key not configured');
  }

  const stream = anthropic.messages.stream({
    model: DEFAULT_MODEL_STR,
    max_tokens: 2048,
    messages: [{
      role: "user",
      content: [
        {
          type: "text",
          text: question
        },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: mediaType as any, // Anthropic SDK types don't include PDF yet, but API supports it
            data: base64Image
          }
        }
      ]
    }]
  });
  const response = await stream.finalMessage();

  return response.content[0].type === 'text' ? response.content[0].text : '';
}

/**
 * Analyze a PDF document using Claude's native PDF support
 * Uses 'document' content type instead of 'image' for better PDF processing
 */
export async function analyzePdfWithClaude({
  base64Data,
  prompt,
  maxTokens = 4096,
  temperature = 1,
  model = DEFAULT_MODEL_STR,
}: {
  base64Data: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
}): Promise<string> {
  ensureConfigured();

  if (!anthropic) {
    throw new Error('Anthropic client not initialized - API key not configured');
  }

  // Use streaming: Anthropic SDK errors out on non-streaming calls that may
  // exceed 10 minutes; more importantly, streaming keeps bytes flowing so the
  // nginx ~60s proxy_read_timeout in front of this server doesn't fire on
  // large invoice extractions.
  const stream = anthropic.messages.stream({
    model,
    max_tokens: maxTokens,
    temperature: temperature,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: base64Data,
            },
          },
          {
            type: 'text',
            text: prompt,
          },
        ],
      },
    ],
  });
  const message = await stream.finalMessage();

  return message.content[0].type === 'text' ? message.content[0].text : '';
}

/**
 * Analyze text with Claude (non-vision). Streams to avoid nginx proxy timeout
 * on large outputs (see analyzePdfWithClaude for rationale).
 */
export async function analyzeText(prompt: string, systemPrompt?: string, temperature: number = 1, maxTokens: number = 4096, model: string = DEFAULT_MODEL_STR): Promise<string> {
  ensureConfigured();

  if (!anthropic) {
    throw new Error('Anthropic client not initialized - API key not configured');
  }

  const stream = anthropic.messages.stream({
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
    model,
    temperature,
    ...(systemPrompt && { system: systemPrompt })
  });
  const message = await stream.finalMessage();

  return message.content[0].type === 'text' ? message.content[0].text : '';
}

export default {
  isConfigured,
  analyzeImage,
  analyzeMultipleImages,
  extractInvoiceData,
  askAboutImage,
  analyzePdfWithClaude,
  analyzeText
};
