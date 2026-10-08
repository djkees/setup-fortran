import * as exec from "@actions/exec";
import * as cache from "@actions/cache";
import * as tc from "@actions/tool-cache";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { installWin32 as installIfort } from "../../src/installers/ifort/win32";
import { installWin32 as installIfx } from "../../src/installers/ifx/win32";
import { Arch, Compiler, OS, Msystem, type Inputs } from "../../src/types";

jest.mock("@actions/core");
jest.mock("@actions/cache");
jest.mock("@actions/tool-cache");
jest.mock("@actions/exec");
jest.mock("../../src/verify_download");
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  writeFileSync: jest.fn(),
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  rmSync: jest.fn(),
}));

// Jest cannot load the ESM-only @actions/exec, so run it in a child process.
const RUN_WITH_ACTIONS_EXEC = `
  import { exec } from "@actions/exec";
  const { args, cwd } = JSON.parse(process.env.PROBE);
  const options = { cwd, ignoreReturnCode: true, silent: true };
  process.exit(await exec("cmd", args, options));
`;

function runProbe(args: string[] | undefined, cwd: string): number {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", RUN_WITH_ACTIONS_EXEC],
    { env: { ...process.env, PROBE: JSON.stringify({ args, cwd }) } },
  );
  return result.status ?? -1;
}

const realFs = jest.requireActual<typeof fs>("fs");
const describeOnWindows =
  process.platform === "win32" ? describe : describe.skip;

const ONEAPI_ROOT = "C:\\Program Files (x86)\\Intel\\oneAPI";

// ifort exits 1 when given no source file, even on a working installation.
const COMPILERS = [
  {
    compiler: Compiler.IFX,
    version: "2026.0.0",
    install: installIfx,
    standIn: ["@echo ifx (IFX) 2026.0.0", "@exit /b 0"],
  },
  {
    compiler: Compiler.IFort,
    version: "2021.13",
    install: installIfort,
    standIn: ["@echo Compiler Classic, Version 2021.13.1 1>&2", "@exit /b 1"],
  },
];

describeOnWindows.each(COMPILERS)(
  "restored $compiler cache validation on Windows",
  ({ compiler, version, install, standIn }) => {
    const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
    const mockedDownloadTool = tc.downloadTool as jest.MockedFunction<
      typeof tc.downloadTool
    >;
    const inputs: Inputs = {
      compiler,
      version,
      os: OS.Windows,
      osVersion: "10.0.19045",
      arch: Arch.X64,
      cleanupDisk: false,
      updateEnvironment: true,
      msystem: Msystem.Native,
    };
    let oneApiDir: string;
    let probeCwd: string | undefined;

    function writeSetvars(exitCode: number) {
      realFs.writeFileSync(
        path.join(oneApiDir, "setvars.bat"),
        [
          "@echo off",
          'set "PATH=%~dp0bin;%SystemRoot%\\System32"',
          `exit /b ${exitCode.toString()}`,
        ].join("\r\n"),
      );
    }

    function writeCompiler() {
      realFs.mkdirSync(path.join(oneApiDir, "bin"));
      realFs.writeFileSync(
        path.join(oneApiDir, "bin", `${compiler}.cmd`),
        standIn.join("\r\n"),
      );
    }

    beforeEach(() => {
      jest.clearAllMocks();
      oneApiDir = realFs.mkdtempSync(path.join(os.tmpdir(), "oneAPI (x86) "));
      probeCwd = undefined;
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (cache.restoreCache as jest.Mock).mockResolvedValue("cache-hit");
      mockedDownloadTool.mockResolvedValue("C:\\Temp\\installer.exe");
      mockedExec.mockImplementation(async (commandLine, args, options) => {
        if (commandLine === "cmd" && args?.[0] === "/D") {
          probeCwd = options?.cwd;
          return runProbe(args, oneApiDir);
        }
        options?.listeners?.stdout?.(Buffer.from("PATH=C:\\bin"));
        return 0;
      });
    });

    afterEach(() => {
      realFs.rmSync(oneApiDir, { recursive: true, force: true });
    });

    it("accepts a working installation", async () => {
      writeSetvars(0);
      writeCompiler();

      await install(inputs);

      expect(mockedDownloadTool).not.toHaveBeenCalled();
      expect(probeCwd).toBe(ONEAPI_ROOT);
    });

    it("reinstalls when the compiler is missing", async () => {
      writeSetvars(0);

      await install(inputs);

      expect(mockedDownloadTool).toHaveBeenCalled();
    });

    it("reinstalls when setvars.bat fails", async () => {
      writeSetvars(1);
      writeCompiler();

      await install(inputs);

      expect(mockedDownloadTool).toHaveBeenCalled();
    });
  },
);
