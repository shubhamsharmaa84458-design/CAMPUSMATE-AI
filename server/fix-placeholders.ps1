$path = 'C:\Users\Dell\Desktop\coding\campusmate-ai\src\App.jsx'
$s = Get-Content -Raw -Path $path
# Use regex-escaped replacements to avoid PowerShell string-quoting issues
$s = $s -replace [regex]::Escape("`******;"), '`Bearer ${token}`;'
$s = $s -replace [regex]::Escape("Authorization: `****** }"), 'Authorization: `Bearer ${token}` }'
$s = $s -replace [regex]::Escape("if (token2) headers['Authorization'] = `******;"), 'if (token2) headers['Authorization'] = `Bearer ${token2}`;'
# Additional safety: replace any remaining `****** occurrences
$s = $s -replace [regex]::Escape("`******"), '`Bearer ${token}`'
Set-Content -Path $path -Value $s -Encoding UTF8
Write-Output 'placeholders replaced'