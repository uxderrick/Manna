/**
 * Unified setup pipeline for Manna.
 *
 * 8 phases (ids in `PHASES` below). Users invoke via named recipes:
 *   bun run setup:minimal    → venv, bible-data, build-db, export-verses
 *   bun run setup:semantic   → onnx, precompute  (GPU required)
 *   bun run setup:whisper    → whisper
 *   bun run setup:all        → all 8 phases
 *
 * Flags:
 *   --phases=<csv>           Run only the listed phase ids
 *   --force                  Re-run phases even if artifacts exist
 *   --allow-cpu              Let precompute run on CPU (10+ hours)
 *
 * See README "Getting Started" for decision + feature matrices.
 */

import { join } from "node:path"
import { existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import {
  ensurePythonEnv,
  getVenvBin,
  PROJECT_ROOT,
} from "./lib/python-env"

// ── Paths ────────────────────────────────────────────────────────────
const DATA_DIR = join(PROJECT_ROOT, "data")
const MODELS_DIR = join(PROJECT_ROOT, "models", "qwen3-embedding-0.6b")
const MODELS_DIR_INT8 = join(
  PROJECT_ROOT,
  "models",
  "qwen3-embedding-0.6b-int8"
)

const KJV_SOURCE = join(DATA_DIR, "sources", "KJV.json")
const NIV_SOURCE = join(DATA_DIR, "sources", "NIV.json")
const DB_PATH = join(DATA_DIR, "rhema.db")
const VERSES_JSON = join(DATA_DIR, "verses-for-embedding.json")
const EMB_BIN = join(PROJECT_ROOT, "embeddings", "kjv-qwen3-0.6b.bin")
const IDS_BIN = join(PROJECT_ROOT, "embeddings", "kjv-qwen3-0.6b-ids.bin")
const WHISPER_MODEL = join(PROJECT_ROOT, "models", "whisper", "ggml-large-v3-turbo-q8_0.bin")
const MODEL_ONNX = join(MODELS_DIR, "model.onnx")
const MODEL_INT8 = join(MODELS_DIR_INT8, "model_quantized.onnx")

// ── CLI args ─────────────────────────────────────────────────────────
interface Opts {
  phases: PhaseId[]
  force: boolean
  allowCpu: boolean
}

function parseArgs(argv: string[]): Opts {
  const phasesArg = argv.find((a) => a.startsWith("--phases="))
  const phaseIds = phasesArg
    ? (phasesArg.slice("--phases=".length).split(",") as PhaseId[])
    : []
  return {
    phases: phaseIds,
    force: argv.includes("--force"),
    allowCpu: argv.includes("--allow-cpu"),
  }
}

// ── Helpers ──────────────────────────────────────────────────────────
function shouldSkip(label: string, force: boolean, ...artifacts: string[]): boolean {
  if (force) return false
  const allExist = artifacts.every((p) => existsSync(p))
  if (allExist) {
    console.log(`  ⏭ Skip: ${label} (artifacts already exist)`)
  }
  return allExist
}

async function run(
  cmd: string[],
  cwd?: string,
  extraEnv?: Record<string, string>
): Promise<void> {
  const proc = Bun.spawn(cmd, {
    stdout: "inherit",
    stderr: "inherit",
    cwd: cwd ?? PROJECT_ROOT,
    env: { ...process.env, ...extraEnv },
  })
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new Error(`Command failed (exit ${exitCode}): ${cmd.join(" ")}`)
  }
}

async function detectGpu(venvPython: string): Promise<"mps" | "cuda" | "cpu"> {
  try {
    const out = execFileSync(
      venvPython,
      [
        "-c",
        "import torch; print('mps' if torch.backends.mps.is_available() else 'cuda' if torch.cuda.is_available() else 'cpu')",
      ],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim()
    if (out === "mps" || out === "cuda") return out
    return "cpu"
  } catch {
    return "cpu"
  }
}

// ── Phase functions ──────────────────────────────────────────────────

async function phaseVenv(_opts: Opts): Promise<void> {
  await ensurePythonEnv([
    "optimum-onnx[onnxruntime]",
    "sentence-transformers",
    "accelerate",
    "tokenizers",
    "numpy",
    "torch",
    "meaningless",
  ])
}

async function phaseBibleData(opts: Opts): Promise<void> {
  if (!shouldSkip("open-source Bible data", opts.force, KJV_SOURCE)) {
    await run(["bun", "run", join(DATA_DIR, "download-sources.ts")])
  }
}

async function phaseBibleGw(opts: Opts): Promise<void> {
  if (!shouldSkip("BibleGateway translations", opts.force, NIV_SOURCE)) {
    const venvPython = getVenvBin(
      process.platform === "win32" ? "python" : "python3"
    )
    await run(
      [venvPython, join(DATA_DIR, "download-biblegateway.py")],
      undefined,
      { PYTHONUTF8: "1" }
    )
  }
}

async function phaseBuildDb(opts: Opts): Promise<void> {
  if (!shouldSkip("Bible database", opts.force, DB_PATH)) {
    await run(["bun", "run", join(DATA_DIR, "build-bible-db.ts")])
  }
}

async function phaseOnnx(opts: Opts): Promise<void> {
  if (shouldSkip("ONNX models", opts.force, MODEL_ONNX, MODEL_INT8)) return

  const optimumCli = getVenvBin("optimum-cli")

  if (opts.force || !existsSync(MODEL_ONNX)) {
    console.log("\n  🧠 Exporting Qwen3-Embedding-0.6B to ONNX (feature-extraction)...")
    console.log("     This may take a few minutes on first run.\n")
    await run([
      optimumCli,
      "export",
      "onnx",
      "--model",
      "Qwen/Qwen3-Embedding-0.6B",
      "--task",
      "feature-extraction",
      MODELS_DIR,
    ])
    console.log(`  ✓ Model exported to ${MODELS_DIR}`)
  }

  if (opts.force || !existsSync(MODEL_INT8)) {
    console.log("\n  ⚡ Quantizing to INT8 (ARM64)...")
    try {
      await run([
        optimumCli,
        "onnxruntime",
        "quantize",
        "--onnx_model",
        MODELS_DIR,
        "--arm64",
        "-o",
        MODELS_DIR_INT8,
      ])
      console.log(`  ✓ INT8 model saved to ${MODELS_DIR_INT8}`)
    } catch {
      console.error("  ⚠️  Quantization failed. The FP32 model is still usable.")
    }
  }
}

async function phaseExportVerses(opts: Opts): Promise<void> {
  if (shouldSkip("verses JSON", opts.force, VERSES_JSON)) return
  if (!existsSync(DB_PATH)) {
    console.error("  ❌ rhema.db not found. Run `bun run setup:minimal` first.")
    process.exit(1)
  }
  await run(["bun", "run", join(DATA_DIR, "compute-embeddings.ts")])
}

async function phasePrecompute(opts: Opts): Promise<void> {
  if (shouldSkip("precomputed embeddings", opts.force, EMB_BIN, IDS_BIN)) return

  const venvPython = getVenvBin(
    process.platform === "win32" ? "python" : "python3"
  )

  if (!existsSync(venvPython)) {
    console.error("  ❌ Python venv missing. Run `bun run setup:minimal` first.")
    process.exit(1)
  }

  const gpu = await detectGpu(venvPython)
  const allowCpu = opts.allowCpu || process.env.FORCE_CPU === "1"

  if (gpu === "cpu" && !allowCpu) {
    console.error(`
  ⚠️  No GPU detected — KJV precompute takes 10+ hours on CPU.

  Options:
    1. Skip semantic detection (recommended for church PCs):
       bun run setup:minimal
    2. Run on a Mac (MPS) or Linux with CUDA
    3. Accept CPU run (you'll wait):
       FORCE_CPU=1 bun run setup:semantic

  Aborting.
`)
    process.exit(1)
  }

  if (gpu !== "cpu") {
    const estimate = gpu === "mps" ? "30-45 min" : "15-25 min"
    console.log(`  ✓ GPU detected: ${gpu.toUpperCase()} (estimated time: ${estimate})`)
  } else {
    console.warn("  ⚠️  CPU fallback active — expect 10+ hours for KJV.")
  }

  await run(
    [venvPython, join(DATA_DIR, "precompute-embeddings.py")],
    undefined,
    { PYTHONUTF8: "1" }
  )
}

async function phaseWhisper(opts: Opts): Promise<void> {
  if (!shouldSkip("Whisper model", opts.force, WHISPER_MODEL)) {
    await run(["bun", "run", join(DATA_DIR, "download-whisper-model.ts")])
  }
}

// ── Phase registry ───────────────────────────────────────────────────

const PHASES = [
  { id: "venv",          fn: phaseVenv,         label: "Python environment" },
  { id: "bible-data",    fn: phaseBibleData,    label: "Open-source Bible data" },
  { id: "biblegateway",  fn: phaseBibleGw,      label: "BibleGateway translations" },
  { id: "build-db",      fn: phaseBuildDb,      label: "Build rhema.db" },
  { id: "onnx",          fn: phaseOnnx,         label: "ONNX model + quantize" },
  { id: "export-verses", fn: phaseExportVerses, label: "Export KJV verses to JSON" },
  { id: "precompute",    fn: phasePrecompute,   label: "Pre-compute embeddings" },
  { id: "whisper",       fn: phaseWhisper,      label: "Whisper STT model" },
] as const

type PhaseId = (typeof PHASES)[number]["id"]

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv)
  const selected =
    opts.phases.length > 0
      ? PHASES.filter((p) => (opts.phases as string[]).includes(p.id))
      : [...PHASES]

  if (selected.length === 0) {
    console.error(`❌ No matching phases for --phases=${opts.phases.join(",")}`)
    console.error(`   Valid phase ids: ${PHASES.map((p) => p.id).join(", ")}`)
    process.exit(1)
  }

  console.log("\n╔══════════════════════════════════════════════╗")
  console.log("║   Manna – Setup Pipeline                     ║")
  console.log("╚══════════════════════════════════════════════╝")
  console.log(
    `  Running ${selected.length} phase(s): ${selected.map((p) => p.id).join(", ")}`
  )
  if (opts.force) console.log("  (--force: re-running all selected phases)")

  for (const [i, p] of selected.entries()) {
    console.log(`\n━━━ Phase ${i + 1}/${selected.length}: ${p.label} ━━━`)
    await p.fn(opts)
  }

  console.log("\n╔══════════════════════════════════════════════╗")
  console.log("║   ✅ Setup complete!                          ║")
  console.log("╚══════════════════════════════════════════════╝\n")
}

main().catch((err) => {
  console.error("\n❌ Pipeline failed:", err.message ?? err)
  process.exit(1)
})
