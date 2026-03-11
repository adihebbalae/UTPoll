# generate-icons.ps1
# Creates UT Instapoll icons: burnt orange background with white tower in center.
# Runs once from the UTPoll/ directory: .\generate-icons.ps1

Add-Type -AssemblyName System.Drawing

$assetsDir = Join-Path $PSScriptRoot "assets"
if (-not (Test-Path $assetsDir)) {
    New-Item -ItemType Directory -Path $assetsDir | Out-Null
}

$bgColor   = [System.Drawing.Color]::FromArgb(255, 191,  87,   0)  # UT Burnt Orange
$fgColor   = [System.Drawing.Color]::White

foreach ($size in @(16, 48, 128)) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode       = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint   = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    # Filled background
    $bgBrush = New-Object System.Drawing.SolidBrush($bgColor)
    $g.FillRectangle($bgBrush, 0, 0, $size, $size)

    # Draw a stylized UT tower (white vertical bars)
    $penWidth = [Math]::Max(1, $size / 16)
    $pen      = New-Object System.Drawing.Pen($fgColor, $penWidth)
    $fgBrush  = New-Object System.Drawing.SolidBrush($fgColor)

    # Tower dimensions (scalable)
    $cxE   = $size / 2        # center x
    $cyB   = $size * 0.75     # base y
    $cyT   = $size * 0.15     # top y
    $wBase = $size * 0.35
    $wTop  = $size * 0.12

    # Main tower shaft (trapezoid outline)
    $pts = @(
      [System.Drawing.PointF]::new($cxE - $wBase/2, $cyB),
      [System.Drawing.PointF]::new($cxE + $wBase/2, $cyB),
      [System.Drawing.PointF]::new($cxE + $wTop/2,  $cyT),
      [System.Drawing.PointF]::new($cxE - $wTop/2,  $cyT)
    )
    $g.FillPolygon($fgBrush, $pts)

    # Tower cap (small circle at top)
    $capR = $size * 0.08
    $g.FillEllipse($fgBrush, $cxE - $capR, $cyT - $capR*0.5, $capR*2, $capR)

    $outPath = Join-Path $assetsDir "icon-$size.png"
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)

    $g.Dispose()
    $bmp.Dispose()
    Write-Host "Created $outPath"
}

Write-Host "Done. Load the extension in chrome://extensions (Developer mode > Load unpacked)."
