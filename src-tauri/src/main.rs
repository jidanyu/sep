#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use futures_util::StreamExt;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::env;
use tauri::{AppHandle, Emitter};

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
            eprintln!("sep app ignored invalid proxy env {key}={value}");
        }
    }
}

fn is_invalid_loopback_proxy_value(value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase();
    normalized.contains("127.0.0.1:9")
        || normalized.contains("localhost:9")
        || normalized.contains("[::1]:9")
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatRequest {
    request_id: String,
    provider_id: String,
    endpoint: String,
    api_key: String,
    payload: Value,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StreamEvent {
    request_id: String,
    kind: String,
    chunk: Option<String>,
    message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorResponse {
    message: String,
}

#[tauri::command]
async fn send_chat(app: AppHandle, request: ChatRequest) -> Result<(), ErrorResponse> {
    if request.api_key.trim().is_empty() {
        return Err(ErrorResponse {
            message: "API Key is required for the selected provider.".into(),
        });
    }

    emit_event(&app, &request.request_id, "start", None, None)?;

    let client = reqwest::Client::new();

    let result = match request.provider_id.as_str() {
        "openai" => stream_openai(&app, &client, &request).await,
        "anthropic" => stream_anthropic(&app, &client, &request).await,
        _ => Err(ErrorResponse {
            message: format!(
                "Provider '{}' is not wired yet in v0.1. Use OpenAI or Anthropic for now.",
                request.provider_id
            ),
        }),
    };

    match result {
        Ok(()) => {
            emit_event(&app, &request.request_id, "done", None, None)?;
            Ok(())
        }
        Err(error) => {
            let _ = emit_event(&app, &request.request_id, "error", None, Some(error.message.clone()));
            Err(error)
        }
    }
}

async fn stream_openai(
    app: &AppHandle,
    client: &reqwest::Client,
    request: &ChatRequest,
) -> Result<(), ErrorResponse> {
    let response = client
        .post(request.endpoint.clone())
        .header(CONTENT_TYPE, "application/json")
        .header(AUTHORIZATION, format!("Bearer {}", request.api_key))
        .json(&request.payload)
        .send()
        .await
        .map_err(to_error)?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_else(|_| "unknown provider error".into());
        return Err(ErrorResponse {
            message: format!("OpenAI request failed with {}: {}", status, body),
        });
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(item) = stream.next().await {
        let chunk = item.map_err(to_error)?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(index) = buffer.find('\n') {
            let line = buffer[..index].trim().to_string();
            buffer.drain(..=index);

            if line.is_empty() || !line.starts_with("data:") {
                continue;
            }

            let payload = line.trim_start_matches("data:").trim();
            if payload == "[DONE]" {
                break;
            }

            if let Some(text) = extract_openai_delta(payload)? {
                emit_event(app, &request.request_id, "chunk", Some(text), None)?;
            }
        }
    }

    Ok(())
}

async fn stream_anthropic(
    app: &AppHandle,
    client: &reqwest::Client,
    request: &ChatRequest,
) -> Result<(), ErrorResponse> {
    let response = client
        .post(request.endpoint.clone())
        .header(CONTENT_TYPE, "application/json")
        .header("x-api-key", request.api_key.clone())
        .header("anthropic-version", "2023-06-01")
        .json(&request.payload)
        .send()
        .await
        .map_err(to_error)?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_else(|_| "unknown provider error".into());
        return Err(ErrorResponse {
            message: format!("Anthropic request failed with {}: {}", status, body),
        });
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(item) = stream.next().await {
        let chunk = item.map_err(to_error)?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(index) = buffer.find('\n') {
            let line = buffer[..index].trim().to_string();
            buffer.drain(..=index);

            if line.is_empty() || !line.starts_with("data:") {
                continue;
            }

            let payload = line.trim_start_matches("data:").trim();
            if payload == "[DONE]" {
                break;
            }

            if let Some(text) = extract_anthropic_delta(payload)? {
                emit_event(app, &request.request_id, "chunk", Some(text), None)?;
            }
        }
    }

    Ok(())
}

fn extract_openai_delta(payload: &str) -> Result<Option<String>, ErrorResponse> {
    let value = serde_json::from_str::<Value>(payload).map_err(json_error)?;
    let Some(choice) = value.get("choices").and_then(|choices| choices.get(0)) else {
        return Ok(None);
    };

    let delta = choice.get("delta");
    if let Some(content) = delta.and_then(|delta| delta.get("content")) {
        if let Some(text) = content.as_str() {
            return Ok(Some(text.to_string()));
        }

        if let Some(parts) = content.as_array() {
            let collected = parts
                .iter()
                .filter_map(|part| part.get("text").and_then(|text| text.as_str()))
                .collect::<String>();
            if !collected.is_empty() {
                return Ok(Some(collected));
            }
        }
    }

    Ok(None)
}

fn extract_anthropic_delta(payload: &str) -> Result<Option<String>, ErrorResponse> {
    let value = serde_json::from_str::<Value>(payload).map_err(json_error)?;
    let event_type = value.get("type").and_then(|item| item.as_str()).unwrap_or_default();

    if event_type == "content_block_delta" {
        return Ok(value
            .get("delta")
            .and_then(|delta| delta.get("text"))
            .and_then(|text| text.as_str())
            .map(ToString::to_string));
    }

    Ok(None)
}

fn emit_event(
    app: &AppHandle,
    request_id: &str,
    kind: &str,
    chunk: Option<String>,
    message: Option<String>,
) -> Result<(), ErrorResponse> {
    app.emit(
        "chat-stream",
        StreamEvent {
            request_id: request_id.to_string(),
            kind: kind.to_string(),
            chunk,
            message,
        },
    )
    .map_err(|error| ErrorResponse {
        message: error.to_string(),
    })
}

fn json_error(error: serde_json::Error) -> ErrorResponse {
    ErrorResponse {
        message: error.to_string(),
    }
}

fn to_error(error: reqwest::Error) -> ErrorResponse {
    ErrorResponse {
        message: error.to_string(),
    }
}

fn main() {
    install_rustls_crypto_provider();
    sanitize_process_proxy_env();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![send_chat])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
