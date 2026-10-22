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
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $app.FullName
    $startInfo.Arguments = "`"$Path`""
    $startInfo.UseShellExecute = $false
    [System.Diagnostics.Process]::Start($startInfo) | Out-Null
    return $app.Directory.Name
  }
  Start-Process -FilePath $Path
  return "the default app"
}

function Get-DriveVersion([string]$FileId, [string]$AccessToken) {
  $url = "https://www.googleapis.com/drive/v3/files/$([uri]::EscapeDataString($FileId))?fields=modifiedTime,size&supportsAllDrives=true"
  $request = [System.Net.HttpWebRequest]::Create($url)
  $request.Method = "GET"
  $request.Headers["Authorization"] = "Bearer $AccessToken"
  $request.Timeout = 20000
  $response = $request.GetResponse()
  $reader = New-Object IO.StreamReader($response.GetResponseStream())
  $raw = $reader.ReadToEnd()
  $reader.Close()
  $response.Close()
  $info = $raw | ConvertFrom-Json
  return "$($info.modifiedTime)|$($info.size)"
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
  $temporary = "$Destination.downloading"
  $output = [IO.File]::Create($temporary)
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
  try {
    if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Force }
    Move-Item -LiteralPath $temporary -Destination $Destination
  } catch {
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $Destination) { return }
    throw "SketchUp still has this file open. Close SketchUp, then try the icon again."
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

function Write-Log([string]$Message) {
  $folder = Join-Path $env:LOCALAPPDATA "Kiddai\SketchUp Helper"
  New-Item -ItemType Directory -Force -Path $folder | Out-Null
  Add-Content -LiteralPath (Join-Path $folder "helper.log") -Value ("{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message)
}

function Read-Exact([IO.Stream]$Stream, [int]$Count) {
  $buffer = New-Object byte[] $Count
  $offset = 0
  while ($offset -lt $Count) {
    $read = $Stream.Read($buffer, $offset, $Count - $offset)
    if ($read -le 0) { break }
    $offset += $read
  }
  return @{ Bytes = $buffer; Count = $offset }
}

function Read-Headers([IO.Stream]$Stream) {
  $data = New-Object IO.MemoryStream
  $one = New-Object byte[] 1
  while ($data.Length -lt 100000) {
    if ($Stream.Read($one, 0, 1) -le 0) { break }
    $data.Write($one, 0, 1)
    if ($data.Length -ge 4) {
      $bytes = $data.ToArray()
      $count = $bytes.Length
      if ($bytes[$count - 4] -eq 13 -and $bytes[$count - 3] -eq 10 -and $bytes[$count - 2] -eq 13 -and $bytes[$count - 1] -eq 10) {
        break
      }
    }
  }
  return [Text.Encoding]::ASCII.GetString($data.ToArray())
}

function Send-Response($Stream, [int]$Status, [string]$Reason, [string]$Body, [string]$Origin, [string]$Extra) {
  $bodyBytes = [Text.Encoding]::UTF8.GetBytes($Body)
  $headers = "HTTP/1.1 $Status $Reason`r`nContent-Type: application/json; charset=utf-8`r`nContent-Length: $($bodyBytes.Length)`r`nAccess-Control-Allow-Private-Network: true`r`nConnection: close`r`n"
  if ($Origin) {
    $headers += "Access-Control-Allow-Origin: $Origin`r`nVary: Origin`r`n"
  }
  if ($Extra) { $headers += $Extra }
  $headers += "`r`n"
  $headerBytes = [Text.Encoding]::ASCII.GetBytes($headers)
  $Stream.Write($headerBytes, 0, $headerBytes.Length)
  if ($bodyBytes.Length -gt 0) { $Stream.Write($bodyBytes, 0, $bodyBytes.Length) }
  $Stream.Flush()
}

$script:WatchGeneration = [hashtable]::Synchronized(@{})
$script:WatchRuns = @()

function Start-SaveWatch([string]$Path, [string]$FileId, [string]$AccessToken, [string]$RefreshToken, [string]$RefreshUrl) {
  if (-not $script:WatchGeneration.ContainsKey($FileId)) { $script:WatchGeneration[$FileId] = 0 }
  $script:WatchGeneration[$FileId] = [int]$script:WatchGeneration[$FileId] + 1
  $generation = [int]$script:WatchGeneration[$FileId]
  $logFolder = Join-Path $env:LOCALAPPDATA "Kiddai\SketchUp Helper"
  $worker = [powershell]::Create()
  $null = $worker.AddScript({
    param($Path, $FileId, $AccessToken, $RefreshToken, $RefreshUrl, $Generation, $LogFolder, $Generations)
    function Write-WatchLog([string]$Message) {
      Add-Content -LiteralPath (Join-Path $LogFolder "helper.log") -Value ("{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message)
    }
    function Read-FileBytes([string]$FilePath) {
      $stream = [IO.File]::Open($FilePath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
      try {
        $memory = New-Object IO.MemoryStream
        $stream.CopyTo($memory)
        return $memory.ToArray()
      } finally {
        $stream.Close()
      }
    }
    function Update-AccessToken([string]$Token, [string]$Url) {
      $request = [System.Net.HttpWebRequest]::Create($Url)
      $request.Method = "POST"
      $request.ContentType = "application/json"
      $request.Timeout = 30000
      $body = [Text.Encoding]::UTF8.GetBytes((@{ refreshToken = $Token } | ConvertTo-Json -Compress))
      $request.ContentLength = $body.Length
      $out = $request.GetRequestStream()
      $out.Write($body, 0, $body.Length)
      $out.Close()
      $response = $request.GetResponse()
      $reader = New-Object IO.StreamReader($response.GetResponseStream())
      $raw = $reader.ReadToEnd()
      $reader.Close()
      $response.Close()
      $access = [string](($raw | ConvertFrom-Json).access_token)
      if (-not $access) { throw "Google access expired. Connect Google in Settings, then open the file again." }
      return $access
    }
    function Remove-DriveFile([string]$Id, [string]$Token) {
      $request = [System.Net.HttpWebRequest]::Create("https://www.googleapis.com/drive/v3/files/$([uri]::EscapeDataString($Id))?supportsAllDrives=true")
      $request.Method = "DELETE"
      $request.Headers["Authorization"] = "Bearer $Token"
      $request.Timeout = 30000
      $response = $request.GetResponse()
      $response.Close()
    }
    function Send-SameDriveFile([string]$Id, [string]$Token, [string]$FilePath) {
      $bytes = Read-FileBytes $FilePath
      $start = [System.Net.HttpWebRequest]::Create("https://www.googleapis.com/upload/drive/v3/files/$([uri]::EscapeDataString($Id))?uploadType=resumable&supportsAllDrives=true&fields=id,modifiedTime,size")
      $start.Method = "PATCH"
      $start.Headers["Authorization"] = "Bearer $Token"
      $start.ContentType = "application/json; charset=UTF-8"
      $start.Headers["X-Upload-Content-Type"] = "application/octet-stream"
      $start.Headers["X-Upload-Content-Length"] = [string]$bytes.Length
      $start.Timeout = 60000
      $meta = [Text.Encoding]::UTF8.GetBytes("{}")
      $start.ContentLength = $meta.Length
      $metaStream = $start.GetRequestStream()
      $metaStream.Write($meta, 0, $meta.Length)
      $metaStream.Close()
      $started = $start.GetResponse()
      $session = $started.Headers["Location"]
      $started.Close()
      if (-not $session) { throw "Could not start saving the SketchUp file back to Drive." }
      $put = [System.Net.HttpWebRequest]::Create($session)
      $put.Method = "PUT"
      $put.ContentType = "application/octet-stream"
      $put.ContentLength = $bytes.Length
      $put.Timeout = 300000
      $putStream = $put.GetRequestStream()
      $putStream.Write($bytes, 0, $bytes.Length)
      $putStream.Close()
      $saved = $put.GetResponse()
      $reader = New-Object IO.StreamReader($saved.GetResponseStream())
      $raw = $reader.ReadToEnd()
      $reader.Close()
      $saved.Close()
      $version = ""
      if ($raw) {
        $savedInfo = $raw | ConvertFrom-Json
        $returned = [string]$savedInfo.id
        if ($returned -and $returned -ne $Id) {
          try { Remove-DriveFile $returned $Token } catch {}
          throw "Drive made a new file. That copy was removed. The original file was not replaced."
        }
        $version = "$($savedInfo.modifiedTime)|$($savedInfo.size)"
      }
      return $version
    }
    Start-Sleep -Seconds 1
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $item = Get-Item -LiteralPath $Path
    $baselineSize = $item.Length
    $baselineTime = $item.LastWriteTimeUtc.Ticks
    $stampPath = "$Path.kiddai"
    if ((Test-Path -LiteralPath $stampPath) -and $item.LastWriteTimeUtc -gt (Get-Item -LiteralPath $stampPath).LastWriteTimeUtc) {
      $baselineSize = -1
      $baselineTime = -1
    }
    while ($true) {
      if ([int]$Generations[$FileId] -ne $Generation) { return }
      Start-Sleep -Seconds 2
      if (-not (Test-Path -LiteralPath $Path)) { continue }
      $item = Get-Item -LiteralPath $Path
      if ($item.Length -eq 0 -or ($item.Length -eq $baselineSize -and $item.LastWriteTimeUtc.Ticks -eq $baselineTime)) { continue }
      $seenSize = $item.Length
      $seenTime = $item.LastWriteTimeUtc.Ticks
      Start-Sleep -Seconds 1
      if (-not (Test-Path -LiteralPath $Path)) { continue }
      $quiet = Get-Item -LiteralPath $Path
      if ($quiet.Length -eq 0 -or $quiet.Length -ne $seenSize -or $quiet.LastWriteTimeUtc.Ticks -ne $seenTime) { continue }
      try {
        $savedVersion = ""
        try {
          $savedVersion = Send-SameDriveFile $FileId $AccessToken $Path
        } catch [System.Net.WebException] {
          $status = 0
          if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
          if ($status -ne 401 -or -not $RefreshToken -or -not $RefreshUrl) { throw }
          $AccessToken = Update-AccessToken $RefreshToken $RefreshUrl
          $savedVersion = Send-SameDriveFile $FileId $AccessToken $Path
        }
        if ($savedVersion) { Set-Content -LiteralPath "$Path.kiddai" -Value $savedVersion -Encoding Ascii }
        $baselineSize = $quiet.Length
        $baselineTime = $quiet.LastWriteTimeUtc.Ticks
        Write-WatchLog "Saved $([IO.Path]::GetFileName($Path)) back to Drive."
      } catch {
        Write-WatchLog "Could not save $([IO.Path]::GetFileName($Path)) back to Drive: $($_.Exception.Message)"
      }
    }
  }).AddArgument($Path).AddArgument($FileId).AddArgument($AccessToken).AddArgument($RefreshToken).AddArgument($RefreshUrl).AddArgument($generation).AddArgument($logFolder).AddArgument($script:WatchGeneration)
  $script:WatchRuns += $worker
  $null = $worker.BeginInvoke()
}

function Stop-PortOwner([int]$ListenPort) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  foreach ($line in @(netstat -ano)) {
    if ($line -notmatch ":$ListenPort\s+\S+\s+LISTENING\s+(\d+)") { continue }
    $owner = [int]$Matches[1]
    if ($owner -le 0 -or $owner -eq $PID) { continue }
    cmd /c "taskkill /F /PID $owner >nul 2>&1" | Out-Null
  }
  $ErrorActionPreference = $previous
}

$started = $false
foreach ($attempt in 1..20) {
  $tcp = New-Object System.Net.Sockets.TcpListener ([Net.IPAddress]::Parse($HostAddress), $Port)
  try {
    $tcp.Start()
    $started = $true
    break
  } catch {
    Stop-PortOwner $Port
    Start-Sleep -Milliseconds 500
  }
}
if (-not $started) {
  Write-Log "The SketchUp helper could not listen on ${HostAddress}:${Port}."
  exit 1
}
Write-Log "Kiddai SketchUp helper is ready at http://${HostAddress}:${Port}"

while ($true) {
  $client = $null
  try {
  $client = $tcp.AcceptTcpClient()
  $stream = $client.GetStream()
  $stream.ReadTimeout = 180000
  try {
    $headerText = Read-Headers $stream
    $lines = $headerText -split "`r`n"
    $requestLine = [string]($lines | Select-Object -First 1)
    $parts = @($requestLine -split " ")
    $method = [string]$parts[0]
    $path = "/"
    if ($parts.Count -gt 1) { $path = ([string]$parts[1] -split "\?")[0] }
    $origin = ""
    $originHeader = ""
    $contentLength = 0
    foreach ($line in $lines) {
      if ($line -match "^Origin:\s*(.+)$") { $originHeader = $Matches[1].Trim() }
      if ($line -match "^Content-Length:\s*(\d+)$") { $contentLength = [int]$Matches[1] }
    }
    if ($AllowedOrigins -contains $originHeader) { $origin = $originHeader }
    $bodyText = ""
    if ($contentLength -gt 0) {
      $readBody = Read-Exact $stream $contentLength
      $bodyText = [Text.Encoding]::UTF8.GetString($readBody.Bytes, 0, $readBody.Count)
    }
    if ($method -eq "OPTIONS") {
      if (-not $origin) {
        Send-Response $stream 403 "Forbidden" '{"ok":false,"error":"This site is not allowed to use the helper."}' "" ""
      } else {
        Send-Response $stream 204 "No Content" "" $origin "Access-Control-Allow-Methods: GET, POST, OPTIONS`r`nAccess-Control-Allow-Headers: Content-Type`r`nAccess-Control-Max-Age: 600`r`n"
      }
    } elseif ($method -eq "GET" -and $path -eq "/health") {
      Send-Response $stream 200 "OK" '{"ok":true}' $origin ""
    } elseif ($method -ne "POST" -or $path -ne "/open") {
      Send-Response $stream 404 "Not Found" '{"ok":false,"error":"Not found."}' $origin ""
    } elseif (-not $origin) {
      Send-Response $stream 403 "Forbidden" '{"ok":false,"error":"This site is not allowed to use the helper."}' "" ""
    } else {
      $payload = $bodyText | ConvertFrom-Json
      $fileId = [string]$payload.fileId
      $fileName = Get-SafeFileName ([string]$payload.fileName)
      $accessToken = [string]$payload.accessToken
      $refreshToken = [string]$payload.refreshToken
      $refreshUrl = [string]$payload.refreshUrl
      if (-not $refreshUrl.StartsWith("$origin/")) {
        $refreshToken = ""
        $refreshUrl = ""
      }
      if ($fileId -notmatch '^[A-Za-z0-9_-]{8,}$' -or -not $accessToken) {
        Send-Response $stream 400 "Bad Request" '{"ok":false,"error":"The SketchUp file id was not valid."}' $origin ""
      } else {
        $destination = Join-Path (Get-SaveDir) $fileName
        try {
          $driveVersion = ""
          try { $driveVersion = Get-DriveVersion $fileId $accessToken } catch { $driveVersion = "" }
          $stampPath = "$destination.kiddai"
          $haveLocal = Test-Path -LiteralPath $destination
          $sameVersion = $haveLocal -and $driveVersion -and (Test-Path -LiteralPath $stampPath) -and ((Get-Content -LiteralPath $stampPath -Raw).Trim() -eq $driveVersion)
          if ($sameVersion) {
            Write-Log "Opened the Drive copy already on this computer: $fileName."
          } else {
            Save-DriveFile $fileId $accessToken $destination
            if ($driveVersion) { Set-Content -LiteralPath $stampPath -Value $driveVersion -Encoding Ascii }
          }
          $openedWith = Open-Model $destination
          Start-SaveWatch $destination $fileId $accessToken $refreshToken $refreshUrl
          Write-Log "Opened $fileName in $openedWith."
          $json = (@{ ok = $true; fileName = $fileName; openedWith = $openedWith } | ConvertTo-Json -Compress)
          Send-Response $stream 200 "OK" $json $origin ""
        } catch {
          Write-Log $_.Exception.Message
          $json = (@{ ok = $false; error = [string]$_.Exception.Message } | ConvertTo-Json -Compress)
          Send-Response $stream 500 "Error" $json $origin ""
        }
      }
    }
  } catch {
    Write-Log $_.Exception.Message
  } finally {
    if ($client) { $client.Close() }
  }
  } catch {
    Write-Log $_.Exception.Message
  }
}
