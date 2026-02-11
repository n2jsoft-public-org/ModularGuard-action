# AGENTS.md - ModularGuard GitHub Action

## Project Overview

This is a GitHub Action that integrates [ModularGuard](https://github.com/n2jsoft-public-org/ModularGuard) into CI/CD workflows. ModularGuard is a tool for analyzing modular architecture and enforcing architectural boundaries in codebases.

### Purpose

The action automates the process of:
1. Downloading the latest ModularGuard binary
2. Running architecture analysis on the codebase
3. Posting results as PR comments
4. Annotating code with violations using GitHub's check annotations

## Architecture

### Technology Stack

- **Runtime**: Node.js 20.x
- **Language**: TypeScript (strict mode)
- **Template**: Based on [int128/typescript-action](https://github.com/int128/typescript-action)
- **Build Tool**: Vercel ncc (compiles to single `dist/index.js`)
- **Package Manager**: pnpm
- **Testing**: Vitest
- **Linting/Formatting**: Biome

### Project Structure

```
ModularGuard-action/
├── action.yaml          # GitHub Action metadata and interface
├── src/
│   ├── index.ts         # Entry point - orchestrates the action
│   ├── run.ts           # Main logic for running ModularGuard
│   ├── github.ts        # GitHub API utilities and context
├── tests/
│   └── run.test.ts      # Unit tests
├── dist/                # Compiled action (generated, not in repo)
│   └── index.js
└── package.json         # Dependencies and scripts
```

## Core Functionality

### 1. Binary Download and Execution

The action should:
- Detect the runner's OS (Linux, macOS, Windows)
- Download the appropriate ModularGuard binary from the latest GitHub release
- Cache the binary to avoid repeated downloads
- Make it executable and run it on the specified directory
- Capture the JSON output

### 2. PR Comment Management

The action should:
- Find existing comments from previous runs (search by a unique identifier/marker)
- Update the existing comment with new results (avoid comment spam)
- Format the JSON results into a readable markdown table
- Include summary statistics (violations count, files analyzed, etc.)
- Link to specific lines of code where violations occur

### 3. Code Annotations

The action should:
- Parse violation data from ModularGuard's JSON output
- Use GitHub's Check Runs API to create annotations
- Map violations to specific files and line numbers
- Set appropriate annotation levels (error, warning, notice)
- Include violation descriptions and suggested fixes

## Implementation Details

### Inputs (action.yaml)

```yaml
inputs:
  directory:
    description: 'Directory to analyze (default: .)'
    required: false
    default: '.'
  
  token:
    description: 'GitHub token for API access'
    required: true
    default: ${{ github.token }}
  
  modularguard-version:
    description: 'ModularGuard version (default: latest)'
    required: false
    default: 'latest'
  
  config-path:
    description: 'Path to ModularGuard config file'
    required: false
```

### Outputs

```yaml
outputs:
  violations-count:
    description: 'Number of violations found'
  
  status:
    description: 'Status: passed, failed, or warning'
```

### Key Modules

#### `src/run.ts`

Main execution logic:
```typescript
type Inputs = {
  directory: string
  token: string
  modularguardVersion: string
  configPath?: string
}

export const run = async (inputs: Inputs, octokit: Octokit, context: Context) => {
  // 1. Download ModularGuard binary
  // 2. Execute ModularGuard analysis
  // 3. Parse JSON results
  // 4. Post/update PR comment
  // 5. Create code annotations
  // 6. Set action outputs
}
```

#### `src/github.ts`

GitHub API integration:
```typescript
// Functions to implement:
- downloadModularGuardBinary()
- findExistingComment()
- createOrUpdateComment()
- createCheckRun()
- addAnnotations()
- formatResultsAsMarkdown()
```

### Expected ModularGuard Output Format

The action expects JSON output from ModularGuard in this format:

```json
{
  "summary": {
    "total_violations": 5,
    "files_analyzed": 42,
    "modules_analyzed": 8
  },
  "violations": [
    {
      "file": "src/components/Button.tsx",
      "line": 15,
      "column": 8,
      "severity": "error",
      "rule": "forbidden-dependency",
      "message": "Module 'components' cannot depend on 'infrastructure'",
      "suggestion": "Move this dependency to a higher level module"
    }
  ]
}
```

## Development Guide for AI Agents

### When Adding Features

1. **Add new inputs**: Update `action.yaml`, `src/index.ts` (getInput), and `src/run.ts` (Inputs type)
2. **Add new GitHub API calls**: Add to `src/github.ts` with proper error handling and retry logic
3. **Add new outputs**: Update `action.yaml` and use `core.setOutput()` in `src/run.ts`
4. **Add tests**: Create corresponding test cases in `tests/run.test.ts`

### Code Style Guidelines

- Use strict TypeScript types (no `any`)
- Prefer async/await over promises
- Use `@actions/core` for logging (`core.info()`, `core.warning()`, `core.error()`)
- Handle errors gracefully with try-catch
- Use descriptive variable names
- Add JSDoc comments for public functions

### Testing Strategy

- Unit tests for pure functions (parsing, formatting)
- Mock Octokit for GitHub API tests
- Mock file system operations
- Test error scenarios (network failures, invalid JSON, etc.)

### Build and Release

```bash
# Development
pnpm install
pnpm test
pnpm check      # Biome lint/format
pnpm build      # Compile to dist/index.js

# The action is released automatically via GitHub Actions
# when PRs are merged to main
```

### Common Patterns

#### Error Handling
```typescript
try {
  await riskyOperation()
} catch (e) {
  core.setFailed(e instanceof Error ? e.message : String(e))
  throw e
}
```

#### GitHub API with Retry
```typescript
const octokit = new (Octokit.plugin(retry))()
const { data } = await octokit.rest.issues.createComment({
  ...context.repo,
  issue_number: pullNumber,
  body: commentBody,
})
```

#### Annotations
```typescript
await octokit.rest.checks.create({
  ...context.repo,
  head_sha: context.sha,
  name: 'ModularGuard',
  status: 'completed',
  conclusion: violations.length > 0 ? 'failure' : 'success',
  output: {
    title: 'ModularGuard Analysis',
    summary: `Found ${violations.length} violations`,
    annotations: violations.map(v => ({
      path: v.file,
      start_line: v.line,
      end_line: v.line,
      annotation_level: v.severity,
      message: v.message,
    })),
  },
})
```

## Key Implementation TODOs

- [ ] Implement binary download logic with OS detection
- [ ] Add caching mechanism for binaries (@actions/tool-cache)
- [ ] Execute ModularGuard and capture JSON output
- [ ] Parse and validate JSON results
- [ ] Implement PR comment creation/update logic
- [ ] Add unique marker to comments for identification
- [ ] Create check runs with annotations
- [ ] Add comprehensive error handling
- [ ] Add tests for all components
- [ ] Update README.md with usage examples

## References

- [GitHub Actions Toolkit](https://github.com/actions/toolkit)
- [Octokit REST API](https://octokit.github.io/rest.js/)
- [GitHub Checks API](https://docs.github.com/en/rest/checks)
- [ModularGuard](https://github.com/n2jsoft-public-org/ModularGuard)
- [TypeScript Action Template](https://github.com/int128/typescript-action)

## Notes for Future Development

### Performance Considerations
- Cache binaries between workflow runs
- Use conditional execution (only run on changed files)
- Optimize JSON parsing for large outputs

### Security Considerations
- Validate binary checksums after download
- Use `GITHUB_TOKEN` with minimum required permissions
- Sanitize user inputs before execution
- Never log sensitive information

### User Experience
- Provide clear error messages
- Add progress indicators for long operations
- Format results in a readable way
- Include links to documentation for violations
