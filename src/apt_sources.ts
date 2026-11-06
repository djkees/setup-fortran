import * as exec from "@actions/exec";

/**
 * apt-get options that scope a command to a single source list file,
 * ignoring every other configured repository.
 *
 * Used for `apt-get update` after this action has added its own repository:
 * unrelated repositories baked into the GitHub runner images (e.g.
 * packages.microsoft.com) can return transient 403/5xx responses and fail an
 * unscoped update, breaking compiler installs that never needed them.
 *
 * `Dir::Etc::SourceList` is resolved relative to `/etc/apt`; pointing
 * `Dir::Etc::SourceParts` at a non-existent entry ("-") suppresses loading
 * of all other source files.
 */
export function scopedSourceListOptions(sourceListFile: string): string[] {
  return [
    "-o",
    `Dir::Etc::SourceList=sources.list.d/${sourceListFile}`,
    "-o",
    "Dir::Etc::SourceParts=-",
  ];
}

/**
 * Whether captured apt-get output indicates that fetching an index from the
 * given repository host failed. Distinguishes failures of the repository the
 * installer needs from failures of unrelated repositories baked into the
 * runner image.
 */
export function indexFetchFailed(
  output: string,
  repositoryHost: string,
): boolean {
  return output.includes("Failed to fetch") && output.includes(repositoryHost);
}

export async function aptPackageExists(pkg: string): Promise<boolean> {
  let output = "";
  const exitCode = await exec.exec("apt-cache", ["policy", pkg], {
    ignoreReturnCode: true,
    silent: true,
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  const candidate = /^\s*Candidate:\s*(\S+)/m.exec(output)?.[1];
  return exitCode === 0 && candidate !== undefined && candidate !== "(none)";
}
