<#
.SINOPSIS
    Deja Bitacora lista para usar: compila, prepara la base y la conecta a
    Claude Desktop y Claude Code.

.DESCRIPCION
    Es idempotente: podes correrlo las veces que quieras. No pisa tu base de
    datos, no pisa tu contrasena, y antes de tocar la configuracion de Claude
    Desktop hace una copia de seguridad.

.EJEMPLO
    .\instalar.ps1

.EJEMPLO
    .\instalar.ps1 -ZonaHoraria America/Buenos_Aires -ConDatosDeEjemplo
#>
#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$ZonaHoraria = 'America/Montevideo',
    [int]$Puerto = 8787,
    [switch]$ConDatosDeEjemplo,
    [switch]$SaltearBuild,
    [switch]$SaltearClaudeDesktop,
    [switch]$SaltearClaudeCode,
    [switch]$SaltearSkill
)

$ErrorActionPreference = 'Stop'
$raiz = $PSScriptRoot
$paso = 0

function Titulo($texto) {
    $script:paso++
    Write-Host ''
    Write-Host "[$script:paso] $texto" -ForegroundColor Cyan
}
function Ok($texto)    { Write-Host "    OK  $texto" -ForegroundColor Green }
function Info($texto)  { Write-Host "        $texto" -ForegroundColor DarkGray }
function Aviso($texto) { Write-Host "    !   $texto" -ForegroundColor Yellow }

function Escribir-SinBom {
    param([string]$Ruta, [string]$Texto)
    # Set-Content -Encoding UTF8 en PowerShell 5.1 escribe BOM, y un BOM al
    # principio de un .json hace que muchos parsers lo rechacen.
    [System.IO.File]::WriteAllText($Ruta, $Texto, (New-Object System.Text.UTF8Encoding($false)))
}

function Invocar-Npm {
    param([string[]]$Argumentos)
    # npm en Windows es un .cmd; cmd /c evita sorpresas de parseo.
    $linea = "npm " + ($Argumentos -join ' ')
    cmd /c $linea
    if ($LASTEXITCODE -ne 0) { throw "Fallo: $linea" }
}

Write-Host ''
Write-Host '  Bitacora - instalacion' -ForegroundColor White
Write-Host "  $raiz" -ForegroundColor DarkGray

# --- 1. Requisitos ----------------------------------------------------------

Titulo 'Revisando requisitos'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'No encontre Node.js en el PATH. Instalalo desde https://nodejs.org y volve a correr esto.'
}
$versionNode = (& node --version).TrimStart('v')
$mayor = [int]($versionNode -split '\.')[0]
if ($mayor -lt 20) {
    throw "Node $versionNode es muy viejo. Hace falta 20 o superior."
}
Ok "Node $versionNode"

if (-not (Test-Path (Join-Path $raiz 'package.json'))) {
    throw "No encuentro package.json en $raiz. Corre el script desde la carpeta del proyecto."
}

# --- 2. Configuracion -------------------------------------------------------

Titulo 'Preparando el .env'

$envPath = Join-Path $raiz '.env'
if (Test-Path $envPath) {
    Ok '.env ya existe, no lo toco'
} else {
    $lineas = Get-Content (Join-Path $raiz '.env.example') |
        ForEach-Object {
            $_ -replace '^BITACORA_TZ=.*', "BITACORA_TZ=$ZonaHoraria" `
               -replace '^BITACORA_WEB_URL=.*', "BITACORA_WEB_URL=http://127.0.0.1:$Puerto"
        }
    Escribir-SinBom $envPath ($lineas -join "`r`n")
    Ok "creado con zona horaria $ZonaHoraria"
}

# --- 3. Compilar ------------------------------------------------------------

if ($SaltearBuild) {
    Titulo 'Compilacion salteada (-SaltearBuild)'
} else {
    Titulo 'Instalando dependencias (puede tardar unos minutos)'
    Push-Location $raiz
    try {
        Invocar-Npm @('install')
        Ok 'dependencias instaladas'

        Titulo 'Compilando'
        Invocar-Npm @('run', 'build')
        Ok 'compilado'

        Titulo 'Preparando la base de datos'
        Invocar-Npm @('run', 'migrate')
        Ok 'base al dia'

        if ($ConDatosDeEjemplo) {
            Invocar-Npm @('run', 'seed')
            Ok 'notas de ejemplo cargadas'
        }
    } finally {
        Pop-Location
    }
}

$stdio = Join-Path $raiz 'server\dist\mcp\stdio.js'
if (-not (Test-Path $stdio)) {
    throw "No existe $stdio. Corre el script sin -SaltearBuild."
}

# --- 4. Claude Desktop ------------------------------------------------------

if ($SaltearClaudeDesktop) {
    Titulo 'Claude Desktop salteado (-SaltearClaudeDesktop)'
} else {
    Titulo 'Conectando Claude Desktop'

    $configDir = Join-Path $env:APPDATA 'Claude'
    $configPath = Join-Path $configDir 'claude_desktop_config.json'
    New-Item -ItemType Directory -Force -Path $configDir | Out-Null

    $config = $null
    if (Test-Path $configPath) {
        $crudo = Get-Content $configPath -Raw
        if ($crudo.Trim()) {
            try {
                $config = $crudo | ConvertFrom-Json
            } catch {
                Aviso 'El claude_desktop_config.json actual no es JSON valido.'
                Aviso 'No lo toco para no romperte nada. Arreglalo o borralo y volve a correr esto.'
                $config = 'INVALIDO'
            }
        }
        if ($config -ne 'INVALIDO') {
            # Copia de seguridad antes de escribir, con fecha.
            $backup = "$configPath.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
            Copy-Item $configPath $backup
            Info "copia de seguridad en $backup"
        }
    }

    if ($config -ne 'INVALIDO') {
        if (-not $config) { $config = [pscustomobject]@{} }
        if (-not $config.PSObject.Properties['mcpServers']) {
            $config | Add-Member -NotePropertyName mcpServers -NotePropertyValue ([pscustomobject]@{}) -Force
        }

        $entrada = [pscustomobject]@{
            command = 'node'
            # [string[]] fuerza el array: ConvertTo-Json puede aplastar uno de un
            # solo elemento a string suelto, y Claude Desktop espera una lista.
            args    = [string[]]@($stdio)
            env     = [pscustomobject]@{ BITACORA_TZ = $ZonaHoraria }
        }
        $config.mcpServers | Add-Member -NotePropertyName bitacora -NotePropertyValue $entrada -Force

        Escribir-SinBom $configPath ($config | ConvertTo-Json -Depth 10)
        Ok "bitacora agregado a claude_desktop_config.json"
        $otros = @($config.mcpServers.PSObject.Properties.Name | Where-Object { $_ -ne 'bitacora' })
        if ($otros.Count -gt 0) { Info "conectores que ya tenias y siguen ahi: $($otros -join ', ')" }
        Aviso 'Reinicia Claude Desktop para que lo tome.'
    }
}

# --- 5. Claude Code ---------------------------------------------------------

if ($SaltearClaudeCode) {
    Titulo 'Claude Code salteado (-SaltearClaudeCode)'
} elseif (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    Titulo 'Claude Code'
    Aviso 'No encontre el comando "claude" en el PATH: salteo este paso.'
    Info  'Si lo instalas despues, corre el script otra vez con -SaltearBuild.'
} else {
    Titulo 'Conectando Claude Code'

    # Si ya estaba registrado, lo saco para que quede con la ruta correcta.
    # Falla la primera vez (no existe todavia) y eso esta bien; con
    # ErrorActionPreference = Stop hay que atraparlo para que no corte el script.
    try { cmd /c 'claude mcp remove bitacora' | Out-Null } catch { }
    $global:LASTEXITCODE = 0

    $comando = "claude mcp add --transport stdio --env BITACORA_TZ=$ZonaHoraria bitacora -- node `"$stdio`""
    Info $comando
    cmd /c $comando
    if ($LASTEXITCODE -ne 0) {
        Aviso 'No se pudo registrar en Claude Code. Corre el comando de arriba a mano para ver el error.'
    } else {
        Ok 'bitacora registrado en Claude Code'
    }
}

# --- 6. Skill ---------------------------------------------------------------

if ($SaltearSkill) {
    Titulo 'Skill salteada (-SaltearSkill)'
} else {
    Titulo 'Instalando la skill guardar-en-bitacora'

    $origen = Join-Path $raiz 'skills\guardar-en-bitacora'
    $destinoDir = Join-Path $env:USERPROFILE '.claude\skills'
    $destino = Join-Path $destinoDir 'guardar-en-bitacora'
    New-Item -ItemType Directory -Force -Path $destinoDir | Out-Null
    # Copy-Item de una carpeta dentro de otra que ya la contiene la anida
    # (skills\guardar-en-bitacora\guardar-en-bitacora). Se borra primero.
    if (Test-Path $destino) { Remove-Item $destino -Recurse -Force }
    Copy-Item $origen $destino -Recurse -Force
    Ok "copiada a $destino"

    $obsidian = Join-Path $destinoDir 'guardar-en-obsidian'
    if (Test-Path $obsidian) {
        Aviso 'Tenes tambien la skill guardar-en-obsidian instalada.'
        Info  'Las dos compiten por los mismos pedidos. Si ya no usas Obsidian, borra esa carpeta.'
    }
}

# --- Listo ------------------------------------------------------------------

Write-Host ''
Write-Host '  Listo.' -ForegroundColor Green
Write-Host ''
Write-Host '  Para levantar la web:' -ForegroundColor White
Write-Host "      cd `"$raiz`"" -ForegroundColor DarkGray
Write-Host '      npm start' -ForegroundColor DarkGray
Write-Host "      http://127.0.0.1:$Puerto" -ForegroundColor DarkGray
Write-Host ''
Write-Host '  Para probar desde Claude Code:' -ForegroundColor White
Write-Host '      claude mcp list        (tiene que decir Connected)' -ForegroundColor DarkGray
Write-Host '      claude                 y adentro: /mcp  (tiene que mostrar 12 tools)' -ForegroundColor DarkGray
Write-Host '      despues escribi: guarda esta conversacion en Bitacora' -ForegroundColor DarkGray
Write-Host ''
Write-Host '  Para que arranque sola con Windows, el README tiene los pasos' -ForegroundColor White
Write-Host '  del Programador de tareas.' -ForegroundColor White
Write-Host ''
