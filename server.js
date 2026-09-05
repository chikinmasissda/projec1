const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0";
const PUBLIC_DIRECTORY = __dirname;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function sendResponse(response, statusCode, contentType, body) {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-cache",
  });
  response.end(body);
}

function getSafeFilePath(requestUrl) {
  const url = new URL(requestUrl, `http://${HOST}:${PORT}`);
  const requestedPath = decodeURIComponent(url.pathname);
  const normalizedPath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const relativePath =
    normalizedPath === "/" || normalizedPath === "."
      ? "index.html"
      : normalizedPath.replace(/^[/\\]+/, "");

  const filePath = path.resolve(PUBLIC_DIRECTORY, relativePath);
  const relativeToPublic = path.relative(PUBLIC_DIRECTORY, filePath);

  if (
    relativeToPublic.startsWith("..") ||
    path.isAbsolute(relativeToPublic) ||
    relativePath.startsWith(".")
  ) {
    return null;
  }

  return filePath;
}

const server = http.createServer((request, response) => {
  const filePath = getSafeFilePath(request.url);

  if (!filePath) {
    sendResponse(response, 403, "text/plain; charset=utf-8", "403 Forbidden");
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      sendResponse(
        response,
        404,
        "text/plain; charset=utf-8",
        "404 Not Found"
      );
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const contentType =
      MIME_TYPES[extension] || "application/octet-stream";

    fs.readFile(filePath, (readError, content) => {
      if (readError) {
        sendResponse(
          response,
          500,
          "text/plain; charset=utf-8",
          "500 Internal Server Error"
        );
        return;
      }

      sendResponse(response, 200, contentType, content);
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log("");
  console.log("==============================================");
  console.log(" AI.SW 부천연합해커톤 프로젝트 서버");
  console.log(` http://localhost:${PORT}`);
  console.log("==============================================");
  console.log("");
});
