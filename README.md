\# WFSL Org Profile Guard



Deterministic drift detector for GitHub organisation profile state.



GitHub does not provide a supported API to set pinned repositories. This guard treats the org profile as a governed surface by declaring intent and detecting drift.



\## What it checks



\- Pinned repositories (names only)

\- Organisation profile README presence (`.github/profile/README.md`)



\## Evidence



Writes deterministic JSON evidence to:



\- `./evidence/org-profile-check.json`



Exit codes:



\- `0` OK

\- `1` DRIFT

\- `2` ERROR



\## Usage (PowerShell)



Set a token:



```powershell

$env:GITHUB\_TOKEN = gh auth token



