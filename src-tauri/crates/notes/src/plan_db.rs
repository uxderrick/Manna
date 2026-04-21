// src-tauri/crates/notes/src/plan_db.rs
use rusqlite::params;

use crate::db::SessionDb;
use crate::error::{Result, SessionError};
use crate::plan_models::{Plan, PlanItem, PlanItemType, PlanKind, TemplateMeta};

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

    /* ------------------------- Plan Items ------------------------- */

    /// Load all items for a given plan (template or session-scoped), ordered by
    /// `order_index` ascending. Returns an empty Vec if no items exist — callers
    /// treat "empty plan" as a normal state, not an error.
    pub fn get_plan(&self, plan_id: i64, plan_kind: PlanKind) -> Result<Plan> {
        let mut stmt = self.conn().prepare(
            "SELECT id, order_index, item_type, item_data, auto_advance_seconds
             FROM service_plan_items
             WHERE plan_id = ?1 AND plan_kind = ?2
             ORDER BY order_index ASC",
        )?;
        let rows = stmt.query_map(params![plan_id, plan_kind.as_str()], |r| {
            let type_str: String = r.get(2)?;
            let item_type = PlanItemType::from_str(&type_str)
                .unwrap_or(PlanItemType::Blank);
            Ok(PlanItem {
                id: r.get(0)?,
                plan_id,
                plan_kind,
                order_index: r.get(1)?,
                item_type,
                item_data: r.get(3)?,
                auto_advance_seconds: r.get(4)?,
            })
        })?;
        let items = rows
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(SessionError::from)?;
        Ok(Plan { plan_id, plan_kind, items })
    }

    pub fn add_plan_item(
        &self,
        plan_id: i64,
        plan_kind: PlanKind,
        item_type: PlanItemType,
        item_data: &str,
        order_index: f64,
        auto_advance_seconds: Option<i32>,
    ) -> Result<PlanItem> {
        self.conn().execute(
            "INSERT INTO service_plan_items
                (plan_id, plan_kind, order_index, item_type, item_data, auto_advance_seconds)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                plan_id,
                plan_kind.as_str(),
                order_index,
                item_type.as_str(),
                item_data,
                auto_advance_seconds,
            ],
        )?;
        let id = self.conn().last_insert_rowid();
        Ok(PlanItem {
            id,
            plan_id,
            plan_kind,
            order_index,
            item_type,
            item_data: item_data.to_string(),
            auto_advance_seconds,
        })
    }

    pub fn update_plan_item(
        &self,
        item_id: i64,
        item_data: &str,
        auto_advance_seconds: Option<i32>,
    ) -> Result<()> {
        let n = self.conn().execute(
            "UPDATE service_plan_items
                SET item_data = ?1, auto_advance_seconds = ?2
              WHERE id = ?3",
            params![item_data, auto_advance_seconds, item_id],
        )?;
        if n == 0 {
            return Err(SessionError::NotFound(format!("plan item {item_id}")));
        }
        Ok(())
    }

    pub fn reorder_plan_item(&self, item_id: i64, new_order_index: f64) -> Result<()> {
        let n = self.conn().execute(
            "UPDATE service_plan_items SET order_index = ?1 WHERE id = ?2",
            params![new_order_index, item_id],
        )?;
        if n == 0 {
            return Err(SessionError::NotFound(format!("plan item {item_id}")));
        }
        Ok(())
    }

    pub fn delete_plan_item(&self, item_id: i64) -> Result<()> {
        let n = self.conn().execute(
            "DELETE FROM service_plan_items WHERE id = ?1",
            params![item_id],
        )?;
        if n == 0 {
            return Err(SessionError::NotFound(format!("plan item {item_id}")));
        }
        Ok(())
    }

    /// Replace target session plan with a deep copy of a template's items.
    /// Takes `&mut self` because it uses a transaction.
    pub fn load_template_into_session(
        &mut self,
        session_id: i64,
        template_id: i64,
    ) -> Result<()> {
        let tx = self.conn_mut().transaction()?;
        tx.execute(
            "DELETE FROM service_plan_items WHERE plan_id = ?1 AND plan_kind = 'session'",
            params![session_id],
        )?;
        tx.execute(
            "INSERT INTO service_plan_items
                (plan_id, plan_kind, order_index, item_type, item_data, auto_advance_seconds)
             SELECT ?1, 'session', order_index, item_type, item_data, auto_advance_seconds
             FROM service_plan_items
             WHERE plan_id = ?2 AND plan_kind = 'template'",
            params![session_id, template_id],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Deep-copy another session's plan into this session. Used for "clone last Sunday".
    /// Takes `&mut self` because it uses a transaction.
    pub fn clone_session_plan(
        &mut self,
        target_session_id: i64,
        source_session_id: i64,
    ) -> Result<()> {
        let tx = self.conn_mut().transaction()?;
        tx.execute(
            "DELETE FROM service_plan_items WHERE plan_id = ?1 AND plan_kind = 'session'",
            params![target_session_id],
        )?;
        tx.execute(
            "INSERT INTO service_plan_items
                (plan_id, plan_kind, order_index, item_type, item_data, auto_advance_seconds)
             SELECT ?1, 'session', order_index, item_type, item_data, auto_advance_seconds
             FROM service_plan_items
             WHERE plan_id = ?2 AND plan_kind = 'session'",
            params![target_session_id, source_session_id],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Save current session plan as a new template. Returns the new template id.
    /// Takes `&mut self` because it uses a transaction.
    pub fn save_session_as_template(
        &mut self,
        session_id: i64,
        name: &str,
        notes: Option<&str>,
    ) -> Result<i64> {
        let now = now_ms();
        let tx = self.conn_mut().transaction()?;
        tx.execute(
            "INSERT INTO service_plan_templates (name, notes, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?3)",
            params![name, notes, now],
        )?;
        let template_id = tx.last_insert_rowid();
        tx.execute(
            "INSERT INTO service_plan_items
                (plan_id, plan_kind, order_index, item_type, item_data, auto_advance_seconds)
             SELECT ?1, 'template', order_index, item_type, item_data, auto_advance_seconds
             FROM service_plan_items
             WHERE plan_id = ?2 AND plan_kind = 'session'",
            params![template_id, session_id],
        )?;
        tx.commit()?;
        Ok(template_id)
    }
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_millis()).unwrap_or(0))
        .unwrap_or(0)
}
