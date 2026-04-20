import { describe, expect, test } from "vitest"
import { parseGeniusLyrics } from "./song-store"

describe("parseGeniusLyrics", () => {
  test("strips Genius header junk before first bracket", () => {
    const raw = `35 ContributorsAmazing Grace Lyrics"Amazing Grace" is a Christian hymn...Read More [Verse 1]
Amazing Grace, how sweet the sound
That saved a wretch like me
I once was lost but now I'm found
Was blind, but now I see`
    const { stanzas, chorus } = parseGeniusLyrics(raw)
    expect(chorus).toBeNull()
    expect(stanzas.length).toBe(1)
    expect(stanzas[0].lines[0]).toBe("Amazing Grace, how sweet the sound")
    expect(stanzas[0].lines[3]).toBe("Was blind, but now I see")
    // header junk must not appear
    expect(stanzas[0].lines.some((l) => l.includes("Contributors"))).toBe(false)
  })

  test("splits multiple verses on [Verse N] markers", () => {
    const raw = `[Verse 1]
Line A1
Line A2

[Verse 2]
Line B1
Line B2`
    const { stanzas } = parseGeniusLyrics(raw)
    expect(stanzas.length).toBe(2)
    expect(stanzas[0].lines).toEqual(["Line A1", "Line A2"])
    expect(stanzas[1].lines).toEqual(["Line B1", "Line B2"])
  })

  test("maps [Chorus] to chorus field", () => {
    const raw = `[Verse 1]
Verse line

[Chorus]
Chorus line 1
Chorus line 2

[Verse 2]
Second verse`
    const { stanzas, chorus } = parseGeniusLyrics(raw)
    expect(chorus).not.toBeNull()
    expect(chorus!.lines).toEqual(["Chorus line 1", "Chorus line 2"])
    expect(stanzas.length).toBe(2)
    expect(stanzas[0].lines).toEqual(["Verse line"])
    expect(stanzas[1].lines).toEqual(["Second verse"])
  })

  test("first chorus wins; later [Chorus] sections ignored", () => {
    const raw = `[Chorus]
First chorus text

[Verse 1]
Verse

[Chorus]
Different text`
    const { chorus } = parseGeniusLyrics(raw)
    expect(chorus!.lines).toEqual(["First chorus text"])
  })

  test("Refrain also treated as chorus", () => {
    const raw = `[Verse 1]
Verse

[Refrain]
Refrain line`
    const { chorus } = parseGeniusLyrics(raw)
    expect(chorus!.lines).toEqual(["Refrain line"])
  })

  test("preamble with [Intro] marker — [Intro] is valid section, content preserved", () => {
    const raw = `35 Contributors [Intro]
Real intro line

[Verse 1]
Amazing Grace`
    const { stanzas } = parseGeniusLyrics(raw)
    // Both [Intro] and [Verse 1] recognized as song sections
    expect(stanzas.length).toBe(2)
    expect(stanzas[0].lines).toEqual(["Real intro line"])
    expect(stanzas[1].lines).toEqual(["Amazing Grace"])
    // Preamble "35 Contributors" never promoted — it was before the first bracket
    expect(stanzas.some((s) => s.lines.some((l) => l.includes("Contributors")))).toBe(false)
  })

  test("non-structure brackets like [Produced by X] are skipped", () => {
    const raw = `[Produced by Kanye]
ignore this metadata

[Verse 1]
Real verse line`
    const { stanzas } = parseGeniusLyrics(raw)
    expect(stanzas.length).toBe(1)
    expect(stanzas[0].lines).toEqual(["Real verse line"])
  })

  test("[Bridge] and [Outro] treated as verses", () => {
    const raw = `[Verse 1]
Verse text

[Bridge]
Bridge text

[Outro]
Outro text`
    const { stanzas } = parseGeniusLyrics(raw)
    expect(stanzas.length).toBe(3)
    expect(stanzas.map((s) => s.lines[0])).toEqual(["Verse text", "Bridge text", "Outro text"])
  })

  test("fallback: no brackets → split on blank lines", () => {
    const raw = `Line A1
Line A2

Line B1
Line B2`
    const { stanzas, chorus } = parseGeniusLyrics(raw)
    expect(chorus).toBeNull()
    expect(stanzas.length).toBe(2)
    expect(stanzas[0].lines).toEqual(["Line A1", "Line A2"])
  })
})
