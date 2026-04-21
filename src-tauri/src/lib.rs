mod commands;
mod events;
mod menu;
mod state;

use rhema_notes::SessionDb;
use std::sync::Mutex;

const GHS_SEED_VERSION: i64 = 1;
const GHS_JSON: &str = include_str!("../ghs.json");

fn seed_ghs_hymns(db: &SessionDb) -> Result<(), Box<dyn std::error::Error>> {
    let current = db.max_ghs_seed_version().unwrap_or(0);
    if current >= GHS_SEED_VERSION {
        return Ok(());
    }

    let parsed: serde_json::Value = serde_json::from_str(GHS_JSON)?;
    let hymns = parsed
        .get("hymns")
        .and_then(|v| v.as_object())
        .ok_or("ghs.json missing hymns object")?;

    // Atomic seed: either all 260 rows land, or none do. Prevents "partial
    // seed" state that would permanently skip re-seeding on next startup.
    db.begin_transaction()?;
    let mut seeded = 0_usize;
    for (num_str, hymn) in hymns {
        let number: i64 = num_str.parse().unwrap_or(0);
        let title = hymn
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let chorus_str = hymn.get("chorus").and_then(|v| v.as_str()).unwrap_or("");
        let verses: Vec<String> = hymn
            .get("verses")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(ToString::to_string))
                    .filter(|s| !s.trim().is_empty())
                    .collect()
            })
            .unwrap_or_default();

        let stanzas_json: Vec<serde_json::Value> = verses
            .iter()
            .enumerate()
            .map(|(i, text)| {
                serde_json::json!({
                    "id": format!("v{}", i + 1),
                    "kind": "verse",
                    "lines": text.lines().collect::<Vec<_>>(),
                })
            })
            .collect();

        let chorus_json = if chorus_str.trim().is_empty() {
            serde_json::Value::Null
        } else {
            serde_json::json!({
                "id": "ch",
                "kind": "chorus",
                "lines": chorus_str.lines().collect::<Vec<_>>(),
            })
        };

        let data = serde_json::json!({
            "stanzas": stanzas_json,
            "chorus": chorus_json,
            "autoChorus": true,
            "lineMode": "stanza-full",
        });

        let id = format!("ghs-{number}");
        if let Err(e) = db.save_song(
            &id,
            "ghs",
            Some(number),
            &title,
            None,
            &data.to_string(),
            GHS_SEED_VERSION,
        ) {
            // Roll back — no partial state persists.
            let _ = db.rollback_transaction();
            return Err(Box::new(e));
        }
        seeded += 1;
    }

    db.commit_transaction()?;
    log::info!("GHS hymn seed complete — {seeded} hymns (version {GHS_SEED_VERSION})");
    Ok(())
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// Pre-warm the reqwest/rustls connection pool for API hosts used later.
///
/// Runs a single HEAD request per host at startup so the first user-initiated
/// verify or summary call doesn't pay the 6–10s cold-TLS penalty. Failures are
/// silently ignored — warmup is best-effort.
async fn warm_connection_pool() {
    const HOSTS: &[&str] = &[
        "https://api.deepgram.com",
        "https://api.assemblyai.com",
        "https://api.anthropic.com",
    ];
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .connect_timeout(std::time::Duration::from_secs(5))
        .http1_only()
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            log::warn!("connection warmup: failed to build client: {e}");
            return;
        }
    };
    let tasks: Vec<_> = HOSTS
        .iter()
        .map(|host| {
            let client = client.clone();
            let host = (*host).to_string();
            tokio::spawn(async move {
                match client.head(&host).send().await {
                    Ok(resp) => log::info!(
                        "connection warmup: {host} → HTTP {}",
                        resp.status().as_u16()
                    ),
                    Err(e) => log::info!("connection warmup: {host} failed: {e}"),
                }
            })
        })
        .collect();
    for t in tasks {
        let _ = t.await;
    }
}

#[expect(clippy::too_many_lines, reason = "app setup is inherently complex")]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load .env files — src-tauri/.env, project root ../.env, and ../.env.local
    dotenvy::dotenv().ok();
    dotenvy::from_filename("../.env").ok();
    dotenvy::from_filename("../.env.local").ok();
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(Mutex::new(state::AppState::new()))
        .manage(Mutex::new(rhema_broadcast::ndi::NdiRuntime::default()))
        .manage(Mutex::new(rhema_detection::DirectDetector::new()))
        .manage(Mutex::new(rhema_detection::DetectionMerger::new()))
        .manage(Mutex::new(rhema_detection::ReadingMode::new()))
        .manage(Mutex::new(commands::remote::OscRuntime::new()))
        .manage(Mutex::new(commands::remote::HttpRuntime::new()))
        .manage(Mutex::new({
            let app_data = dirs::data_dir()
                .unwrap_or_else(|| std::path::PathBuf::from("."))
                .join("com.manna.app");
            std::fs::create_dir_all(&app_data).ok();
            SessionDb::open(&app_data.join("manna.db"))
                .expect("Failed to open manna.db")
        }))
        .invoke_handler(tauri::generate_handler![
            quit_app,
            commands::bible::list_translations,
            commands::bible::list_books,
            commands::bible::get_chapter,
            commands::bible::get_verse,
            commands::bible::search_verses,
            commands::bible::get_translation_verses_for_search,
            commands::bible::get_cross_references,
            commands::bible::get_active_translation,
            commands::bible::set_active_translation,
            commands::detection::detect_verses,
            commands::detection::detection_status,
            commands::detection::semantic_search,
            commands::detection::toggle_paraphrase_detection,
            commands::detection::quotation_search,
            commands::detection::reading_mode_status,
            commands::detection::stop_reading_mode,
            commands::audio::get_audio_devices,
            commands::stt::start_transcription,
            commands::stt::stop_transcription,
            commands::stt::verify_deepgram_key,
            commands::stt::verify_assemblyai_key,
            commands::broadcast::list_monitors,
            commands::broadcast::ensure_broadcast_window,
            commands::broadcast::open_broadcast_window,
            commands::broadcast::close_broadcast_window,
            commands::broadcast::start_ndi,
            commands::broadcast::stop_ndi,
            commands::broadcast::get_ndi_status,
            commands::broadcast::push_ndi_frame,
            commands::remote::start_osc,
            commands::remote::stop_osc,
            commands::remote::get_osc_status,
            commands::remote::start_http,
            commands::remote::stop_http,
            commands::remote::get_http_status,
            commands::remote::update_remote_status,
            commands::session::create_session,
            commands::session::get_session,
            commands::session::list_sessions,
            commands::session::start_session,
            commands::session::end_session,
            commands::session::delete_session,
            commands::session::update_session_title,
            commands::session::update_session_summary,
            commands::session::add_session_detection,
            commands::session::get_session_detections,
            commands::session::add_session_transcript,
            commands::session::get_session_transcript,
            commands::session::add_session_note,
            commands::session::get_session_notes,
            commands::themes::list_custom_themes,
            commands::themes::save_custom_theme,
            commands::themes::delete_custom_theme,
            commands::songs::list_songs,
            commands::songs::get_song,
            commands::songs::save_song,
            commands::songs::delete_song,
            commands::songs::search_genius,
            commands::songs::fetch_genius_lyrics,
            commands::analytics::get_aggregate_stats,
            commands::analytics::get_verse_frequency,
            commands::analytics::get_recent_sessions,
            commands::analytics::get_session_detection_count,
            commands::service_plan::plan_list_templates,
            commands::service_plan::plan_create_template,
            commands::service_plan::plan_rename_template,
            commands::service_plan::plan_update_template_notes,
            commands::service_plan::plan_delete_template,
            commands::service_plan::plan_get,
            commands::service_plan::plan_add_item,
            commands::service_plan::plan_update_item,
            commands::service_plan::plan_reorder_item,
            commands::service_plan::plan_delete_item,
            commands::service_plan::plan_load_template_into_session,
            commands::service_plan::plan_clone_from_session,
            commands::service_plan::plan_save_session_as_template,
        ])
        .setup(|app| {
            use tauri::Manager;

            // Try resource dir first (production), then dev fallback
            let db_path = app
                .path()
                .resource_dir()
                .map(|p| p.join("rhema.db"))
                .ok()
                .filter(|p| p.exists())
                .unwrap_or_else(|| {
                    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                        .join("../data/rhema.db")
                });

            if db_path.exists() {
                let bible_db = rhema_bible::BibleDb::open(&db_path)
                    .expect("Failed to open Bible database");

                // Build quotation matching index from all English verses
                log::info!("Building quotation matching index...");
                let quotation_matcher = match bible_db.load_all_verses_for_quotation(Some("en")) {
                    Ok(verses) => {
                        log::info!("Loaded {} English verses for quotation index", verses.len());
                        rhema_detection::QuotationMatcher::build(verses)
                    }
                    Err(e) => {
                        log::warn!("Failed to load verses for quotation index: {e}");
                        rhema_detection::QuotationMatcher::new()
                    }
                };

                let managed_state = app.state::<Mutex<state::AppState>>();
                let mut state = managed_state.lock().unwrap();
                state.bible_db = Some(bible_db);
                state.quotation_matcher = quotation_matcher;
                drop(state);
                log::info!("Bible database loaded from {}", db_path.display());
            } else {
                log::warn!("Bible database not found at {}", db_path.display());
            }

            // Try to load ONNX embedding model and pre-computed verse index
            // Supports multiple models: MiniLM (fast, 80MB) or Qwen3 (quality, 585MB+)
            let base_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
            let (model_path, tokenizer_path, embeddings_path, ids_path) = {
                // Try MiniLM first (fast, small, pre-built ONNX)
                let minilm_model = base_dir.join("models/all-MiniLM-L6-v2/onnx/model.onnx");
                let minilm_tok = base_dir.join("models/all-MiniLM-L6-v2/tokenizer.json");
                let minilm_emb = base_dir.join("embeddings/kjv-minilm-l6-v2.bin");
                let minilm_ids = base_dir.join("embeddings/kjv-minilm-l6-v2-ids.bin");

                // Then Qwen3 INT8/FP32
                let qwen_int8 = base_dir.join("models/qwen3-embedding-0.6b-int8/model_quantized.onnx");
                let qwen_fp32 = base_dir.join("models/qwen3-embedding-0.6b/model.onnx");
                let qwen_tok = base_dir.join("models/qwen3-embedding-0.6b/tokenizer.json");
                let qwen_emb = base_dir.join("embeddings/kjv-qwen3-0.6b.bin");
                let qwen_ids = base_dir.join("embeddings/kjv-qwen3-0.6b-ids.bin");

                // Prefer Qwen3 INT8 — 4× less RAM than FP32 for <1% MTEB loss.
                // Matches upstream rhema default. FP32 only used if INT8 missing.
                if qwen_int8.exists() && qwen_emb.exists() {
                    log::info!("Using Qwen3 INT8 embedding model (quality, 1024-dim, 585MB)");
                    (qwen_int8, qwen_tok, qwen_emb, qwen_ids)
                } else if qwen_fp32.exists() && qwen_emb.exists() {
                    log::info!("Using Qwen3 FP32 embedding model (quality, 1024-dim, 1.1GB)");
                    (qwen_fp32, qwen_tok, qwen_emb, qwen_ids)
                } else if minilm_model.exists() && minilm_emb.exists() {
                    log::info!("Using MiniLM-L6-v2 embedding model (fast, 384-dim)");
                    (minilm_model, minilm_tok, minilm_emb, minilm_ids)
                } else if minilm_model.exists() {
                    log::info!("MiniLM model found but embeddings missing. Run precompute.");
                    (minilm_model, minilm_tok, minilm_emb, minilm_ids)
                } else {
                    // Default to Qwen3 paths (will fail gracefully if missing)
                    (qwen_fp32, qwen_tok, qwen_emb, qwen_ids)
                }
            };

            if model_path.exists() && tokenizer_path.exists() {
                use rhema_detection::semantic::embedder::TextEmbedder;
                use rhema_detection::semantic::index::VectorIndex;
                match rhema_detection::OnnxEmbedder::load(&model_path, &tokenizer_path) {
                    Ok(embedder) => {
                        log::info!("ONNX embedding model loaded");
                        let managed_state = app.state::<Mutex<state::AppState>>();
                        let mut state = managed_state.lock().unwrap();

                        // If pre-computed embeddings exist, load the vector index
                        if embeddings_path.exists() && ids_path.exists() {
                            let dim = embedder.dimension();
                            match rhema_detection::HnswVectorIndex::load(&embeddings_path, &ids_path, dim) {
                                Ok(index) => {
                                    log::info!("Verse embeddings loaded ({} vectors)", index.len());
                                    state.detection_pipeline.set_semantic(
                                        rhema_detection::SemanticDetector::new(
                                            Box::new(embedder),
                                            Box::new(index),
                                        ),
                                    );
                                }
                                Err(e) => {
                                    log::warn!("Failed to load verse embeddings: {e}");
                                }
                            }
                        } else {
                            log::info!("No pre-computed verse embeddings found. Run 'bun run export:verses' then the precompute binary.");
                        }
                    }
                    Err(e) => {
                        log::warn!("Failed to load ONNX model: {e}");
                    }
                }
            } else {
                log::info!("ONNX model not found. Semantic search disabled. Run 'bun run download:model' to download.");
            }

            // Seed GHS hymns into songs table (idempotent via seed_version check)
            if let Some(db_state) = app.try_state::<Mutex<SessionDb>>() {
                match db_state.lock() {
                    Ok(db) => {
                        if let Err(e) = seed_ghs_hymns(&db) {
                            log::warn!("GHS seed failed: {e}");
                        }
                    }
                    Err(e) => log::warn!("GHS seed: could not acquire DB lock: {e}"),
                }
            }

            let menu = menu::build(app)?;
            app.set_menu(menu)?;

            // Warm TLS/HTTP connection pool to STT + AI hosts in the background.
            // First cold request eats 6–10s of DNS + TLS handshake; prewarming
            // makes subsequent user-initiated verify/summarize calls snappy.
            tauri::async_runtime::spawn(async {
                warm_connection_pool().await;
            });

            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().0.clone();
            // Handle quit natively — closing via JS only hides the window on macOS
            if id == "manna:quit" {
                app.exit(0);
                return;
            }
            use tauri::Emitter;
            let _ = app.emit("menu-event", id);
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
