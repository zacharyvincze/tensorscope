// vsce packages only files under the extension directory, so the repo's LICENSE is copied in.
const fs = require("fs");
const path = require("path");

const ext = path.join(__dirname, "..");
fs.copyFileSync(path.join(ext, "..", "LICENSE"), path.join(ext, "LICENSE"));
