use rhema_notes::SessionDb;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

type DbState = Mutex<SessionDb>;

#[derive(Serialize)]
pub struct SongRow {
    pub id: String,
    pub source: String,
    pub number: Option<i64>,
    pub title: String,
    pub author: Option<String>,
    pub data: String,
    pub tune: Option<String>,
    pub meter: Option<String>,
    #[serde(rename = "scriptureRef")]
    pub scripture_ref: Option<String>,
    pub category: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[tauri::command]
pub fn list_songs(db: State<'_, DbState>) -> Result<Vec<SongRow>, String> {
    db.lock()
        .map_err(|e| e.to_string())?
        .list_songs()
        .map(|rows| {
            rows.into_iter()
                .map(|(id, source, number, title, author, data, tune, meter, scripture_ref, category, created_at)| SongRow {
                    id,
                    source,
                    number,
                    title,
                    author,
                    data,
                    tune,
                    meter,
                    scripture_ref,
                    category,
                    created_at,
                })
                .collect()
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_song(db: State<'_, DbState>, id: String) -> Result<SongRow, String> {
    db.lock()
        .map_err(|e| e.to_string())?
        .get_song(&id)
        .map(|(id, source, number, title, author, data, tune, meter, scripture_ref, category, created_at)| SongRow {
            id,
            source,
            number,
            title,
            author,
            data,
            tune,
            meter,
            scripture_ref,
            category,
            created_at,
        })
        .map_err(|e| e.to_string())
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn save_song(
    db: State<'_, DbState>,
    id: String,
    source: String,
    number: Option<i64>,
    title: String,
    author: Option<String>,
    data: String,
) -> Result<(), String> {
    db.lock()
        .map_err(|e| e.to_string())?
        .save_song(&id, &source, number, &title, author.as_deref(), &data, 0)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_song(app: tauri::AppHandle, db: State<'_, DbState>, id: String) -> Result<(), String> {
    db.lock()
        .map_err(|e| e.to_string())?
        .delete_song(&id)
        .map_err(|e| e.to_string())?;
    // Its fingerprints were deleted with it.
    super::song_detection::songs_changed(&app);
    Ok(())
}

#[derive(Serialize, Deserialize)]
pub struct GeniusHit {
    pub id: i64,
    pub title: String,
    pub url: String,
    pub artist: String,
    #[serde(rename = "thumbnailUrl")]
    pub thumbnail_url: Option<String>,
}

#[tauri::command]
pub async fn search_genius(token: String, query: String) -> Result<Vec<GeniusHit>, String> {
    if token.trim().is_empty() {
        return Err("Genius token not set. Add in Settings.".to_string());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get("https://api.genius.com/search")
        .query(&[("q", &query)])
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    match resp.status().as_u16() {
        200 => {}
        401 => {
            return Err(
                "Genius token rejected (401). Re-generate at genius.com/api-clients.".to_string(),
            )
        }
        429 => return Err("Genius rate limit hit. Retry in 60s.".to_string()),
        s => return Err(format!("Genius returned HTTP {s}")),
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let hits = json
        .pointer("/response/hits")
        .and_then(|v| v.as_array())
        .ok_or("Unexpected Genius response shape")?;

    let out: Vec<GeniusHit> = hits
        .iter()
        .filter_map(|h| {
            let result = h.get("result")?;
            Some(GeniusHit {
                id: result.get("id")?.as_i64()?,
                title: result.get("title")?.as_str()?.to_string(),
                url: result.get("url")?.as_str()?.to_string(),
                artist: result
                    .get("primary_artist")?
                    .get("name")?
                    .as_str()?
                    .to_string(),
                thumbnail_url: result
                    .get("song_art_image_thumbnail_url")
                    .and_then(|v| v.as_str())
                    .map(ToString::to_string),
            })
        })
        .collect();

    Ok(out)
}

#[tauri::command]
pub async fn fetch_genius_lyrics(url: String) -> Result<String, String> {
    const MAX_BODY: usize = 2 * 1024 * 1024; // 2 MB — typical Genius page ~500KB
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .connect_timeout(std::time::Duration::from_secs(5))
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    // `.timeout()` above covers send + body read. `.bytes()` enforces the
    // whole body is read within the 15s budget instead of hanging on a
    // slow stream (unbounded `.text()` can stall for minutes on TCP-paced
    // responses even when headers arrived quickly).
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BODY {
        return Err(format!(
            "Genius response too large ({} bytes); refusing to parse.",
            bytes.len()
        ));
    }
    let html = String::from_utf8_lossy(&bytes).into_owned();

    let doc = scraper::Html::parse_document(&html);
    let sel = scraper::Selector::parse("[data-lyrics-container=\"true\"]")
        .map_err(|e| format!("selector: {e:?}"))?;

    let mut parts: Vec<String> = Vec::new();
    for el in doc.select(&sel) {
        let mut text = String::new();
        for node in el.descendants() {
            if let Some(t) = node.value().as_text() {
                text.push_str(t);
            } else if let Some(e) = node.value().as_element() {
                if e.name() == "br" {
                    text.push('\n');
                }
            }
        }
        parts.push(text);
    }

    let joined = parts.join("\n\n").trim().to_string();
    if joined.is_empty() {
        return Err(
            "Could not extract lyrics — Genius page structure changed. Please paste manually."
                .to_string(),
        );
    }
    Ok(joined)
}

#[derive(Serialize, Deserialize)]
pub struct LrclibHit {
    pub id: i64,
    #[serde(rename = "trackName")]
    pub track_name: String,
    #[serde(rename = "artistName")]
    pub artist_name: String,
    #[serde(rename = "albumName")]
    pub album_name: Option<String>,
    pub duration: Option<f64>,
    pub instrumental: bool,
    #[serde(rename = "hasSynced")]
    pub has_synced: bool,
    #[serde(rename = "hasPlain")]
    pub has_plain: bool,
}

#[tauri::command]
pub async fn search_lrclib(query: String) -> Result<Vec<LrclibHit>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent("Manna/1.0 (https://github.com/openbezal/rhema)")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get("https://lrclib.net/api/search")
        .query(&[("q", &query)])
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    match resp.status().as_u16() {
        200 => {}
        429 => return Err("LRCLIB rate limit hit. Retry shortly.".to_string()),
        s => return Err(format!("LRCLIB returned HTTP {s}")),
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let arr = json
        .as_array()
        .ok_or("Unexpected LRCLIB response shape")?;

    let out: Vec<LrclibHit> = arr
        .iter()
        .filter_map(|r| {
            let id = r.get("id")?.as_i64()?;
            let track_name = r.get("trackName")?.as_str()?.to_string();
            let artist_name = r.get("artistName")?.as_str()?.to_string();
            let album_name = r
                .get("albumName")
                .and_then(|v| v.as_str())
                .map(ToString::to_string);
            let duration = r.get("duration").and_then(|v| v.as_f64());
            let instrumental = r
                .get("instrumental")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let has_synced = r
                .get("syncedLyrics")
                .map(|v| v.is_string() && !v.as_str().unwrap_or("").is_empty())
                .unwrap_or(false);
            let has_plain = r
                .get("plainLyrics")
                .map(|v| v.is_string() && !v.as_str().unwrap_or("").is_empty())
                .unwrap_or(false);
            Some(LrclibHit {
                id,
                track_name,
                artist_name,
                album_name,
                duration,
                instrumental,
                has_synced,
                has_plain,
            })
        })
        .collect();

    Ok(out)
}

#[derive(Serialize)]
pub struct LrclibLyrics {
    #[serde(rename = "plainLyrics")]
    pub plain_lyrics: Option<String>,
    #[serde(rename = "syncedLyrics")]
    pub synced_lyrics: Option<String>,
}

#[tauri::command]
pub async fn fetch_lrclib_lyrics(id: i64) -> Result<LrclibLyrics, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent("Manna/1.0 (https://github.com/openbezal/rhema)")
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("https://lrclib.net/api/get/{id}");
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    match resp.status().as_u16() {
        200 => {}
        404 => return Err("Lyrics not found on LRCLIB.".to_string()),
        429 => return Err("LRCLIB rate limit hit. Retry shortly.".to_string()),
        s => return Err(format!("LRCLIB returned HTTP {s}")),
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(LrclibLyrics {
        plain_lyrics: json
            .get("plainLyrics")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(ToString::to_string),
        synced_lyrics: json
            .get("syncedLyrics")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(ToString::to_string),
    })
}
