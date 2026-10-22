# Export LEN schemy (bez dat) produkcnej Supabase DB do supabase/prod_schema_dump.sql
# (subor je v .gitignore). Iba citanie: ziadne --data-only, link ani db push.
# Heslo sa nikam nevypisuje ani neuklada, na konci sa premenne vymazu.
# Spustenie z korena repozitara:  powershell -ExecutionPolicy Bypass -File scripts\dump-prod-schema.ps1

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$poolerHost = (Read-Host "Session pooler host (napr. aws-0-eu-central-1.pooler.supabase.com)").Trim()
if (-not $poolerHost) { throw "Chyba adresa hostitela." }

if ($PSVersionTable.PSVersion.Major -ge 7) {
  $plain = Read-Host "Heslo k produkcnej DB" -MaskInput
} else {
  $secure = Read-Host "Heslo k produkcnej DB" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

try {
  $encoded = [uri]::EscapeDataString($plain)
  $dbUrl = "postgresql://postgres.zvvlxrfghkizflfbqfrk:$encoded@${poolerHost}:5432/postgres"
  npx supabase db dump --db-url $dbUrl --schema public,storage -f supabase/prod_schema_dump.sql
  if ($LASTEXITCODE -ne 0) { throw "supabase db dump skoncil s chybou (kod $LASTEXITCODE)." }
  Write-Host "Hotovo: supabase/prod_schema_dump.sql"
} finally {
  Remove-Variable -Name plain, encoded, dbUrl, secure, bstr -ErrorAction SilentlyContinue
  [GC]::Collect()
}
