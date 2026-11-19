# Драйвер автономного цикла улучшений DPILS. Документация: docs/autoloop.md.
# Промпт итерации каждый раз берётся из origin/main — цикл не зависит от ветки общего каталога.
# Запуск: npm run loop  (или powershell -File tools/improve-loop.ps1 -MaxIterations 5)
param(
  [int]$MaxIterations = 0,         # 0 = бесконечно
  [int]$PauseSec = 60,             # пауза между итерациями
  [int]$IterationTimeoutMin = 45,  # убить зависшую итерацию
  [string]$Model = '',             # модель claude (пусто = по умолчанию)
  [string]$Agent = 'claude',       # команда headless-агента
  [string]$Repo = (Split-Path -Parent $PSScriptRoot)
)
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$logDir  = Join-Path $Repo 'loop-logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stopFile = Join-Path $Repo 'LOOP-STOP'
$lockFile = Join-Path $logDir 'loop.lock'
$summary  = Join-Path $logDir 'loop.log'

function Log([string]$msg) {
  $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Write-Host $line
  Add-Content -Path $summary -Value $line -Encoding UTF8
}
function Short([string]$h) { if ($h -and $h.Length -ge 7) { $h.Substring(0, 7) } else { '???????' } }

if (Test-Path $lockFile) {
  $oldPid = 0
  [int]::TryParse((Get-Content $lockFile -Raw).Trim(), [ref]$oldPid) | Out-Null
  if ($oldPid -and (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {
    Log "Цикл уже запущен (PID $oldPid). Выход."
    exit 1
  }
}
Set-Content -Path $lockFile -Value $PID -Encoding ASCII

$promptDisk = Join-Path $Repo 'tools/improve-prompt.md'
$promptFile = Join-Path $logDir 'prompt-current.md'
if (-not (Get-Command $Agent -ErrorAction SilentlyContinue)) {
  Log "Агент '$Agent' не найден. Установка: npm i -g @anthropic-ai/claude-code, затем один раз claude для входа."
  exit 1
}
if ($Model -match '["'']') { Log 'Недопустимое имя модели.'; exit 1 }

# Уборка worktree, оставленных упавшей итерацией (только свои chatbox/loop-*).
function Clean-LoopWorktrees {
  $blocks = (git -C $Repo worktree list --porcelain) -join "`n"
  foreach ($b in ($blocks -split "`n`n")) {
    $cur = ''; $br = ''
    foreach ($l in ($b -split "`n")) {
      if ($l -like 'worktree *') { $cur = $l.Substring(9) }
      elseif ($l -like 'branch *') { $br = $l.Substring(7) }
    }
    if ($cur -and $cur -ne $Repo -and $br -like 'refs/heads/chatbox/loop-*') {
      $j = Join-Path $cur 'node_modules'
      if (Test-Path $j) { cmd /c rmdir "$j" 2>$null }
      git -C $Repo worktree remove --force $cur 2>$null
      Log "Убран leftover worktree: $cur"
    }
  }
  git -C $Repo worktree prune 2>$null
}

$iter = 0; $fails = 0; $noops = 0
try {
  while ($true) {
    if (Test-Path $stopFile) { Log 'Найден LOOP-STOP — остановка.'; break }
    if ($MaxIterations -gt 0 -and $iter -ge $MaxIterations) { Log "Достигнут лимит: $MaxIterations итераций."; break }
    $iter++
    git -C $Repo fetch origin --quiet
    $before = (git -C $Repo rev-parse origin/main).Trim()
    $promptSrc = git -C $Repo show origin/main:tools/improve-prompt.md 2>$null
    if ($promptSrc) { ($promptSrc -join "`n") | Set-Content -Path $promptFile -Encoding UTF8 }
    elseif (Test-Path $promptDisk) { Copy-Item $promptDisk $promptFile -Force }
    else { Log 'Промпт не найден ни в origin/main, ни на диске — остановка.'; break }
    $stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
    $log    = Join-Path $logDir "iter-$iter-$stamp.log"
    $runner = Join-Path $logDir "run-$iter.ps1"
    $modelLine = if ($Model) { "`$a += @('--model', '$Model')" } else { '' }
    @"
`$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
`$OutputEncoding = [Text.Encoding]::UTF8
Set-Location '$Repo'
`$a = @('-p', '--dangerously-skip-permissions', '--output-format', 'text')
$modelLine
Get-Content -Raw -Encoding UTF8 '$promptFile' | & '$Agent' @a *>> '$log'
exit `$LASTEXITCODE
"@ | Set-Content -Path $runner -Encoding UTF8
    Log "Итерация ${iter}: запуск агента (лог iter-$iter-$stamp.log)"
    $p = Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',$runner -WorkingDirectory $Repo -WindowStyle Hidden -PassThru
    if (-not $p.WaitForExit($IterationTimeoutMin * 60 * 1000)) {
      taskkill /PID $p.Id /T /F | Out-Null
      Log "Итерация ${iter}: таймаут $IterationTimeoutMin мин — убита."
      $code = -1
    } else {
      $code = $p.ExitCode
    }
    Clean-LoopWorktrees
    git -C $Repo fetch origin --quiet
    $after = (git -C $Repo rev-parse origin/main).Trim()
    if ($code -eq 0 -and $after -ne $before) {
      $fails = 0; $noops = 0
      Log "Итерация ${iter}: смержено, main $(Short $before) -> $(Short $after)"
    } elseif ($code -ne 0) {
      $fails++; $noops = 0
      Log "Итерация ${iter}: ошибка агента (код $code), подряд ошибок: $fails"
    } else {
      $noops++; $fails = 0
      Log "Итерация ${iter}: без мержа в main, подряд простоев: $noops"
    }
    if ($fails -ge 2) { Log 'Две ошибки подряд — остановка. Разобрать логи в loop-logs/.'; break }
    if ($noops -ge 3) { Log 'Три итерации без мержей — остановка (очередь пуста или агент застрял).'; break }
    if (Test-Path $stopFile) { Log 'Найден LOOP-STOP — остановка.'; break }
    Start-Sleep -Seconds $PauseSec
  }
} finally {
  Remove-Item $lockFile -ErrorAction SilentlyContinue
  Log 'Цикл остановлен.'
}
