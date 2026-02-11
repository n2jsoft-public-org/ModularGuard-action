import * as core from '@actions/core'
import * as tc from '@actions/tool-cache'
import { Octokit } from '@octokit/action'
import { retry } from '@octokit/plugin-retry'
import type { WebhookEvent } from '@octokit/webhooks-types'
import assert from 'node:assert'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export const getOctokit = () => new (Octokit.plugin(retry))()

export type Context = {
  repo: {
    owner: string
    repo: string
  }
  sha: string
  payload: WebhookEvent
}

export const getContext = async (): Promise<Context> => {
  // https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/store-information-in-variables#default-environment-variables
  return {
    repo: getRepo(),
    sha: getEnv('GITHUB_SHA'),
    payload: JSON.parse(await fs.readFile(getEnv('GITHUB_EVENT_PATH'), 'utf-8')) as WebhookEvent,
  }
}

const getRepo = () => {
  const [owner, repo] = getEnv('GITHUB_REPOSITORY').split('/')
  assert(owner, 'GITHUB_REPOSITORY must have an owner part')
  assert(repo, 'GITHUB_REPOSITORY must have a repo part')
  return { owner, repo }
}

const getEnv = (name: string): string => {
  assert(process.env[name], `${name} is required`)
  return process.env[name]
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
  summary: {
    totalModules: number
    totalProjects: number
    errorCount: number
    warningCount: number
    isValid: boolean
  }
  modules: Array<{
    moduleName: string
    projects: Array<{
      name: string
      type: string
      filePath: string
      references: string[]
    }>
  }>
  violations: ModularGuardViolation[]
}

/**
 * Download and cache ModularGuard binary for the current platform
 */
export async function downloadModularGuard(version: string): Promise<string> {
  const platform = getPlatform()
  const arch = getArch()

  // Check cache first
  const cachedPath = tc.find('modularguard', version, arch)
  if (cachedPath) {
    core.info(`Using cached ModularGuard binary from ${cachedPath}`)
    const binaryName = platform === 'win' ? 'modularguard.exe' : 'modularguard'
    return path.join(cachedPath, binaryName)
  }

  // Resolve version if 'latest'
  const resolvedVersion = version === 'latest' ? await getLatestVersion() : version

  // Build download URL
  const ext = platform === 'win' ? 'zip' : 'tar.gz'
  const filename = `modularguard-${platform}-${arch}.${ext}`
  const url = `https://github.com/n2jsoft-public-org/ModularGuard/releases/download/v${resolvedVersion}/${filename}`

  core.info(`Downloading ModularGuard from ${url}`)

  try {
    // Download archive
    const archivePath = await tc.downloadTool(url)

    // Extract archive
    let extractedPath: string
    if (platform === 'win') {
      extractedPath = await tc.extractZip(archivePath)
    } else {
      extractedPath = await tc.extractTar(archivePath)
    }

    // Make binary executable on Unix
    const binaryName = platform === 'win' ? 'modularguard.exe' : 'modularguard'
    const binaryPath = path.join(extractedPath, binaryName)

    if (platform !== 'win') {
      await fs.chmod(binaryPath, 0o755)
    }

    // Cache for future use
    const cachedDir = await tc.cacheDir(extractedPath, 'modularguard', resolvedVersion, arch)
    core.info(`Cached ModularGuard binary to ${cachedDir}`)

    return path.join(cachedDir, binaryName)
  } catch (error) {
    throw new Error(`Failed to download ModularGuard: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Get the latest ModularGuard version from GitHub releases
 */
async function getLatestVersion(): Promise<string> {
  try {
    const octokit = getOctokit()
    const { data: release } = await octokit.rest.repos.getLatestRelease({
      owner: 'n2jsoft-public-org',
      repo: 'ModularGuard',
    })
    // Remove 'v' prefix if present
    return release.tag_name.replace(/^v/, '')
  } catch (error) {
    throw new Error(
      `Failed to fetch latest ModularGuard version: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Get platform identifier for ModularGuard binary
 */
function getPlatform(): 'linux' | 'osx' | 'win' {
  switch (process.platform) {
    case 'linux':
      return 'linux'
    case 'darwin':
      return 'osx'
    case 'win32':
      return 'win'
    default:
      throw new Error(`Unsupported platform: ${process.platform}`)
  }
}

/**
 * Get architecture identifier for ModularGuard binary
 */
function getArch(): 'x64' | 'arm64' {
  switch (process.arch) {
    case 'x64':
      return 'x64'
    case 'arm64':
      return 'arm64'
    default:
      throw new Error(`Unsupported architecture: ${process.arch}`)
  }
}

/**
 * Convert absolute file path to workspace-relative path
 */
export function toWorkspaceRelativePath(absolutePath: string, workspaceRoot: string): string {
  const relativePath = path.relative(workspaceRoot, absolutePath)
  // Normalize to forward slashes for GitHub (replace both \ and path.sep)
  return relativePath.replace(/\\/g, '/')
}

/**
 * Find existing ModularGuard comment on a pull request
 */
export async function findExistingComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<{ id: number } | null> {
  try {
    const { data: comments } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: issueNumber,
    })

    const marker = '<!-- modularguard-results -->'
    const existing = comments.find((comment) => comment.body?.includes(marker))

    return existing ? { id: existing.id } : null
  } catch (error) {
    core.warning(`Failed to find existing comment: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

/**
 * Format ModularGuard results as markdown comment
 */
export function formatComment(result: ModularGuardResult, runUrl?: string): string {
  const { summary, violations } = result
  const hasErrors = summary.errorCount > 0
  const hasWarnings = summary.warningCount > 0

  let markdown = '<!-- modularguard-results -->\n\n'
  markdown += '## ModularGuard Analysis Results\n\n'

  // Status badge
  if (hasErrors) {
    markdown += '❌ **Analysis Failed**\n\n'
  } else if (hasWarnings) {
    markdown += '⚠️ **Analysis Passed with Warnings**\n\n'
  } else {
    markdown += '✅ **Analysis Passed**\n\n'
  }

  // Summary statistics
  markdown += '### Summary\n\n'
  markdown += `- **Total Modules:** ${summary.totalModules}\n`
  markdown += `- **Total Projects:** ${summary.totalProjects}\n`
  markdown += `- **Errors:** ${summary.errorCount}\n`
  markdown += `- **Warnings:** ${summary.warningCount}\n\n`

  // Violations table
  if (violations.length > 0) {
    markdown += '### Violations\n\n'
    markdown += '| Severity | File:Line | Project | Invalid Reference | Description |\n'
    markdown += '|----------|-----------|---------|-------------------|-------------|\n'

    for (const violation of violations) {
      const severityIcon = violation.severity === 'Error' ? '🔴' : '⚠️'
      const fileLocation = `\`${violation.filePath}:${violation.lineNumber}\``
      const project = violation.projectName
      const reference = violation.invalidReference
      const description = violation.description.replace(/\n/g, ' ').substring(0, 100)

      markdown += `| ${severityIcon} ${violation.severity} | ${fileLocation} | ${project} | ${reference} | ${description} |\n`
    }

    markdown += '\n'

    // Suggestions section if any violations have suggestions
    const violationsWithSuggestions = violations.filter((v) => v.suggestion)
    if (violationsWithSuggestions.length > 0) {
      markdown += '<details>\n<summary>💡 Suggestions</summary>\n\n'
      for (const violation of violationsWithSuggestions) {
        markdown += `**${violation.projectName} → ${violation.invalidReference}**\n`
        markdown += `${violation.suggestion}\n\n`
      }
      markdown += '</details>\n\n'
    }
  }

  if (runUrl) {
    markdown += `---\n\n[View detailed results](${runUrl})\n`
  }

  return markdown
}

/**
 * Create or update a pull request comment
 */
export async function createOrUpdateComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
  existingCommentId?: number,
): Promise<void> {
  try {
    if (existingCommentId) {
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: existingCommentId,
        body,
      })
    } else {
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body,
      })
    }
  } catch (error) {
    throw new Error(
      `Failed to ${existingCommentId ? 'update' : 'create'} comment: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Create a GitHub Check Run with annotations
 */
export async function createCheckRun(
  octokit: Octokit,
  owner: string,
  repo: string,
  headSha: string,
  result: ModularGuardResult,
): Promise<void> {
  const { summary, violations } = result
  const conclusion = summary.errorCount > 0 ? 'failure' : 'success'

  // Format summary text
  let summaryText = `## ModularGuard Analysis\n\n`
  summaryText += `**Total Modules:** ${summary.totalModules}\n`
  summaryText += `**Total Projects:** ${summary.totalProjects}\n`
  summaryText += `**Errors:** ${summary.errorCount}\n`
  summaryText += `**Warnings:** ${summary.warningCount}\n\n`

  if (violations.length > 0) {
    summaryText += `Found ${violations.length} violation(s).\n\n`
    summaryText += 'See annotations on the Files Changed tab for details.'
  } else {
    summaryText += 'No violations found! 🎉'
  }

  // Map violations to annotations (GitHub API limit: 50 annotations per call)
  const annotations = violations.slice(0, 50).map((violation) => ({
    path: violation.filePath,
    start_line: violation.lineNumber,
    end_line: violation.lineNumber,
    start_column: violation.columnNumber,
    end_column: violation.columnNumber,
    annotation_level: mapSeverityToLevel(violation.severity),
    message: violation.description,
    title: `${violation.ruleName}: ${violation.projectName} → ${violation.invalidReference}`,
  }))

  if (violations.length > 50) {
    summaryText += `\n\n⚠️ Note: Only showing the first 50 annotations. ${violations.length - 50} additional violation(s) not shown.`
  }

  try {
    await octokit.rest.checks.create({
      owner,
      repo,
      name: 'ModularGuard',
      head_sha: headSha,
      status: 'completed',
      conclusion,
      output: {
        title: 'ModularGuard Analysis',
        summary: summaryText,
        annotations,
      },
    })
  } catch (error) {
    throw new Error(`Failed to create check run: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Map ModularGuard severity to GitHub annotation level
 */
function mapSeverityToLevel(severity: string): 'failure' | 'warning' | 'notice' {
  switch (severity.toLowerCase()) {
    case 'error':
      return 'failure'
    case 'warning':
      return 'warning'
    default:
      return 'notice'
  }
}
