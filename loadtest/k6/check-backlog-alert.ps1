param(
  [string]$PrometheusUrl = "http://localhost:9090",
  [string]$Lookback = "10m",
  [double]$WarningPending = 20,
  [double]$CriticalPending = 100,
  [double]$WarningRejectedRatio = 0.05,
  [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"

function Get-InstantValue([string]$Expression) {
  $encoded = [System.Uri]::EscapeDataString($Expression)
  $uri = "$PrometheusUrl/api/v1/query?query=$encoded"
  $response = Invoke-RestMethod -Method Get -Uri $uri

  if ($response.status -ne "success") {
    throw "Prometheus query failed: $Expression"
  }

  $result = $response.data.result
  if ($null -eq $result -or $result.Count -eq 0) {
    return 0.0
  }

  return [double]$result[0].value[1]
}

$pendingExpr = "max_over_time(ws_pending_message_jobs[$Lookback])"
$rejectedRatioExpr = '(sum(rate(ws_v2_message_result_total{result="rejected"}[1m])) / clamp_min(sum(rate(ws_v2_message_result_total{result=~"accepted|rejected"}[1m])), 0.001))'
$messageP95Expr = 'histogram_quantile(0.95, sum by (le) (rate(ws_message_process_duration_ms_bucket{result="ok"}[5m])))'

$pendingMax = Get-InstantValue $pendingExpr
$rejectedRatio = Get-InstantValue $rejectedRatioExpr
$messageP95 = Get-InstantValue $messageP95Expr

$status = "ok"
$reasons = New-Object System.Collections.Generic.List[string]

if ($pendingMax -ge $CriticalPending) {
  $status = "critical"
  $reasons.Add("pending_message_jobs=$([math]::Round($pendingMax, 2)) >= critical threshold $CriticalPending")
} elseif ($pendingMax -ge $WarningPending) {
  if ($status -ne "critical") { $status = "warning" }
  $reasons.Add("pending_message_jobs=$([math]::Round($pendingMax, 2)) >= warning threshold $WarningPending")
}

if ($rejectedRatio -ge $WarningRejectedRatio) {
  if ($status -ne "critical") { $status = "warning" }
  $reasons.Add("rejected_ratio=$([math]::Round($rejectedRatio, 4)) >= warning threshold $WarningRejectedRatio")
}

if ($messageP95 -ge 2000 -and $pendingMax -ge $WarningPending) {
  $status = "critical"
  $reasons.Add("p95=$([math]::Round($messageP95, 2))ms with backlog correlation (pending >= $WarningPending)")
}

$summary = @()
$summary += "# Backlog Alert Check"
$summary += ""
$summary += "- status: $status"
$summary += "- lookback: $Lookback"
$summary += "- pending_message_jobs_max: $([math]::Round($pendingMax, 2))"
$summary += "- rejected_ratio_1m: $([math]::Round($rejectedRatio, 4))"
$summary += "- ws_message_process_p95_ms: $([math]::Round($messageP95, 2))"
$summary += ""
$summary += "## Reasons"

if ($reasons.Count -eq 0) {
  $summary += "- no alert condition matched"
} else {
  foreach ($reason in $reasons) {
    $summary += "- $reason"
  }
}

$text = ($summary -join "`n")
Write-Host $text

if ($OutputPath -ne "") {
  $text | Set-Content -Path $OutputPath -Encoding UTF8
}

switch ($status) {
  "critical" { exit 2 }
  "warning" { exit 1 }
  default { exit 0 }
}
