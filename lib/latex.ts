/**
 * Compiles a LaTeX source string to PDF using Tectonic via node-latex-compiler. Downloads Tectonic binary automatically on first run. Requires Node.js runtime.
 */
import fs from "fs";
import { compile } from "node-latex-compiler";
import os from "os";
import path from "path";

type CompileResult = {
  status: string;
  error?: string;
  stderr?: string;
  pdfBuffer?: Uint8Array;
};

function resolveTectonicPath(): string | undefined {
  if (process.env.TECTONIC_PATH) {
    return process.env.TECTONIC_PATH;
  }

  if (process.platform === "win32") {
    const bundled = path.join(
      process.cwd(),
      "node_modules",
      "@node-latex-compiler",
      "bin-win32-x64",
      "bin",
      "tectonic.exe"
    );
    if (fs.existsSync(bundled)) {
      return bundled;
    }
  }

  return undefined;
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

export async function compileTex(texSource: string): Promise<Buffer> {
  try {
    ensureFontconfigEnv();
    const tectonicPath = resolveTectonicPath();
    const result = (await compile({
      tex: texSource,
      returnBuffer: true,
      ...(tectonicPath ? { tectonicPath } : {}),
    })) as CompileResult;

    if (result.status !== "success") {
      const errorMessage = result.error || result.stderr || "LaTeX compilation failed";
      throw new Error(errorMessage);
    }

    if (!result.pdfBuffer) {
      throw new Error("LaTeX compilation failed");
    }

    return Buffer.from(result.pdfBuffer);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`LaTeX compilation failed: ${message}`);
  }
}
