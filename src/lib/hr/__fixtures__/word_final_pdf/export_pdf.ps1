# Export .docx -> PDF skutocnym Wordom (ako HR: Soubor -> Ulozit jako -> PDF).
# Pouzitie: powershell -ExecutionPolicy Bypass -File export_pdf.ps1 <priecinok>
param([string]$dir)
$w = New-Object -ComObject Word.Application
$w.Visible = $false
try {
  Get-ChildItem -Path $dir -Filter *.docx | ForEach-Object {
    $d = $w.Documents.Open($_.FullName, $false, $true)
    $pdf = [IO.Path]::ChangeExtension($_.FullName, ".pdf")
    $d.ExportAsFixedFormat($pdf, 17)
    $d.Close($false)
    "exported $($_.Name)"
  }
} finally { $w.Quit() }
