@echo off
setlocal
set "KIDDAI_INSTALLER=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand CgAkAHIAYQB3ACAAPQAgAEcAZQB0AC0AQwBvAG4AdABlAG4AdAAgAC0ATABpAHQAZQByAGEAbABQAGEAdABoACAAJABlAG4AdgA6AEsASQBEAEQAQQBJAF8ASQBOAFMAVABBAEwATABFAFIAIAAtAFIAYQB3AAoAJABtAGEAcgBrAGUAcgAgAD0AIAAiACMAIwAjACAASABFAEwAUABFAFIAIgAKACQAaQBuAGQAZQB4ACAAPQAgACQAcgBhAHcALgBJAG4AZABlAHgATwBmACgAJABtAGEAcgBrAGUAcgApAAoAaQBmACAAKAAkAGkAbgBkAGUAeAAgAC0AbAB0ACAAMAApACAAewAgAHQAaAByAG8AdwAgACIASABlAGwAcABlAHIAIABwAGEAeQBsAG8AYQBkACAAbQBpAHMAcwBpAG4AZwAuACIAIAB9AAoAJABzAGMAcgBpAHAAdAAgAD0AIAAkAHIAYQB3AC4AUwB1AGIAcwB0AHIAaQBuAGcAKAAkAGkAbgBkAGUAeAAgACsAIAAkAG0AYQByAGsAZQByAC4ATABlAG4AZwB0AGgAKQAuAFQAcgBpAG0AUwB0AGEAcgB0ACgAIgBgAHIAIgAsACIAYABuACIAKQAKACQAZABlAHMAdAAgAD0AIABKAG8AaQBuAC0AUABhAHQAaAAgACQAZQBuAHYAOgBMAE8AQwBBAEwAQQBQAFAARABBAFQAQQAgACIASwBpAGQAZABhAGkAXABTAGsAZQB0AGMAaABVAHAAIABIAGUAbABwAGUAcgAiAAoATgBlAHcALQBJAHQAZQBtACAALQBJAHQAZQBtAFQAeQBwAGUAIABEAGkAcgBlAGMAdABvAHIAeQAgAC0ARgBvAHIAYwBlACAALQBQAGEAdABoACAAJABkAGUAcwB0ACAAfAAgAE8AdQB0AC0ATgB1AGwAbAAKACQAaABlAGwAcABlAHIAIAA9ACAASgBvAGkAbgAtAFAAYQB0AGgAIAAkAGQAZQBzAHQAIAAiAHMAawBlAHQAYwBoAHUAcABfAGgAZQBsAHAAZQByAC4AcABzADEAIgAKAFMAZQB0AC0AQwBvAG4AdABlAG4AdAAgAC0ATABpAHQAZQByAGEAbABQAGEAdABoACAAJABoAGUAbABwAGUAcgAgAC0AVgBhAGwAdQBlACAAJABzAGMAcgBpAHAAdAAgAC0ARQBuAGMAbwBkAGkAbgBnACAAVQBUAEYAOAAKACQAcwB0AGEAcgB0AHUAcAAgAD0AIABbAEUAbgB2AGkAcgBvAG4AbQBlAG4AdABdADoAOgBHAGUAdABGAG8AbABkAGUAcgBQAGEAdABoACgAIgBTAHQAYQByAHQAdQBwACIAKQAKACQAbABuAGsAIAA9ACAASgBvAGkAbgAtAFAAYQB0AGgAIAAkAHMAdABhAHIAdAB1AHAAIAAiAEsAaQBkAGQAYQBpACAAUwBrAGUAdABjAGgAVQBwACAASABlAGwAcABlAHIALgBsAG4AawAiAAoAJABzAGgAZQBsAGwAIAA9ACAATgBlAHcALQBPAGIAagBlAGMAdAAgAC0AQwBvAG0ATwBiAGoAZQBjAHQAIABXAFMAYwByAGkAcAB0AC4AUwBoAGUAbABsAAoAJABzAGMAIAA9ACAAJABzAGgAZQBsAGwALgBDAHIAZQBhAHQAZQBTAGgAbwByAHQAYwB1AHQAKAAkAGwAbgBrACkACgAkAHMAYwAuAFQAYQByAGcAZQB0AFAAYQB0AGgAIAA9ACAAIgBwAG8AdwBlAHIAcwBoAGUAbABsAC4AZQB4AGUAIgAKACQAcwBjAC4AQQByAGcAdQBtAGUAbgB0AHMAIAA9ACAAIgAtAFcAaQBuAGQAbwB3AFMAdAB5AGwAZQAgAEgAaQBkAGQAZQBuACAALQBOAG8AUAByAG8AZgBpAGwAZQAgAC0ARQB4AGUAYwB1AHQAaQBvAG4AUABvAGwAaQBjAHkAIABCAHkAcABhAHMAcwAgAC0ARgBpAGwAZQAgAGAAIgAkAGgAZQBsAHAAZQByAGAAIgAiAAoAJABzAGMALgBXAG8AcgBrAGkAbgBnAEQAaQByAGUAYwB0AG8AcgB5ACAAPQAgACQAZABlAHMAdAAKACQAcwBjAC4AUwBhAHYAZQAoACkACgBTAHQAYQByAHQALQBQAHIAbwBjAGUAcwBzACAALQBGAGkAbABlAFAAYQB0AGgAIABwAG8AdwBlAHIAcwBoAGUAbABsAC4AZQB4AGUAIAAtAEEAcgBnAHUAbQBlAG4AdABMAGkAcwB0ACAAIgAtAFcAaQBuAGQAbwB3AFMAdAB5AGwAZQAiACwAIgBIAGkAZABkAGUAbgAiACwAIgAtAE4AbwBQAHIAbwBmAGkAbABlACIALAAiAC0ARQB4AGUAYwB1AHQAaQBvAG4AUABvAGwAaQBjAHkAIgAsACIAQgB5AHAAYQBzAHMAIgAsACIALQBGAGkAbABlACIALAAkAGgAZQBsAHAAZQByAAoAQQBkAGQALQBUAHkAcABlACAALQBBAHMAcwBlAG0AYgBsAHkATgBhAG0AZQAgAFMAeQBzAHQAZQBtAC4AVwBpAG4AZABvAHcAcwAuAEYAbwByAG0AcwAKAFsAUwB5AHMAdABlAG0ALgBXAGkAbgBkAG8AdwBzAC4ARgBvAHIAbQBzAC4ATQBlAHMAcwBhAGcAZQBCAG8AeABdADoAOgBTAGgAbwB3ACgAIgBUAGgAZQAgAFMAawBlAHQAYwBoAFUAcAAgAGgAZQBsAHAAZQByACAAaQBzACAAaQBuAHMAdABhAGwAbABlAGQAIABhAG4AZAAgAHIAdQBuAG4AaQBuAGcALgAgAEkAdAAgAHcAaQBsAGwAIABzAHQAYQByAHQAIABhAGcAYQBpAG4AIAB3AGgAZQBuACAAeQBvAHUAIABsAG8AZwAgAGkAbgAuACAATwBwAGUAbgAgAGEAIABjAHUAcwB0AG8AbQBlAHIAIABmAG8AbABkAGUAcgAsACAAdABoAGUAbgAgAHUAcwBlACAAdABoAGUAIABzAG0AYQBsAGwAIABTAGsAZQB0AGMAaABVAHAAIABpAGMAbwBuAC4AIgAsACIASwBpAGQAZABhAGkAIgApAAoA
exit /b 0
### HELPER
# Kiddai SketchUp helper for Windows. Started by the installer.
$HostAddress = "127.0.0.1"
$Port = 17341
$MaxBytes = 800MB
$AllowedOrigins = @(
  "https://kiddai.netlify.app",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174"
)

function Get-SaveDir {
  $folder = Join-Path $env:USERPROFILE "Kiddai\SketchUp"
  New-Item -ItemType Directory -Force -Path $folder | Out-Null
  return $folder
}

function Get-SafeFileName([string]$Name) {
  $cleaned = [IO.Path]::GetFileName(($Name -replace "\\", "/").Trim())
  $cleaned = [regex]::Replace($cleaned, '[<>:"|?*]', "_")
  if (-not $cleaned.ToLower().EndsWith(".skp")) {
    if (-not $cleaned) { $cleaned = "model" }
    $cleaned = "$cleaned.skp"
  }
  if ($cleaned.Length -gt 180) { $cleaned = $cleaned.Substring(0, 180) }
  return $cleaned
}

function Find-SketchUp {
  $roots = @($env:ProgramFiles, ${env:ProgramFiles(x86)}) | Where-Object { $_ }
  $found = @()
  foreach ($root in $roots) {
    $base = Join-Path $root "SketchUp"
    if (Test-Path $base) {
      $found += Get-ChildItem -Path $base -Filter "SketchUp.exe" -Recurse -ErrorAction SilentlyContinue
    }
  }
  return $found | Sort-Object FullName -Descending | Select-Object -First 1
}

function Open-Model([string]$Path) {
  $app = Find-SketchUp
  if ($app) {
    Start-Process -FilePath $app.FullName -ArgumentList @($Path)
    return $app.Directory.Name
  }
  Start-Process -FilePath $Path
  return "the default app"
}

function Save-DriveFile([string]$FileId, [string]$AccessToken, [string]$Destination) {
  $url = "https://www.googleapis.com/drive/v3/files/$([uri]::EscapeDataString($FileId))?alt=media&supportsAllDrives=true"
  $request = [System.Net.HttpWebRequest]::Create($url)
  $request.Headers["Authorization"] = "Bearer $AccessToken"
  $request.Timeout = 180000
  $request.ReadWriteTimeout = 180000
  try {
    $response = $request.GetResponse()
  } catch [System.Net.WebException] {
    $status = 0
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    if ($status -eq 401 -or $status -eq 403) {
      throw "Google access expired. Connect Google in Settings, then try again."
    }
    throw "Could not download the SketchUp file ($status)."
  }
  $inputStream = $response.GetResponseStream()
  $output = [IO.File]::Create($Destination)
  try {
    $buffer = New-Object byte[] 262144
    $total = 0
    while (($read = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
      $total += $read
      if ($total -gt $MaxBytes) { throw "This SketchUp file is too large to open from the helper." }
      $output.Write($buffer, 0, $read)
    }
    if ($total -eq 0) { throw "The SketchUp file from Drive was empty." }
  } finally {
    $output.Close()
    $inputStream.Close()
    $response.Close()
  }
}

function Send-Json($Context, [int]$Status, $Payload, [string]$Origin) {
  $json = ($Payload | ConvertTo-Json -Compress)
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $response = $Context.Response
  $response.StatusCode = $Status
  $response.ContentType = "application/json"
  $response.Headers["Access-Control-Allow-Private-Network"] = "true"
  if ($Origin) {
    $response.Headers["Access-Control-Allow-Origin"] = $Origin
    $response.Headers["Vary"] = "Origin"
  }
  $response.ContentLength64 = $bytes.Length
  $response.OutputStream.Write($bytes, 0, $bytes.Length)
  $response.OutputStream.Close()
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://${HostAddress}:${Port}/")
try {
  $listener.Start()
} catch {
  Write-Output "The SketchUp helper is already running on ${HostAddress}:${Port}."
  exit 0
}
Write-Output "Kiddai SketchUp helper is ready at http://${HostAddress}:${Port}"

while ($listener.IsListening) {
  $context = $listener.GetContext()
  $originHeader = $context.Request.Headers["Origin"]
  $origin = ""
  if ($AllowedOrigins -contains $originHeader) { $origin = $originHeader }
  $path = $context.Request.Url.AbsolutePath
  try {
    if ($context.Request.HttpMethod -eq "OPTIONS") {
      if (-not $origin) {
        Send-Json $context 403 @{ ok = $false; error = "This site is not allowed to use the helper." } ""
        continue
      }
      $response = $context.Response
      $response.StatusCode = 204
      $response.Headers["Access-Control-Allow-Private-Network"] = "true"
      $response.Headers["Access-Control-Allow-Origin"] = $origin
      $response.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
      $response.Headers["Access-Control-Allow-Headers"] = "Content-Type"
      $response.Headers["Access-Control-Max-Age"] = "600"
      $response.Headers["Vary"] = "Origin"
      $response.OutputStream.Close()
      continue
    }
    if ($context.Request.HttpMethod -eq "GET" -and $path -eq "/health") {
      Send-Json $context 200 @{ ok = $true } $origin
      continue
    }
    if ($context.Request.HttpMethod -ne "POST" -or $path -ne "/open") {
      Send-Json $context 404 @{ ok = $false; error = "Not found." } $origin
      continue
    }
    if (-not $origin) {
      Send-Json $context 403 @{ ok = $false; error = "This site is not allowed to use the helper." } ""
      continue
    }
    $reader = New-Object IO.StreamReader($context.Request.InputStream, $context.Request.ContentEncoding)
    $body = $reader.ReadToEnd()
    $reader.Close()
    $payload = $body | ConvertFrom-Json
    $fileId = [string]$payload.fileId
    $fileName = Get-SafeFileName ([string]$payload.fileName)
    $accessToken = [string]$payload.accessToken
    if ($fileId -notmatch '^[A-Za-z0-9_-]{8,}$' -or -not $accessToken) {
      Send-Json $context 400 @{ ok = $false; error = "The SketchUp file id was not valid." } $origin
      continue
    }
    $destination = Join-Path (Get-SaveDir) $fileName
    try {
      Save-DriveFile $fileId $accessToken $destination
      $openedWith = Open-Model $destination
      Send-Json $context 200 @{ ok = $true; fileName = $fileName; openedWith = $openedWith } $origin
    } catch {
      if (Test-Path $destination) { Remove-Item -Force $destination }
      Send-Json $context 500 @{ ok = $false; error = $_.Exception.Message } $origin
    }
  } catch {
    try { $context.Response.Abort() } catch {}
  }
}

