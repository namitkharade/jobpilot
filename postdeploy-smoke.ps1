$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$base = 'https://jobpilot-topaz.vercel.app'
$h = @{ 'Content-Type' = 'application/json' }
$results = @()

function AddRes {
  param($name, $method, $path, $status, $ok, $detail)
  $script:results += [pscustomobject]@{
    name = $name
    method = $method
    path = $path
    status = $status
    ok = $ok
    detail = $detail
  }
}

function Hit {
  param($name, $method, $path, $body = $null)

  try {
    if ($null -ne $body) {
      $resp = Invoke-WebRequest -Uri ($base + $path) -Method $method -Headers $h -Body ($body | ConvertTo-Json -Depth 12 -Compress) -UseBasicParsing -TimeoutSec 180
    } else {
      $resp = Invoke-WebRequest -Uri ($base + $path) -Method $method -UseBasicParsing -TimeoutSec 180
    }

    $detail = 'ok'
    if ($resp.Content) {
      try {
        $j = $resp.Content | ConvertFrom-Json
        if ($j.error) {
          $detail = [string]$j.error
        } elseif ($j.success -eq $false) {
          $detail = 'success:false'
        }
      } catch {
        $detail = 'ok'
      }
    }

    AddRes $name $method $path ([int]$resp.StatusCode) $true $detail
    return $resp
  } catch {
    $status = 0
    $detail = $_.Exception.Message

    if ($_.Exception.Response) {
      $status = [int]$_.Exception.Response.StatusCode
      try {
        $sr = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())
        $txt = $sr.ReadToEnd()
        try {
          $j = $txt | ConvertFrom-Json
          if ($j.error) {
            $detail = [string]$j.error
          } else {
            $detail = $txt
          }
        } catch {
          $detail = $txt
        }
      } catch {
      }
    }

    if ($detail.Length -gt 240) {
      $detail = $detail.Substring(0, 240)
    }

    AddRes $name $method $path $status $false $detail
    return $null
  }
}

# UI + baseline
Hit 'UI Home' 'GET' '/'
Hit 'UI Jobs' 'GET' '/jobs'
Hit 'UI Resume' 'GET' '/resume'
Hit 'UI Settings' 'GET' '/settings'
Hit 'API Config GET' 'GET' '/api/config'
Hit 'API Jobs GET' 'GET' '/api/jobs'
Hit 'API Cron GET' 'GET' '/api/cron'
Hit 'API Cron Logs GET' 'GET' '/api/cron/logs'
Hit 'API Resume Status GET' 'GET' '/api/resume/status'
Hit 'API Cover Letter GET' 'GET' '/api/cover-letter'

# Validation checks expected to fail with 400
Hit 'API Scrape invalid payload' 'POST' '/api/scrape' @{ query = ''; location = '' }
Hit 'API ATS missing jobId' 'GET' '/api/ats'

# Provider connectivity checks
foreach ($svc in @('apify', 'hunter', 'openai', 'searxng')) {
  Hit ("API Config PATCH test " + $svc) 'PATCH' '/api/config' @{ service = $svc }
}

# Functional workflows
$jobId = 'smoke-postdeploy-' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
Hit 'API Jobs POST create' 'POST' '/api/jobs' @{
  id = $jobId
  title = 'ML Engineer'
  company = 'OpenAI'
  location = 'San Francisco'
  jobDescription = 'Build and deploy ML systems in production with strong collaboration.'
  url = 'https://example.com/jobs/ml'
  source = 'linkedin'
  postedAt = (Get-Date).ToString('o')
}
Hit 'API Recruiter POST' 'POST' '/api/recruiter' @{
  jobId = $jobId
  company = 'OpenAI'
  role = 'ML Engineer'
  jobDescription = 'Build production AI systems and collaborate with infra and product teams.'
}
Hit 'API Email POST' 'POST' '/api/email' @{
  jobId = $jobId
  recruiter = @{ name = 'Alex Hiring'; title = 'Hiring Manager'; email = ''; linkedinUrl = 'https://linkedin.com/in/alex'; confidence = 70; source = 'smoke' }
  jobListing = @{ title = 'ML Engineer'; company = 'OpenAI'; jobDescription = 'Build production ML systems' }
  resumeSummary = 'Built production ML ranking system improving CTR by 18%.'
  tone = 'professional'
  variant = 'hiring-manager'
}
Hit 'API ATS POST' 'POST' '/api/ats' @{ jobId = $jobId; jobDescription = 'Need python, mlops, distributed systems, experimentation.' }
Hit 'API Assistant POST' 'POST' '/api/assistant' @{ jobId = $jobId; question = 'Why are you interested in this role?'; history = @() }
Hit 'API Resume Compile POST' 'POST' '/api/resume/compile' @{ texSource = '\\documentclass{article}\\begin{document}Post deploy smoke test\\end{document}' }

# Real scrape call
Hit 'API Scrape real call' 'POST' '/api/scrape' @{ query = 'Software Engineer'; location = 'Remote'; sources = @('linkedin') }

# Cleanup
Hit 'API Jobs DELETE cleanup' 'DELETE' '/api/jobs' @{ id = $jobId }

$pass = ($results | Where-Object { $_.ok }).Count
$fail = ($results | Where-Object { -not $_.ok }).Count

$out = [pscustomobject]@{
  timestamp = (Get-Date).ToString('o')
  base = $base
  total = $results.Count
  passed = $pass
  failed = $fail
  results = $results
}

$outPath = Join-Path -Path $PSScriptRoot -ChildPath 'postdeploy-smoke-results.json'
$out | ConvertTo-Json -Depth 8 | Set-Content -Path $outPath -Encoding UTF8
Write-Output $outPath
