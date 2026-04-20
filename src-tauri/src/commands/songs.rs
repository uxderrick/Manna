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
}

#[tauri::command]
pub fn list_songs(db: State<'_, DbState>) -> Result<Vec<SongRow>, String> {
    db.lock()
        .unwrap()
        .list_songs()
        .map(|rows| {
            rows.into_iter()
                .map(|(id, source, number, title, author, data)| SongRow {
                    id,
                    source,
                    number,
                    title,
                    author,
                    data,
                })
                .collect()
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_song(db: State<'_, DbState>, id: String) -> Result<SongRow, String> {
    db.lock()
        .unwrap()
        .get_song(&id)
        .map(|(id, source, number, title, author, data)| SongRow {
            id,
            source,
            number,
            title,
            author,
            data,
        })
        .map_err(|e| e.to_string())
}

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
        .unwrap()
        .save_song(&id, &source, number, &title, author.as_deref(), &data, 0)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_song(db: State<'_, DbState>, id: String) -> Result<(), String> {
    db.lock()
        .unwrap()
        .delete_song(&id)
        .map_err(|e| e.to_string())
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
