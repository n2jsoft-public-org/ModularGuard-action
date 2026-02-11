import { describe, expect, it } from 'vitest'
import { formatComment, toWorkspaceRelativePath } from '../src/github.js'

describe('toWorkspaceRelativePath', () => {
  it('converts absolute path to workspace-relative path', () => {
    const absolutePath = '/Users/test/dev/project/src/module/File.cs'
    const workspaceRoot = '/Users/test/dev/project'
    const result = toWorkspaceRelativePath(absolutePath, workspaceRoot)
    expect(result).toBe('src/module/File.cs')
  })

  it('handles Windows-style paths', () => {
    const absolutePath = '/Users/test/dev/project/src\\module\\File.cs'
    const workspaceRoot = '/Users/test/dev/project'
    const result = toWorkspaceRelativePath(absolutePath, workspaceRoot)
    expect(result).toBe('src/module/File.cs')
  })

  it('normalizes path separators to forward slashes', () => {
    const absolutePath = '/Users/test/dev/project/src/nested/deep/File.cs'
    const workspaceRoot = '/Users/test/dev/project'
    const result = toWorkspaceRelativePath(absolutePath, workspaceRoot)
    expect(result).toBe('src/nested/deep/File.cs')
  })

  it('handles paths at workspace root', () => {
    const absolutePath = '/Users/test/dev/project/File.cs'
    const workspaceRoot = '/Users/test/dev/project'
    const result = toWorkspaceRelativePath(absolutePath, workspaceRoot)
    expect(result).toBe('File.cs')
  })
})

describe('formatComment', () => {
  it('formats successful analysis with no violations', () => {
    const result = {
      summary: {
        totalModules: 3,
        totalProjects: 15,
        errorCount: 0,
        warningCount: 0,
        isValid: true,
      },
      modules: [],
      violations: [],
    }

    const markdown = formatComment(result)

    expect(markdown).toContain('<!-- modularguard-results -->')
    expect(markdown).toContain('## ModularGuard Analysis Results')
    expect(markdown).toContain('✅ **Analysis Passed**')
    expect(markdown).toContain('**Total Modules:** 3')
    expect(markdown).toContain('**Total Projects:** 15')
    expect(markdown).toContain('**Errors:** 0')
    expect(markdown).toContain('**Warnings:** 0')
    expect(markdown).not.toContain('### Violations')
  })

  it('formats analysis with errors', () => {
    const result = {
      summary: {
        totalModules: 2,
        totalProjects: 10,
        errorCount: 2,
        warningCount: 0,
        isValid: false,
      },
      modules: [],
      violations: [
        {
          severity: 'Error',
          projectName: 'Module.Infrastructure',
          invalidReference: 'OtherModule.Core',
          ruleName: 'ConfigurableRule[infrastructure]',
          description: 'Infrastructure cannot reference other modules core layers',
          filePath: 'src/Module/Module.Infrastructure/Module.Infrastructure.csproj',
          lineNumber: 10,
          columnNumber: 5,
        },
        {
          severity: 'Error',
          projectName: 'Module.Core',
          invalidReference: 'Module.Infrastructure',
          ruleName: 'ConfigurableRule[core]',
          description: 'Core cannot reference infrastructure',
          suggestion: 'Remove the reference or move logic to application layer',
          filePath: 'src/Module/Module.Core/Module.Core.csproj',
          lineNumber: 15,
          columnNumber: 5,
        },
      ],
    }

    const markdown = formatComment(result)

    expect(markdown).toContain('❌ **Analysis Failed**')
    expect(markdown).toContain('**Errors:** 2')
    expect(markdown).toContain('### Violations')
    expect(markdown).toContain('🔴 Error')
    expect(markdown).toContain('Module.Infrastructure')
    expect(markdown).toContain('OtherModule.Core')
    expect(markdown).toContain('`src/Module/Module.Infrastructure/Module.Infrastructure.csproj:10`')
    expect(markdown).toContain('💡 Suggestions')
    expect(markdown).toContain('Remove the reference or move logic to application layer')
  })

  it('formats analysis with warnings', () => {
    const result = {
      summary: {
        totalModules: 2,
        totalProjects: 10,
        errorCount: 0,
        warningCount: 1,
        isValid: true,
      },
      modules: [],
      violations: [
        {
          severity: 'Warning',
          projectName: 'Module.App',
          invalidReference: 'Shared.Utilities',
          ruleName: 'ConfigurableRule[app]',
          description: 'Consider using Shared.Core instead',
          filePath: 'src/Module/Module.App/Module.App.csproj',
          lineNumber: 8,
          columnNumber: 5,
        },
      ],
    }

    const markdown = formatComment(result)

    expect(markdown).toContain('⚠️ **Analysis Passed with Warnings**')
    expect(markdown).toContain('**Warnings:** 1')
    expect(markdown).toContain('⚠️ Warning')
  })

  it('includes run URL when provided', () => {
    const result = {
      summary: {
        totalModules: 1,
        totalProjects: 5,
        errorCount: 0,
        warningCount: 0,
        isValid: true,
      },
      modules: [],
      violations: [],
    }

    const runUrl = 'https://github.com/owner/repo/actions/runs/12345'
    const markdown = formatComment(result, runUrl)

    expect(markdown).toContain('[View detailed results](https://github.com/owner/repo/actions/runs/12345)')
  })

  it('creates violations table with correct columns', () => {
    const result = {
      summary: {
        totalModules: 1,
        totalProjects: 5,
        errorCount: 1,
        warningCount: 0,
        isValid: false,
      },
      modules: [],
      violations: [
        {
          severity: 'Error',
          projectName: 'TestProject',
          invalidReference: 'InvalidRef',
          ruleName: 'TestRule',
          description: 'Test description',
          filePath: 'test/path.csproj',
          lineNumber: 42,
          columnNumber: 10,
        },
      ],
    }

    const markdown = formatComment(result)

    expect(markdown).toContain('| Severity | File:Line | Project | Invalid Reference | Description |')
    expect(markdown).toContain('|----------|-----------|---------|-------------------|-------------|')
    expect(markdown).toContain('| 🔴 Error | `test/path.csproj:42` | TestProject | InvalidRef | Test description |')
  })

  it('truncates long descriptions in table', () => {
    const result = {
      summary: {
        totalModules: 1,
        totalProjects: 5,
        errorCount: 1,
        warningCount: 0,
        isValid: false,
      },
      modules: [],
      violations: [
        {
          severity: 'Error',
          projectName: 'TestProject',
          invalidReference: 'InvalidRef',
          ruleName: 'TestRule',
          description: 'A'.repeat(150), // Very long description
          filePath: 'test/path.csproj',
          lineNumber: 1,
          columnNumber: 1,
        },
      ],
    }

    const markdown = formatComment(result)
    const lines = markdown.split('\n')
    const violationLine = lines.find((line) => line.includes('TestProject'))

    expect(violationLine).toBeDefined()
    expect(violationLine?.length).toBeLessThan(200) // Should be truncated
  })

  it('only shows suggestions section when violations have suggestions', () => {
    const resultWithoutSuggestions = {
      summary: {
        totalModules: 1,
        totalProjects: 5,
        errorCount: 1,
        warningCount: 0,
        isValid: false,
      },
      modules: [],
      violations: [
        {
          severity: 'Error',
          projectName: 'TestProject',
          invalidReference: 'InvalidRef',
          ruleName: 'TestRule',
          description: 'Test description',
          filePath: 'test/path.csproj',
          lineNumber: 1,
          columnNumber: 1,
        },
      ],
    }

    const markdown = formatComment(resultWithoutSuggestions)
    expect(markdown).not.toContain('💡 Suggestions')
  })
})
