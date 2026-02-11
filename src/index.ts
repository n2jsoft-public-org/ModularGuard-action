import * as core from '@actions/core'
import { getContext, getOctokit } from './github.js'
import { run } from './run.js'

try {
  const configPathInput = core.getInput('config-path', { required: false })
  const inputs = {
    directory: core.getInput('directory', { required: false }) || '.',
    token: core.getInput('token', { required: true }),
    modularguardVersion: core.getInput('modularguard-version', { required: false }) || 'latest',
    ...(configPathInput && { configPath: configPathInput }),
  }
  
  await run(inputs, getOctokit(), await getContext())
} catch (e) {
  core.setFailed(e instanceof Error ? e : String(e))
  console.error(e)
}
