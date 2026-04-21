// src-tauri/crates/notes/src/plan_db.rs
use rusqlite::params;

use crate::db::SessionDb;
use crate::error::{Result, SessionError};
use crate::plan_models::TemplateMeta;

impl SessionDb {
    /* ------------------------- Templates ------------------------- */

    pub fn list_templates(&self) -> Result<Vec<TemplateMeta>> {
        let mut stmt = self.conn().prepare(
            "SELECT t.id, t.name, t.notes, t.created_at, t.updated_at,
                    COALESCE(
                      (SELECT COUNT(*) FROM service_plan_items
                       WHERE plan_id = t.id AND plan_kind = 'template'),
                      0
                    ) AS item_count
             FROM service_plan_templates t
             ORDER BY t.updated_at DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(TemplateMeta {
                id: r.get(0)?,
                name: r.get(1)?,
                notes: r.get(2)?,
                created_at: r.get(3)?,
                updated_at: r.get(4)?,
                item_count: r.get(5)?,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(SessionError::from)
    }

    pub fn create_template(&self, name: &str, notes: Option<&str>) -> Result<TemplateMeta> {
        let now = now_ms();
        self.conn().execute(
            "INSERT INTO service_plan_templates (name, notes, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?3)",
            params![name, notes, now],
        )?;
        let id = self.conn().last_insert_rowid();
        Ok(TemplateMeta {
            id,
            name: name.to_string(),
            notes: notes.map(str::to_string),
            created_at: now,
            updated_at: now,
            item_count: 0,
        })
    }

    pub fn rename_template(&self, id: i64, name: &str) -> Result<()> {
        let n = self.conn().execute(
            "UPDATE service_plan_templates SET name = ?1, updated_at = ?2 WHERE id = ?3",
            params![name, now_ms(), id],
        )?;
        if n == 0 {
            return Err(SessionError::NotFound(format!("template {id}")));
        }
        Ok(())
    }

    pub fn update_template_notes(&self, id: i64, notes: Option<&str>) -> Result<()> {
        let n = self.conn().execute(
            "UPDATE service_plan_templates SET notes = ?1, updated_at = ?2 WHERE id = ?3",
            params![notes, now_ms(), id],
        )?;
        if n == 0 {
            return Err(SessionError::NotFound(format!("template {id}")));
        }
        Ok(())
    }

    pub fn delete_template(&mut self, id: i64) -> Result<()> {
        let tx = self.conn_mut().transaction()?;
        tx.execute(
            "DELETE FROM service_plan_items WHERE plan_id = ?1 AND plan_kind = 'template'",
            params![id],
        )?;
        tx.execute(
            "DELETE FROM service_plan_templates WHERE id = ?1",
            params![id],
        )?;
        tx.commit()?;
        Ok(())
    }
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_millis()).unwrap_or(0))
        .unwrap_or(0)
}
