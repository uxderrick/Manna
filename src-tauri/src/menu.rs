use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{App, Wry};

/// Build the native application menu with all app commands.
///
/// Menu item IDs match the frontend command registry so that menu events
/// can be dispatched directly to the corresponding handlers.
pub fn build(app: &App) -> tauri::Result<Menu<Wry>> {
    // ── Manna ──────────────────────────────────────────────────
    let manna_menu = Submenu::with_items(
        app,
        "Manna",
        true,
        &[
            &MenuItem::with_id(app, "manna:about", "About Manna", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "manna:preferences",
                "Preferences…",
                true,
                Some("CmdOrCtrl+,"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "manna:quit",
                "Quit Manna",
                true,
                Some("CmdOrCtrl+Q"),
            )?,
        ],
    )?;

    // ── Session ────────────────────────────────────────────────
    let session_menu = Submenu::with_items(
        app,
        "Session",
        true,
        &[
            &MenuItem::with_id(
                app,
                "session:new",
                "New Session…",
                true,
                Some("CmdOrCtrl+N"),
            )?,
            &MenuItem::with_id(
                app,
                "session:end",
                "End Session",
                true,
                Some("CmdOrCtrl+Shift+E"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "session:import-plan",
                "Import Plan…",
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "session:export-notes",
                "Export Notes…",
                true,
                Some("CmdOrCtrl+Shift+X"),
            )?,
            &MenuItem::with_id(
                app,
                "session:distribute-summary",
                "Distribute Summary…",
                true,
                None::<&str>,
            )?,
        ],
    )?;

    // ── Broadcast ──────────────────────────────────────────────
    let broadcast_menu = Submenu::with_items(
        app,
        "Broadcast",
        true,
        &[
            &MenuItem::with_id(
                app,
                "broadcast:go-live",
                "Go Live",
                true,
                Some("CmdOrCtrl+L"),
            )?,
            &MenuItem::with_id(
                app,
                "broadcast:go-off-air",
                "Go Off Air",
                true,
                Some("CmdOrCtrl+Shift+L"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "broadcast:new-announcement",
                "New Announcement…",
                true,
                Some("CmdOrCtrl+Shift+N"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "broadcast:theme-designer",
                "Theme Designer…",
                true,
                Some("CmdOrCtrl+T"),
            )?,
        ],
    )?;

    // ── View ───────────────────────────────────────────────────
    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &MenuItem::with_id(
                app,
                "view:toggle-transcript",
                "Toggle Transcript",
                true,
                Some("CmdOrCtrl+J"),
            )?,
            &MenuItem::with_id(
                app,
                "view:reset-layout",
                "Reset Layout",
                true,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "view:toggle-theme",
                "Toggle Theme",
                true,
                None::<&str>,
            )?,
        ],
    )?;

    // ── Help ───────────────────────────────────────────────────
    let help_menu = Submenu::with_items(
        app,
        "Help",
        true,
        &[
            &MenuItem::with_id(app, "help:tutorial", "Tutorial", true, None::<&str>)?,
            &MenuItem::with_id(
                app,
                "help:keyboard-shortcuts",
                "Keyboard Shortcuts",
                true,
                Some("CmdOrCtrl+/"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "help:documentation",
                "Documentation",
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "help:report-issue",
                "Report Issue",
                true,
                None::<&str>,
            )?,
        ],
    )?;

    // ── Top-level menu ─────────────────────────────────────────
    Menu::with_items(
        app,
        &[
            &manna_menu,
            &session_menu,
            &broadcast_menu,
            &view_menu,
            &help_menu,
        ],
    )
}
