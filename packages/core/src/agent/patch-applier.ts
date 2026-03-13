import { execSync } from 'child_process';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const exec = promisify(execCb);

export interface ApplyPatchOptions {
  /** e.g. "owner/repo" */
  repoFullName: string;
  /** Branch name to create in the clone */
  branch: string;
  /** Unified diff content to apply */
  patch: string;
  /** GitHub installation token for authenticated clone */
  installationToken: string;
}

export interface AppliedPatchDir {
  /** Path to the temporary directory with the patched repo */
  dir: string;
  /** Call this when done to remove the temp directory */
  cleanup: () => void;
}

/**
 * Clones a repo into a temp directory, creates the specified branch,
 * applies the unified diff patch, and returns the directory path.
 * The caller MUST call `cleanup()` when done to remove the temp directory.
 */
export async function applyPatchToClone(options: ApplyPatchOptions): Promise<AppliedPatchDir> {
  const { repoFullName, branch, patch, installationToken } = options;

  const tmpDir = join(
    tmpdir(),
    `codowave-patch-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tmpDir, { recursive: true });

  const cloneUrl = `https://x-access-token:${installationToken}@github.com/${repoFullName}.git`;

  try {
    // Shallow clone for speed
    await exec(`git clone --depth 1 "${cloneUrl}" "${tmpDir}"`);

    // Create and switch to the codowave branch
    await exec(`git -C "${tmpDir}" checkout -b "${branch}"`);

    // Write the patch to a temp file inside the clone dir
    const patchFile = join(tmpDir, '_codowave.patch');
    writeFileSync(patchFile, patch, 'utf-8');

    // Apply the patch (--whitespace=nowarn to avoid spurious failures)
    await exec(`git -C "${tmpDir}" apply --whitespace=nowarn "${patchFile}"`);

    // Clean up the temp patch file
    await exec(`rm "${patchFile}"`);

    console.log(`[patch-applier] Patch successfully applied in ${tmpDir}`);

    return {
      dir: tmpDir,
      cleanup: () => {
        try {
          execSync(`rm -rf "${tmpDir}"`);
          console.log(`[patch-applier] Cleaned up temp dir ${tmpDir}`);
        } catch {
          // Best effort cleanup
        }
      },
    };
  } catch (err: unknown) {
    // Clean up on failure
    try {
      execSync(`rm -rf "${tmpDir}"`);
    } catch {
      // Best effort
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`[patch-applier] Failed to apply patch to ${repoFullName}: ${message}`);
  }
}
