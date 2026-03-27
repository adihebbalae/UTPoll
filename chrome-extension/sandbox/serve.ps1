# sandbox/serve.ps1
#
# Starts a local HTTP server on http://localhost:8080/ serving the sandbox/
# directory. Required so that:
#   - Chrome loads the page on an http:// origin (Service Workers need it)
#   - The extension's content scripts inject correctly (manifest match rule)
#
# Usage (run from the project root or the sandbox/ folder):
#   powershell -ExecutionPolicy Bypass -File sandbox\serve.ps1
#
# Then open http://localhost:8080/ in Chrome.

$Port = 8080
$Root = $PSScriptRoot   # directory this script lives in (sandbox/)

$MimeTypes = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'application/javascript'
  '.css'  = 'text/css'
  '.json' = 'application/json'
  '.png'  = 'image/png'
  '.ico'  = 'image/x-icon'
  '.txt'  = 'text/plain'
}

$Listener = [System.Net.HttpListener]::new()
$Listener.Prefixes.Add("http://localhost:$Port/")

try {
  $Listener.Start()
} catch {
  Write-Error "Could not start server on port $Port. Is something already using it?"
  exit 1
}

Write-Host ""
Write-Host "  UT Instapoll Alert — Sandbox Server" -ForegroundColor Yellow
Write-Host "  ─────────────────────────────────────" -ForegroundColor DarkGray
Write-Host "  Listening on: " -NoNewline
Write-Host "http://localhost:$Port/" -ForegroundColor Cyan
Write-Host "  Serving from: $Root" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Steps:" -ForegroundColor White
Write-Host "   1. Reload the extension at chrome://extensions" -ForegroundColor Gray
Write-Host "   2. Open http://localhost:$Port/ in Chrome" -ForegroundColor Gray
Write-Host "   3. Click 'Fire Live Poll' in the sandbox panel" -ForegroundColor Gray
Write-Host ""
Write-Host "  Press Ctrl+C to stop." -ForegroundColor DarkGray
Write-Host ""

while ($Listener.IsListening) {
  $Context = $null
  try {
    $Context = $Listener.GetContext()
  } catch [System.Net.HttpListenerException] {
    break
  }

  $Req  = $Context.Request
  $Resp = $Context.Response

  # Strip leading slash; default to index.html
  $RelPath = $Req.Url.LocalPath.TrimStart('/')
  if ($RelPath -eq '') { $RelPath = 'index.html' }

  $FilePath = Join-Path $Root $RelPath

  if (Test-Path $FilePath -PathType Leaf) {
    $Ext     = [System.IO.Path]::GetExtension($FilePath).ToLower()
    $Mime    = if ($MimeTypes.ContainsKey($Ext)) { $MimeTypes[$Ext] } else { 'application/octet-stream' }
    $Bytes   = [System.IO.File]::ReadAllBytes($FilePath)
    $Resp.StatusCode    = 200
    $Resp.ContentType   = $Mime
    $Resp.ContentLength64 = $Bytes.Length
    $Resp.OutputStream.Write($Bytes, 0, $Bytes.Length)
    Write-Host "  200 GET /$RelPath" -ForegroundColor DarkGreen
  } else {
    $Body = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: /$RelPath")
    $Resp.StatusCode    = 404
    $Resp.ContentType   = 'text/plain'
    $Resp.ContentLength64 = $Body.Length
    $Resp.OutputStream.Write($Body, 0, $Body.Length)
    Write-Host "  404 GET /$RelPath" -ForegroundColor DarkRed
  }

  $Resp.Close()
}

$Listener.Stop()
Write-Host "`nServer stopped."
