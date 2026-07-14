param(
  [int]$TimeoutMs = 800
)
$ErrorActionPreference = 'Stop'
try {
  $c = [System.Net.Sockets.TcpClient]::new()
  $iar = $c.BeginConnect('127.0.0.1', 6379, $null, $null)
  if (-not $iar.AsyncWaitHandle.WaitOne($TimeoutMs)) {
    $c.Close()
    exit 1
  }
  $c.EndConnect($iar)
  $c.Close()
  exit 0
} catch {
  exit 1
}
