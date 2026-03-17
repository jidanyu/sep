set windows-shell := ["powershell.exe", "-NoProfile", "-Command"]

default:
    just --list

dev:
    npm run dev

desktop:
    npm run tauri -- dev
