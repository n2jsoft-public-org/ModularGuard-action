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

  if (pulls.length === 0) {
    core.info('No associated pull requests found. Skipping analysis (PR-only mode).')
    return
  }

  for (const pull of pulls) {
    core.info(`Associated pull request: ${pull.html_url}`)
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

  // Set action outputs
  core.setOutput('violations-count', result.violations.length)
  core.setOutput('error-count', result.summary.errorCount)
  core.setOutput('warning-count', result.summary.warningCount)
  core.setOutput('status', result.summary.errorCount > 0 ? 'failure' : 'success')

  // Fail the action if errors found
  if (result.summary.errorCount > 0) {
    core.setFailed(
      `ModularGuard analysis failed: found ${result.summary.errorCount} error(s) and ${result.summary.warningCount} warning(s)`,
    )
  }
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
