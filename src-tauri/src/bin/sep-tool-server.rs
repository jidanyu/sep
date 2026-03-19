use async_stream::stream;
use axum::{
    extract::State,
    http::StatusCode,
    response::{
        IntoResponse,
        sse::{Event, KeepAlive, Sse},
    },
    routing::{get, post},
    Json, Router,
};
use futures_util::{Stream, StreamExt};
#[path = "../provider_store.rs"]
mod provider_store;
use genai::{
    Client, ModelIden, ServiceTarget,
    adapter::AdapterKind,
    chat::{
        ChatMessage, ChatOptions, ChatRequest, ChatResponse, ChatStreamEvent, ContentPart,
        MessageContent, ReasoningEffort, Tool, ToolCall, ToolResponse,
    },
    resolver::{AuthData, Endpoint, ServiceTargetResolver},
};
use reqwest::header::CONTENT_TYPE;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::{
    convert::Infallible,
    env,
    net::SocketAddr,
    path::{Path, PathBuf},
    pin::Pin,
    sync::Arc,
    time::Duration,
};
use tokio::{net::TcpListener, process::Command, time::timeout};
use tower_http::cors::CorsLayer;

use provider_store::{
    ProviderConfigResult, SaveProviderConfigRequest, SaveWorkspaceStateRequest,
    WorkspaceStateResult, load_provider_config, load_workspace_state, save_provider_config,
    save_workspace_state,
};

fn install_rustls_crypto_provider() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}

fn sanitize_process_proxy_env() {
    for key in [
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
    ] {
        let Some(value) = env::var_os(key) else {
            continue;
        };

        let value = value.to_string_lossy();
        if is_invalid_loopback_proxy_value(&value) {
            env::remove_var(key);
            eprintln!("sep-tool-server ignored invalid proxy env {key}={value}");
        }
    }
}

fn is_invalid_loopback_proxy_value(value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase();
    normalized.contains("127.0.0.1:9")
        || normalized.contains("localhost:9")
        || normalized.contains("[::1]:9")
}

fn format_error_chain(error: &(dyn std::error::Error + 'static)) -> String {
    let mut lines = vec![error.to_string()];
    let mut current = error.source();

    while let Some(source) = current {
        lines.push(format!("Caused by: {source}"));
        current = source.source();
    }

    lines.join("\n")
}

#[derive(Clone)]
struct AppState {
    workspace_root: Arc<PathBuf>,
}

#[derive(Debug, Deserialize)]
struct InvokeRequest {
    tool: String,
    #[serde(default)]
    args: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelRequest {
    provider_id: String,
    base_url: String,
    api_key: String,
    payload: Value,
}

#[derive(Debug, Serialize)]
struct ToolEnvelope {
    ok: bool,
    result: Option<Value>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenDirectoryDialogRequest {
    default_path: Option<String>,
    title: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenDirectoryDialogEnvelope {
    ok: bool,
    path: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelEnvelope {
    ok: bool,
    result: Option<ModelResult>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelResult {
    content: String,
    tool_calls: Vec<ToolCallPayload>,
    raw_response_text: Option<String>,
}

#[derive(Debug, Serialize)]
struct ToolCallPayload {
    id: String,
    #[serde(rename = "type")]
    kind: &'static str,
    function: ToolCallFunctionPayload,
}

#[derive(Debug, Serialize)]
struct ToolCallFunctionPayload {
    name: String,
    arguments: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamEventPayload {
    event_type: String,
    text: Option<String>,
    message: Option<String>,
    raw_response_text: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderConfigEnvelope {
    ok: bool,
    result: Option<ProviderConfigResult>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceStateEnvelope {
    ok: bool,
    result: Option<WorkspaceStateResult>,
    error: Option<String>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    install_rustls_crypto_provider();
    sanitize_process_proxy_env();

    let (host, port, workspace_root) = parse_args()?;
    let workspace_display = workspace_root.display().to_string();
    let state = AppState {
        workspace_root: Arc::new(workspace_root),
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/invoke", post(invoke_tool))
        .route("/dialog/open-directory", post(open_directory_dialog))
        .route("/config/providers", get(get_provider_config).post(save_provider_config_handler))
        .route("/state/workspace", get(get_workspace_state).post(save_workspace_state_handler))
        .route("/chat", post(chat_complete))
        .route("/chat/stream", post(chat_stream))
        .with_state(state)
        .layer(CorsLayer::permissive());

    let address: SocketAddr = format!("{host}:{port}").parse()?;
    let listener = TcpListener::bind(address).await?;

    println!("sep local server listening on http://{host}:{port}");
    println!("workspace path: {workspace_display}");

    axum::serve(listener, app).await?;
    Ok(())
}

async fn health(State(state): State<AppState>) -> Json<Value> {
    Json(json!({
        "ok": true,
        "workspaceRoot": state.workspace_root.display().to_string(),
    }))
}

async fn get_provider_config(
    State(state): State<AppState>,
) -> (StatusCode, Json<ProviderConfigEnvelope>) {
    match load_provider_config(state.workspace_root.as_ref()) {
        Ok(result) => (
            StatusCode::OK,
            Json(ProviderConfigEnvelope {
                ok: true,
                result: Some(result),
                error: None,
            }),
        ),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(ProviderConfigEnvelope {
                ok: false,
                result: None,
                error: Some(error),
            }),
        ),
    }
}

async fn save_provider_config_handler(
    State(state): State<AppState>,
    Json(request): Json<SaveProviderConfigRequest>,
) -> (StatusCode, Json<ProviderConfigEnvelope>) {
    match save_provider_config(state.workspace_root.as_ref(), request) {
        Ok(result) => (
            StatusCode::OK,
            Json(ProviderConfigEnvelope {
                ok: true,
                result: Some(result),
                error: None,
            }),
        ),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(ProviderConfigEnvelope {
                ok: false,
                result: None,
                error: Some(error),
            }),
        ),
    }
}

async fn get_workspace_state(
    State(state): State<AppState>,
) -> (StatusCode, Json<WorkspaceStateEnvelope>) {
    match load_workspace_state(state.workspace_root.as_ref()) {
        Ok(result) => (
            StatusCode::OK,
            Json(WorkspaceStateEnvelope {
                ok: true,
                result: Some(result),
                error: None,
            }),
        ),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(WorkspaceStateEnvelope {
                ok: false,
                result: None,
                error: Some(error),
            }),
        ),
    }
}

async fn save_workspace_state_handler(
    State(state): State<AppState>,
    Json(request): Json<SaveWorkspaceStateRequest>,
) -> (StatusCode, Json<WorkspaceStateEnvelope>) {
    match save_workspace_state(state.workspace_root.as_ref(), request) {
        Ok(result) => (
            StatusCode::OK,
            Json(WorkspaceStateEnvelope {
                ok: true,
                result: Some(result),
                error: None,
            }),
        ),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(WorkspaceStateEnvelope {
                ok: false,
                result: None,
                error: Some(error),
            }),
        ),
    }
}

async fn invoke_tool(
    State(state): State<AppState>,
    Json(request): Json<InvokeRequest>,
) -> (StatusCode, Json<ToolEnvelope>) {
    match handle_tool(&state, request).await {
        Ok(result) => (
            StatusCode::OK,
            Json(ToolEnvelope {
                ok: true,
                result: Some(result),
                error: None,
            }),
        ),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(ToolEnvelope {
                ok: false,
                result: None,
                error: Some(error),
            }),
        ),
    }
}

async fn open_directory_dialog(
    Json(request): Json<OpenDirectoryDialogRequest>,
) -> (StatusCode, Json<OpenDirectoryDialogEnvelope>) {
    let result = tokio::task::spawn_blocking(move || {
        let mut dialog = rfd::FileDialog::new();

        if let Some(title) = request.title.as_ref() {
            if !title.trim().is_empty() {
                dialog = dialog.set_title(title);
            }
        }

        if let Some(default_path) = request.default_path.as_ref() {
            if !default_path.trim().is_empty() {
                dialog = dialog.set_directory(default_path);
            }
        }

        dialog.pick_folder()
    })
    .await;

    match result {
        Ok(Some(path)) => (
            StatusCode::OK,
            Json(OpenDirectoryDialogEnvelope {
                ok: true,
                path: Some(path.display().to_string()),
                error: None,
            }),
        ),
        Ok(None) => (
            StatusCode::OK,
            Json(OpenDirectoryDialogEnvelope {
                ok: true,
                path: None,
                error: None,
            }),
        ),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(OpenDirectoryDialogEnvelope {
                ok: false,
                path: None,
                error: Some(error.to_string()),
            }),
        ),
    }
}

async fn chat_complete(Json(request): Json<ModelRequest>) -> (StatusCode, Json<ModelEnvelope>) {
    match handle_model_completion(request).await {
        Ok(result) => (
            StatusCode::OK,
            Json(ModelEnvelope {
                ok: true,
                result: Some(result),
                error: None,
            }),
        ),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(ModelEnvelope {
                ok: false,
                result: None,
                error: Some(error),
            }),
        ),
    }
}

async fn chat_stream(Json(request): Json<ModelRequest>) -> impl IntoResponse {
    match build_model_stream(request).await {
        Ok(sse) => sse.into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(ModelEnvelope {
                ok: false,
                result: None,
                error: Some(error),
            }),
        )
            .into_response(),
    }
}

async fn handle_tool(state: &AppState, request: InvokeRequest) -> Result<Value, String> {
    match request.tool.as_str() {
        "list_dir" => list_dir(state, request.args).await,
        "read_file" => read_file(state, request.args).await,
        "write_file" => write_file(state, request.args).await,
        "patch_file" => patch_file(state, request.args).await,
        "stat_path" => stat_path(state, request.args).await,
        "move_path" => move_path(state, request.args).await,
        "delete_path" => delete_path(state, request.args).await,
        "search_text" => search_text(state, request.args).await,
        "git_status" => git_status(state, request.args).await,
        "git_diff" => git_diff(state, request.args).await,
        "git_log" => git_log(state, request.args).await,
        "git_show" => git_show(state, request.args).await,
        "git_blame" => git_blame(state, request.args).await,
        "web_fetch" => web_fetch(request.args).await,
        "run_command" => run_command(state, request.args).await,
        tool => Err(format!("Unknown tool '{tool}'.")),
    }
}

async fn handle_model_completion(request: ModelRequest) -> Result<ModelResult, String> {
    let payload = request
        .payload
        .as_object()
        .ok_or_else(|| "Model payload must be a JSON object.".to_string())?;
    let model_name = normalize_model_name(
        &request.provider_id,
        payload
            .get("model")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing required payload field 'model'.".to_string())?,
    );
    let chat_request = build_chat_request(&request.provider_id, payload)?;
    let chat_options = build_chat_options(payload, false);
    let client = build_genai_client(
        &request.provider_id,
        &request.base_url,
        &request.api_key,
        &model_name,
    )?;

    let chat_response = client
        .exec_chat(model_name.as_str(), chat_request, Some(&chat_options))
        .await
        .map_err(|error| format_error_chain(&error))?;

    Ok(model_result_from_chat_response(chat_response))
}

async fn build_model_stream(
    request: ModelRequest,
) -> Result<Sse<Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send>>>, String> {
    let payload = request
        .payload
        .as_object()
        .ok_or_else(|| "Model payload must be a JSON object.".to_string())?;
    let model_name = normalize_model_name(
        &request.provider_id,
        payload
            .get("model")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing required payload field 'model'.".to_string())?,
    );
    let chat_request = build_chat_request(&request.provider_id, payload)?;
    let chat_options = build_chat_options(payload, true);
    let adapter_kind = resolve_adapter_kind(&request.provider_id, &model_name)?;
    let client = build_genai_client(
        &request.provider_id,
        &request.base_url,
        &request.api_key,
        &model_name,
    )?;

    if matches!(adapter_kind, AdapterKind::OpenAIResp) {
        let chat_response = client
            .exec_chat(model_name.as_str(), chat_request, Some(&chat_options))
            .await
            .map_err(|error| format_error_chain(&error))?;

        let result = model_result_from_chat_response(chat_response);
        let event_stream = stream! {
            yield Ok(sse_json_event(StreamEventPayload {
                event_type: "start".into(),
                text: None,
                message: None,
                raw_response_text: None,
            }));

            if !result.content.is_empty() {
                yield Ok(sse_json_event(StreamEventPayload {
                    event_type: "chunk".into(),
                    text: Some(result.content),
                    message: None,
                    raw_response_text: None,
                }));
            }

            yield Ok(sse_json_event(StreamEventPayload {
                event_type: "done".into(),
                text: None,
                message: None,
                raw_response_text: result.raw_response_text,
            }));
        };

        let boxed_stream: Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send>> =
            Box::pin(event_stream);
        return Ok(Sse::new(boxed_stream).keep_alive(KeepAlive::default()));
    }

    let mut chat_stream = client
        .exec_chat_stream(model_name.as_str(), chat_request, Some(&chat_options))
        .await
        .map_err(|error| format_error_chain(&error))?;

    let event_stream = stream! {
        yield Ok(sse_json_event(StreamEventPayload {
            event_type: "start".into(),
            text: None,
            message: None,
            raw_response_text: None,
        }));

        while let Some(event) = chat_stream.stream.next().await {
            match event {
                Ok(ChatStreamEvent::Start) => {}
                Ok(ChatStreamEvent::Chunk(chunk)) => {
                    if !chunk.content.is_empty() {
                        yield Ok(sse_json_event(StreamEventPayload {
                            event_type: "chunk".into(),
                            text: Some(chunk.content),
                            message: None,
                            raw_response_text: None,
                        }));
                    }
                }
                Ok(ChatStreamEvent::ReasoningChunk(_)) => {}
                Ok(ChatStreamEvent::ThoughtSignatureChunk(_)) => {}
                Ok(ChatStreamEvent::ToolCallChunk(_)) => {}
                Ok(ChatStreamEvent::End(_)) => {
                    yield Ok(sse_json_event(StreamEventPayload {
                        event_type: "done".into(),
                        text: None,
                        message: None,
                        raw_response_text: None,
                    }));
                    break;
                }
                Err(error) => {
                    yield Ok(sse_json_event(StreamEventPayload {
                        event_type: "error".into(),
                        text: None,
                        message: Some(format_error_chain(&error)),
                        raw_response_text: None,
                    }));
                    break;
                }
            }
        }
    };

    let boxed_stream: Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send>> =
        Box::pin(event_stream);

    Ok(Sse::new(boxed_stream).keep_alive(KeepAlive::default()))
}

fn build_genai_client(
    provider_id: &str,
    base_url: &str,
    api_key: &str,
    model_name: &str,
) -> Result<Client, String> {
    if api_key.trim().is_empty() {
        return Err("API Key is required for the selected provider.".into());
    }

    let normalized_base_url = normalize_base_url(base_url);
    let adapter_kind = resolve_adapter_kind(provider_id, model_name)?;
    let api_key = api_key.to_string();

    let target_resolver = ServiceTargetResolver::from_resolver_fn(
        move |service_target: ServiceTarget| -> Result<ServiceTarget, genai::resolver::Error> {
            let ServiceTarget { model, .. } = service_target;
            let endpoint = Endpoint::from_owned(normalized_base_url.clone());
            let auth = AuthData::from_single(api_key.clone());
            let model = ModelIden::new(adapter_kind, model.model_name);

            Ok(ServiceTarget {
                endpoint,
                auth,
                model,
            })
        },
    );

    Ok(Client::builder()
        .with_service_target_resolver(target_resolver)
        .build())
}

fn build_chat_request(
    provider_id: &str,
    payload: &Map<String, Value>,
) -> Result<ChatRequest, String> {
    let mut chat_request = ChatRequest::default();

    if let Some(system) = payload.get("system").and_then(Value::as_str) {
        if !system.trim().is_empty() {
            chat_request = chat_request.with_system(system.trim().to_string());
        }
    }

    let messages = payload
        .get("messages")
        .and_then(Value::as_array)
        .ok_or_else(|| "Missing required payload field 'messages'.".to_string())?;

    let mut first_system_taken = chat_request.system.is_some();
    for (index, message) in messages.iter().enumerate() {
        let message_object = message
            .as_object()
            .ok_or_else(|| format!("Message at index {index} must be a JSON object."))?;
        let role = message_object
            .get("role")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("Message at index {index} is missing role."))?;

        match role {
            "system" => {
                let content = extract_text_content(message_object.get("content"));
                if content.is_empty() {
                    continue;
                }

                if !first_system_taken {
                    chat_request = chat_request.with_system(content);
                    first_system_taken = true;
                } else {
                    chat_request = chat_request.append_message(ChatMessage::system(content));
                }
            }
            "user" => {
                chat_request = chat_request.append_message(ChatMessage::user(extract_text_content(
                    message_object.get("content"),
                )));
            }
            "assistant" => {
                let tool_calls = parse_tool_calls(message_object.get("tool_calls"))?;
                let assistant_content = extract_text_content(message_object.get("content"));
                let assistant_message = build_assistant_message(assistant_content, tool_calls);

                if let Some(message) = assistant_message {
                    chat_request = chat_request.append_message(message);
                }
            }
            "tool" => {
                let tool_call_id = message_object
                    .get("tool_call_id")
                    .and_then(Value::as_str)
                    .filter(|value| !value.trim().is_empty())
                    .ok_or_else(|| format!("Tool message at index {index} is missing tool_call_id."))?;
                let content = stringify_content(message_object.get("content"));
                chat_request = chat_request.append_message(ToolResponse::new(tool_call_id, content));
            }
            unsupported_role => {
                if provider_id == "anthropic" {
                    return Err(format!("Unsupported role '{unsupported_role}' for Anthropic payload."));
                }
            }
        }
    }

    if let Some(tools) = parse_tools(payload.get("tools"))? {
        chat_request = chat_request.with_tools(tools);
    }

    Ok(chat_request)
}

fn build_chat_options(payload: &Map<String, Value>, streaming: bool) -> ChatOptions {
    let mut options = ChatOptions::default()
        .with_capture_raw_body(!streaming)
        .with_normalize_reasoning_content(true);

    if streaming {
        options = options
            .with_capture_content(true)
            .with_capture_reasoning_content(true)
            .with_capture_tool_calls(true)
            .with_capture_usage(true);
    }

    if let Some(max_tokens) = payload
        .get("max_tokens")
        .or_else(|| payload.get("max_completion_tokens"))
        .and_then(Value::as_u64)
    {
        options = options.with_max_tokens(max_tokens.min(u32::MAX as u64) as u32);
    }

    if let Some(temperature) = payload.get("temperature").and_then(Value::as_f64) {
        options = options.with_temperature(temperature);
    }

    if let Some(top_p) = payload.get("top_p").and_then(Value::as_f64) {
        options = options.with_top_p(top_p);
    }

    if let Some(stop_sequences) = payload.get("stop").and_then(Value::as_array) {
        let stops = stop_sequences
            .iter()
            .filter_map(Value::as_str)
            .map(ToString::to_string)
            .collect::<Vec<_>>();

        if !stops.is_empty() {
            options = options.with_stop_sequences(stops);
        }
    }

    if let Some(reasoning_effort) = payload.get("reasoning_effort").and_then(Value::as_str) {
        let normalized = match reasoning_effort {
            "xhigh" => Some(ReasoningEffort::High),
            keyword => ReasoningEffort::from_keyword(keyword),
        };

        if let Some(reasoning_effort) = normalized {
            options = options.with_reasoning_effort(reasoning_effort);
        }
    }

    options
}

fn build_assistant_message(content: String, tool_calls: Vec<ToolCall>) -> Option<ChatMessage> {
    let normalized_content = content.trim();
    let meaningful_text = (!normalized_content.is_empty() && normalized_content != "[Tool call requested]")
        .then(|| normalized_content.to_string());

    if tool_calls.is_empty() {
        return meaningful_text.map(ChatMessage::assistant);
    }

    if meaningful_text.is_none() {
        return Some(ChatMessage::from(tool_calls));
    }

    let mut parts = vec![ContentPart::from_text(meaningful_text.unwrap())];
    parts.extend(tool_calls.into_iter().map(ContentPart::ToolCall));
    Some(ChatMessage::assistant(MessageContent::from_parts(parts)))
}

fn parse_tool_calls(tool_calls: Option<&Value>) -> Result<Vec<ToolCall>, String> {
    let Some(tool_calls) = tool_calls.and_then(Value::as_array) else {
        return Ok(Vec::new());
    };

    let mut parsed = Vec::new();
    for (index, tool_call) in tool_calls.iter().enumerate() {
        let tool_object = tool_call
            .as_object()
            .ok_or_else(|| format!("Tool call at index {index} must be a JSON object."))?;
        let function = tool_object
            .get("function")
            .and_then(Value::as_object)
            .ok_or_else(|| format!("Tool call at index {index} is missing function metadata."))?;
        let fn_name = function
            .get("name")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| format!("Tool call at index {index} is missing function name."))?;
        let raw_arguments = function
            .get("arguments")
            .and_then(Value::as_str)
            .unwrap_or("{}")
            .trim();
        let fn_arguments = if raw_arguments.is_empty() {
            json!({})
        } else {
            serde_json::from_str::<Value>(raw_arguments)
                .map_err(|error| format!("Tool call arguments for '{fn_name}' are invalid JSON: {error}"))?
        };

        parsed.push(ToolCall {
            call_id: tool_object
                .get("id")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .map(ToString::to_string)
                .unwrap_or_else(|| format!("tool-call-{}", index + 1)),
            fn_name: fn_name.to_string(),
            fn_arguments,
            thought_signatures: None,
        });
    }

    Ok(parsed)
}

fn parse_tools(tools: Option<&Value>) -> Result<Option<Vec<Tool>>, String> {
    let Some(tools) = tools.and_then(Value::as_array) else {
        return Ok(None);
    };

    let mut parsed = Vec::new();
    for (index, tool) in tools.iter().enumerate() {
        let tool_object = tool
            .as_object()
            .ok_or_else(|| format!("Tool definition at index {index} must be a JSON object."))?;
        let function = tool_object
            .get("function")
            .and_then(Value::as_object)
            .ok_or_else(|| format!("Tool definition at index {index} is missing function metadata."))?;
        let name = function
            .get("name")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| format!("Tool definition at index {index} is missing name."))?;

        let mut parsed_tool = Tool::new(name);
        if let Some(description) = function.get("description").and_then(Value::as_str) {
            if !description.trim().is_empty() {
                parsed_tool = parsed_tool.with_description(description.to_string());
            }
        }

        if let Some(schema) = function.get("parameters") {
            parsed_tool = parsed_tool.with_schema(schema.clone());
        }

        parsed.push(parsed_tool);
    }

    Ok((!parsed.is_empty()).then_some(parsed))
}

fn model_result_from_chat_response(response: ChatResponse) -> ModelResult {
    let raw_response_text = response
        .captured_raw_body
        .as_ref()
        .and_then(|value| serde_json::to_string_pretty(value).ok());
    let content = collect_text_from_message_content(&response.content);
    let tool_calls = response
        .tool_calls()
        .into_iter()
        .map(tool_call_to_payload)
        .collect();

    ModelResult {
        content,
        tool_calls,
        raw_response_text,
    }
}

fn tool_call_to_payload(tool_call: &ToolCall) -> ToolCallPayload {
    ToolCallPayload {
        id: tool_call.call_id.clone(),
        kind: "function",
        function: ToolCallFunctionPayload {
            name: tool_call.fn_name.clone(),
            arguments: serde_json::to_string(&tool_call.fn_arguments)
                .unwrap_or_else(|_| "{}".to_string()),
        },
    }
}

fn collect_text_from_message_content(content: &MessageContent) -> String {
    content
        .texts()
        .into_iter()
        .collect::<Vec<_>>()
        .join("")
}

fn extract_text_content(content: Option<&Value>) -> String {
    let Some(content) = content else {
        return String::new();
    };

    if let Some(text) = content.as_str() {
        return text.to_string();
    }

    if let Some(parts) = content.as_array() {
        return parts
            .iter()
            .map(|part| {
                part.get("text")
                    .and_then(Value::as_str)
                    .or_else(|| part.get("content").and_then(Value::as_str))
                    .unwrap_or_default()
            })
            .collect::<Vec<_>>()
            .join("");
    }

    if content.is_null() {
        return String::new();
    }

    stringify_content(Some(content))
}

fn stringify_content(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(text)) => text.to_string(),
        Some(Value::Null) | None => String::new(),
        Some(value) => serde_json::to_string(value).unwrap_or_else(|_| String::new()),
    }
}

fn resolve_adapter_kind(provider_id: &str, model_name: &str) -> Result<AdapterKind, String> {
    match provider_id {
        "openai" | "opencode" => {
            let inferred = AdapterKind::from_model(model_name).map_err(|error| error.to_string())?;
            if matches!(inferred, AdapterKind::OpenAIResp) {
                Ok(AdapterKind::OpenAIResp)
            } else {
                Ok(AdapterKind::OpenAI)
            }
        }
        "anthropic" => Ok(AdapterKind::Anthropic),
        "google" => Ok(AdapterKind::Gemini),
        _ => AdapterKind::from_model(model_name).map_err(|error| error.to_string()),
    }
}

fn normalize_model_name(provider_id: &str, model_name: &str) -> String {
    let normalized = model_name.trim();

    match provider_id {
        "anthropic" | "google" | "openai" | "opencode" => normalized
            .split_once('/')
            .map(|(_, tail)| tail.to_string())
            .unwrap_or_else(|| normalized.to_string()),
        _ => normalized.to_string(),
    }
}

fn normalize_base_url(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        String::new()
    } else {
        format!("{trimmed}/")
    }
}

fn sse_json_event(payload: StreamEventPayload) -> Event {
    let data = serde_json::to_string(&payload)
        .unwrap_or_else(|_| "{\"eventType\":\"error\",\"message\":\"failed to serialize stream event\"}".into());

    Event::default().data(data)
}

async fn list_dir(state: &AppState, args: Value) -> Result<Value, String> {
    let relative_path = args
        .get("path")
        .and_then(Value::as_str)
        .unwrap_or(".");
    let path = resolve_existing_path(&state.workspace_root, relative_path)?;

    if !path.is_dir() {
        return Err("Path is not a directory.".into());
    }

    let mut entries = std::fs::read_dir(&path)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .map(|entry| {
            let entry_path = entry.path();
            let kind = if entry_path.is_dir() { "dir" } else { "file" };
            let relative = entry_path
                .strip_prefix(&*state.workspace_root)
                .unwrap_or(&entry_path)
                .to_string_lossy()
                .replace('\\', "/");

            json!({
                "name": entry.file_name().to_string_lossy(),
                "path": if relative.is_empty() { "." } else { &relative },
                "kind": kind,
            })
        })
        .collect::<Vec<_>>();

    entries.sort_by(|left, right| {
        left["path"]
            .as_str()
            .unwrap_or_default()
            .cmp(right["path"].as_str().unwrap_or_default())
    });

    Ok(json!({
        "path": relative_display(&state.workspace_root, &path),
        "entries": entries,
    }))
}

async fn read_file(state: &AppState, args: Value) -> Result<Value, String> {
    let relative_path = args
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| "Missing required argument 'path'.".to_string())?;
    let path = resolve_existing_path(&state.workspace_root, relative_path)?;

    if !path.is_file() {
        return Err("Path is not a file.".into());
    }

    let content = tokio::fs::read_to_string(&path)
        .await
        .map_err(|error| error.to_string())?;
    let offset = args
        .get("offset")
        .and_then(Value::as_u64)
        .unwrap_or(1)
        .max(1) as usize;
    let limit = args
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(400)
        .clamp(1, 2_000) as usize;
    let lines = content.lines().collect::<Vec<_>>();
    let total_lines = lines.len();
    let start_index = offset.saturating_sub(1).min(total_lines);
    let end_index = start_index.saturating_add(limit).min(total_lines);
    let window_lines = lines[start_index..end_index].to_vec();
    let window_content = window_lines.join("\n");
    let numbered_content = window_lines
        .iter()
        .enumerate()
        .map(|(index, line)| format!("{}: {}", start_index + index + 1, line))
        .collect::<Vec<_>>()
        .join("\n");

    Ok(json!({
        "path": relative_display(&state.workspace_root, &path),
        "content": truncate_text(&window_content, 200_000),
        "numberedContent": truncate_text(&numbered_content, 200_000),
        "offset": offset,
        "limit": limit,
        "startLine": if total_lines == 0 { 0 } else { start_index + 1 },
        "endLine": end_index,
        "totalLines": total_lines,
        "truncated": end_index < total_lines,
    }))
}

async fn write_file(state: &AppState, args: Value) -> Result<Value, String> {
    let relative_path = args
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| "Missing required argument 'path'.".to_string())?;
    let content = args
        .get("content")
        .and_then(Value::as_str)
        .ok_or_else(|| "Missing required argument 'content'.".to_string())?;
    let path = resolve_create_path(&state.workspace_root, relative_path)?;

    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|error| error.to_string())?;
    }

    tokio::fs::write(&path, content)
        .await
        .map_err(|error| error.to_string())?;

    Ok(json!({
        "path": relative_display(&state.workspace_root, &path),
        "bytesWritten": content.len(),
    }))
}

async fn patch_file(state: &AppState, args: Value) -> Result<Value, String> {
    let relative_path = args
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| "Missing required argument 'path'.".to_string())?;
    let edits = args
        .get("edits")
        .and_then(Value::as_array)
        .ok_or_else(|| "Missing required argument 'edits'.".to_string())?;
    let path = resolve_existing_path(&state.workspace_root, relative_path)?;

    if !path.is_file() {
        return Err("Path is not a file.".into());
    }

    let mut content = tokio::fs::read_to_string(&path)
        .await
        .map_err(|error| error.to_string())?;
    let mut applied = Vec::new();

    for (index, edit) in edits.iter().enumerate() {
        let find = edit
            .get("find")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("Edit at index {index} is missing 'find'."))?;
        let replace = edit
            .get("replace")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("Edit at index {index} is missing 'replace'."))?;
        let replace_all = edit
            .get("replace_all")
            .and_then(Value::as_bool)
            .unwrap_or(false);

        if find.is_empty() {
            return Err(format!("Edit at index {index} has an empty 'find' string."));
        }

        let match_count = content.matches(find).count();
        if match_count == 0 {
            return Err(format!("Edit at index {index} did not match any content."));
        }

        if replace_all {
            content = content.replace(find, replace);
            applied.push(json!({
                "index": index,
                "matches": match_count,
                "replaceAll": true,
            }));
            continue;
        }

        content = content.replacen(find, replace, 1);
        applied.push(json!({
            "index": index,
            "matches": match_count,
            "replaceAll": false,
        }));
    }

    tokio::fs::write(&path, content)
        .await
        .map_err(|error| error.to_string())?;

    Ok(json!({
        "path": relative_display(&state.workspace_root, &path),
        "applied": applied,
        "editCount": edits.len(),
    }))
}

async fn stat_path(state: &AppState, args: Value) -> Result<Value, String> {
    let relative_path = args
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| "Missing required argument 'path'.".to_string())?;
    let path = resolve_existing_path(&state.workspace_root, relative_path)?;
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|error| error.to_string())?;

    Ok(json!({
        "path": relative_display(&state.workspace_root, &path),
        "exists": true,
        "isFile": metadata.is_file(),
        "isDir": metadata.is_dir(),
        "len": metadata.len(),
        "readonly": metadata.permissions().readonly(),
    }))
}

async fn move_path(state: &AppState, args: Value) -> Result<Value, String> {
    let from_relative_path = args
        .get("from")
        .and_then(Value::as_str)
        .ok_or_else(|| "Missing required argument 'from'.".to_string())?;
    let to_relative_path = args
        .get("to")
        .and_then(Value::as_str)
        .ok_or_else(|| "Missing required argument 'to'.".to_string())?;
    let from_path = resolve_existing_path(&state.workspace_root, from_relative_path)?;
    let to_path = resolve_create_path(&state.workspace_root, to_relative_path)?;

    if to_path.exists() {
        return Err("Destination path already exists.".into());
    }

    if let Some(parent) = to_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|error| error.to_string())?;
    }

    tokio::fs::rename(&from_path, &to_path)
        .await
        .map_err(|error| error.to_string())?;

    Ok(json!({
        "from": relative_display(&state.workspace_root, &from_path),
        "to": relative_display(&state.workspace_root, &to_path),
    }))
}

async fn delete_path(state: &AppState, args: Value) -> Result<Value, String> {
    let relative_path = args
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| "Missing required argument 'path'.".to_string())?;
    let recursive = args
        .get("recursive")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let path = resolve_existing_path(&state.workspace_root, relative_path)?;
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|error| error.to_string())?;

    if metadata.is_dir() {
        if recursive {
            tokio::fs::remove_dir_all(&path)
                .await
                .map_err(|error| error.to_string())?;
        } else {
            tokio::fs::remove_dir(&path)
                .await
                .map_err(|error| error.to_string())?;
        }
    } else {
        tokio::fs::remove_file(&path)
            .await
            .map_err(|error| error.to_string())?;
    }

    Ok(json!({
        "path": relative_display(&state.workspace_root, &path),
        "deleted": true,
        "recursive": recursive,
    }))
}

async fn search_text(state: &AppState, args: Value) -> Result<Value, String> {
    let pattern = args
        .get("pattern")
        .and_then(Value::as_str)
        .ok_or_else(|| "Missing required argument 'pattern'.".to_string())?;
    let relative_path = args
        .get("path")
        .and_then(Value::as_str)
        .unwrap_or(".");
    let max_results = args
        .get("max_results")
        .and_then(Value::as_u64)
        .unwrap_or(50)
        .min(200) as usize;
    let path = resolve_existing_path(&state.workspace_root, relative_path)?;
    let target = relative_display(&state.workspace_root, &path);

    let mut command = Command::new("rg");
    command.args([
        "--json",
        "-n",
        "-F",
        "--hidden",
        "-g",
        "!.git",
        "-g",
        "!node_modules",
        "-g",
        "!dist",
        "-g",
        "!target",
        pattern,
        &target,
    ]);
    command.current_dir(&*state.workspace_root);
    command.kill_on_drop(true);

    let output = timeout(Duration::from_millis(15_000), command.output())
        .await
        .map_err(|_| "rg timed out after 15000 ms.".to_string())?
        .map_err(|error| format!("Failed to launch rg: {error}"))?;

    if !output.status.success() && output.status.code() != Some(1) {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut matches = Vec::new();

    for line in stdout.lines() {
        if matches.len() >= max_results {
            break;
        }

        let Ok(event) = serde_json::from_str::<Value>(line) else {
            continue;
        };

        if event.get("type").and_then(Value::as_str) != Some("match") {
            continue;
        }

        let Some(data) = event.get("data") else {
            continue;
        };
        let matched_path = data
            .get("path")
            .and_then(|value| value.get("text"))
            .and_then(Value::as_str)
            .unwrap_or(&target)
            .replace('\\', "/");
        let line_number = data
            .get("line_number")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let text = data
            .get("lines")
            .and_then(|value| value.get("text"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim_end_matches(['\r', '\n']);

        matches.push(json!({
            "path": matched_path,
            "line": line_number,
            "text": truncate_text(text, 400),
        }));
    }

    Ok(json!({
        "pattern": pattern,
        "path": relative_display(&state.workspace_root, &path),
        "matches": matches,
    }))
}

async fn run_command(state: &AppState, args: Value) -> Result<Value, String> {
    let command_text = args
        .get("command")
        .and_then(Value::as_str)
        .ok_or_else(|| "Missing required argument 'command'.".to_string())?;
    let relative_cwd = args
        .get("cwd")
        .and_then(Value::as_str)
        .unwrap_or(".");
    let cwd = resolve_existing_path(&state.workspace_root, relative_cwd)?;

    if !cwd.is_dir() {
        return Err("Command cwd must be a directory.".into());
    }

    let timeout_ms = args
        .get("timeout_ms")
        .and_then(Value::as_u64)
        .unwrap_or(15_000)
        .min(60_000);

    let mut command = if cfg!(target_os = "windows") {
        let mut cmd = Command::new("powershell");
        cmd.args(["-NoProfile", "-Command", command_text]);
        cmd
    } else {
        let mut cmd = Command::new("sh");
        cmd.args(["-lc", command_text]);
        cmd
    };

    command.current_dir(&cwd);
    command.kill_on_drop(true);

    let output = timeout(Duration::from_millis(timeout_ms), command.output())
        .await
        .map_err(|_| format!("Command timed out after {timeout_ms} ms."))?
        .map_err(|error| error.to_string())?;

    Ok(json!({
        "cwd": relative_display(&state.workspace_root, &cwd),
        "command": command_text,
        "exitCode": output.status.code(),
        "success": output.status.success(),
        "stdout": truncate_text(&String::from_utf8_lossy(&output.stdout), 16_000),
        "stderr": truncate_text(&String::from_utf8_lossy(&output.stderr), 16_000),
    }))
}

async fn git_status(state: &AppState, args: Value) -> Result<Value, String> {
    let cwd = resolve_git_cwd(state, args.get("cwd").and_then(Value::as_str).unwrap_or("."))?;
    let output = run_git(&cwd, &["status", "--short", "--branch"]).await?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let lines = stdout.lines().collect::<Vec<_>>();
    let branch = lines
        .first()
        .copied()
        .unwrap_or("## HEAD")
        .trim_start_matches("## ")
        .to_string();
    let entries = lines
        .iter()
        .skip(1)
        .map(|line| (*line).to_string())
        .collect::<Vec<_>>();

    Ok(json!({
        "cwd": relative_display(&state.workspace_root, &cwd),
        "branch": branch,
        "changedCount": entries.len(),
        "entries": entries,
    }))
}

async fn git_diff(state: &AppState, args: Value) -> Result<Value, String> {
    let cwd = resolve_git_cwd(state, args.get("cwd").and_then(Value::as_str).unwrap_or("."))?;
    let staged = args.get("staged").and_then(Value::as_bool).unwrap_or(false);
    let path = args.get("path").and_then(Value::as_str);
    let base = args.get("base").and_then(Value::as_str);
    let head = args.get("head").and_then(Value::as_str);
    let mut owned_args = vec!["diff".to_string()];
    if let (Some(base), Some(head)) = (base, head) {
        owned_args.push(format!("{base}...{head}"));
    } else if staged {
        owned_args.push("--cached".to_string());
    }
    if let Some(path) = path {
        owned_args.push("--".to_string());
        owned_args.push(path.to_string());
    }

    let command_args = owned_args.iter().map(String::as_str).collect::<Vec<_>>();
    let output = run_git(&cwd, &command_args).await?;
    Ok(json!({
        "cwd": relative_display(&state.workspace_root, &cwd),
        "path": path.unwrap_or("."),
        "staged": staged,
        "base": base,
        "head": head,
        "diff": truncate_text(&String::from_utf8_lossy(&output.stdout), 24_000),
    }))
}

async fn git_log(state: &AppState, args: Value) -> Result<Value, String> {
    let cwd = resolve_git_cwd(state, args.get("cwd").and_then(Value::as_str).unwrap_or("."))?;
    let max_count = args
        .get("max_count")
        .and_then(Value::as_u64)
        .unwrap_or(10)
        .clamp(1, 50);
    let max_count_owned = max_count.to_string();
    let output = run_git(
        &cwd,
        &[
            "log",
            "--date=iso-strict",
            "--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s",
            "-n",
            max_count_owned.as_str(),
        ],
    )
    .await?;
    let commits = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let parts = line.split('\u{1f}').collect::<Vec<_>>();
            if parts.len() != 5 {
                return None;
            }
            Some(json!({
                "hash": parts[0],
                "shortHash": parts[1],
                "author": parts[2],
                "date": parts[3],
                "subject": parts[4],
            }))
        })
        .collect::<Vec<_>>();

    Ok(json!({
        "cwd": relative_display(&state.workspace_root, &cwd),
        "commits": commits,
    }))
}

async fn git_show(state: &AppState, args: Value) -> Result<Value, String> {
    let cwd = resolve_git_cwd(state, args.get("cwd").and_then(Value::as_str).unwrap_or("."))?;
    let target = args
        .get("target")
        .and_then(Value::as_str)
        .ok_or_else(|| "Missing required argument 'target'.".to_string())?;
    let output = run_git(&cwd, &["show", "--stat", "--format=medium", target]).await?;

    Ok(json!({
        "cwd": relative_display(&state.workspace_root, &cwd),
        "target": target,
        "output": truncate_text(&String::from_utf8_lossy(&output.stdout), 24_000),
    }))
}

async fn git_blame(state: &AppState, args: Value) -> Result<Value, String> {
    let cwd = resolve_git_cwd(state, args.get("cwd").and_then(Value::as_str).unwrap_or("."))?;
    let path = args
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| "Missing required argument 'path'.".to_string())?;
    let start_line = args
        .get("start_line")
        .and_then(Value::as_u64)
        .unwrap_or(1)
        .max(1);
    let end_line = args
        .get("end_line")
        .and_then(Value::as_u64)
        .unwrap_or(start_line + 49)
        .max(start_line)
        .min(start_line + 499);
    let range = format!("{start_line},{end_line}");
    let output = run_git(
        &cwd,
        &["blame", "--line-porcelain", "-L", range.as_str(), "--", path],
    )
    .await?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut lines = Vec::new();
    let mut commit = String::new();
    let mut author = String::new();
    let mut summary = String::new();
    let mut line_no = 0_u64;

    for raw_line in stdout.lines() {
        if let Some(rest) = raw_line.strip_prefix("author ") {
            author = rest.to_string();
        } else if let Some(rest) = raw_line.strip_prefix("summary ") {
            summary = rest.to_string();
        } else if raw_line.starts_with('\t') {
            lines.push(json!({
                "line": line_no,
                "commit": commit,
                "author": author,
                "summary": summary,
                "text": truncate_text(raw_line.trim_start_matches('\t'), 400),
            }));
            author.clear();
            summary.clear();
        } else {
            let parts = raw_line.split_whitespace().collect::<Vec<_>>();
            if parts.len() >= 3 && parts[0].len() >= 8 {
                commit = parts[0].to_string();
                line_no = parts[2].parse::<u64>().unwrap_or(0);
            }
        }
    }

    Ok(json!({
        "cwd": relative_display(&state.workspace_root, &cwd),
        "path": path,
        "startLine": start_line,
        "endLine": end_line,
        "lines": lines,
    }))
}

async fn web_fetch(args: Value) -> Result<Value, String> {
    let url = args
        .get("url")
        .and_then(Value::as_str)
        .ok_or_else(|| "Missing required argument 'url'.".to_string())?
        .trim();
    let format = args
        .get("format")
        .and_then(Value::as_str)
        .unwrap_or("markdown");
    let timeout_ms = args
        .get("timeout_ms")
        .and_then(Value::as_u64)
        .unwrap_or(15_000)
        .clamp(1_000, 60_000);
    let normalized_url = normalize_fetch_url(url)?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(&normalized_url)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status();
    let final_url = response.url().to_string();
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();

    if !status.is_success() {
        return Err(format!("Fetch failed with HTTP {}.", status.as_u16()));
    }

    let body = response.text().await.map_err(|error| error.to_string())?;
    let rendered = match format {
        "html" => body.clone(),
        "text" => render_fetch_text(&body, &content_type),
        "markdown" => render_fetch_markdown(&body, &content_type),
        other => return Err(format!("Unsupported fetch format '{other}'.")),
    };

    Ok(json!({
        "url": normalized_url,
        "finalUrl": final_url,
        "status": status.as_u16(),
        "contentType": content_type,
        "format": format,
        "content": truncate_text(&rendered, 120_000),
        "truncated": rendered.chars().count() > 120_000,
    }))
}

fn resolve_existing_path(workspace_root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let candidate = sanitize_relative_path(relative_path)?;
    if candidate.is_absolute() {
        return candidate.canonicalize().map_err(|error| error.to_string());
    }
    let path = workspace_root.join(candidate);
    let canonical = path.canonicalize().map_err(|error| error.to_string())?;

    if !canonical.starts_with(workspace_root) {
        return Err("Path escapes the workspace root.".into());
    }

    Ok(canonical)
}

fn resolve_git_cwd(state: &AppState, relative_path: &str) -> Result<PathBuf, String> {
    let cwd = resolve_existing_path(&state.workspace_root, relative_path)?;
    if !cwd.is_dir() {
        return Err("Git cwd must be a directory.".into());
    }
    Ok(cwd)
}

async fn run_git(cwd: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    let mut command = Command::new("git");
    command.args(args);
    command.current_dir(cwd);
    command.kill_on_drop(true);

    let output = timeout(Duration::from_millis(15_000), command.output())
        .await
        .map_err(|_| "git timed out after 15000 ms.".to_string())?
        .map_err(|error| format!("Failed to launch git: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Err(if !stderr.is_empty() { stderr } else { stdout });
    }

    Ok(output)
}

fn normalize_fetch_url(url: &str) -> Result<String, String> {
    let normalized = if url.starts_with("http://") || url.starts_with("https://") {
        url.to_string()
    } else {
        format!("https://{url}")
    };

    let parsed = reqwest::Url::parse(&normalized).map_err(|error| error.to_string())?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed.to_string()),
        _ => Err("Only http and https URLs are supported.".into()),
    }
}

fn render_fetch_text(body: &str, content_type: &str) -> String {
    if content_type.contains("html") {
        html2text::from_read(body.as_bytes(), 100).unwrap_or_else(|_| body.to_string())
    } else {
        body.to_string()
    }
}

fn render_fetch_markdown(body: &str, content_type: &str) -> String {
    if content_type.contains("html") {
        html2text::from_read(body.as_bytes(), 100).unwrap_or_else(|_| body.to_string())
    } else {
        body.to_string()
    }
}

fn resolve_create_path(workspace_root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let candidate = sanitize_relative_path(relative_path)?;
    if candidate.is_absolute() {
        let existing_ancestor = candidate
            .ancestors()
            .find(|ancestor| ancestor.exists())
            .ok_or_else(|| "No valid parent directory found.".to_string())?;
        existing_ancestor
            .canonicalize()
            .map_err(|error| error.to_string())?;
        return Ok(candidate);
    }
    let path = workspace_root.join(&candidate);

    let existing_ancestor = path
        .ancestors()
        .find(|ancestor| ancestor.exists())
        .ok_or_else(|| "No valid parent directory found.".to_string())?;
    let canonical_parent = existing_ancestor
        .canonicalize()
        .map_err(|error| error.to_string())?;

    if !canonical_parent.starts_with(workspace_root) {
        return Err("Path escapes the workspace root.".into());
    }

    Ok(path)
}

fn sanitize_relative_path(relative_path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(relative_path);
    Ok(candidate)
}

fn relative_display(workspace_root: &Path, path: &Path) -> String {
    let relative = path
        .strip_prefix(workspace_root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");

    if relative.is_empty() {
        ".".into()
    } else {
        relative
    }
}

fn truncate_text(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }

    text.chars().take(max_chars).collect::<String>() + "\n…"
}

fn parse_args() -> Result<(String, u16, PathBuf), Box<dyn std::error::Error>> {
    let mut host = "127.0.0.1".to_string();
    let mut port = 4097;
    let mut workspace_root = env::current_dir()?;

    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--host" => {
                if let Some(value) = args.next() {
                    host = value;
                }
            }
            "--port" => {
                if let Some(value) = args.next() {
                    port = value.parse()?;
                }
            }
            "--workspace" => {
                if let Some(value) = args.next() {
                    workspace_root = PathBuf::from(value);
                }
            }
            _ => {}
        }
    }

    workspace_root = workspace_root.canonicalize()?;
    Ok((host, port, workspace_root))
}
