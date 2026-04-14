import { useSettingsStore } from "@/stores"

const PROMPT = `You are a church sermon notes assistant. Summarize this sermon transcript into clear, concise notes. Work with whatever content is available — even if the transcript is short, fragmented, or from a test recording.

Always produce useful notes. Never refuse or say the transcript is insufficient. Extract whatever you can.

Format:
## Topic
[Best guess at the main theme based on what was said]

## Key Verses
[Any Bible verses mentioned or referenced, even indirectly]

## Main Points
[3-5 bullet points summarizing what was discussed]

## Takeaways
[1-3 practical takeaways for the congregation]

Transcript:
`

const MODELS = ["claude-haiku-4-5-20251001", "claude-sonnet-4-6"]

export async function summarizeTranscript(transcript: string): Promise<string> {
  const apiKey = useSettingsStore.getState().claudeApiKey
  if (!apiKey) {
    throw new Error("Claude API key not configured. Add it in Settings → API Keys.")
  }

  let lastError = ""

  for (const model of MODELS) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          messages: [{
            role: "user",
            content: PROMPT + transcript.slice(0, 12000),
          }],
        }),
      })

      if (response.ok) {
        const data = await response.json()
        return data.content[0].text
      }

      lastError = await response.text()
      if (!lastError.includes("overloaded")) {
        throw new Error(`Claude API error: ${lastError}`)
      }
      // If overloaded, try next model
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Claude API error:")) throw e
      lastError = String(e)
    }
  }

  throw new Error("Claude API is currently overloaded. Please try again in a minute.")
}
