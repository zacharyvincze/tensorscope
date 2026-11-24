// The page template lives with the Python viewer so both readers serve the same page.
const fs = require("fs");
const path = require("path");

const ext = path.join(__dirname, "..");
const repo = path.join(ext, "..");
fs.mkdirSync(path.join(ext, "media"), { recursive: true });
fs.copyFileSync(path.join(repo, "viewer/src/tensorscope_viewer/html_viewer.html"),
                path.join(ext, "media/html_viewer.html"));
fs.copyFileSync(path.join(repo, "LICENSE"), path.join(ext, "LICENSE"));
