use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    env, fs,
    hash::{DefaultHasher, Hash, Hasher},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const OPENAI_CONFIG_SETTING_KEY: &str = "openai_config_json";
const WORKSPACE_STATE_SETTING_KEY: &str = "workspace_state_json";
const LOCALE_SETTING_KEY: &str = "locale";
const THEME_MODE_SETTING_KEY: &str = "theme_mode";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConnectionRecord {
    pub provider_id: String,
    pub enabled: bool,
    pub connected: bool,
    pub endpoint: String,
    pub api_key: String,
    pub selected_model: String,
    pub selected_variant: String,
    pub store: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveProviderConfigRequest {
    pub connections: Vec<ProviderConnectionRecord>,
    pub open_ai_config_text: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfigResult {
    pub connections: Vec<ProviderConnectionRecord>,
    pub open_ai_config_text: Option<String>,
    pub db_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveWorkspaceStateRequest {
    pub workspace_state: Value,
    pub locale: String,
    pub theme_mode: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStateResult {
    pub workspace_state: Option<Value>,
    pub locale: Option<String>,
    pub theme_mode: Option<String>,
    pub db_path: String,
}

pub fn load_provider_config(workspace_root: &Path) -> Result<ProviderConfigResult, String> {
    let db_path = provider_db_path(workspace_root);
    match load_provider_config_inner(&db_path) {
        Ok(result) => Ok(result),
        Err(error) if is_recoverable_provider_db_error(&error) => {
            recover_provider_db(&db_path)?;
            load_provider_config_inner(&db_path)
        }
        Err(error) => Err(error),
    }
}

pub fn save_provider_config(
    workspace_root: &Path,
    request: SaveProviderConfigRequest,
) -> Result<ProviderConfigResult, String> {
    let db_path = provider_db_path(workspace_root);
    match save_provider_config_inner(&db_path, request.clone()) {
        Ok(result) => Ok(result),
        Err(error) if is_recoverable_provider_db_error(&error) => {
            recover_provider_db(&db_path)?;
            save_provider_config_inner(&db_path, request)
        }
        Err(error) => Err(error),
    }
}

pub fn load_workspace_state(workspace_root: &Path) -> Result<WorkspaceStateResult, String> {
    let db_path = provider_db_path(workspace_root);
    match load_workspace_state_inner(&db_path) {
        Ok(result) => Ok(result),
        Err(error) if is_recoverable_provider_db_error(&error) => {
            recover_provider_db(&db_path)?;
            load_workspace_state_inner(&db_path)
        }
        Err(error) => Err(error),
    }
}

pub fn save_workspace_state(
    workspace_root: &Path,
    request: SaveWorkspaceStateRequest,
) -> Result<WorkspaceStateResult, String> {
    let db_path = provider_db_path(workspace_root);
    match save_workspace_state_inner(&db_path, request.clone()) {
        Ok(result) => Ok(result),
        Err(error) if is_recoverable_provider_db_error(&error) => {
            recover_provider_db(&db_path)?;
            save_workspace_state_inner(&db_path, request)
        }
        Err(error) => Err(error),
    }
}

fn load_provider_config_inner(db_path: &Path) -> Result<ProviderConfigResult, String> {
    let connection = open_provider_db(&db_path)?;
    init_provider_db(&connection)?;
    seed_default_provider_connections(&connection)?;

    let connections = read_provider_connections(&connection)?;
    let open_ai_config_text = read_setting(&connection, OPENAI_CONFIG_SETTING_KEY)?;

    Ok(ProviderConfigResult {
        connections,
        open_ai_config_text,
        db_path: db_path.display().to_string(),
    })
}

fn save_provider_config_inner(
    db_path: &Path,
    request: SaveProviderConfigRequest,
) -> Result<ProviderConfigResult, String> {
    let mut connection = open_provider_db(db_path)?;
    init_provider_db(&connection)?;

    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    for provider_connection in &request.connections {
        validate_provider_connection(provider_connection)?;
        upsert_provider_connection(&transaction, provider_connection)?;
    }

    if let Some(open_ai_config_text) = request.open_ai_config_text.as_ref() {
        upsert_setting(
            &transaction,
            OPENAI_CONFIG_SETTING_KEY,
            open_ai_config_text.as_str(),
        )?;
    }

    transaction.commit().map_err(|error| error.to_string())?;
    load_provider_config_inner(db_path)
}

fn load_workspace_state_inner(db_path: &Path) -> Result<WorkspaceStateResult, String> {
    let connection = open_provider_db(db_path)?;
    init_provider_db(&connection)?;

    let workspace_state = read_json_setting(&connection, WORKSPACE_STATE_SETTING_KEY)?;
    let locale = read_setting(&connection, LOCALE_SETTING_KEY)?;
    let theme_mode = read_setting(&connection, THEME_MODE_SETTING_KEY)?;

    Ok(WorkspaceStateResult {
        workspace_state,
        locale,
        theme_mode,
        db_path: db_path.display().to_string(),
    })
}

fn save_workspace_state_inner(
    db_path: &Path,
    request: SaveWorkspaceStateRequest,
) -> Result<WorkspaceStateResult, String> {
    let mut connection = open_provider_db(db_path)?;
    init_provider_db(&connection)?;

    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    upsert_json_setting(
        &transaction,
        WORKSPACE_STATE_SETTING_KEY,
        &request.workspace_state,
    )?;
    upsert_setting(&transaction, LOCALE_SETTING_KEY, request.locale.trim())?;
    upsert_setting(
        &transaction,
        THEME_MODE_SETTING_KEY,
        request.theme_mode.trim(),
    )?;
    transaction.commit().map_err(|error| error.to_string())?;

    load_workspace_state_inner(db_path)
}

fn provider_db_path(workspace_root: &Path) -> PathBuf {
    provider_storage_dir()
        .unwrap_or_else(|| workspace_root.join(".sep"))
        .join(format!(
            "workspace-{}.sqlite3",
            workspace_storage_key(workspace_root)
        ))
}

fn open_provider_db(db_path: &Path) -> Result<Connection, String> {
    let Some(parent) = db_path.parent() else {
        return Err("Could not determine provider config directory.".into());
    };

    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let connection = Connection::open(db_path).map_err(|error| error.to_string())?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    Ok(connection)
}

fn init_provider_db(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS provider_connections (
                provider_id TEXT PRIMARY KEY,
                enabled INTEGER NOT NULL,
                connected INTEGER NOT NULL,
                endpoint TEXT NOT NULL,
                api_key TEXT NOT NULL,
                selected_model TEXT NOT NULL,
                selected_variant TEXT NOT NULL,
                store INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );
            ",
        )
        .map_err(|error| error.to_string())
}

fn seed_default_provider_connections(connection: &Connection) -> Result<(), String> {
    for provider_connection in default_provider_connections() {
        insert_default_provider_connection(connection, &provider_connection)?;
    }

    Ok(())
}

fn insert_default_provider_connection(
    connection: &Connection,
    provider_connection: &ProviderConnectionRecord,
) -> Result<(), String> {
    connection
        .execute(
            "
            INSERT INTO provider_connections (
                provider_id,
                enabled,
                connected,
                endpoint,
                api_key,
                selected_model,
                selected_variant,
                store,
                updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(provider_id) DO NOTHING
            ",
            params![
                provider_connection.provider_id,
                bool_to_int(provider_connection.enabled),
                bool_to_int(provider_connection.connected),
                provider_connection.endpoint,
                provider_connection.api_key,
                provider_connection.selected_model,
                provider_connection.selected_variant,
                bool_to_int(provider_connection.store),
                unix_timestamp_seconds(),
            ],
        )
        .map_err(|error| error.to_string())?;

    Ok(())
}

fn upsert_provider_connection(
    connection: &Connection,
    provider_connection: &ProviderConnectionRecord,
) -> Result<(), String> {
    connection
        .execute(
            "
            INSERT INTO provider_connections (
                provider_id,
                enabled,
                connected,
                endpoint,
                api_key,
                selected_model,
                selected_variant,
                store,
                updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(provider_id) DO UPDATE SET
                enabled = excluded.enabled,
                connected = excluded.connected,
                endpoint = excluded.endpoint,
                api_key = excluded.api_key,
                selected_model = excluded.selected_model,
                selected_variant = excluded.selected_variant,
                store = excluded.store,
                updated_at = excluded.updated_at
            ",
            params![
                provider_connection.provider_id,
                bool_to_int(provider_connection.enabled),
                bool_to_int(provider_connection.connected),
                provider_connection.endpoint,
                provider_connection.api_key,
                provider_connection.selected_model,
                provider_connection.selected_variant,
                bool_to_int(provider_connection.store),
                unix_timestamp_seconds(),
            ],
        )
        .map_err(|error| error.to_string())?;

    Ok(())
}

fn upsert_setting(connection: &Connection, key: &str, value: &str) -> Result<(), String> {
    connection
        .execute(
            "
            INSERT INTO app_settings (key, value, updated_at)
            VALUES (?1, ?2, ?3)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at
            ",
            params![key, value, unix_timestamp_seconds()],
        )
        .map_err(|error| error.to_string())?;

    Ok(())
}

fn upsert_json_setting(connection: &Connection, key: &str, value: &Value) -> Result<(), String> {
    let json = serde_json::to_string(value).map_err(|error| error.to_string())?;
    upsert_setting(connection, key, &json)
}

fn read_setting(connection: &Connection, key: &str) -> Result<Option<String>, String> {
    connection
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            [key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())
}

fn read_json_setting(connection: &Connection, key: &str) -> Result<Option<Value>, String> {
    let Some(value) = read_setting(connection, key)? else {
        return Ok(None);
    };

    let parsed = serde_json::from_str::<Value>(&value).map_err(|error| error.to_string())?;
    Ok(Some(parsed))
}

fn read_provider_connections(
    connection: &Connection,
) -> Result<Vec<ProviderConnectionRecord>, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT provider_id, enabled, connected, endpoint, api_key, selected_model, selected_variant, store
            FROM provider_connections
            ORDER BY provider_id
            ",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([], |row| {
            Ok(ProviderConnectionRecord {
                provider_id: row.get(0)?,
                enabled: int_to_bool(row.get::<_, i64>(1)?),
                connected: int_to_bool(row.get::<_, i64>(2)?),
                endpoint: row.get(3)?,
                api_key: row.get(4)?,
                selected_model: row.get(5)?,
                selected_variant: row.get(6)?,
                store: int_to_bool(row.get::<_, i64>(7)?),
            })
        })
        .map_err(|error| error.to_string())?;

    let mut by_id = HashMap::new();
    for row in rows {
        let provider_connection = row.map_err(|error| error.to_string())?;
        by_id.insert(provider_connection.provider_id.clone(), provider_connection);
    }

    let default_connections = default_provider_connections();
    let known_ids = default_connections
        .iter()
        .map(|provider_connection| provider_connection.provider_id.clone())
        .collect::<HashSet<_>>();

    let mut merged_connections = default_connections
        .into_iter()
        .map(|provider_connection| {
            by_id
                .remove(&provider_connection.provider_id)
                .unwrap_or(provider_connection)
        })
        .collect::<Vec<_>>();

    let mut extra_connections = by_id
        .into_values()
        .filter(|provider_connection| !known_ids.contains(&provider_connection.provider_id))
        .collect::<Vec<_>>();
    extra_connections.sort_by(|left, right| left.provider_id.cmp(&right.provider_id));
    merged_connections.extend(extra_connections);

    Ok(merged_connections)
}

fn validate_provider_connection(
    provider_connection: &ProviderConnectionRecord,
) -> Result<(), String> {
    if provider_connection.provider_id.trim().is_empty() {
        return Err("Provider id is required.".into());
    }

    if provider_connection.endpoint.trim().is_empty() {
        return Err(format!(
            "Provider '{}' is missing an endpoint.",
            provider_connection.provider_id
        ));
    }

    if provider_connection.selected_model.trim().is_empty() {
        return Err(format!(
            "Provider '{}' is missing a selected model.",
            provider_connection.provider_id
        ));
    }

    if provider_connection.selected_variant.trim().is_empty() {
        return Err(format!(
            "Provider '{}' is missing a selected variant.",
            provider_connection.provider_id
        ));
    }

    Ok(())
}

fn default_provider_connections() -> Vec<ProviderConnectionRecord> {
    vec![
        ProviderConnectionRecord {
            provider_id: "anthropic".into(),
            enabled: true,
            connected: true,
            endpoint: "https://api.anthropic.com".into(),
            api_key: String::new(),
            selected_model: "anthropic/claude-sonnet-4.6".into(),
            selected_variant: "medium".into(),
            store: false,
        },
        ProviderConnectionRecord {
            provider_id: "openai".into(),
            enabled: true,
            connected: false,
            endpoint: "https://api.openai.com/v1".into(),
            api_key: String::new(),
            selected_model: "gpt-5-codex".into(),
            selected_variant: "medium".into(),
            store: false,
        },
        ProviderConnectionRecord {
            provider_id: "google".into(),
            enabled: false,
            connected: false,
            endpoint: "https://generativelanguage.googleapis.com".into(),
            api_key: String::new(),
            selected_model: "google/gemini-3-flash".into(),
            selected_variant: "medium".into(),
            store: false,
        },
        ProviderConnectionRecord {
            provider_id: "opencode".into(),
            enabled: true,
            connected: false,
            endpoint: "http://127.0.0.1:4096".into(),
            api_key: String::new(),
            selected_model: "gpt-5.3-codex".into(),
            selected_variant: "medium".into(),
            store: false,
        },
    ]
}

fn unix_timestamp_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

fn provider_storage_dir() -> Option<PathBuf> {
    if let Some(app_data) = env::var_os("APPDATA") {
        return Some(PathBuf::from(app_data).join("sep").join("provider-configs"));
    }

    if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
        return Some(
            PathBuf::from(local_app_data)
                .join("SEP Agent Workspace")
                .join("provider-configs"),
        );
    }

    env::var_os("HOME").map(|home| {
        PathBuf::from(home)
            .join(".sep-agent-workspace")
            .join("provider-configs")
    })
}

fn workspace_storage_key(workspace_root: &Path) -> String {
    let mut hasher = DefaultHasher::new();
    workspace_root.to_string_lossy().hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn is_recoverable_provider_db_error(error: &str) -> bool {
    error.contains("disk I/O error")
        || error.contains("database disk image is malformed")
        || error.contains("database or disk is full")
}

fn recover_provider_db(db_path: &Path) -> Result<(), String> {
    if db_path.exists() {
        let backup_path = db_path.with_file_name(format!(
            "{}.corrupt-{}",
            db_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("config.sqlite3"),
            unix_timestamp_seconds()
        ));
        fs::rename(db_path, backup_path).map_err(|error| error.to_string())?;
    }

    for suffix in ["-journal", "-wal", "-shm"] {
        let sidecar_path = PathBuf::from(format!("{}{}", db_path.display(), suffix));
        if sidecar_path.exists() {
            fs::remove_file(sidecar_path).map_err(|error| error.to_string())?;
        }
    }

    Ok(())
}

fn bool_to_int(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

fn int_to_bool(value: i64) -> bool {
    value != 0
}
