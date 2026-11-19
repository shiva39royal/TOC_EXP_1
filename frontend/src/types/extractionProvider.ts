export type ExtractionProvider = "offline" | "google" | "openai" | "anthropic";
export type AiExtractionProvider = Exclude<ExtractionProvider, "offline">;

export const EXTRACTION_PROVIDERS: Array<{
  value: ExtractionProvider;
  label: string;
  keyPlaceholder: string;
}> = [
  {
    value: "offline",
    label: "Offline (no AI)",
    keyPlaceholder: "No API key — extraction stays on this device",
  },
  {
    value: "google",
    label: "Google Gemini (online)",
    keyPlaceholder: "Your Google AI Studio API key",
  },
  { value: "openai", label: "OpenAI (online)", keyPlaceholder: "Your OpenAI API key" },
  {
    value: "anthropic",
    label: "Anthropic Claude (online)",
    keyPlaceholder: "Your Anthropic API key",
  },
];
