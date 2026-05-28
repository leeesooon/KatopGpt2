$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outputDir = Join-Path $root 'src\assets\avatars'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

function ColorFromHex([string]$hex, [int]$alpha = 255) {
  $value = $hex.TrimStart('#')
  return [System.Drawing.Color]::FromArgb(
    $alpha,
    [Convert]::ToInt32($value.Substring(0, 2), 16),
    [Convert]::ToInt32($value.Substring(2, 2), 16),
    [Convert]::ToInt32($value.Substring(4, 2), 16)
  )
}

function NewRoundRectPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function AddBezierFromCurrent(
  $path,
  [float]$control1X,
  [float]$control1Y,
  [float]$control2X,
  [float]$control2Y,
  [float]$endX,
  [float]$endY
) {
  $points = $path.PathPoints
  if ($points.Length -eq 0) {
    throw 'Cannot add a relative bezier before the path has a start point.'
  }
  $start = $points[$points.Length - 1]
  $path.AddBezier(
    $start.X,
    $start.Y,
    $control1X,
    $control1Y,
    $control2X,
    $control2Y,
    $endX,
    $endY
  )
}

function FillPathGradient($graphics, $path, $centerColor, $edgeColor, [float]$centerX, [float]$centerY) {
  $brush = [System.Drawing.Drawing2D.PathGradientBrush]::new($path)
  $brush.CenterColor = $centerColor
  $brush.SurroundColors = @($edgeColor)
  $brush.CenterPoint = [System.Drawing.PointF]::new($centerX, $centerY)
  $graphics.FillPath($brush, $path)
  $brush.Dispose()
}

function FillEllipseGradient($graphics, [float]$x, [float]$y, [float]$w, [float]$h, $centerColor, $edgeColor) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $path.AddEllipse($x, $y, $w, $h)
  FillPathGradient $graphics $path $centerColor $edgeColor ($x + $w * 0.38) ($y + $h * 0.25)
  $path.Dispose()
}

function FillLinearPath($graphics, $path, [string]$fromHex, [string]$toHex, [float]$angle = 90) {
  $bounds = $path.GetBounds()
  $brush = [System.Drawing.Drawing2D.LinearGradientBrush]::new($bounds, (ColorFromHex $fromHex), (ColorFromHex $toHex), $angle)
  $graphics.FillPath($brush, $path)
  $brush.Dispose()
}

function DrawSoftEllipse($graphics, [float]$x, [float]$y, [float]$w, [float]$h, [string]$hex, [int]$alpha) {
  $brush = [System.Drawing.SolidBrush]::new((ColorFromHex $hex $alpha))
  $graphics.FillEllipse($brush, $x, $y, $w, $h)
  $brush.Dispose()
}

function DrawHair($graphics, $avatar, $palette) {
  $hair = $palette.hair
  $hairLight = $palette.hairLight
  $dark = $palette.hairDark

  if ($avatar.special -eq 'astronaut') {
    $helmet = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $helmet.AddEllipse(104, 70, 304, 304)
    FillPathGradient $graphics $helmet (ColorFromHex '#ffffff') (ColorFromHex '#cbd5e1') 210 122
    $visor = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $visor.AddEllipse(143, 116, 226, 190)
    FillPathGradient $graphics $visor (ColorFromHex '#bae6fd' 230) (ColorFromHex '#0f172a' 235) 210 140
    $graphics.FillPath([System.Drawing.SolidBrush]::new((ColorFromHex '#ffd9b8')), $visor)
    $visor.Dispose()
    $helmet.Dispose()
    return
  }

  if ($avatar.special -eq 'robot') {
    return
  }

  if ($avatar.special -eq 'fox') {
    $earBrush = [System.Drawing.SolidBrush]::new((ColorFromHex $hair))
    $innerBrush = [System.Drawing.SolidBrush]::new((ColorFromHex '#ffd2aa'))
    $leftEar = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $leftEar.AddPolygon([System.Drawing.PointF[]]@(
      [System.Drawing.PointF]::new(138, 92),
      [System.Drawing.PointF]::new(188, 150),
      [System.Drawing.PointF]::new(112, 174)
    ))
    $rightEar = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $rightEar.AddPolygon([System.Drawing.PointF[]]@(
      [System.Drawing.PointF]::new(374, 92),
      [System.Drawing.PointF]::new(324, 150),
      [System.Drawing.PointF]::new(400, 174)
    ))
    $graphics.FillPath($earBrush, $leftEar)
    $graphics.FillPath($earBrush, $rightEar)
    $graphics.FillPolygon($innerBrush, [System.Drawing.PointF[]]@(
      [System.Drawing.PointF]::new(146, 118),
      [System.Drawing.PointF]::new(174, 152),
      [System.Drawing.PointF]::new(130, 164)
    ))
    $graphics.FillPolygon($innerBrush, [System.Drawing.PointF[]]@(
      [System.Drawing.PointF]::new(366, 118),
      [System.Drawing.PointF]::new(338, 152),
      [System.Drawing.PointF]::new(382, 164)
    ))
    $leftEar.Dispose()
    $rightEar.Dispose()
    $earBrush.Dispose()
    $innerBrush.Dispose()
  }

  if ($avatar.hair -eq 'cap' -or $avatar.special -eq 'detective') {
    $capPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $capPath.AddBezier(132, 154, 154, 82, 342, 72, 376, 154)
    $capPath.AddLine(376, 185, 130, 185)
    $capPath.CloseFigure()
    FillLinearPath $graphics $capPath $palette.shirtLight $palette.shirtDark 90
    $brim = NewRoundRectPath 118 174 276 42 20
    FillLinearPath $graphics $brim $palette.shirt $palette.shirtDark 0
    $capPath.Dispose()
    $brim.Dispose()
    return
  }

  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  switch ($avatar.hair) {
    'waves' {
      $path.AddBezier(120, 218, 110, 92, 222, 44, 315, 82)
      $path.AddBezier(390, 112, 404, 230, 366, 324, 324, 330)
      AddBezierFromCurrent $path 304 248 308 182 260 162
      AddBezierFromCurrent $path 216 206 176 198 154 286
      AddBezierFromCurrent $path 128 274 116 244 120 218
      $path.CloseFigure()
    }
    'short' {
      $path.AddBezier(126, 180, 154, 74, 286, 52, 364, 134)
      AddBezierFromCurrent $path 332 126 300 130 260 154
      AddBezierFromCurrent $path 222 176 178 162 132 204
      AddBezierFromCurrent $path 124 196 122 188 126 180
      $path.CloseFigure()
    }
    'side' {
      $path.AddBezier(122, 190, 148, 70, 300, 46, 374, 138)
      AddBezierFromCurrent $path 324 122 246 132 176 190
      AddBezierFromCurrent $path 158 206 144 224 128 246
      AddBezierFromCurrent $path 118 226 116 206 122 190
      $path.CloseFigure()
    }
    default {
      $path.AddBezier(126, 186, 138, 78, 262, 44, 356, 124)
      AddBezierFromCurrent $path 382 158 376 198 354 222
      AddBezierFromCurrent $path 300 168 218 152 134 216
      AddBezierFromCurrent $path 122 206 120 196 126 186
      $path.CloseFigure()
    }
  }

  FillLinearPath $graphics $path $hairLight $dark 70
  $shine = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $shine.AddBezier(170, 122, 210, 76, 290, 80, 332, 122)
  $shine.AddBezier(292, 114, 238, 128, 182, 160, 154, 190)
  AddBezierFromCurrent $shine 154 164 158 140 170 122
  $shine.CloseFigure()
  $graphics.FillPath([System.Drawing.SolidBrush]::new((ColorFromHex $hairLight 90)), $shine)
  $path.Dispose()
  $shine.Dispose()
}

function DrawFace($graphics, $avatar, $palette) {
  if ($avatar.special -eq 'robot') {
    $head = NewRoundRectPath 138 92 236 236 64
    FillPathGradient $graphics $head (ColorFromHex '#f8fafc') (ColorFromHex '#94a3b8') 212 132
    $outline = [System.Drawing.Pen]::new((ColorFromHex '#334155' 120), 6)
    $graphics.DrawPath($outline, $head)
    $outline.Dispose()
    $head.Dispose()
  } else {
    DrawSoftEllipse $graphics 122 206 50 62 $palette.skinShade 255
    DrawSoftEllipse $graphics 340 206 50 62 $palette.skinShade 255
    FillEllipseGradient $graphics 136 92 240 254 (ColorFromHex $palette.skin) (ColorFromHex $palette.skinShade)
    DrawSoftEllipse $graphics 176 132 80 48 '#ffffff' 80
  }

  if ($avatar.glasses) {
    $lensBrush = [System.Drawing.SolidBrush]::new((ColorFromHex '#bff5ff' 165))
    $framePen = [System.Drawing.Pen]::new((ColorFromHex '#263449'), 9)
    $bridgePen = [System.Drawing.Pen]::new((ColorFromHex '#263449'), 7)
    $left = NewRoundRectPath 170 192 74 64 18
    $right = NewRoundRectPath 268 192 74 64 18
    $graphics.FillPath($lensBrush, $left)
    $graphics.FillPath($lensBrush, $right)
    $graphics.DrawPath($framePen, $left)
    $graphics.DrawPath($framePen, $right)
    $graphics.DrawLine($bridgePen, 244, 222, 268, 222)
    $left.Dispose()
    $right.Dispose()
    $lensBrush.Dispose()
    $framePen.Dispose()
    $bridgePen.Dispose()
  } else {
    DrawSoftEllipse $graphics 192 211 21 28 '#1f2937' 255
    DrawSoftEllipse $graphics 299 211 21 28 '#1f2937' 255
    DrawSoftEllipse $graphics 198 216 7 8 '#ffffff' 190
    DrawSoftEllipse $graphics 305 216 7 8 '#ffffff' 190
  }

  DrawSoftEllipse $graphics 168 254 38 26 '#fb7185' 120
  DrawSoftEllipse $graphics 306 254 38 26 '#fb7185' 120

  if ($avatar.beard) {
    $beardPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $beardPath.AddBezier(172, 260, 192, 350, 320, 350, 340, 260)
    AddBezierFromCurrent $beardPath 314 314 198 314 172 260
    $beardPath.CloseFigure()
    FillLinearPath $graphics $beardPath $palette.hair $palette.hairDark 90
    $beardPath.Dispose()
  }

  if ($avatar.mustache) {
    $mustache = [System.Drawing.SolidBrush]::new((ColorFromHex $palette.hairDark))
    $graphics.FillEllipse($mustache, 212, 268, 48, 22)
    $graphics.FillEllipse($mustache, 252, 268, 48, 22)
    $mustache.Dispose()
  }

  $mouthPen = [System.Drawing.Pen]::new((ColorFromHex '#7f1d1d'), 7)
  $graphics.DrawArc($mouthPen, 218, 276, 76, 48, 20, 140)
  $mouthPen.Dispose()

  if ($avatar.headset) {
    $pen = [System.Drawing.Pen]::new((ColorFromHex '#1f2937'), 8)
    $graphics.DrawArc($pen, 142, 120, 228, 210, 195, 150)
    $graphics.DrawLine($pen, 144, 226, 144, 268)
    $graphics.DrawLine($pen, 368, 226, 368, 268)
    $graphics.DrawArc($pen, 276, 270, 82, 52, 0, 65)
    $graphics.FillEllipse([System.Drawing.SolidBrush]::new((ColorFromHex '#1f2937')), 306, 304, 18, 18)
    $pen.Dispose()
  }
}

function DrawBody($graphics, $avatar, $palette) {
  $shadow = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(70, 2, 6, 23))
  $graphics.FillEllipse($shadow, 122, 448, 268, 32)
  $shadow.Dispose()

  if ($avatar.special -eq 'astronaut') {
    $body = NewRoundRectPath 150 328 212 152 42
    FillLinearPath $graphics $body '#ffffff' '#cbd5e1' 90
    $graphics.DrawPath([System.Drawing.Pen]::new((ColorFromHex '#94a3b8' 160), 5), $body)
    $body.Dispose()
    return
  }

  DrawSoftEllipse $graphics 220 318 72 98 $palette.skinShade 255
  $bodyPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $bodyPath.AddBezier(122, 476, 132, 370, 190, 330, 256, 330)
  AddBezierFromCurrent $bodyPath 322 330 380 370 390 476
  $bodyPath.CloseFigure()
  FillLinearPath $graphics $bodyPath $palette.shirtLight $palette.shirtDark 90
  $graphics.FillPolygon([System.Drawing.SolidBrush]::new((ColorFromHex '#fff8ef')), [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new(210, 342),
    [System.Drawing.PointF]::new(256, 392),
    [System.Drawing.PointF]::new(302, 342),
    [System.Drawing.PointF]::new(314, 472),
    [System.Drawing.PointF]::new(198, 472)
  ))
  $tieBrush = [System.Drawing.SolidBrush]::new((ColorFromHex $palette.shirtDark))
  $graphics.FillPolygon($tieBrush, [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new(244, 384),
    [System.Drawing.PointF]::new(268, 384),
    [System.Drawing.PointF]::new(278, 470),
    [System.Drawing.PointF]::new(234, 470)
  ))
  $tieBrush.Dispose()
  $bodyPath.Dispose()
}

function DrawAvatar($avatar, [string]$filePath) {
  $palettes = @{
    amber = @{ hair = '#b45309'; hairLight = '#f59e0b'; hairDark = '#7c2d12'; skin = '#ffd7ad'; skinShade = '#e99a61'; shirt = '#f59e0b'; shirtLight = '#fbbf24'; shirtDark = '#b45309' }
    sky = @{ hair = '#7c3f1d'; hairLight = '#c76c36'; hairDark = '#3f2417'; skin = '#ffd8b5'; skinShade = '#e89b66'; shirt = '#38bdf8'; shirtLight = '#7dd3fc'; shirtDark = '#0369a1' }
    emerald = @{ hair = '#7c3f1d'; hairLight = '#c76c36'; hairDark = '#3f2417'; skin = '#ffd8b5'; skinShade = '#e89b66'; shirt = '#34d399'; shirtLight = '#86efac'; shirtDark = '#047857' }
    rose = @{ hair = '#9f3d2c'; hairLight = '#fb7185'; hairDark = '#5f1f1b'; skin = '#ffd8b5'; skinShade = '#e89b66'; shirt = '#fb7185'; shirtLight = '#fda4af'; shirtDark = '#be123c' }
    cyan = @{ hair = '#7c3f1d'; hairLight = '#c76c36'; hairDark = '#3f2417'; skin = '#ffd8b5'; skinShade = '#e89b66'; shirt = '#22d3ee'; shirtLight = '#67e8f9'; shirtDark = '#0e7490' }
    teal = @{ hair = '#7c3f1d'; hairLight = '#c76c36'; hairDark = '#3f2417'; skin = '#ffd8b5'; skinShade = '#e89b66'; shirt = '#2dd4bf'; shirtLight = '#5eead4'; shirtDark = '#0f766e' }
    violet = @{ hair = '#6b3a1f'; hairLight = '#a16207'; hairDark = '#3f2417'; skin = '#ffd8b5'; skinShade = '#e89b66'; shirt = '#a78bfa'; shirtLight = '#c4b5fd'; shirtDark = '#6d28d9' }
    orange = @{ hair = '#df5b1f'; hairLight = '#ff9b45'; hairDark = '#7c2d12'; skin = '#ffd2aa'; skinShade = '#e98f5d'; shirt = '#fb923c'; shirtLight = '#fdba74'; shirtDark = '#c2410c' }
    slate = @{ hair = '#1f2937'; hairLight = '#64748b'; hairDark = '#0f172a'; skin = '#ffd8b5'; skinShade = '#e89b66'; shirt = '#64748b'; shirtLight = '#cbd5e1'; shirtDark = '#334155' }
  }
  $palette = $palettes[$avatar.accent]

  $bmp = [System.Drawing.Bitmap]::new(512, 512, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bmp)
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

  DrawBody $graphics $avatar $palette
  DrawFace $graphics $avatar $palette
  DrawHair $graphics $avatar $palette

  if ($avatar.special -eq 'astronaut') {
    $helmetPen = [System.Drawing.Pen]::new((ColorFromHex '#e2e8f0'), 14)
    $graphics.DrawEllipse($helmetPen, 104, 70, 304, 304)
    $helmetPen.Dispose()
  }

  $bmp.Save($filePath, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bmp.Dispose()
}

$avatars = @(
  @{ id = 'assistant-general'; accent = 'amber'; hair = 'round' },
  @{ id = 'assistant-engineer'; accent = 'sky'; hair = 'side'; glasses = $true; headset = $true },
  @{ id = 'assistant-writer'; accent = 'rose'; hair = 'waves' },
  @{ id = 'assistant-tutor'; accent = 'emerald'; hair = 'round'; glasses = $true },
  @{ id = 'assistant-pm'; accent = 'orange'; hair = 'side'; glasses = $true },
  @{ id = 'assistant-data'; accent = 'cyan'; hair = 'short'; glasses = $true },
  @{ id = 'assistant-translator'; accent = 'teal'; hair = 'waves' },
  @{ id = 'assistant-researcher'; accent = 'violet'; hair = 'cap'; glasses = $true },
  @{ id = 'avatar-engineer'; accent = 'sky'; hair = 'short'; glasses = $true },
  @{ id = 'avatar-writer'; accent = 'rose'; hair = 'waves' },
  @{ id = 'avatar-teacher'; accent = 'emerald'; hair = 'round'; glasses = $true },
  @{ id = 'avatar-researcher'; accent = 'violet'; hair = 'cap' },
  @{ id = 'avatar-analyst'; accent = 'cyan'; hair = 'side'; glasses = $true },
  @{ id = 'avatar-translator'; accent = 'teal'; hair = 'short' },
  @{ id = 'avatar-product'; accent = 'orange'; hair = 'side'; glasses = $true },
  @{ id = 'avatar-operations'; accent = 'amber'; hair = 'round'; mustache = $true },
  @{ id = 'avatar-designer'; accent = 'rose'; hair = 'waves'; glasses = $true },
  @{ id = 'avatar-lawyer'; accent = 'slate'; hair = 'side'; glasses = $true },
  @{ id = 'avatar-doctor'; accent = 'emerald'; hair = 'short' },
  @{ id = 'avatar-finance'; accent = 'amber'; hair = 'round'; glasses = $true; beard = $true },
  @{ id = 'avatar-support'; accent = 'teal'; hair = 'short'; headset = $true },
  @{ id = 'avatar-sales'; accent = 'orange'; hair = 'side'; mustache = $true },
  @{ id = 'avatar-marketing'; accent = 'rose'; hair = 'waves' },
  @{ id = 'avatar-hr'; accent = 'sky'; hair = 'round' },
  @{ id = 'avatar-project-manager'; accent = 'violet'; hair = 'cap'; glasses = $true },
  @{ id = 'avatar-creative'; accent = 'amber'; hair = 'waves' },
  @{ id = 'avatar-reader'; accent = 'emerald'; hair = 'short'; glasses = $true },
  @{ id = 'avatar-robot'; accent = 'slate'; hair = 'none'; special = 'robot' },
  @{ id = 'avatar-owl'; accent = 'amber'; hair = 'round'; glasses = $true },
  @{ id = 'avatar-fox'; accent = 'orange'; hair = 'side'; special = 'fox' },
  @{ id = 'avatar-astronaut'; accent = 'sky'; hair = 'none'; special = 'astronaut' },
  @{ id = 'avatar-detective'; accent = 'slate'; hair = 'cap'; glasses = $true; mustache = $true; special = 'detective' }
)

foreach ($avatar in $avatars) {
  DrawAvatar $avatar (Join-Path $outputDir "$($avatar.id).png")
}

Write-Host "Generated $($avatars.Count) avatars in $outputDir"
