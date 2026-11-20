/** Platform-appropriate install command for an external tool. */
export function installHint(tool: "mpv" | "mkcert"): string {
  switch (process.platform) {
    case "darwin":
      return `brew install ${tool}`;
    case "win32":
      return `scoop bucket add extras && scoop install ${tool}`;
    default:
      return `install ${tool} with your package manager`;
  }
}
