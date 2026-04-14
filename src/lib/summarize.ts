import { useSettingsStore } from "@/stores"

export async function summarizeTranscript(transcript: string): Promise<string> {
  const apiKey = useSettingsStore.getState().claudeApiKey
  if (!apiKey) {
    throw new Error("Claude API key not configured. Add it in Settings → API Keys.")
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5-20250514",
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: `Summarize this sermon transcript into clear, concise sermon notes. Include:
- Main topic/theme
- Key Bible verses referenced
- Main points (3-5 bullet points)
- Key takeaways

Transcript:
${transcript.slice(0, 12000)}`,
      }],
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Claude API error: ${error}`)
  }

  const data = await response.json()
  return data.content[0].text
}
