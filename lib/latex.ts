/**
 * Compiles a LaTeX source string to PDF using Tectonic in a writable temp
 * workspace. This avoids serverless runtime failures when package directories
 * are read-only, which is the case on Vercel.
 */
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

function normalizeArch(arch: string): string {
  if (arch === "x86_64" || arch === "amd64") return "x64";
  if (arch === "aarch64") return "arm64";
  return arch;
}

function getExecutableName(): string {
  return process.platform === "win32" ? "tectonic.exe" : "tectonic";
}

function getRuntimePackageName(): string | null {
  const arch = normalizeArch(process.arch);

  if (process.platform === "win32" && arch === "x64") {
    return "@node-latex-compiler/bin-win32-x64";
  }
  if (process.platform === "darwin" && arch === "x64") {
    return "@node-latex-compiler/bin-darwin-x64";
  }
  if (process.platform === "darwin" && arch === "arm64") {
    return "@node-latex-compiler/bin-darwin-arm64";
  }
  if (process.platform === "linux" && arch === "x64") {
    return "@node-latex-compiler/bin-linux-x64";
  }

  return null;
}

function resolveBundledTectonicPath(): string | undefined {
  const runtimePackage = getRuntimePackageName();
  if (!runtimePackage) return undefined;

  const exeName = getExecutableName();
  const candidates = [
    path.join(process.cwd(), "node_modules", runtimePackage, "bin", exeName),
    path.join(process.cwd(), "node_modules", "node-latex-compiler", "node_modules", runtimePackage, "bin", exeName),
  ];

  const bundled = candidates.find((candidate) => fs.existsSync(candidate));
  if (!bundled) return undefined;

  if (process.platform !== "win32") {
    try {
      fs.chmodSync(bundled, 0o755);
    } catch {
      // Best effort only.
    }
  }

  return bundled;
}

function resolveTectonicPath(): string {
  if (process.env.TECTONIC_PATH && fs.existsSync(process.env.TECTONIC_PATH)) {
    return process.env.TECTONIC_PATH;
  }

  const bundled = resolveBundledTectonicPath();
  if (bundled) {
    return bundled;
  }

  return process.platform === "win32" ? "tectonic.exe" : "tectonic";
}

function ensureFontconfigEnv(): void {
  const configured = process.env.FONTCONFIG_FILE;
  if (configured && fs.existsSync(configured)) {
    return;
  }

  const workDir = path.join(os.tmpdir(), "jobpilot-fontconfig");
  const cacheDir = path.join(workDir, "cache");
  const configPath = path.join(workDir, "fonts.conf");

  fs.mkdirSync(cacheDir, { recursive: true });

  const candidateDirs = process.platform === "win32"
    ? ["C:/Windows/Fonts"]
    : [
        "/usr/share/fonts",
        "/usr/local/share/fonts",
        process.env.HOME ? path.join(process.env.HOME, ".fonts") : "",
      ];

  const existingDirs = candidateDirs.filter((dir) => dir && fs.existsSync(dir));
  const dirNodes = existingDirs
    .map((dir) => `  <dir>${dir.replace(/\\/g, "/")}</dir>`)
    .join("\n");

  const fallbackNode = existingDirs.length ? "" : `\n  <dir>${workDir.replace(/\\/g, "/")}</dir>`;
  const xml = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
${dirNodes}${fallbackNode}
  <cachedir>${cacheDir.replace(/\\/g, "/")}</cachedir>
</fontconfig>
`;

  fs.writeFileSync(configPath, xml, "utf8");

  process.env.FONTCONFIG_FILE = configPath;
  process.env.FONTCONFIG_PATH = workDir;
  process.env.XDG_CACHE_HOME = cacheDir;
}

function createWorkspace() {
  const baseDir = path.join(os.tmpdir(), "jobpilot-latex");
  fs.mkdirSync(baseDir, { recursive: true });
  return fs.mkdtempSync(path.join(baseDir, "compile-"));
}

function runTectonic(tectonicPath: string, texFilePath: string, workspace: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      tectonicPath,
      [texFilePath, `--outdir=${workspace}`],
      {
        cwd: workspace,
        env: process.env,
        windowsHide: true,
      }
    );

    let stderr = "";
    let stdout = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || stdout.trim() || `Tectonic exited with code ${code}`));
    });
  });
}

export async function compileTex(texSource: string): Promise<Buffer> {
  const workspace = createWorkspace();
  const texFilePath = path.join(workspace, "document.tex");
  const pdfFilePath = path.join(workspace, "document.pdf");

  try {
    ensureFontconfigEnv();
    fs.writeFileSync(texFilePath, texSource, "utf8");

    await runTectonic(resolveTectonicPath(), texFilePath, workspace);

    if (!fs.existsSync(pdfFilePath)) {
      throw new Error("PDF file was not generated");
    }

    return fs.readFileSync(pdfFilePath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`LaTeX compilation failed: ${message}`);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}
