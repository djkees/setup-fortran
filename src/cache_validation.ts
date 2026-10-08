import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as cache from "@actions/cache";

export async function validateRestoredCompilerCache(
  label: string,
  requiredPaths: string[],
  command: string,
  args: string[],
): Promise<boolean> {
  const missing = requiredPaths.filter((entry) => !fs.existsSync(entry));
  if (missing.length > 0) {
    core.info(
      `Restored ${label} cache is incomplete; missing: ${missing.join(", ")}. Reinstalling.`,
    );
    return false;
  }

  try {
    let output = "";
    const append = (data: Buffer): void => {
      output += data.toString();
    };
    const exitCode = await exec.exec(command, args, {
      ignoreReturnCode: true,
      silent: true,
      listeners: { stdout: append, stderr: append },
    });
    if (exitCode === 0) return true;
    if (output.trim()) core.info(output.trim());
    core.info(
      `Restored ${label} cache failed compiler validation with exit code ${exitCode.toString()}. Reinstalling.`,
    );
  } catch (error) {
    core.info(
      `Restored ${label} cache failed compiler validation: ${String(error)}. Reinstalling.`,
    );
  }
  return false;
}

// Initializes MSVC before setvars.bat, as the installers do when exporting the
// environment: older setvars.bat cannot find newer Visual Studio releases.
export async function validateRestoredIntelWindowsCache(
  label: string,
  setvarsBat: string,
  compiler: string,
): Promise<boolean> {
  const batFile = path.win32.join(os.tmpdir(), `validate_${compiler}.bat`);
  fs.writeFileSync(
    batFile,
    [
      `@echo off`,
      `for /f "usebackq tokens=*" %%i in (\`"%ProgramFiles(x86)%\\Microsoft Visual Studio\\Installer\\vswhere.exe" -latest -property installationPath\`) do set VS_INSTALL_DIR=%%i`,
      `if exist "%VS_INSTALL_DIR%\\VC\\Auxiliary\\Build\\vcvars64.bat" call "%VS_INSTALL_DIR%\\VC\\Auxiliary\\Build\\vcvars64.bat"`,
      `call "${setvarsBat}" --force`,
      `${compiler} /QV`,
    ].join("\r\n"),
  );
  return validateRestoredCompilerCache(label, [setvarsBat], "cmd", [
    "/C",
    batFile,
  ]);
}

export async function saveCompilerCache(
  paths: string[],
  key: string,
): Promise<void> {
  try {
    await cache.saveCache(paths, key);
  } catch (error) {
    core.info(`Could not save compiler cache ${key}: ${String(error)}`);
  }
}
