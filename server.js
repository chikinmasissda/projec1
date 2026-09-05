const http = require("http");
const fs = require("fs");
const path = require("path");

function loadEnvironmentFile() {
  const environmentPath = path.join(__dirname, ".env");
  if (!fs.existsSync(environmentPath)) return;
  const lines = fs.readFileSync(environmentPath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) return;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  });
}

function loadLocalSecrets() {
  const secretsPath = path.join(__dirname, ".secrets.js");
  if (!fs.existsSync(secretsPath)) return;
  const secrets = require(secretsPath);
  if (!process.env.GEMINI_API_KEY && typeof secrets.GEMINI_API_KEY === "string") {
    process.env.GEMINI_API_KEY = secrets.GEMINI_API_KEY;
  }
  if (!process.env.GEMINI_MODEL && typeof secrets.GEMINI_MODEL === "string") {
    process.env.GEMINI_MODEL = secrets.GEMINI_MODEL;
  }
}

loadLocalSecrets();
loadEnvironmentFile();

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

function sendJson(response, statusCode, payload) {
  sendResponse(
    response,
    statusCode,
    "application/json; charset=utf-8",
    JSON.stringify(payload)
  );
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10000) {
        reject(new Error("요청이 너무 큽니다."));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("서버에 GEMINI_API_KEY가 설정되지 않았습니다.");

  const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";
  const aiResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 500 },
      }),
    }
  );
  const data = await aiResponse.json();
  if (!aiResponse.ok) throw new Error(data.error?.message || "Gemini API 요청에 실패했습니다.");
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error("Gemini가 결과를 반환하지 않았습니다.");
  return text;
}

function parseAiJson(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  return JSON.parse(cleaned);
}

function isCell(value) {
  return Number.isInteger(value) && value >= 1 && value <= 13;
}

function validateStage(stage) {
  if (!stage || !isCell(stage.start?.col) || !isCell(stage.start?.row) || !["up", "right", "down", "left"].includes(stage.start.direction)) throw new Error("AI 맵의 시작 위치가 올바르지 않습니다.");
  if (!isCell(stage.key?.col) || !isCell(stage.key?.row)) throw new Error("AI 맵의 열쇠 위치가 올바르지 않습니다.");
  if (!Array.isArray(stage.walls) || stage.walls.length > 70) throw new Error("AI 맵의 벽 정보가 올바르지 않습니다.");
  const walls = stage.walls.filter((cell) => isCell(cell?.col) && isCell(cell?.row));
  const uniqueWalls = new Set(walls.map((cell) => `${cell.col},${cell.row}`));
  if (uniqueWalls.has(`${stage.start.col},${stage.start.row}`) || uniqueWalls.has(`${stage.key.col},${stage.key.row}`)) throw new Error("AI 맵의 시작점 또는 열쇠가 벽과 겹칩니다.");
  return { start: stage.start, key: stage.key, box: stage.box || null, walls };
}

function isVagueRequest(command) {
  return /열쇠로|도착지점|목표로|알아서|그냥 가/.test(command);
}

function vagueFallback(command) {
  if (/알아서|적당히|빨리|천천히|조심히/.test(command)) return "정지해";
  if (/그쪽|저기|거기|이쪽/.test(command)) return "오른쪽으로 돌아";
  return "1칸 전진해";
}

function sanitizeAiCommand(program) {
  const normalized = program.replace(/^```(?:text)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const action = "(?:(?:\\d+칸\\s*)?(?:전진해|이동해|후진해)|왼쪽으로 돌아|오른쪽으로 돌아|좌회전해|우회전해|뒤로 돌아|180도 돌아|정지해|멈춰)";
  const condition = `(?:만약\\s*)?(?:정면|왼쪽|오른쪽|뒤)에\\s*(?:벽|박스|열쇠|장애물)(?:이|가)?\\s*(?:있으면|없으면)\\s*${action}`;
  const repeat = `(?:정면|왼쪽|오른쪽|뒤)에\\s*(?:벽|박스|열쇠|장애물)(?:이|가)?\\s*(?:있을|없을) 때까지\\s*.+?를\\s*반복해`;
  const allowed = new RegExp(`^(?:${action}|${condition}|${repeat})\\.?$`);
  const lines = normalized.split(/\r?\n|\./).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0 || lines.length > 8 || lines.some((line) => !allowed.test(`${line}.`))) return "정지해";
  return lines.join(".\n");
}

async function composeCommand(request, response) {
  try {
    const body = JSON.parse(await readRequestBody(request));
    const command = typeof body.command === "string" ? body.command.trim() : "";
    if (!command || command.length > 500) {
      sendJson(response, 400, { error: "문장은 1~500자 사이여야 합니다." });
      return;
    }
    const result = await callGemini(`너는 한국어 퍼즐 게임의 명령 문장 편집기다. 사용자의 문장을 자연스럽게 다듬되, 원문에 포함된 행동·조건·순서·반복 횟수를 하나도 삭제하거나 합치거나 요약하지 않는다. 경로를 계산하거나 열쇠까지의 정답을 만들지 않는다. 원문이 길어도 모든 행동을 유지한다. 설명과 마크다운 없이 한 문장만 출력한다.
  예를 들어 '앞으로 계속 가다가 벽 만나면 왼쪽으로 틀고 한칸 전진, 오른쪽으로 틀고 벽 만날때까지 계속 직진'은 일부만 남기지 말고 모든 행동을 자연스러운 한 문장으로 다시 써야 한다.
  사용자 문장: ${command}`);
    const composed = result.replace(/[\r\n]+/g, " ").trim();
    const preserved = command.includes("그리고") || command.includes(",") || command.length > 45;
    sendJson(response, 200, { command: preserved && composed.length < command.length * 0.55 ? command : composed });
  } catch (error) {
    sendJson(response, error.message.includes("GEMINI_API_KEY") ? 503 : 502, { error: error.message });
  }
}

async function generateStage(request, response) {
  try {
    const stage = parseAiJson(await callGemini(`
AI 퍼즐 게임의 새 15x15 맵을 생성하라. 바깥 테두리는 벽으로 처리되므로 내부 좌표 1~13만 사용한다. 로봇 시작점에서 열쇠까지 걸어갈 수 있고, 필요하면 박스 1개를 사용한다. 벽은 너무 복잡하지 않게 10~35개만 배치한다. 반드시 아래 JSON만 출력한다. 설명과 마크다운은 금지한다.
{"start":{"col":2,"row":12,"direction":"up"},"key":{"col":10,"row":2},"box":{"col":5,"row":5},"walls":[{"col":4,"row":8}]}
  `));
    sendJson(response, 200, { stage: validateStage(stage) });
  } catch (error) {
    sendJson(response, error.message.includes("GEMINI_API_KEY") ? 503 : 502, { error: error.message });
  }
}

async function interpretCommand(request, response) {
  try {
    const body = JSON.parse(await readRequestBody(request));
    const command = typeof body.command === "string" ? body.command.trim() : "";
    const map = body.map;
    if (!command || command.length > 500) {
      sendJson(response, 400, { error: "명령은 1~500자 사이여야 합니다." });
      return;
    }
    if (!map || !map.robot || !map.key) {
      sendJson(response, 400, { error: "현재 맵 상태가 필요합니다." });
      return;
    }

    if (isVagueRequest(command)) {
      sendJson(response, 200, { program: vagueFallback(command), reason: "거리·시점·방향이 모호해 정확한 의도 대신 예측 가능한 오작동을 실행했습니다." });
      return;
    }

    const rawProgram = await callGemini(`너는 AI 퍼즐 게임의 범용 자연어 행동 해석기다. 정확한 문법인지 검사하는 역할이 아니라, 한국어 명령의 의미를 행동 프로그램으로 해석하는 역할이다. 입력 문장을 수정하거나 다시 써서 보여주지 말고, 의미를 행동 프로그램으로만 번역한다. 맵 전체를 풀거나 열쇠까지의 경로를 계산하지 않는다. 문장에 있는 행동·수량·반복·조건을 순서대로 모두 보존한다. 사용자가 표현을 다르게 써도 같은 의미의 게임 행동으로 이해한다.
  사용자 입력: ${command}

  의미가 명확한 행동은 아래 문법으로 번역한다. 먼저 문장을 언플러그드 코딩처럼 작은 행동으로 분해한다. '1칸 전진을 3번 해'는 '1칸 전진해'를 3회 반복하고, '3칸 전진'이나 '앞으로 세 칸 가'는 3칸 이동한다. '잼 병 뚜껑을 열고 퍼서 빵에 발라'처럼 행동 사이에 생략된 자연스러운 동작이 있어도 순서를 보존해 각각 실행한다. 조건 뒤의 행동도 버리지 않는다. '계속 전진하다가 벽을 만나면 돌아서 두칸 움직여'는 '정면에 벽이 없을 때까지 전진해를 반복해. 뒤로 돌아. 2칸 전진해.'로 해석한다. '벽을 만나면 왼쪽으로 틀고 한칸 가'는 반복, 왼쪽 회전, 1칸 전진의 세 행동으로 해석한다. '돌아서'처럼 방향이 없으면 뒤로 돌아(180도 회전)를 선택한다. 다음 자연어 표현은 모두 같은 반복 행동이다: '벽에 닿을 때까지 전진해', '벽 만날 때까지 계속 가', '앞으로 쭉 가다가 벽을 만나면 멈춰', '앞으로 쭈우우욱 가다가 벽 만나면 오른쪽으로 돌아'. 첫 세 표현은 '정면에 벽이 없을 때까지 전진해를 반복해'로, 마지막 표현은 그 뒤에 '오른쪽으로 돌아'를 이어서 출력한다.
  - 숫자칸 전진해 / 숫자칸 이동해 / 숫자칸 후진해
  - 왼쪽으로 돌아 / 오른쪽으로 돌아 / 좌회전해 / 우회전해 / 뒤로 돌아 / 정지해
  - 정면/왼쪽/오른쪽/뒤에 벽/박스/열쇠가 있으면 행동
  - 정면/왼쪽/오른쪽/뒤에 벽/박스/열쇠가 없을 때까지 행동을 반복해

  '열쇠로 가줘', '도착지점까지 가', '목표로 가'처럼 행동 없이 목적지만 말하는 요청은 정지해로 출력한다. 그 외 이해 가능한 행동은 정지해로 거절하지 말고 최대한 작은 행동으로 분해한다. 출력은 명령만 하고 설명, 마크다운, 좌표는 금지한다.
  현재 맵 정보는 참고하지 않는다: ${JSON.stringify(map)}`);
    sendJson(response, 200, { program: sanitizeAiCommand(rawProgram) });
  } catch (error) {
    sendJson(response, error.message.includes("GEMINI_API_KEY") ? 503 : 502, { error: error.message });
  }
}

const server = http.createServer((request, response) => {
  if (request.method === "POST" && request.url === "/api/compose") {
    composeCommand(request, response);
    return;
  }
  if (request.method === "POST" && request.url === "/api/interpret") {
    interpretCommand(request, response);
    return;
  }
  if (request.method === "POST" && request.url === "/api/generate-stage") {
    generateStage(request, response);
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    sendResponse(response, 405, "text/plain; charset=utf-8", "405 Method Not Allowed");
    return;
  }

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
