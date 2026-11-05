# ---------------------------------------------------------------------------
# V2EX Clone v0.0.4 — 一键安装脚本（Windows PowerShell）
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
#
# 与 install.sh 功能等价：
#   1. 校验前置条件（Docker / Compose v2 / 磁盘 / 端口）
#   2. 生成 .env（含随机口令，已存在则不覆盖 —— 幂等）
#   3. 拉取镜像并启动容器
#   4. 等待健康检查通过，输出访问地址与管理员凭据
#
# 安全约定：
#   - 随机口令只写入 .env，不写入镜像、不写入 CI 日志。
#   - 管理员口令最后一次性提示，并写入 INSTALL_CREDENTIALS.txt。
#   - 不执行 `docker compose down -v`（那会删数据卷）。
# ---------------------------------------------------------------------------

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# --- 常量 ------------------------------------------------------------------
$ScriptDir      = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppVersion     = '0.0.4'
$DefaultImage   = 'ghcr.io/alicia1030su/v2ex-clone:v0.0.4'
# 允许调用方通过环境变量指定镜像（例如 CI 用本地构建的镜像验证安装流程）。
# 之前硬编码写回 DefaultImage，会**静默忽略**调用方的取值。
$ImageOverride  = $env:V2EX_IMAGE
$EnvFile        = Join-Path $ScriptDir '.env'
$EnvTemplate    = Join-Path $ScriptDir '.env.example'
$CredFile       = Join-Path $ScriptDir 'INSTALL_CREDENTIALS.txt'
$MinDiskMB      = 2048
$HealthTimeout  = 120

Set-Location $ScriptDir

# --- 输出helpers -----------------------------------------------------------
function Write-Info { param([string]$Message) Write-Host "[信息] $Message" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Message) Write-Host "[成功] $Message" -ForegroundColor Green }
function Write-Warn { param([string]$Message) Write-Host "[警告] $Message" -ForegroundColor Yellow }
function Write-Err  { param([string]$Message) Write-Host "[错误] $Message" -ForegroundColor Red }

function Fail {
    param([string]$Message)
    Write-Err $Message
    exit 1
}

# 统一写文件编码：UTF-8 **无 BOM**（Windows PowerShell 5.1 的默认编码是 UTF-16 LE）
function Write-Utf8NoBom {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Content
    )
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

# ---------------------------------------------------------------------------
# 限制文件的访问权限（仅当前用户）
#
# Windows 上 NTFS 不支持 POSIX 权限位，chmod 是空操作 ——
# 含明文口令的 .env / INSTALL_CREDENTIALS.txt 对同机其他用户依然可读。
# 这里用 icacls 移除继承的 ACL，并只授予当前用户完全控制。
# ---------------------------------------------------------------------------
function Set-FileOwnerOnly {
    param([Parameter(Mandatory = $true)][string]$Path)
    try {
        # 移除继承的权限
        & icacls $Path /inheritance:r | Out-Null
        # 只授予当前用户完全控制
        $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        & icacls $Path "/grant:r" "${me}:(F)" | Out-Null
        return $true
    } catch {
        Write-Warn "无法收紧 ${Path} 的访问权限：$($_.Exception.Message)"
        return $false
    }
}

# ---------------------------------------------------------------------------
# 随机数生成
# ---------------------------------------------------------------------------

# 用密码学安全的随机数生成器取随机字节。
function Get-RandomBytes {
    param([int]$Count)
    $bytes = New-Object 'System.Byte[]' $Count
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    } finally {
        $rng.Dispose()
    }
    # 逗号前缀：阻止 PowerShell 把字节数组展开成标量流
    return ,$bytes
}

# 生成十六进制随机串（长度 = 2 * ByteCount）
function Get-RandomHex {
    param([int]$ByteCount = 16)
    $bytes = Get-RandomBytes -Count $ByteCount
    return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}

# 返回 [0, MaxExclusive) 内的密码学安全随机整数。
# 注意：RandomNumberGenerator.GetInt32 是 .NET Core 3.0+ 的 API，
# Windows PowerShell 5.1 跑在 .NET Framework 4.x 上没有它，
# 因此这里用字节数组 + 取模实现（取模偏差在 62 以内可忽略）。
function Get-RandomInt {
    param([int]$MaxExclusive)
    if ($MaxExclusive -le 1) { return 0 }
    $bytes = Get-RandomBytes -Count 4
    $value = [int]$bytes[0] -bor ([int]$bytes[1] -shl 8) -bor ([int]$bytes[2] -shl 16) -bor ([int]$bytes[3] -shl 24)
    if ($value -lt 0) { $value = $value + 4294967296 }   # 转为无符号 32 位
    return $value % $MaxExclusive
}

# 生成管理员口令：≥12 位，强制包含大写 / 小写 / 数字。
# 与 install.sh 使用相同的字符集策略（去掉易混淆字符 I O l 0 1）。
function Get-AdminPassword {
    param([int]$Length = 16)

    $upper   = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
    $lower   = 'abcdefghijkmnopqrstuvwxyz'
    $digits  = '23456789'
    $all     = $upper + $lower + $digits

    $chars = New-Object 'System.Collections.Generic.List[char]'

    # 随机位
    for ($i = 0; $i -lt ($Length - 3); $i++) {
        $idx = Get-RandomInt -MaxExclusive $all.Length
        $chars.Add($all[$idx])
    }
    # 强制包含大写 / 小写 / 数字各一位
    $chars.Add($upper[(Get-RandomInt -MaxExclusive $upper.Length)])
    $chars.Add($lower[(Get-RandomInt -MaxExclusive $lower.Length)])
    $chars.Add($digits[(Get-RandomInt -MaxExclusive $digits.Length)])

    # Fisher-Yates 洗牌（随机下标用密码学安全 RNG）
    for ($i = $chars.Count - 1; $i -gt 0; $i--) {
        $j = Get-RandomInt -MaxExclusive ($i + 1)
        $tmp = $chars[$i]
        $chars[$i] = $chars[$j]
        $chars[$j] = $tmp
    }

    return (-join $chars)
}

# ---------------------------------------------------------------------------
# 步骤 0：前置条件检查
# ---------------------------------------------------------------------------

# 0.1 Docker 是否存在
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Fail @'
未检测到 docker 命令。
请先安装 Docker Desktop：
  https://docs.docker.com/desktop/install/windows-install/
安装完成后重新运行本脚本。
'@
}

# 0.2 Docker 守护进程是否在运行
try {
    $null = & docker info 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'docker info failed' }
} catch {
    Fail "Docker 守护进程未运行或当前用户无权访问 Docker。请启动 Docker Desktop 后重试。"
}

# 0.3 Docker Compose v2
try {
    $composeVersion = (& docker compose version --short 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'docker compose version failed' }
} catch {
    Fail @'
未检测到 Docker Compose v2（docker compose version 失败）。
Docker Desktop 请升级到最新版本以自带 Compose v2。
本脚本依赖 Compose v2 的 spec 语法与 'docker compose' 子命令，不支持旧的 docker-compose v1。
'@
}
Write-Info "Docker Compose 版本：$composeVersion"

# 0.4 磁盘可用空间 ≥ 2GB
try {
    $driveRoot = (Get-Item $ScriptDir).PSDrive.Root
    $freeMB = [math]::Floor((Get-PSDrive -Name $driveRoot.TrimEnd(':')).Free / 1MB)
    if ($freeMB -gt 0 -and $freeMB -lt $MinDiskMB) {
        Fail "磁盘可用空间不足：需要 >= $MinDiskMB MB，当前约 $freeMB MB。请清理磁盘空间后重试。"
    }
    if ($freeMB -gt 0) { Write-Ok "磁盘可用空间：${freeMB}MB" }
} catch {
    Write-Warn "无法检测磁盘可用空间，跳过该检查。"
}

# 读取 .env 中的某个键（仅用于探测端口，绝不打印口令）
function Read-EnvValue {
    param([string]$Key)
    if (-not (Test-Path -LiteralPath $EnvFile)) { return '' }
    $line = Select-String -Path $EnvFile -Pattern "^$([regex]::Escape($Key))=" -ErrorAction SilentlyContinue |
             Select-Object -Last 1
    if ($null -eq $line) { return '' }
    return ($line.Line -split '=', 2)[1].Trim()
}

# 0.5 端口占用检查
$AppPort = Read-EnvValue -Key 'APP_PORT'
if ([string]::IsNullOrWhiteSpace($AppPort)) { $AppPort = '3000' }
$parsedPort = 0
if (-not [int]::TryParse($AppPort, [ref]$parsedPort) -or $parsedPort -lt 1 -or $parsedPort -gt 65535) {
    Fail "APP_PORT 非法：'$AppPort'（必须是 1-65535 的整数）。"
}
$AppPort = [string]$parsedPort

$portInUse = $false
try {
    $conn = Get-NetTCPConnection -LocalPort $parsedPort -State Listen -ErrorAction SilentlyContinue
    if ($null -ne $conn) { $portInUse = $true }
} catch {
    # 旧版 Windows 没有 Get-NetTCPConnection，退回 netstat
    try {
        $netstat = & netstat -ano 2>$null | Select-String -Pattern "LISTENING" | Select-String -Pattern ":$AppPort\s"
        if ($null -ne $netstat) { $portInUse = $true }
    } catch {
        $portInUse = $false
    }
}
if ($portInUse) {
    Fail @"
端口 $AppPort 已被占用。
请先停止占用该端口的程序，或修改 .env 中的 APP_PORT（同时同步修改 APP_URL 与 NEXT_PUBLIC_APP_URL），然后重新运行本脚本。
"@
}
Write-Ok "端口 $AppPort 可用"

# ---------------------------------------------------------------------------
# 步骤 1：准备 .env（幂等：已存在则不覆盖）
# ---------------------------------------------------------------------------
$AdminPasswordNew = ''

if (-not (Test-Path -LiteralPath $EnvFile)) {
    if (-not (Test-Path -LiteralPath $EnvTemplate)) {
        Fail "缺少模板文件 $EnvTemplate，无法生成 .env。"
    }

    $postgresPassword = Get-RandomHex -ByteCount 16   # 32 位十六进制
    $redisPassword    = Get-RandomHex -ByteCount 16   # 32 位十六进制
    $sessionSecret    = Get-RandomHex -ByteCount 24   # 48 位十六进制
    $adminPassword    = Get-AdminPassword -Length 16

    # 复制模板到 .env，再逐项替换（保留模板里的注释）
    Copy-Item -LiteralPath $EnvTemplate -Destination $EnvFile -Force

    $lines = [System.IO.File]::ReadAllLines($EnvFile)
    for ($i = 0; $i -lt $lines.Length; $i++) {
        $line = $lines[$i]
        foreach ($pair in @(
            @('POSTGRES_PASSWORD',    $postgresPassword),
            @('REDIS_PASSWORD',       $redisPassword),
            @('SESSION_SECRET',       $sessionSecret),
            @('SEED_ADMIN_PASSWORD',  $adminPassword),
            @('V2EX_IMAGE',           $(if ($ImageOverride) { $ImageOverride } else { $DefaultImage }))
        )) {
            $key = $pair[0]; $value = $pair[1]
            if ($line -match "^$([regex]::Escape($key))=") {
                $lines[$i] = "$key=$value"
            }
        }
    }
    Write-Utf8NoBom -Path $EnvFile -Content (($lines -join "`r`n") + "`r`n")
    Set-FileOwnerOnly -Path $EnvFile | Out-Null

    # 管理员凭据单独落盘
    $appUrl = (Read-EnvValue -Key 'APP_URL')
    if ([string]::IsNullOrWhiteSpace($appUrl)) { $appUrl = "http://localhost:$AppPort" }
    $credContent = @(
        "# V2EX Clone v$AppVersion 安装凭据",
        "# 生成时间：$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
        '# 本文件含明文口令，**请妥善保管**，登录后立即在后台修改管理员密码。',
        '',
        "访问地址: $appUrl",
        "管理员用户名: $(Read-EnvValue -Key 'SEED_ADMIN_USERNAME')",
        "管理员邮箱: $(Read-EnvValue -Key 'SEED_ADMIN_EMAIL')",
        "管理员初始密码: $adminPassword"
    ) -join "`r`n"
    Write-Utf8NoBom -Path $CredFile -Content ($credContent + "`r`n")
    Set-FileOwnerOnly -Path $CredFile | Out-Null

    $AdminPasswordNew = $adminPassword
    Write-Ok '已生成 .env 与随机口令'
    Write-Info "管理员凭据已写入：$CredFile"
    Write-Info '已用 icacls 收紧 .env 与凭据文件的访问权限（仅当前用户可读写）。'
} else {
    Write-Ok '.env 已存在，**未覆盖**（幂等）'
    Write-Info '沿用 .env 中的现有配置与口令'
}

# 校验必需变量均已填充
foreach ($key in @('POSTGRES_PASSWORD', 'REDIS_PASSWORD', 'SESSION_SECRET', 'SEED_ADMIN_PASSWORD')) {
    $val = Read-EnvValue -Key $key
    if ([string]::IsNullOrWhiteSpace($val)) {
        Fail ".env 中的 $key 为空。请手动填写该值（口令需满足长度要求）后重新运行本脚本。"
    }
}

# ---------------------------------------------------------------------------
# 步骤 2：拉取镜像并启动
# ---------------------------------------------------------------------------
Write-Info '拉取镜像（首次需要下载，请耐心等待）...'
# 拉取失败不一定致命：镜像可能已在本机存在（离线安装 / 内网镜像仓库 / 预置镜像），
# 或环境无法访问 ghcr.io 但本地已有同 tag 镜像。
# 因此先尝试拉取；失败时检查本地是否已有该镜像，有则继续，没有才中止。
$imageRef = Read-EnvValue -Key 'V2EX_IMAGE'
if ([string]::IsNullOrWhiteSpace($imageRef)) { $imageRef = $DefaultImage }
& docker compose pull
if ($LASTEXITCODE -ne 0) {
    & docker image inspect $imageRef *> $null
    if ($LASTEXITCODE -eq 0) {
        Write-Warn "拉取失败，但本机已存在镜像 $imageRef，继续使用本地镜像。"
        Write-Warn '如需更新到最新版本，请检查网络后执行 docker compose pull。'
        Write-Ok "使用本机已有镜像：$imageRef"
    } else {
        Write-Warn 'docker compose pull 失败，且本机没有该镜像。'
        Write-Warn '常见原因：网络无法访问 ghcr.io。可改用国内镜像源，或先手动执行：'
        Write-Warn "  docker pull $imageRef"
        Fail '镜像拉取失败，安装中止。'
    }
} else {
    Write-Ok '镜像拉取完成'
}

Write-Info '启动容器...'
& docker compose up -d
if ($LASTEXITCODE -ne 0) {
    Write-Warn 'docker compose up -d 失败。最近的日志：'
    & docker compose logs --tail=100
    Fail '容器启动失败，安装中止。'
}
Write-Ok '容器已启动'

# ---------------------------------------------------------------------------
# 步骤 3：等待健康检查
# ---------------------------------------------------------------------------
$appUrl = Read-EnvValue -Key 'APP_URL'
if ([string]::IsNullOrWhiteSpace($appUrl)) { $appUrl = "http://localhost:$AppPort" }

Write-Info "等待服务就绪（最长 $HealthTimeout 秒）..."
Write-Info "健康检查地址：$appUrl"

$deadline = (Get-Date).AddSeconds($HealthTimeout)
$ready = $false
while ((Get-Date) -lt $deadline) {
    # 优先看 compose 的 health 状态
    $cid = (& docker compose ps -q app 2>$null | Out-String).Trim()
    if ($cid) {
        $status = (& docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $cid 2>$null | Out-String).Trim()
        if ($status -eq 'healthy') { $ready = $true; break }
        if ($status -eq 'exited' -or $status -eq 'dead') {
            Write-Warn "app 容器已退出（状态：$status）。最近的日志："
            & docker compose logs --tail=100 app
            Fail '容器异常退出，安装中止。'
        }
    }

    # HTTP 兜底探测
    try {
        $resp = Invoke-WebRequest -Uri $appUrl -UseBasicParsing -TimeoutSec 5
        if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) { $ready = $true; break }
    } catch {
        # 尚未就绪，继续等待
    }
    Start-Sleep -Seconds 3
}

if (-not $ready) {
    Write-Warn "等待健康检查超时（$HealthTimeout 秒）。最近的日志："
    & docker compose logs --tail=100
    Fail "服务未在预期时间内就绪。可用 'docker compose logs -f app' 持续查看日志。"
}
Write-Ok '健康检查通过'

# ---------------------------------------------------------------------------
# 步骤 4：输出结果
# ---------------------------------------------------------------------------
$finalUrl = Read-EnvValue -Key 'APP_URL'
if ([string]::IsNullOrWhiteSpace($finalUrl)) { $finalUrl = "http://localhost:$AppPort" }

Write-Host ''
Write-Host '安装完成' -ForegroundColor Green
Write-Host "  访问地址   : $finalUrl"
Write-Host "  管理员账号 : $(Read-EnvValue -Key 'SEED_ADMIN_USERNAME')"
Write-Host "  管理员邮箱 : $(Read-EnvValue -Key 'SEED_ADMIN_EMAIL')"
if ($AdminPasswordNew) {
    Write-Host "  管理员密码 : $AdminPasswordNew"
}
Write-Host ''
if ($AdminPasswordNew) {
    Write-Warn '请立即登录并修改管理员密码。'
    Write-Host "凭据也已保存到：$CredFile（请妥善保管）"
} else {
    Write-Warn "沿用已有 .env 中的管理员密码（存于 $CredFile）。"
}
Write-Host ''
Write-Host '常用命令（在本目录执行）：'
Write-Host '  docker compose up -d       启动服务'
Write-Host '  docker compose stop        停止服务（保留数据卷）'
Write-Host '  docker compose pull && docker compose up -d   升级到新版本'
Write-Host '  docker compose logs -f app 查看应用日志'
Write-Host ''
