const childProcess = require("node:child_process");
const { syncBuiltinESMExports } = require("node:module");

for (const method of ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync"]) {
  const original = childProcess[method];
  childProcess[method] = function hiddenWindowsChild(...args) {
    const optionsIndex = method.startsWith("execFile") ? 2 : method.startsWith("exec") ? 1 : 2;
    const current = args[optionsIndex];
    if (current == null || (typeof current === "object" && !Array.isArray(current))) {
      args[optionsIndex] = { ...(current || {}), windowsHide: true };
    }
    return original.apply(this, args);
  };
}

syncBuiltinESMExports();
