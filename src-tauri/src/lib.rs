mod commands;
mod events;
mod hymnals;
mod menu;
#[cfg(feature = "onnx")]
mod semantic_resources;
mod state;
#[cfg(feature = "package-check")]
mod package_check;

use rhema_notes::SessionDb;
use std::sync::Mutex;

use hymnals::{HymnalDef, HYMNALS};

/// Compile-time flavor marker ("minimal", "standard", or "full"). Set by `build.rs` from
/// the `MANNA_FLAVOR` env var at build time; defaults to "minimal".
pub const FLAVOR: &str = env!("MANNA_FLAVOR");

#[tauri::command]
fn get_flavor() -> &'static str {
    FLAVOR
}

#[tauri::command]
fn print_summary(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Summary printing is only available in the main window.".to_owned());
    }
    #[cfg(desktop)]
    return window.print().map_err(|error| error.to_string());
    #[cfg(not(desktop))]
    Err("Summary printing requires the desktop app.".to_owned())
}

/// Release builds resolve only installed resources. Development builds can also
/// resolve files from the checkout; a missing release resource must stay missing.
fn resolve_resource(app: &tauri::App, rel: &str) -> std::path::PathBuf {
    use tauri::Manager;
    let bundled = app.path().resource_dir().unwrap_or_default().join(rel);
    if cfg!(debug_assertions) && !bundled.exists() {
        return std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..").join(rel);
    }
    bundled
}

#[derive(serde::Deserialize)]
struct NormalizedHymnalJson {
    hymns: Vec<NormalizedHymn>,
}

#[derive(serde::Deserialize)]
struct NormalizedHymn {
    number: i64,
    title: String,
    #[serde(default)]
    author: Option<String>,
    #[serde(default)]
    stanzas: Vec<Vec<String>>,
    #[serde(default)]
    chorus: Option<Vec<String>>,
    #[serde(default)]
    tune: Option<String>,
    #[serde(default)]
    meter: Option<String>,
    #[serde(rename = "scriptureRef", default)]
    scripture_ref: Option<String>,
    #[serde(default)]
    category: Option<String>,
}

fn seed_hymnals(db: &SessionDb, enabled: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    for def in HYMNALS {
        if !enabled.iter().any(|e| e == def.id) {
            continue;
        }
        let current = db.max_hymnal_seed_version(def.id).unwrap_or(0);
        if current >= def.seed_version {
            continue;
        }
        seed_one_hymnal(db, def)?;
    }
    Ok(())
}

fn seed_one_hymnal(db: &SessionDb, def: &HymnalDef) -> Result<(), Box<dyn std::error::Error>> {
    let parsed: NormalizedHymnalJson = serde_json::from_str(def.json)?;
    if parsed.hymns.is_empty() {
        log::info!(
            "Skipping seed for {} — hymnal JSON is empty (placeholder)",
            def.id
        );
        return Ok(());
    }

    db.begin_transaction()?;
    let mut seeded = 0_usize;
    for hymn in &parsed.hymns {
        let stanzas_json: Vec<serde_json::Value> = hymn
            .stanzas
            .iter()
            .enumerate()
            .map(|(i, lines)| {
                serde_json::json!({
                    "id": format!("v{}", i + 1),
                    "kind": "verse",
                    "lines": lines,
                })
            })
            .collect();

        let chorus_json = match &hymn.chorus {
            Some(lines) if !lines.is_empty() => serde_json::json!({
                "id": "ch",
                "kind": "chorus",
                "lines": lines,
            }),
            _ => serde_json::Value::Null,
        };

        let has_chorus = !chorus_json.is_null();
        let data = serde_json::json!({
            "stanzas": stanzas_json,
            "chorus": chorus_json,
            "autoChorus": has_chorus,
            "lineMode": "stanza-pair",
        });

        let id = format!("{}-{}", def.id, hymn.number);
        if let Err(e) = db.save_song_with_meta(
            &id,
            def.id,
            Some(hymn.number),
            &hymn.title,
            hymn.author.as_deref(),
            &data.to_string(),
            def.seed_version,
            hymn.tune.as_deref(),
            hymn.meter.as_deref(),
            hymn.scripture_ref.as_deref(),
            hymn.category.as_deref(),
        ) {
            let _ = db.rollback_transaction();
            return Err(Box::new(e));
        }
        seeded += 1;
    }

    db.commit_transaction()?;
    log::info!(
        "Seeded {} hymns from {} (version {})",
        seeded,
        def.id,
        def.seed_version
    );
    Ok(())
}

/// Public wrapper so `commands::hymnals::seed_hymnal` can invoke seeding.
pub(crate) fn seed_one_hymnal_public(
    db: &SessionDb,
    def: &HymnalDef,
) -> Result<(), Box<dyn std::error::Error>> {
    seed_one_hymnal(db, def)
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// Open the webview devtools. Callable from the frontend so the View menu
/// item can fall back to `invoke("open_devtools")` if menu-event dispatch is
/// flaky. Requires the `devtools` feature on the `tauri` crate.
#[tauri::command]
fn open_devtools(app: tauri::AppHandle) {
    use tauri::Manager;
    let window = app
        .get_webview_window("main")
        .or_else(|| app.webview_windows().into_values().next());
    match window {
        Some(w) => {
            log::info!("[devtools] opening on window {:?}", w.label());
            w.open_devtools();
        }
        None => log::error!("[devtools] no webview window found"),
    }
}

/// Best-effort API host DNS/TLS warm-up. This HTTP client is not reused by
/// speech WebSockets; their actual streaming transport is prepared separately.
async fn warm_connection_pool() {
    const HOSTS: &[&str] = &[
        "https://api.deepgram.com",
        "https://api.assemblyai.com",
        "https://api.deepseek.com",
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
    let checking_package = cfg!(feature = "package-check")
        && std::env::args().any(|argument| argument == "--verify-package");
    // Load .env files — src-tauri/.env, project root ../.env, and ../.env.local
    if !checking_package {
        dotenvy::dotenv().ok();
        dotenvy::from_filename("../.env").ok();
        dotenvy::from_filename("../.env.local").ok();
    }
    let context = tauri::generate_context!();
    let application_identifier = context.config().identifier.clone();
    // Bibles imported from other software live next to manna.db; the bundled
    // rhema.db stays read-only. Package checks use no on-disk user data.
    let user_bibles_path = (!checking_package).then(|| {
        dirs::data_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .join(&application_identifier)
            .join("user-bibles.db")
    });
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(Mutex::new(state::AppState::new()))
        .manage(Mutex::new(rhema_broadcast::ndi::NdiRuntime::default()))
        .manage(Mutex::new(rhema_detection::DirectDetector::new()))
        .manage(Mutex::new(rhema_detection::DetectionMerger::new()))
        .manage(Mutex::new(rhema_detection::ReadingMode::new()))
        .manage(Mutex::new(commands::remote::OscRuntime::new()))
        .manage(Mutex::new(commands::remote::HttpRuntime::new()))
        .manage(commands::sms::SmsRuntime::default())
        .manage(commands::sermon_audio::AudioEditRuntime::default())
        .manage(Mutex::new({
            let app_data = dirs::data_dir()
                .unwrap_or_else(|| std::path::PathBuf::from("."))
                .join(application_identifier);
            let db_path = if checking_package {
                std::path::PathBuf::from(":memory:")
            } else {
                std::fs::create_dir_all(&app_data).ok();
                app_data.join("manna.db")
            };
            // Tauri's setup() hasn't run yet, so a plugin-dialog message box
            // isn't available here. Print to stderr and exit cleanly with a
            // non-zero code so the user sees a readable message instead of a
            // panic backtrace. The installer / GUI launcher logs stderr.
            match SessionDb::open(&db_path) {
                Ok(db) => db,
                Err(e) => {
                    eprintln!(
                        "FATAL: cannot open manna.db at {}\n\
                         reason: {e}\n\
                         The app data directory may be read-only or the DB file is corrupt.\n\
                         Try deleting {} and restarting (this will reset notes/sessions but keep imported songs).",
                        db_path.display(),
                        db_path.display(),
                    );
                    std::process::exit(1);
                }
            }
        }))
        .invoke_handler(tauri::generate_handler![
            quit_app,
            open_devtools,
            get_flavor,
            print_summary,
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
            commands::audio::start_audio_test,
            commands::audio::stop_audio_test,
            commands::audio::record_audio_clip,
            commands::stt::start_transcription,
            commands::stt::prepare_stt_connection,
            commands::stt::local::get_default_stt_provider,
            commands::stt::local::prepare_local_speech,
            commands::stt::stop_transcription,
            commands::stt::get_stt_status,
            commands::stt::set_recording_paused,
            commands::stt::get_recording_paused,
            commands::stt::verify_deepgram_key,
            commands::stt::verify_assemblyai_key,
            commands::stt::verify_claude_key,
            commands::stt::verify_deepseek_key,
            commands::summarize::summarize_sermon,
            commands::sharing::generate_sharing_draft,
            commands::sharing::alternatives::generate_sms_alternatives,
            commands::sharing::get_sharing_draft,
            commands::sharing::save_sharing_draft,
            commands::publishing::get_session_publication,
            commands::publishing::publish_session_recap,
            commands::publishing::generate_linked_sms,
            commands::sermon_audio::get_sermon_audio,
            commands::sermon_audio::suggest_sermon_audio,
            commands::sermon_audio::prepare_sermon_audio,
            commands::sermon_audio::read_prepared_sermon_audio,
            commands::sms::get_comms360_settings,
            commands::sms::save_comms360_settings,
            commands::sms::get_test_sms_batch,
            commands::sms::preview_test_sms,
            commands::sms::send_test_sms,
            commands::sms::refresh_test_sms,
            commands::sms::list::get_contact_list_sms,
            commands::sms::list::preview_contact_list_sms,
            commands::sms::list::send_contact_list_sms,
            commands::sms::list::refresh_contact_list_sms,
            commands::summarize::generate_live_notes,
            commands::images::search_pexels,
            commands::images::search_unsplash,
            commands::images::search_brave_images,
            commands::images::save_image_to_library,
            commands::images::list_library_images,
            commands::images::delete_library_image,
            commands::images::library_dir_path,
            commands::images::list_local_images,
            commands::images::delete_local_image,
            commands::images::read_local_image_data_url,
            commands::broadcast::list_monitors,
            commands::broadcast::ensure_broadcast_window,
            commands::broadcast::open_broadcast_window,
            commands::broadcast::close_broadcast_window,
            commands::broadcast::is_broadcast_open,
            commands::broadcast::set_broadcast_fullscreen,
            commands::broadcast::is_broadcast_fullscreen,
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
            commands::sermon_title::detect_session_title,
            commands::session::update_session_summary,
            commands::session::update_session_series,
            commands::session::update_session_tags,
            commands::session::list_session_series,
            commands::session::update_transcript_segment,
            commands::session::delete_transcript_segment,
            commands::session::add_session_detection,
            commands::session::get_session_detections,
            commands::session::record_presented_verse,
            commands::session::add_session_transcript,
            commands::session::get_session_transcript,
            commands::session::add_session_note,
            commands::session::get_session_notes,
            commands::session::update_session_note,
            commands::session::add_distribution,
            commands::session::list_distributions,
            commands::session::mark_distribution_sent,
            commands::session::mark_distribution_failed,
            commands::session::delete_distribution,
            commands::recording::delete_session_audio,
            commands::recording::finalize_session_audio,
            commands::recording::read_session_audio,
            commands::recording::get_session_audio_timeline,
            commands::storage::get_recordings_location,
            commands::storage::set_recordings_root,
            commands::storage::move_recordings_root,
            commands::themes::list_custom_themes,
            commands::themes::save_custom_theme,
            commands::themes::delete_custom_theme,
            commands::songs::list_songs,
            commands::songs::get_song,
            commands::songs::save_song,
            commands::songs::delete_song,
            commands::songs::search_genius,
            commands::songs::fetch_genius_lyrics,
            commands::songs::search_lrclib,
            commands::songs::fetch_lrclib_lyrics,
            commands::content_import::detect_import_sources,
            commands::content_import::import_content,
            commands::hymnals::seed_hymnal,
            commands::hymnals::delete_hymnal_songs,
            commands::hymnals::list_hymnal_counts,
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
            commands::service_plan::get_session_slides,
            commands::service_plan::plan_add_item,
            commands::service_plan::plan_update_item,
            commands::service_plan::plan_reorder_item,
            commands::service_plan::plan_delete_item,
            commands::service_plan::plan_load_template_into_session,
            commands::service_plan::plan_clone_from_session,
            commands::service_plan::plan_save_session_as_template,
            commands::assets::save_brand_asset,
            commands::video_assets::import_blank_video,
            commands::assets::delete_brand_asset,
            commands::images::import_library_image,
        ])
        .setup(move |app| {
            use tauri::Manager;

            // Hold a keepawake assertion for the app's lifetime so the laptop
            // doesn't idle-sleep during a service. Display + idle sleep are
            // blocked; system sleep (lid close) is honored. The handle is
            // kept inside AppState so it lives as long as the process.
            match keepawake::Builder::default()
                .display(true)
                .idle(true)
                .reason("Live broadcast in progress")
                .app_name("Manna")
                .app_reverse_domain("com.manna.app")
                .create()
            {
                Ok(handle) => {
                    log::info!("[sleep] keepawake assertion active");
                    let managed_state = app.state::<Mutex<state::AppState>>();
                    match managed_state.lock() {
                        Ok(mut state) => state.keepawake = Some(handle),
                        Err(_) => log::warn!("[sleep] could not install keepawake handle — AppState lock poisoned"),
                    };
                }
                Err(e) => log::warn!("[sleep] failed to acquire keepawake: {e}"),
            }

            // Resource-dir first (production), dev fallback via resolve_resource.
            // Installer places rhema.db at $RESOURCE_DIR/data/rhema.db per the
            // per-flavor tauri.conf.*.json resources block.
            let db_path = resolve_resource(app, "data/rhema.db");

            if db_path.exists() {
                let opened = match &user_bibles_path {
                    Some(user) => rhema_bible::BibleDb::open_with_user(&db_path, user).or_else(|e| {
                        log::warn!("Imported Bibles unavailable ({e}); using bundled Bibles only");
                        rhema_bible::BibleDb::open(&db_path)
                    }),
                    None => rhema_bible::BibleDb::open(&db_path),
                };
                match opened {
                    Ok(bible_db) => {
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
                        match managed_state.lock() {
                            Ok(mut state) => {
                                state.bible_db = Some(bible_db);
                                state.quotation_matcher = quotation_matcher;
                                drop(state);
                                log::info!("Bible database loaded from {}", db_path.display());
                            }
                            Err(_) => log::error!("Could not acquire AppState lock to install Bible DB; Bible features disabled this session"),
                        };
                    }
                    Err(e) => {
                        log::error!(
                            "Bible database at {} present but unreadable: {e}; \
                             Bible features disabled this session",
                            db_path.display()
                        );
                    }
                }
            } else {
                log::warn!("Bible database not found at {}", db_path.display());
            }

            // Try to load ONNX embedding model and pre-computed verse index.
            // In production installs, resources live under $RESOURCE_DIR per the
            // flavor config; in dev mode resolve_resource falls back to project root.
            let bundled_minilm = [
                "models/fallback-minilm/model.onnx",
                "models/fallback-minilm/tokenizer.json",
                "models/fallback-minilm/kjv-minilm-l6-v2.bin",
                "models/fallback-minilm/kjv-minilm-l6-v2-ids.bin",
            ].map(|path| resolve_resource(app,path));
            let [minilm_model,minilm_tok,minilm_emb,minilm_ids] = if bundled_minilm.iter().all(|path|path.is_file()) {
                bundled_minilm
            } else {
                ["models/all-MiniLM-L6-v2/onnx/model.onnx",
                 "models/all-MiniLM-L6-v2/tokenizer.json",
                 "embeddings/kjv-minilm-l6-v2.bin",
                 "embeddings/kjv-minilm-l6-v2-ids.bin"].map(|path|resolve_resource(app,path))
            };

            let qwen_int8 = resolve_resource(app, "models/qwen3-embedding-0.6b-int8/model_quantized.onnx");
            let qwen_fp32 = resolve_resource(app, "models/qwen3-embedding-0.6b/model.onnx");
            let qwen_tok = resolve_resource(app, "models/qwen3-embedding-0.6b/tokenizer.json");
            let qwen_emb = resolve_resource(app, "embeddings/kjv-qwen3-0.6b.bin");
            let qwen_ids = resolve_resource(app, "embeddings/kjv-qwen3-0.6b-ids.bin");

            // Prefer Qwen3 INT8 when present, but keep FP32/MiniLM fallbacks.
            // OnnxEmbedder validates the graph signature at load time, so a
            // stale generation/KV-cache INT8 export is rejected and startup can
            // still try the next known-good model.
            let model_candidates = [
                (
                    "Qwen3 INT8 embedding model (quality, 1024-dim, lower RAM)",
                    qwen_int8,
                    qwen_tok.clone(),
                    qwen_emb.clone(),
                    qwen_ids.clone(),
                ),
                (
                    "Qwen3 FP32 embedding model (quality, 1024-dim, 1.1GB)",
                    qwen_fp32,
                    qwen_tok,
                    qwen_emb,
                    qwen_ids,
                ),
                (
                    "MiniLM-L6-v2 embedding model (fast, 384-dim)",
                    minilm_model,
                    minilm_tok,
                    minilm_emb,
                    minilm_ids,
                ),
            ];

            #[cfg(feature = "onnx")]
            {
                use rhema_detection::semantic::embedder::TextEmbedder;
                use rhema_detection::semantic::index::VectorIndex;

                let mut semantic_loaded = false;
                for (label, model_path, tokenizer_path, embeddings_path, ids_path) in model_candidates {
                    if !model_path.exists() || !tokenizer_path.exists() {
                        continue;
                    }
                    if !embeddings_path.exists() || !ids_path.exists() {
                        log::info!(
                            "{label} found but embeddings missing. Run 'bun run export:verses' then the precompute binary."
                        );
                        continue;
                    }

                    log::info!("Using {label}");
                    match rhema_detection::OnnxEmbedder::load(&model_path, &tokenizer_path) {
                        Ok(embedder) => {
                            if let Err(e) = embedder.embed("Find the Bible verse about faith and hope") {
                                log::warn!("{label} inference check failed: {e}");
                                continue;
                            }
                            let dim = embedder.dimension();
                            match rhema_detection::HnswVectorIndex::load(&embeddings_path, &ids_path, dim) {
                                Ok(index) => {
                                    log::info!("ONNX embedding model loaded");
                                    log::info!("Verse embeddings loaded ({} vectors)", index.len());
                                    let base_count = index.len();
                                    let managed_state = app.state::<Mutex<state::AppState>>();
                                    let pipeline = match state::detection_pipeline(&managed_state) {
                                        Ok(pipeline) => pipeline,
                                        Err(e) => { log::error!("Pipeline unavailable: {e}"); break; }
                                    };
                                    let stem = embeddings_path.file_stem().and_then(|s|s.to_str()).unwrap_or_default();
                                    let index = match managed_state.lock() {
                                        Ok(state) => semantic_resources::add_translations(
                                            index,state.bible_db.as_ref(),&model_path,&tokenizer_path,stem,dim,
                                            |path| resolve_resource(app,path),
                                        ),
                                        Err(e) => { log::error!("Bible database unavailable: {e}"); break; }
                                    };
                                    match pipeline.lock() {
                                        Ok(mut pipeline) => {
                                            let expanded = index.len() > base_count;
                                            let mut detector = rhema_detection::SemanticDetector::new(Box::new(embedder),index);
                                            if expanded { detector.set_confidence_threshold(rhema_detection::semantic::multi_translation::CONFIDENCE_THRESHOLD); }
                                            let warm_started=std::time::Instant::now();
                                            if let Err(e)=detector.warm_up() {
                                                log::warn!("Semantic warm-up failed: {e}");
                                            } else {
                                                log::info!("Semantic detection ready: full warm-up elapsed_ms={}",warm_started.elapsed().as_millis());
                                            }
                                            pipeline.set_semantic(detector);
                                            semantic_loaded = true;
                                        }
                                        Err(e) => log::error!("Semantic startup lock failed: {e}"),
                                    }
                                    if semantic_loaded { break; }
                                }
                                Err(e) => {
                                    log::warn!("Failed to load verse embeddings for {label}: {e}");
                                }
                            }
                        }
                        Err(e) => {
                            log::warn!("Failed to load {label}: {e}");
                        }
                    }

                }

                if !semantic_loaded {
                    log::info!("ONNX model not found or failed to load. Semantic search disabled. Run 'bun run download:model' to download.");
                };
            }

            #[cfg(not(feature = "onnx"))]
            {
                // Keep compiler happy about unused path bindings when onnx is disabled.
                let _ = &model_candidates;
                log::info!("Built without 'onnx' feature — semantic detection disabled.");
            }

            #[cfg(feature = "package-check")]
            if checking_package {
                // Exit before frontend startup, settings hydration or provider warm-up.
                let result = tauri::async_runtime::block_on(package_check::verify(app));
                match result {
                    Ok(report) => {
                        println!("MANNA_PACKAGE_CHECK={report}");
                        std::process::exit(0);
                    }
                    Err(error) => {
                        eprintln!("MANNA_PACKAGE_CHECK_FAILED={error}");
                        std::process::exit(1);
                    }
                }
            }

            // Seed hymnals into songs table — respects enabledHymnals setting,
            // idempotent via per-hymnal seed_version check.
            let enabled = read_enabled_hymnals(app).unwrap_or_else(|| {
                HYMNALS.iter().map(|h| h.id.to_string()).collect()
            });
            if let Some(db_state) = app.try_state::<Mutex<SessionDb>>() {
                match db_state.lock() {
                    Ok(db) => {
                        if let Err(e) = seed_hymnals(&db, &enabled) {
                            log::warn!("Hymnal seed failed: {e}");
                        }
                    }
                    Err(e) => log::warn!("Hymnal seed: could not acquire DB lock: {e}"),
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
            log::info!("[menu] event: {id}");
            // Handle quit natively — closing via JS only hides the window on macOS
            if id == "manna:quit" {
                app.exit(0);
                return;
            }
            use tauri::Emitter;
            if let Err(e) = app.emit("menu-event", id) {
                log::error!("[menu] failed to emit menu-event: {e}");
            }
        })
        .run(context)
        .expect("error while running tauri application");
}

/// Read `enabledHymnals` from tauri-plugin-store's settings.json.
/// Returns `None` if not yet persisted (first launch).
fn read_enabled_hymnals(app: &tauri::App) -> Option<Vec<String>> {
    use tauri_plugin_store::StoreExt;
    let store = app.store("settings.json").ok()?;
    let value = store.get("enabledHymnals")?;
    let array = value.as_array()?;
    let ids: Vec<String> = array
        .iter()
        .filter_map(|v| v.as_str().map(String::from))
        .collect();
    if ids.is_empty() {
        None
    } else {
        Some(ids)
    }
}
