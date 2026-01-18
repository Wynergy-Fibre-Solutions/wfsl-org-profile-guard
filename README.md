# WFSL Org Profile Guard

Execution guard that verifies organisational profile integrity before downstream workflows run.

## What it does

Validates that an organisation profile meets declared governance and integrity expectations.
Designed to fail fast and block execution when profile conditions are not met.

## How to run

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\wfsl-org-profile-guard.ps1
