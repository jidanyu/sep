set windows-shell := ["powershell.exe", "-NoProfile", "-Command"]

default:
    just --list

dev:
    if (-not (Test-NetConnection -ComputerName 127.0.0.1 -Port 4097 -InformationLevel Quiet -WarningAction SilentlyContinue)) { Start-Process powershell.exe -ArgumentList '-NoProfile', '-Command', 'cargo run --manifest-path src-tauri/Cargo.toml --bin sep-tool-server' -WorkingDirectory '{{invocation_directory()}}' }
    $ready = $false; $deadline = (Get-Date).AddSeconds(60); while ((Get-Date) -lt $deadline) { try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4097/health' -Method Get -TimeoutSec 2; if ($health.ok) { $ready = $true; break } } catch {}; Start-Sleep -Milliseconds 500 }; if (-not $ready) { throw 'sep-tool-server did not become ready on http://127.0.0.1:4097/health within 60 seconds.' }
    npm run dev

desktop:
    if (-not (Test-NetConnection -ComputerName 127.0.0.1 -Port 4097 -InformationLevel Quiet -WarningAction SilentlyContinue)) { Start-Process powershell.exe -ArgumentList '-NoProfile', '-Command', 'cargo run --manifest-path src-tauri/Cargo.toml --bin sep-tool-server' -WorkingDirectory '{{invocation_directory()}}' }
    $ready = $false; $deadline = (Get-Date).AddSeconds(60); while ((Get-Date) -lt $deadline) { try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4097/health' -Method Get -TimeoutSec 2; if ($health.ok) { $ready = $true; break } } catch {}; Start-Sleep -Milliseconds 500 }; if (-not $ready) { throw 'sep-tool-server did not become ready on http://127.0.0.1:4097/health within 60 seconds.' }
    npm run tauri -- dev

tool-server:
    cargo run --manifest-path src-tauri/Cargo.toml --bin sep-tool-server
