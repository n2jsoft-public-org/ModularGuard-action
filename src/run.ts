import * as core from '@actions/core'
import * as exec from '@actions/exec'
import type { Octokit } from '@octokit/action'
import type { Context } from './github.js'
import {
  createCheckRun,
  createOrUpdateComment,
  downloadModularGuard,
  findExistingComment,
  formatComment,
  toWorkspaceRelativePath,
} from './github.js'

type Inputs = {
  directory: string
  token: string
  modularguardVersion: string
  configPath?: string
}

type ModularGuardSummary = {
  totalModules: number
  totalProjects: number
  errorCount: number
  warningCount: number
  isValid: boolean
}

type ModularGuardProject = {
  name: string
  type: string
  filePath: string
  references: string[]
}

type ModularGuardModule = {
  moduleName: string
  projects: ModularGuardProject[]
}

type ModularGuardViolation = {
  severity: string
  projectName: string
  invalidReference: string
  ruleName: string
  description: string
  suggestion?: string
  documentationUrl?: string
  filePath: string
  lineNumber: number
  columnNumber: number
}

type ModularGuardResult = {
  summary: ModularGuardSummary
  modules: ModularGuardModule[]
  violations: ModularGuardViolation[]
}

export const run = async (inputs: Inputs, octokit: Octokit, context: Context): Promise<void> => {
  const workspaceRoot = process.env['GITHUB_WORKSPACE'] || process.cwd()
  const runUrl = `${process.env['GITHUB_SERVER_URL']}/${process.env['GITHUB_REPOSITORY']}/actions/runs/${process.env['GITHUB_RUN_ID']}`

  core.info('Finding associated pull requests...')
  const { data: pulls } = await octokit.rest.repos.listPullRequestsAssociatedWithCommit({
    owner: context.repo.owner,
    repo: context.repo.repo,
    commit_sha: context.sha,
  })

  const isInPRContext = pulls.length > 0

  if (isInPRContext) {
    for (const pull of pulls) {
      core.info(`Associated pull request: ${pull.html_url}`)
    }
  } else {
    core.info('No associated pull requests found. Running analysis in non-PR mode.')
  }

  core.info('Downloading ModularGuard binary...')
  const binaryPath = await downloadModularGuard(inputs.modularguardVersion)
  core.info(`Binary downloaded to: ${binaryPath}`)

  core.info('Executing ModularGuard analysis...')
  const result = await executeModularGuard(binaryPath, inputs.directory, inputs.configPath)

  core.info(`Analysis complete:`)
  core.info(`  Total modules: ${result.summary.totalModules}`)
  core.info(`  Total projects: ${result.summary.totalProjects}`)
  core.info(`  Errors: ${result.summary.errorCount}`)
  core.info(`  Warnings: ${result.summary.warningCount}`)

  // Convert absolute paths to workspace-relative
  const violationsWithRelativePaths = result.violations.map((v) => ({
    ...v,
    filePath: toWorkspaceRelativePath(v.filePath, workspaceRoot),
  }))

  const resultWithRelativePaths: ModularGuardResult = {
    ...result,
    violations: violationsWithRelativePaths,
  }

  // Print violations to console
  printViolationsToConsole(resultWithRelativePaths)

  if (isInPRContext) {
    core.info('Creating check run with annotations...')
    await createCheckRun(octokit, context.repo.owner, context.repo.repo, context.sha, resultWithRelativePaths)

    core.info('Posting results to pull request(s)...')
    for (const pull of pulls) {
      const existingComment = await findExistingComment(octokit, context.repo.owner, context.repo.repo, pull.number)
      const commentBody = formatComment(resultWithRelativePaths, runUrl)
      await createOrUpdateComment(
        octokit,
        context.repo.owner,
        context.repo.repo,
        pull.number,
        commentBody,
        existingComment?.id,
      )
      core.info(`Comment ${existingComment ? 'updated' : 'created'} on PR #${pull.number}`)
    }
  } else {
    core.info('Skipping PR comments and check runs (not in PR context)')
  }

  // Set action outputs
  core.setOutput('violations-count', result.violations.length)
  core.setOutput('error-count', result.summary.errorCount)
  core.setOutput('warning-count', result.summary.warningCount)
  core.setOutput('status', result.summary.errorCount > 0 ? 'failure' : 'success')

  // Fail the action if violations found
  if (result.violations.length > 0) {
    const errorCount = result.summary.errorCount
    const warningCount = result.summary.warningCount
    const message = `ModularGuard analysis found ${result.violations.length} violation(s): ${errorCount} error(s) and ${warningCount} warning(s)`
    core.setFailed(message)
  } else {
    core.info('✅ No violations found!')
  }
}

function printViolationsToConsole(result: ModularGuardResult): void {
  const { summary, violations } = result

  core.info('')
  core.info('═'.repeat(80))
  core.info('📊 MODULARGUARD ANALYSIS RESULTS')
  core.info('═'.repeat(80))
  core.info('')
  core.info(`Total Modules:  ${summary.totalModules}`)
  core.info(`Total Projects: ${summary.totalProjects}`)
  core.info(`Errors:         ${summary.errorCount}`)
  core.info(`Warnings:       ${summary.warningCount}`)
  core.info(`Status:         ${summary.isValid ? '✅ Valid' : '❌ Invalid'}`)
  core.info('')

  if (violations.length === 0) {
    core.info('✅ No violations found!')
    core.info('═'.repeat(80))
    return
  }

  core.info(`Found ${violations.length} violation(s):`)
  core.info('')

  violations.forEach((v, i) => {
    const icon = v.severity === 'Error' ? '🔴' : '⚠️'

    core.info(`${i + 1}. ${icon} ${v.severity}: ${v.ruleName}`)
    core.info(`   Project:    ${v.projectName}`)
    core.info(`   Reference:  ${v.invalidReference}`)
    core.info(`   Location:   ${v.filePath}:${v.lineNumber}:${v.columnNumber}`)
    core.info(`   Message:    ${v.description}`)

    if (v.suggestion) {
      core.info(`   💡 Suggestion: ${v.suggestion}`)
    }

    if (v.documentationUrl) {
      core.info(`   📖 Documentation: ${v.documentationUrl}`)
    }

    core.info('')
  })

  core.info('═'.repeat(80))
}

async function executeModularGuard(
  binaryPath: string,
  directory: string,
  configPath?: string,
): Promise<ModularGuardResult> {
  const args = ['check', directory, '--format', 'json', '--quiet']

  if (configPath) {
    args.push('--config', configPath)
  }

  let stdout = ''
  let stderr = ''

  try {
    const exitCode = await exec.exec(binaryPath, args, {
      ignoreReturnCode: true,
      listeners: {
        stdout: (data: Buffer) => {
          stdout += data.toString()
        },
        stderr: (data: Buffer) => {
          stderr += data.toString()
        },
      },
    })

    core.debug(`ModularGuard exit code: ${exitCode}`)
    if (stderr) {
      core.debug(`ModularGuard stderr: ${stderr}`)
    }
  } catch (error) {
    throw new Error(`Failed to execute ModularGuard: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!stdout) {
    throw new Error('ModularGuard produced no output')
  }

  try {
    const result = JSON.parse(stdout) as ModularGuardResult

    // Validate basic structure
    if (!result.summary || !result.modules || !result.violations) {
      throw new Error('Invalid ModularGuard output: missing required fields')
    }

    return result
  } catch (error) {
    core.error('Failed to parse ModularGuard output')
    core.error(`stdout: ${stdout}`)
    core.error(`stderr: ${stderr}`)
    throw new Error(`Failed to parse ModularGuard output: ${error instanceof Error ? error.message : String(error)}`)
  }
}
