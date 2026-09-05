"use strict";

/*
 * AI.SW 부천연합해커톤 오후 프로젝트 스타터
 *
 * 이 파일의 예시 기능은 실행 환경 확인용입니다.
 * 프로젝트 기획이 승인되면 팀의 핵심 기능으로 교체하세요.
 *
 * 작업 원칙:
 * 1. 한 번에 기능 하나만 구현합니다.
 * 2. AI가 수정한 내용을 두 팀원이 함께 확인합니다.
 * 3. 실행하고 테스트한 뒤 커밋합니다.
 * 4. 개인정보나 API 키를 코드에 입력하지 않습니다.
 */

const startButton = document.querySelector("#start-button");
const resetButton = document.querySelector("#reset-button");
const newStageButton = document.querySelector("#new-stage-button");
const hintButton = document.querySelector("#hint-button");
const skipButton = document.querySelector("#skip-button");
const aiButton = document.querySelector("#ai-button");
const aiCommandInput = document.querySelector("#ai-command-input");
const commandInput = document.querySelector("#command-input");
const board = document.querySelector("#game-board");
const log = document.querySelector("#execution-log");
const result = document.querySelector("#result");
const appStatus = document.querySelector("#app-status");
const stepCount = document.querySelector("#step-count");
const ambiguityCount = document.querySelector("#ambiguity-count");

const SIZE = 15;
const directions = ["up", "right", "down", "left"];
const directionIcons = { up: "▲", right: "▶", down: "▼", left: "◀" };
const baseWalls = new Set();
for (let index = 0; index < SIZE; index += 1) {
  baseWalls.add(`${index},0`);
  baseWalls.add(`${index},${SIZE - 1}`);
  baseWalls.add(`0,${index}`);
  baseWalls.add(`${SIZE - 1},${index}`);
}

const state = {
  start: { col: 2, row: 12, direction: "up" },
  robot: { col: 2, row: 12, direction: "up" },
  key: { col: 5, row: 2 },
  box: { col: 5, row: 5 },
  stageBox: { col: 5, row: 5 },
  walls: new Set(baseWalls),
  pits: new Set(),
  stagePits: new Set(),
  saws: [],
  stageSaws: [],
  switchCell: null,
  doorCell: null,
  doorOpen: false,
  solutionPath: [],
  steps: 0,
  ambiguities: 0,
  hints: 0,
  skipped: 0,
  lastFailure: "",
  mode: "maze",
  stage: 1,
};

function keyOf(col, row) { return `${col},${row}`; }

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function makeDirectPath(start, key) {
  const path = [keyOf(start.col, start.row)];
  let cursor = { col: start.col, row: start.row };
  while (cursor.col !== key.col || cursor.row !== key.row) {
    const choices = [];
    if (cursor.col !== key.col) choices.push({ col: cursor.col + Math.sign(key.col - cursor.col), row: cursor.row });
    if (cursor.row !== key.row) choices.push({ col: cursor.col, row: cursor.row + Math.sign(key.row - cursor.row) });
    cursor = choices[randomInt(0, choices.length - 1)];
    path.push(keyOf(cursor.col, cursor.row));
  }
  return path;
}

function findGridPath(start, key, walls) {
  const queue = [{ col: start.col, row: start.row, path: [keyOf(start.col, start.row)] }];
  const visited = new Set(queue[0].path);
  while (queue.length) {
    const current = queue.shift();
    if (current.col === key.col && current.row === key.row) return current.path;
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([colDelta, rowDelta]) => {
      const col = current.col + colDelta;
      const row = current.row + rowDelta;
      const cellKey = keyOf(col, row);
      if (col < 1 || col > 13 || row < 1 || row > 13 || walls.has(cellKey) || visited.has(cellKey)) return;
      visited.add(cellKey);
      queue.push({ col, row, path: [...current.path, cellKey] });
    });
  }
  return [keyOf(start.col, start.row)];
}

function createMaze(start, key) {
  const walls = new Set(baseWalls);
  for (let row = 1; row <= 13; row += 1) {
    for (let col = 1; col <= 13; col += 1) walls.add(keyOf(col, row));
  }
  const carve = (col, row) => walls.delete(keyOf(col, row));
  const stack = [{ col: 1, row: 13 }];
  const visited = new Set([keyOf(1, 13)]);
  carve(1, 13);
  while (stack.length) {
    const current = stack[stack.length - 1];
    const neighbors = [[2, 0], [-2, 0], [0, 2], [0, -2]]
      .map(([colDelta, rowDelta]) => ({ col: current.col + colDelta, row: current.row + rowDelta }))
      .filter((cell) => cell.col >= 1 && cell.col <= 13 && cell.row >= 1 && cell.row <= 13 && !visited.has(keyOf(cell.col, cell.row)));
    if (!neighbors.length) {
      stack.pop();
      continue;
    }
    const next = neighbors[randomInt(0, neighbors.length - 1)];
    visited.add(keyOf(next.col, next.row));
    carve((current.col + next.col) / 2, (current.row + next.row) / 2);
    carve(next.col, next.row);
    stack.push(next);
  }
  carve(start.col, start.row);
  carve(key.col, key.row);
  return walls;
}

function createRandomStage() {
  const mode = state.stage <= 2 ? "maze" : state.stage <= 5 ? "box" : state.stage <= 8 ? "switch" : "saw";
  const start = mode === "maze" ? { col: 1, row: 13, direction: "up" } : { col: 2, row: 12, direction: "up" };
  const key = mode === "maze" ? { col: 13, row: 1 } : { col: randomInt(9, 12), row: randomInt(2, 4) };
  const walls = mode === "maze" ? createMaze(start, key) : new Set(baseWalls);
  const path = mode === "maze" ? findGridPath(start, key, walls) : makeDirectPath(start, key);
  const reserved = new Set(path);
  for (let index = 0; mode !== "maze" && index < 14 + Math.min(state.stage * 2, 18); index += 1) {
    const cell = { col: randomInt(2, 12), row: randomInt(2, 12) };
    if (!reserved.has(keyOf(cell.col, cell.row))) walls.add(keyOf(cell.col, cell.row));
  }

  const freeCells = [];
  for (let row = 2; row < 13; row += 1) {
    for (let col = 2; col < 13; col += 1) {
      const cellKey = keyOf(col, row);
      if (!walls.has(cellKey) && !reserved.has(cellKey)) freeCells.push({ col, row });
    }
  }
  const takeFree = () => freeCells.splice(randomInt(0, Math.max(0, freeCells.length - 1)), 1)[0];
  const box = mode === "box" ? { col: start.col, row: 7 } : null;
  const pits = new Set();
  if (mode === "box") {
    pits.add(keyOf(start.col, 5));
    walls.delete(keyOf(start.col, 7));
    walls.delete(keyOf(start.col, 6));
    walls.delete(keyOf(start.col, 5));
  }
  const switchCell = mode === "switch" ? { col: 5, row: 8 } : null;
  const doorCell = mode === "switch" ? { col: start.col, row: 7 } : null;
  if (mode === "switch") {
    makeDirectPath(start, switchCell).forEach((cell) => walls.delete(cell));
    walls.delete(keyOf(doorCell.col, doorCell.row));
  }
  const saws = mode === "saw" ? [{ col: 2, row: 8, axis: "horizontal", direction: 1, min: 2, max: 5 }] : [];
  return { start, key, path, walls, box, pits, switchCell, doorCell, saws, mode };
}

function loadRandomStage(increment = false) {
  if (increment) state.stage += 1;
  const stage = createRandomStage();
  state.start = stage.start;
  state.key = stage.key;
  state.stageBox = stage.box || { col: -1, row: -1 };
  state.stagePits = new Set(stage.pits);
  state.walls = stage.walls;
  state.pits = stage.pits;
  state.switchCell = stage.switchCell;
  state.doorCell = stage.doorCell;
  state.doorOpen = false;
  state.saws = stage.saws;
  state.stageSaws = stage.saws.map((saw) => ({ ...saw }));
  state.solutionPath = stage.path;
  state.mode = stage.mode;
  resetGame();
}

function renderBoard() {
  board.innerHTML = "";
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      const cell = document.createElement("div");
      const cellKey = keyOf(col, row);
      cell.className = "tile";
      cell.setAttribute("role", "gridcell");
      if (state.walls.has(cellKey)) cell.classList.add("wall");
      if (state.pits.has(cellKey)) { cell.classList.add("pit"); cell.textContent = "○"; }
      if (state.doorCell && state.doorCell.col === col && state.doorCell.row === row) { cell.classList.add(state.doorOpen ? "door-open" : "door"); cell.textContent = state.doorOpen ? "·" : "▥"; }
      if (state.switchCell && state.switchCell.col === col && state.switchCell.row === row) { cell.classList.add("switch"); cell.textContent = "⊙"; }
      if (state.saws.some((saw) => saw.col === col && saw.row === row)) { cell.classList.add("saw"); cell.textContent = "✹"; }
      if (state.key.col === col && state.key.row === row) { cell.classList.add("key"); cell.textContent = "◆"; }
      if (state.box.col === col && state.box.row === row) { cell.classList.add("box"); cell.textContent = "▣"; }
      if (state.robot.col === col && state.robot.row === row) { cell.classList.add("robot"); cell.textContent = directionIcons[state.robot.direction]; cell.setAttribute("aria-label", `로봇, ${state.robot.direction}`); }
      board.appendChild(cell);
    }
  }
  stepCount.textContent = state.steps;
  ambiguityCount.textContent = state.ambiguities;
}

function appendLog(message, type = "info") {
  const item = document.createElement("p");
  item.className = `log-item ${type}`;
  item.textContent = message;
  log.appendChild(item);
  log.scrollTop = log.scrollHeight;
}

function resetGame(clearLog = true) {
  state.robot = { ...state.start };
  state.box = state.stageBox ? { ...state.stageBox } : { col: -1, row: -1 };
  state.pits = new Set(state.stagePits);
  state.saws = state.stageSaws.map((saw) => ({ ...saw }));
  state.steps = 0;
  state.ambiguities = 0;
  state.lastFailure = "";
  state.doorOpen = false;
  if (clearLog) log.innerHTML = "";
  result.textContent = "명령을 입력하고 실행 버튼을 눌러 보세요.";
  appStatus.textContent = `스테이지 ${String(state.stage).padStart(2, "0")}`;
  appStatus.classList.remove("is-running");
  renderBoard();
}

function relativeDelta(direction, amount = 1) {
  const deltas = { up: [0, -amount], right: [amount, 0], down: [0, amount], left: [-amount, 0] };
  return deltas[direction];
}

function frontCell(distance = 1) {
  const [colDelta, rowDelta] = relativeDelta(state.robot.direction, distance);
  return { col: state.robot.col + colDelta, row: state.robot.row + rowDelta };
}

function hasBoxAt(cell) {
  return state.box.col === cell.col && state.box.row === cell.row;
}

function isClosedDoor(cell) {
  return state.doorCell && state.doorCell.col === cell.col && state.doorCell.row === cell.row && !state.doorOpen;
}

function activateSwitch() {
  if (state.switchCell && state.robot.col === state.switchCell.col && state.robot.row === state.switchCell.row && state.doorCell && !state.doorOpen) {
    state.doorOpen = true;
    appendLog("⊙ 스위치 작동 · 연결된 문이 열렸습니다.", "success");
  }
}

function moveRobot(amount) {
  let moved = 0;
  for (let index = 0; index < amount; index += 1) {
    const next = frontCell();
    if (state.walls.has(keyOf(next.col, next.row))) return { moved, blocked: "벽" };
    if (isClosedDoor(next)) return { moved, blocked: "잠긴 문" };
    if (hasBoxAt(next)) {
      const boxNext = frontCell(2);
      if (state.walls.has(keyOf(boxNext.col, boxNext.row)) || isClosedDoor(boxNext) || hasBoxAt(boxNext)) return { moved, blocked: "박스" };
      if (state.pits.has(keyOf(boxNext.col, boxNext.row))) {
        state.pits.delete(keyOf(boxNext.col, boxNext.row));
        state.box = { col: -1, row: -1 };
        appendLog("▣ 박스가 구덩이를 메웠습니다.", "success");
      } else {
        state.box = boxNext;
      }
    }
    state.robot = { ...state.robot, ...next };
    moved += 1;
    activateSwitch();
    if (state.pits.has(keyOf(state.robot.col, state.robot.row))) return { moved, failed: "구덩이에 빠졌습니다." };
    if (state.robot.col === state.key.col && state.robot.row === state.key.row) break;
  }
  return { moved };
}

function advanceSaws() {
  state.saws.forEach((saw) => {
    if (saw.axis === "horizontal") {
      saw.col += saw.direction;
      if (saw.col >= saw.max || saw.col <= saw.min) saw.direction *= -1;
    } else {
      saw.row += saw.direction;
      if (saw.row >= saw.max || saw.row <= saw.min) saw.direction *= -1;
    }
  });
  if (state.saws.some((saw) => saw.col === state.robot.col && saw.row === state.robot.row)) return "톱날에 닿았습니다.";
  return null;
}

function turn(turnDirection) {
  const index = directions.indexOf(state.robot.direction);
  const change = turnDirection === "left" ? -1 : 1;
  state.robot.direction = directions[(index + change + directions.length) % directions.length];
}

function parseCommand(line) {
  const trimmed = line.trim();
  let match = trimmed.match(/^(\d+)칸\s*(전진해|이동해)$/);
  if (match) return { type: "move", amount: Number(match[1]), text: trimmed };
  if (/^(전진해|이동해)$/.test(trimmed)) return { type: "move", amount: 1, text: trimmed };
  match = trimmed.match(/^(\d+)칸\s*후진해$/);
  if (match) return { type: "back", amount: Number(match[1]), text: trimmed };
  if (trimmed === "후진해") return { type: "back", amount: 1, text: trimmed };
  if (/^(왼쪽으로 돌아|좌회전해)$/.test(trimmed)) return { type: "turn", direction: "left", text: trimmed };
  if (/^(오른쪽으로 돌아|우회전해)$/.test(trimmed)) return { type: "turn", direction: "right", text: trimmed };
  if (/^(뒤로 돌아|180도 돌아)$/.test(trimmed)) return { type: "turn180", text: trimmed };
  if (/^(정지해|멈춰)$/.test(trimmed)) return { type: "stop", text: trimmed };
  match = trimmed.match(/^(정면|왼쪽|오른쪽|뒤)에\s*(벽|박스|열쇠|장애물)이?\s*(없을|있을)\s*때까지\s*(.+?)(?:을|를)\s*반복해$/);
  if (match) {
    const action = parseCommand(match[5]);
    if (action) return { type: "repeatUntil", side: match[1], object: match[2], untilPresent: match[3] === "있을", action, text: trimmed };
  }
  match = trimmed.match(/^(?:만약\s*)?(정면|왼쪽|오른쪽|뒤)에\s*(벽|박스|열쇠|장애물)이?\s*(있으면|없으면)\s*(.+)$/);
  if (match) {
    const action = parseCommand(match[5]);
    if (action) return { type: "condition", side: match[1], object: match[2], expected: match[3] === "있으면", action, text: trimmed };
  }
  return null;
}

function parseNaturalCommand(line) {
  const normalized = line.replace(/\s+/g, " ").trim();
  const numberWords = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5 };
  const repeated = normalized.match(/(\d+|한|두|세|네|다섯)\s*칸\s*(?:전진|앞으로\s*가|이동)(?:해|을|를)?\s*(\d+|한|두|세|네|다섯)\s*번(?:\s*해)?/);
  if (repeated) {
    return {
      type: "repeatFixed",
      count: numberWords[repeated[2]] || Number(repeated[2]),
      action: { type: "move", amount: numberWords[repeated[1]] || Number(repeated[1]), text: line },
      text: line,
    };
  }
  const naturalMove = normalized.match(/(\d+|한|두|세|네|다섯)\s*칸\s*(?:전진|앞으로\s*가|이동)(?:해)?$/);
  if (naturalMove) return { type: "move", amount: numberWords[naturalMove[1]] || Number(naturalMove[1]), text: line };
  const forwardMove = normalized.match(/앞으로\s*(\d+|한|두|세|네|다섯)\s*칸\s*(?:가|전진|이동)(?:해)?$/);
  if (forwardMove) return { type: "move", amount: numberWords[forwardMove[1]] || Number(forwardMove[1]), text: line };
  const wallTrigger = normalized.match(/벽.*?(?:닿|만나|부딪히|부딪치).*?(?:때까지|전까지|면|면은)(.*)$/);
  if (wallTrigger && /(?:돌|틀|회전|움직|전진|이동)/.test(wallTrigger[1])) {
    const afterWall = wallTrigger[1];
    const actions = [{ type: "repeatUntil", side: "정면", object: "벽", untilPresent: false, action: { type: "move", amount: 1, text: "전진해" }, text: line }];
    if (/왼쪽/.test(afterWall)) actions.push({ type: "turn", direction: "left", text: "왼쪽으로 돌아" });
    else if (/오른쪽/.test(afterWall)) actions.push({ type: "turn", direction: "right", text: "오른쪽으로 돌아" });
    else actions.push({ type: "turn180", text: "뒤로 돌아" });
    const distance = afterWall.match(/(\d+|한|두|세|네|다섯)\s*칸/);
    if (distance) actions.push({ type: "move", amount: numberWords[distance[1]] || Number(distance[1]), text: afterWall });
    else if (/움직|전진|직진|가/.test(afterWall)) actions.push({ type: "move", amount: 1, text: afterWall });
    return { type: "sequence", actions, text: line };
  }
  const wallUntil = /벽.*?(?:닿|만나|부딪히|부딪치).*?(?:때까지|전까지)/.test(normalized);
  const keepGoing = /(?:전진|앞으로|직진|계속|쭉|쭈+)/.test(normalized);
  if (wallUntil && keepGoing) {
    return {
      type: "repeatUntil",
      side: "정면",
      object: "벽",
      untilPresent: false,
      action: { type: "move", amount: 1, text: "전진해" },
      text: line,
    };
  }
  const moveMatch = normalized.match(/(?:앞으로|전진|이동).*?(\d+)\s*(?:칸|걸음)/);
  if (moveMatch) return { type: "move", amount: Number(moveMatch[1]), text: line };
  if (/왼쪽으로?\s*(?:돌|틀)|좌회전/.test(normalized)) return { type: "turn", direction: "left", text: line };
  if (/오른쪽으로?\s*(?:돌|틀)|우회전/.test(normalized)) return { type: "turn", direction: "right", text: line };
  return null;
}

function ambiguousReason(line) {
  const rules = [
    [/가까워지면|다가가면|근처에서|앞두고/, "'가까워지면'은 정확한 거리가 아니에요. 몇 칸 남았을 때인지 말해주세요."],
    [/조금|약간|여러 번|몇 번|좀/, "정확한 숫자를 알려주세요. 예: '2칸', '3번'."],
    [/빨리|천천히|적당히|알아서|조심히|잘/, "AI는 '적당히'가 어느 정도인지 몰라요. 구체적인 행동을 알려주세요."],
    [/그쪽|저기|거기|이쪽/, "'그쪽' 대신 캐릭터 기준의 명확한 행동을 말해주세요."],
    [/계속|끝까지|무한히|계속해서/, "언제까지 반복할지 조건이 없어요. 종료 조건을 함께 말해주세요."],
  ];
  return rules.find(([pattern]) => pattern.test(line))?.[1];
}

function sensorValue(side, object) {
  const sideIndex = { 정면: 0, 오른쪽: 1, 뒤: 2, 왼쪽: 3 }[side];
  const direction = directions[(directions.indexOf(state.robot.direction) + sideIndex) % directions.length];
  const [colDelta, rowDelta] = relativeDelta(direction);
  const target = { col: state.robot.col + colDelta, row: state.robot.row + rowDelta };
  if (object === "벽") return state.walls.has(keyOf(target.col, target.row));
  if (object === "박스") return state.box.col === target.col && state.box.row === target.row;
  if (object === "열쇠") return state.key.col === target.col && state.key.row === target.row;
  return false;
}

function execute(command) {
  if (command.type === "move") return moveRobot(command.amount);
  if (command.type === "back") {
    const original = state.robot.direction;
    turn("left"); turn("left");
    const outcome = moveRobot(command.amount);
    state.robot.direction = original;
    return outcome;
  }
  if (command.type === "turn") turn(command.direction);
  if (command.type === "turn180") turn("left");
  if (command.type === "turn180") turn("left");
  return { moved: 0 };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function fallbackAmbiguousCommand(line) {
  if (/빨리|천천히|적당히|알아서|조심히|잘/.test(line)) return { type: "stop", text: line };
  if (/그쪽|저기|거기|이쪽/.test(line)) return { type: "turn", direction: "right", text: line };
  return { type: "move", amount: 1, text: line };
}

async function executeAnimated(command) {
  if (command.type === "sequence") {
    let outcome = { moved: 0 };
    for (const action of command.actions) {
      outcome = await executeAnimated(action);
      if (outcome.blocked || outcome.failed) return outcome;
    }
    return outcome;
  }
  if (command.type === "repeatFixed") {
    let outcome = { moved: 0 };
    for (let index = 0; index < command.count; index += 1) {
      outcome = await executeAnimated(command.action);
      if (outcome.blocked || outcome.failed) return outcome;
      appendLog(`↻ 반복 ${index + 1}/${command.count}회 실행`, "info");
    }
    return outcome;
  }
  if (command.type === "repeatUntil") {
    let outcome = { moved: 0 };
    let count = 0;
    while (sensorValue(command.side, command.object) !== command.untilPresent && count < 30) {
      outcome = await executeAnimated(command.action);
      if (outcome.blocked || outcome.failed) return outcome;
      count += 1;
    }
    return outcome;
  }
  if (command.type === "condition") return executeAnimated(command.action);
  if (command.type === "move") {
    let outcome = { moved: 0 };
    for (let index = 0; index < command.amount; index += 1) {
      outcome = moveRobot(1);
      renderBoard();
      if (outcome.blocked || outcome.failed) return outcome;
      await wait(500);
    }
    return outcome;
  }
  if (command.type === "back") {
    const original = state.robot.direction;
    turn("left");
    turn("left");
    let outcome = { moved: 0 };
    for (let index = 0; index < command.amount; index += 1) {
      outcome = moveRobot(1);
      renderBoard();
      if (outcome.blocked || outcome.failed) break;
      await wait(500);
    }
    state.robot.direction = original;
    renderBoard();
    return outcome;
  }
  execute(command);
  renderBoard();
  await wait(500);
  return { moved: 0 };
}

async function requestAiCommand(command) {
  const response = await fetch("/api/interpret", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command, map: getMapForAi() }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "AI 해석에 실패했습니다.");
  return data;
}

async function requestComposedCommand(command) {
  const response = await fetch("/api/compose", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "AI 문장 다듬기에 실패했습니다.");
  return data.command;
}

function explainUnreachedGoal() {
  if (state.robot.col === state.key.col && state.robot.row === state.key.row) return "열쇠 칸에 도착했습니다.";
  const columnDistance = Math.abs(state.key.col - state.robot.col);
  const rowDistance = Math.abs(state.key.row - state.robot.row);
  const directionNames = { up: "위쪽", right: "오른쪽", down: "아래쪽", left: "왼쪽" };
  const reasons = [];
  if (state.lastFailure) reasons.push(state.lastFailure);
  if (state.robot.direction && ((state.robot.direction === "up" && state.key.row > state.robot.row) || (state.robot.direction === "down" && state.key.row < state.robot.row) || (state.robot.direction === "left" && state.key.col > state.robot.col) || (state.robot.direction === "right" && state.key.col < state.robot.col))) {
    reasons.push(`현재 ${directionNames[state.robot.direction]}을 보고 있어 목표 방향과 시선이 어긋났습니다`);
  }
  reasons.push(`현재 위치에서 열쇠까지 가로 ${columnDistance}칸, 세로 ${rowDistance}칸이 남았습니다`);
  return `도착하지 못했습니다. ${reasons.join(". ")}.`;
}

async function runProgram() {
  const lines = commandInput.value.split(/[.\n]/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return;
  appStatus.textContent = "실행 중";
  appStatus.classList.add("is-running");
  state.lastFailure = "";
  let reachedGoal = false;
  startButton.disabled = true;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    let line = lines[lineIndex];
    let command = parseCommand(line);
    if (!command) {
      try {
        appendLog(`… AI가 자연어 명령을 해석하는 중 · ${line}`, "info");
        const aiResult = await requestAiCommand(line);
        if (aiResult.reason) state.ambiguities += 1;
        appendLog(aiResult.reason ? `⚠ AI 판정 · ${aiResult.reason}` : `✦ AI 판정 · ${line} → ${aiResult.program}`, aiResult.reason ? "warning" : "info");
        const interpretedLines = aiResult.program.split(/[.\n]/).map((item) => item.trim()).filter(Boolean);
        if (interpretedLines.length > 1) {
          lines.splice(lineIndex, 1, ...interpretedLines);
          line = lines[lineIndex];
        }
        command = parseCommand(line);
      } catch (error) {
        appendLog(`! AI 연결 실패 · ${error.message}`, "warning");
        state.ambiguities += 1;
        command = parseNaturalCommand(line) || fallbackAmbiguousCommand(line);
        appendLog(`↯ 대체 오작동 · ${line} → ${command.type === "move" ? "1칸 전진해" : command.type === "turn" ? "오른쪽으로 돌아" : "정지해"}`, "warning");
      }
    }
    if (!command) {
      const reason = ambiguousReason(line);
      state.ambiguities += reason ? 1 : 0;
      appendLog(reason ? `⚠ ${line} · ${reason}` : `? ${line} · 명령을 이해하지 못했습니다.`, reason ? "warning" : "muted");
      command = parseNaturalCommand(line) || fallbackAmbiguousCommand(line);
      appendLog(`↯ 모호한 명령 실행 · ${command.type === "move" ? "1칸 전진해" : command.type === "turn" ? "오른쪽으로 돌아" : "정지해"}`, "warning");
    }
    let shouldRun = true;
    if (command.type === "condition") {
      shouldRun = sensorValue(command.side, command.object) === command.expected;
      appendLog(`› ${line} · 조건 ${shouldRun ? "충족" : "불충족"}`, shouldRun ? "success" : "muted");
      if (!shouldRun) {
        state.lastFailure = "조건이 충족되지 않아 해당 행동을 실행하지 못했습니다";
        continue;
      }
      const outcome = await executeAnimated(command.action);
      if (outcome.blocked) appendLog(`! ${outcome.blocked}에 막혔습니다.`, "warning");
      if (outcome.blocked) state.lastFailure = `${outcome.blocked}에 막혔습니다`;
      if (outcome.failed) {
        state.lastFailure = outcome.failed;
        result.textContent = `실패 · ${outcome.failed} 다시 시작 버튼으로 재시도하세요.`;
        appStatus.textContent = "실패";
        appendLog(`✕ ${outcome.failed}`, "warning");
        break;
      }
    } else {
      const outcome = await executeAnimated(command);
      if (outcome.blocked) appendLog(`! ${outcome.blocked}에 막혔습니다.`, "warning");
      if (outcome.blocked) state.lastFailure = `${outcome.blocked}에 막혔습니다`;
      if (outcome.failed) {
        state.lastFailure = outcome.failed;
        result.textContent = `실패 · ${outcome.failed} 다시 시작 버튼으로 재시도하세요.`;
        appStatus.textContent = "실패";
        appendLog(`✕ ${outcome.failed}`, "warning");
        break;
      }
      appendLog(`✓ ${line} · 정확한 명령으로 실행됨`, "success");
    }
    state.steps += 1;
    const hazardFailure = advanceSaws();
    if (hazardFailure) {
      state.lastFailure = hazardFailure;
      result.textContent = `실패 · ${hazardFailure} 다시 시작 버튼으로 재시도하세요.`;
      appStatus.textContent = "실패";
      appendLog(`✕ ${hazardFailure}`, "warning");
      break;
    }
    if (shouldRun && state.robot.col === state.key.col && state.robot.row === state.key.row) {
      reachedGoal = true;
      result.textContent = "열쇠를 획득했습니다! 명확한 지시로 스테이지 클리어.";
      appStatus.textContent = "스테이지 클리어";
      appStatus.classList.add("is-running");
      appendLog("★ 목표 도착 · 다음 스테이지를 준비하세요.", "success");
      break;
    }
  }
  startButton.disabled = false;
  renderBoard();
  if (!reachedGoal) {
    const explanation = explainUnreachedGoal();
    result.textContent = explanation;
    appendLog(`ℹ 실행 결과 · ${explanation}`, "warning");
  }
}

function makeNewStage() {
  loadRandomStage(true);
  appendLog(`새로운 랜덤 맵 ${String(state.stage).padStart(2, "0")}이 생성되었습니다.`, "info");
}

function showHint() {
  state.hints += 1;
  const nextPathCell = state.solutionPath.find((cell) => cell !== keyOf(state.robot.col, state.robot.row));
  const hints = {
    maze: "갈림길에서는 벽을 따라가며 현재 방향을 확인하세요. 열쇠까지 이어지는 통로가 하나 있습니다.",
    box: "박스를 위로 밀어 구덩이를 메워야 합니다. 박스 앞이 아니라 뒤에서 전진하세요.",
    switch: "문 앞에서 막히면 옆 통로로 돌아 스위치를 밟으세요. 스위치가 문을 엽니다.",
    saw: "톱날은 행동마다 움직입니다. 정면의 톱날 위치를 확인하고 정지와 전진의 타이밍을 조절하세요.",
  };
  let hint = hints[state.mode] || "먼저 로봇의 현재 방향을 확인하고, 한 번에 필요한 칸 수만 말해 보세요.";
  if (state.pits.size) hint = "구덩이는 박스로 메울 수 있습니다. 박스를 구덩이 쪽으로 밀어 보세요.";
  if (state.doorCell && !state.doorOpen) hint = "잠긴 문은 지나갈 수 없습니다. 우회해서 스위치를 먼저 밟으세요.";
  if (state.saws.length) hint = "톱날은 명령 한 번마다 한 칸 움직입니다. 정면에 톱날이 있으면 정지해 보세요.";
  if (nextPathCell) appendLog(`💡 힌트 · ${hint}`, "info");
  result.textContent = hint;
}

function skipStage() {
  state.skipped += 1;
  loadRandomStage(true);
  appendLog(`⏭ 스테이지를 건너뛰었습니다. 다음 맵 ${String(state.stage).padStart(2, "0")}`, "warning");
}

function getMapForAi() {
  return {
    size: SIZE,
    robot: state.robot,
    key: state.key,
    box: state.box,
    walls: [...state.walls].map((cell) => {
      const [col, row] = cell.split(",").map(Number);
      return { col, row };
    }),
  };
}

async function interpretWithAi() {
  const naturalCommand = aiCommandInput.value.trim();
  if (!naturalCommand) {
    result.textContent = "먼저 AI에게 해석할 자연어 명령을 입력해 주세요.";
    aiCommandInput.focus();
    return;
  }

  aiButton.disabled = true;
  aiButton.textContent = "해석 중...";
  result.textContent = "AI가 게임 문법으로 변환하고 있습니다.";
  try {
    const composedCommand = await requestComposedCommand(naturalCommand);
    commandInput.value = composedCommand;
    appendLog(`✦ AI 문장 다듬기 · ${composedCommand}`, "info");
    result.textContent = "명령 문장을 다듬었습니다. 실행 버튼을 누르면 AI가 행동으로 해석합니다.";
  } catch (error) {
    result.textContent = error.message;
    appendLog(`! AI 연결 실패 · ${error.message}`, "warning");
  } finally {
    aiButton.disabled = false;
    aiButton.textContent = "✦ 문장 다듬기";
  }
}

loadRandomStage(false);
startButton.addEventListener("click", runProgram);
resetButton.addEventListener("click", () => resetGame());
newStageButton.addEventListener("click", makeNewStage);
hintButton.addEventListener("click", showHint);
skipButton.addEventListener("click", skipStage);
aiButton.addEventListener("click", interpretWithAi);
