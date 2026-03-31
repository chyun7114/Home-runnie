param(
  [int[]]$Rates = @(10, 15, 20, 25, 30),
  [int]$PreAllocatedVUs = 100,
  [int]$MaxVUs = 500,
  [string]$Warmup = "20s",
  [string]$Ramp = "40s",
  [string]$Sustain = "60s"
)

$ErrorActionPreference = "Stop"

$root = (Resolve-Path "$PSScriptRoot\..\..").Path
$resultRoot = Join-Path $PSScriptRoot "results"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$runDir = Join-Path $resultRoot $stamp
New-Item -ItemType Directory -Force $runDir | Out-Null

$profiles = @(
  @{ Name = "sla8"; AuthTimeout = 8000 },
  @{ Name = "diag15"; AuthTimeout = 15000 }
)

$rows = @()

function Get-MetricValue($metric, $preferred, $fallback = 0) {
  if ($null -eq $metric) { return $fallback }
  if ($metric.PSObject.Properties.Name -contains $preferred) { return [double]$metric.$preferred }
  return $fallback
}

foreach ($profile in $profiles) {
  foreach ($rate in $Rates) {
    $summaryFile = Join-Path $runDir ("summary-{0}-{1}.json" -f $profile.Name, $rate)
    $stdoutFile = Join-Path $runDir ("stdout-{0}-{1}.log" -f $profile.Name, $rate)
    $stderrFile = Join-Path $runDir ("stderr-{0}-{1}.log" -f $profile.Name, $rate)

    Write-Host "[matrix] Running profile=$($profile.Name) rate=$rate"

    $env:AUTH_TIMEOUT_MS = "$($profile.AuthTimeout)"
    $env:RATE_START = "2"
    $env:RATE_WARMUP_TARGET = [Math]::Max(2, [Math]::Min($rate, 5))
    $env:RATE_TARGET = "$rate"
    $env:STAGE_WARMUP = $Warmup
    $env:STAGE_RAMP = $Ramp
    $env:STAGE_SUSTAIN = $Sustain
    $env:K6_PREALLOCATED_VUS = "$PreAllocatedVUs"
    $env:K6_MAX_VUS = "$MaxVUs"

    $proc = Start-Process `
      -FilePath "k6" `
      -ArgumentList @("run", "--summary-export", $summaryFile, "$PSScriptRoot\\ws-chat.js") `
      -NoNewWindow `
      -Wait `
      -PassThru `
      -RedirectStandardOutput $stdoutFile `
      -RedirectStandardError $stderrFile

    if ($proc.ExitCode -ne 0) {
      Write-Host "[matrix] k6 exited with code $($proc.ExitCode) (profile=$($profile.Name), rate=$rate) - continuing"
    }

    $summary = Get-Content $summaryFile -Raw | ConvertFrom-Json
    $metrics = $summary.metrics

    $row = [PSCustomObject]@{
      profile                       = $profile.Name
      rate_target                   = $rate
      auth_success                  = Get-MetricValue $metrics.ws_auth_success_rate "value" 0
      join_success                  = Get-MetricValue $metrics.ws_join_success_rate "value" 0
      msg_roundtrip_success         = Get-MetricValue $metrics.ws_message_roundtrip_success_rate "value" 0
      p95_ms                        = Get-MetricValue $metrics.ws_message_roundtrip_ms "p(95)" 0
      p99_ms                        = Get-MetricValue $metrics.ws_message_roundtrip_ms "p(99)" 0
      ws_error_count                = Get-MetricValue $metrics.ws_error_count "count" 0
      dropped_iterations            = Get-MetricValue $metrics.dropped_iterations "count" 0
      max_active_vus                = Get-MetricValue $metrics.vus "max" 0
      iterations                    = Get-MetricValue $metrics.iterations "count" 0
    }
    $rows += $row
  }
}

$csvPath = Join-Path $runDir "matrix-summary.csv"
$rows | Export-Csv -NoTypeInformation -Encoding UTF8 $csvPath

$mdPath = Join-Path $runDir "matrix-summary.md"
$lines = @()
$lines += "# k6 Capacity Matrix Summary ($stamp)"
$lines += ""
$lines += "| profile | rate_target | auth_success | join_success | msg_roundtrip_success | p95_ms | p99_ms | ws_error_count | dropped_iterations | max_active_vus | iterations |"
$lines += "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"
foreach ($r in $rows) {
  $lines += ("| {0} | {1} | {2:P2} | {3:P2} | {4:P2} | {5:N0} | {6:N0} | {7:N0} | {8:N0} | {9:N0} | {10:N0} |" -f `
      $r.profile, $r.rate_target, $r.auth_success, $r.join_success, $r.msg_roundtrip_success, `
      $r.p95_ms, $r.p99_ms, $r.ws_error_count, $r.dropped_iterations, $r.max_active_vus, $r.iterations)
}
$lines | Set-Content $mdPath

Write-Host "[matrix] Done"
Write-Host " - runDir: $runDir"
Write-Host " - csv:    $csvPath"
Write-Host " - md:     $mdPath"
