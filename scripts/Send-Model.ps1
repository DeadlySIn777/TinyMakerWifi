param(
    [string]$Printer = '192.168.1.22',
    [string]$File
)
$ErrorActionPreference = 'Stop'
try {
    $bridgePath = Join-Path $PSScriptRoot 'tm_send.py'
    if (!(Test-Path -LiteralPath $bridgePath -PathType Leaf)) { throw 'Keep this launcher next to tm_send.py.' }
    if (!$File) {
        Add-Type -AssemblyName System.Windows.Forms
        $picker = New-Object System.Windows.Forms.OpenFileDialog
        $picker.Title = 'Choose a sliced model for TinyMaker'
        $picker.Filter = 'Sliced models (*.sl1;*.zip;*.ctb;*.photon)|*.sl1;*.zip;*.ctb;*.photon|All files (*.*)|*.*'
        if ($picker.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { return }
        $File = $picker.FileName
        $picker.Dispose()
    }
    if (!(Test-Path -LiteralPath $File -PathType Leaf)) { throw 'That model file was not found.' }
    $File = (Resolve-Path -LiteralPath $File).Path
    $chosenPrinter = Read-Host "Printer address [$Printer]"
    if ($chosenPrinter.Trim()) { $Printer = $chosenPrinter.Trim() }
    $pythonCommand = $null
    $pythonPrefix = @()
    foreach ($candidate in @('py', 'python')) {
        $command = Get-Command $candidate -CommandType Application -ErrorAction SilentlyContinue
        if (!$command) { continue }
        $prefix = @()
        if ($candidate -eq 'py') { $prefix = @('-3') }
        & $command.Source @prefix -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' 2>$null
        if ($LASTEXITCODE -eq 0) {
            $pythonCommand = $command.Source
            $pythonPrefix = $prefix
            break
        }
    }
    if (!$pythonCommand) { throw 'Python 3.8 or newer is required. Install Python, then run this launcher again.' }
    Write-Host "Sending to $Printer. Existing models are kept; printing will not start."
    # Argument arrays preserve spaces and shell characters in filenames.
    & $pythonCommand @pythonPrefix $bridgePath $File --printer $Printer --action rename
    if ($LASTEXITCODE -ne 0) { throw 'The bridge did not confirm completion. Read the reason above; your source file is kept.' }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
} finally {
    Read-Host 'Press Enter to close' | Out-Null
}
