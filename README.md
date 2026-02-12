# ModularGuard GitHub Action

Analyze and enforce modular architecture boundaries in your codebase using [ModularGuard](https://github.com/n2jsoft-public-org/ModularGuard).

This GitHub Action integrates ModularGuard into your CI/CD pipeline to automatically detect architectural violations in pull requests, post detailed results as comments, and annotate specific code violations directly in the Files Changed tab.

## Features

- 🔍 **Automatic Architecture Analysis** - Runs ModularGuard on every pull request
- 💬 **PR Comment Integration** - Posts formatted results as pull request comments
- 📝 **Code Annotations** - Highlights violations directly in the Files Changed tab
- ✅ **CI/CD Integration** - Fails the workflow when architectural violations are found
- 🚀 **Cross-Platform** - Supports Linux, macOS, and Windows runners (x64 and ARM64)
- 📦 **Binary Caching** - Automatically caches ModularGuard binaries for faster runs
- ⚙️ **Configurable** - Supports custom ModularGuard configuration files

## Usage

### Basic Example

Add this workflow to your repository at `.github/workflows/modularguard.yml`:

```yaml
name: ModularGuard Analysis

on:
  pull_request:
    branches: [main]

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Run ModularGuard
        uses: n2jsoft-public-org/ModularGuard-action@v0
        with:
          token: ${{ github.token }}
```

### Advanced Example

```yaml
name: ModularGuard Analysis

on:
  pull_request:
    branches: [main, develop]

jobs:
  analyze:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      checks: write
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Run ModularGuard
        uses: n2jsoft-public-org/ModularGuard-action@v1
        with:
          directory: './src'
          token: ${{ github.token }}
          modularguard-version: '0.0.5'
          config-path: '.modularguard.yml'
```

## Inputs

| Name                     | Required | Default   | Description                                              |
| ------------------------ | -------- | --------- | -------------------------------------------------------- |
| `directory`              | No       | `.`       | Directory to analyze (relative to repository root)       |
| `token`                  | Yes      | -         | GitHub token for API access (use `${{ github.token }}`)  |
| `modularguard-version`   | No       | `latest`  | ModularGuard version to use (e.g., `0.0.5` or `latest`)  |
| `config-path`            | No       | -         | Path to ModularGuard configuration file                  |

## Outputs

| Name                | Description                                |
| ------------------- | ------------------------------------------ |
| `violations-count`  | Total number of violations found           |
| `error-count`       | Number of error-level violations           |
| `warning-count`     | Number of warning-level violations         |
| `status`            | Analysis status: `success` or `failure`    |

## Permissions

The action requires the following permissions:

```yaml
permissions:
  contents: read        # To checkout code
  pull-requests: write  # To post comments on PRs
  checks: write         # To create check runs with annotations
```

These permissions are automatically available when using `${{ github.token }}` in public repositories. For private repositories or organization-level restrictions, you may need to configure these explicitly.

## How It Works

1. **Download & Cache** - Downloads the appropriate ModularGuard binary for your platform and caches it for future runs
2. **Execute Analysis** - Runs ModularGuard on the specified directory with JSON output
3. **Create Check Run** - Creates a GitHub Check Run with a summary and file annotations (up to 50 violations)
4. **Post PR Comment** - Creates or updates a comment on the pull request with a formatted table of violations
5. **Set Workflow Status** - Fails the workflow if error-level violations are found

## Example Output

### PR Comment

The action posts a formatted comment on your pull request:

```markdown
## ModularGuard Analysis Results

❌ **Analysis Failed**

### Summary

- **Total Modules:** 9
- **Total Projects:** 85
- **Errors:** 1
- **Warnings:** 0

### Violations

| Severity | File:Line | Project | Invalid Reference | Description |
|----------|-----------|---------|-------------------|-------------|
| 🔴 Error | `src/invoices/Invoices.Infrastructure/Invoices.Infrastructure.csproj:3` | Invoices.Infrastructure | Auditing.Abstractions | Project of type 'infrastructure' cannot reference 'Auditing.Abstractions'... |

💡 **Suggestions**
- Remove the reference to 'Auditing.Abstractions' from 'Invoices.Infrastructure'
```

### Check Run Annotations

Violations also appear as annotations in the Files Changed tab, pointing to specific lines in your `.csproj` files.

## Configuration

ModularGuard looks for configuration files in this order:

- `.modularguard.yml`
- `.modularguard.yaml`
- `.modularguard.json`
- `modularguard.yml`
- `modularguard.yaml`
- `modularguard.json`

If no configuration file is found, ModularGuard uses default rules for modular monolith architectures.

Example `.modularguard.yml`:

```yaml
projectStructure:
  patterns:
    - name: "Core"
      pattern: "*.Core"
      type: "core"
      moduleExtraction: "^(.+)\\.Core$"
    
    - name: "Infrastructure"
      pattern: "*.Infrastructure"
      type: "infrastructure"
      moduleExtraction: "^(.+)\\.Infrastructure$"

dependencyRules:
  core:
    allowed:
      - "Shared.Core"
    denied:
      - "*.Infrastructure"
      - "*.App"
  
  infrastructure:
    allowed:
      - "Shared.Infrastructure"
      - "{module}.Core"
    denied:
      - "*.App"
```

See the [ModularGuard documentation](https://github.com/n2jsoft-public-org/ModularGuard) for more configuration options.

## Supported Platforms

The action automatically detects your runner's platform and downloads the appropriate binary:

- **Linux**: x64, ARM64
- **macOS**: x64 (Intel), ARM64 (Apple Silicon)
- **Windows**: x64, ARM64

## Troubleshooting

### Permission Denied Errors

If you see permission errors on Linux/macOS, ensure the action has permission to make the binary executable. This should happen automatically, but if issues persist, check runner permissions.

### No PR Comments Posted

Ensure your workflow has the `pull-requests: write` permission. Also verify that the action is running in the context of a pull request (not a push to main).

### Annotations Not Showing

Check that your workflow has the `checks: write` permission. Annotations appear in the Files Changed tab of the pull request.

### Action Fails on Latest Version

If `modularguard-version: latest` fails, try pinning to a specific version like `0.0.5` until a new release is available.

## Development

### Running Tests

```bash
pnpm install
pnpm test
```

### Building the Action

```bash
pnpm build
```

This compiles the TypeScript code and bundles it into `dist/index.js`, which must be committed to the repository.

### Linting

```bash
pnpm check
```

## License

See [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## Related Projects

- [ModularGuard](https://github.com/n2jsoft-public-org/ModularGuard) - The core architecture analysis tool
