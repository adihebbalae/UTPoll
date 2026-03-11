# generate-icons.ps1
# Creates placeholder PNG icon files for the UTPoll Chrome extension.
# Uses .NET System.Drawing — available by default on Windows PowerShell 5.1.
# Run once from the UTPoll/ directory: .\generate-icons.ps1

Add-Type -AssemblyName System.Drawing

$assetsDir = Join-Path $PSScriptRoot "assets"
if (-not (Test-Path $assetsDir)) {
    New-Item -ItemType Directory -Path $assetsDir | Out-Null
}

$bgColor   = [System.Drawing.Color]::FromArgb(255, 191,  87,   0)  # UT Burnt Orange
$textColor = [System.Drawing.Color]::White

foreach ($size in @(16, 48, 128)) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode       = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint   = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    # Filled background
    $bgBrush = New-Object System.Drawing.SolidBrush($bgColor)
    $g.FillRectangle($bgBrush, 0, 0, $size, $size)

    # Centered "P" glyph
    $fontSize  = [int][Math]::Floor($size * 0.58)
    $font      = New-Object System.Drawing.Font(
        "Arial", $fontSize,
        [System.Drawing.FontStyle]::Bold,
        [System.Drawing.GraphicsUnit]::Pixel)
    $textBrush = New-Object System.Drawing.SolidBrush($textColor)
    $sf        = New-Object System.Drawing.StringFormat
    $sf.Alignment     = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
    $g.DrawString("P", $font, $textBrush, $rect, $sf)

    $outPath = Join-Path $assetsDir "icon-$size.png"
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)

    $g.Dispose()
    $bmp.Dispose()
    Write-Host "Created $outPath"
}

Write-Host "Done. Load the extension in chrome://extensions (Developer mode > Load unpacked)."
