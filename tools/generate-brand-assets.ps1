param(
    [string]$AssetsDirectory = (Join-Path $PSScriptRoot '..\assets')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$sourcePath = Join-Path $AssetsDirectory 'linkora-logo.png'
if (-not (Test-Path -LiteralPath $sourcePath)) {
    throw "Missing official logo: $sourcePath"
}

function Save-SquarePng {
    param(
        [System.Drawing.Image]$Source,
        [int]$Size,
        [string]$Path
    )

    $output = [System.Drawing.Bitmap]::new($Size, $Size)
    $graphics = [System.Drawing.Graphics]::FromImage($output)
    try {
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.DrawImage(
            $Source,
            [System.Drawing.Rectangle]::new(0, 0, $Size, $Size),
            [System.Drawing.Rectangle]::new(270, 65, 670, 670),
            [System.Drawing.GraphicsUnit]::Pixel
        )
        $output.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $graphics.Dispose()
        $output.Dispose()
    }
}

$source = [System.Drawing.Image]::FromFile($sourcePath)
try {
    if ($source.Width -ne 1254 -or $source.Height -ne 1254) {
        throw "Official logo dimensions changed; review the icon crop before regenerating assets."
    }

    $icons = @(
        @{ Name = 'linkora-mark.png'; Size = 128 },
        @{ Name = 'favicon-16x16.png'; Size = 16 },
        @{ Name = 'favicon-32x32.png'; Size = 32 },
        @{ Name = 'apple-touch-icon.png'; Size = 180 },
        @{ Name = 'android-chrome-192x192.png'; Size = 192 },
        @{ Name = 'android-chrome-512x512.png'; Size = 512 }
    )
    foreach ($icon in $icons) {
        Save-SquarePng -Source $source -Size $icon.Size -Path (Join-Path $AssetsDirectory $icon.Name)
    }

    # ICO entries contain PNG data, which modern browsers and Windows support.
    $sizes = @(16, 32, 48)
    $pngData = foreach ($size in $sizes) {
        $temporaryPath = Join-Path $AssetsDirectory "favicon-$size-temp.png"
        try {
            Save-SquarePng -Source $source -Size $size -Path $temporaryPath
            [System.IO.File]::ReadAllBytes($temporaryPath)
        }
        finally {
            Remove-Item -LiteralPath $temporaryPath -ErrorAction SilentlyContinue
        }
    }
    $icoPath = Join-Path $AssetsDirectory 'favicon.ico'
    $stream = [System.IO.File]::Create($icoPath)
    $writer = [System.IO.BinaryWriter]::new($stream)
    try {
        $writer.Write([uint16]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]$sizes.Count)
        $offset = 6 + 16 * $sizes.Count
        for ($index = 0; $index -lt $sizes.Count; $index++) {
            $writer.Write([byte]$sizes[$index])
            $writer.Write([byte]$sizes[$index])
            $writer.Write([byte]0)
            $writer.Write([byte]0)
            $writer.Write([uint16]1)
            $writer.Write([uint16]32)
            $writer.Write([uint32]$pngData[$index].Length)
            $writer.Write([uint32]$offset)
            $offset += $pngData[$index].Length
        }
        foreach ($bytes in $pngData) { $writer.Write([byte[]]$bytes) }
    }
    finally {
        $writer.Dispose()
        $stream.Dispose()
    }
}
finally {
    $source.Dispose()
}
