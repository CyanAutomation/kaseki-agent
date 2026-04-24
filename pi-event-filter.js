#!/usr/bin/env node
const fs = require("node:fs");
const readline = require("node:readline");

const inputPath = process.argv[2] ?? "/tmp/pi-events.raw.jsonl";
const filteredPath = process.argv[3] ?? "/results/pi-events.jsonl";
const summaryPath = process.argv[4] ?? "/results/pi-summary.json";

const eventCounts = {};
const assistantEventCounts = {};
const models = {};
const apis = {};
let toolStartCount = 0;
let toolEndCount = 0;
let invalidJsonLines = 0;
let firstTimestamp = null;
let lastTimestamp = null;

function increment(map, key) {
  if (!key) return;
  map[key] = (map[key] ?? 0) + 1;
}

function observeModelAndApi(message) {
  if (!message || typeof message !== "object") return;
  increment(models, message.model);
  increment(apis, message.api);
}

function eventTimestamp(event) {
  const candidates = [
    event.timestamp,
    event.message?.timestamp,
    event.assistantMessageEvent?.message?.timestamp,
    event.assistantMessageEvent?.partial?.timestamp,
  ];
  for (const value of candidates) {
    if (typeof value === "string") return value;
    if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  }
  return null;
}

function shouldKeep(event) {
  const assistantType = event.assistantMessageEvent?.type;
  if (assistantType?.startsWith("thinking_")) return false;
  return true;
}

function sanitize(event) {
  const copy = JSON.parse(JSON.stringify(event));
  if (copy.assistantMessageEvent?.partial?.content) {
    copy.assistantMessageEvent.partial.content = copy.assistantMessageEvent.partial.content.filter(
      (part) => part?.type !== "thinking"
    );
  }
  if (copy.message?.content) {
    copy.message.content = copy.message.content.filter((part) => part?.type !== "thinking");
  }
  return copy;
}

async function main() {
  const input = fs.createReadStream(inputPath, { encoding: "utf8" });
  const output = fs.createWriteStream(filteredPath, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });

  for await (const line of lines) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      invalidJsonLines++;
      continue;
    }

    increment(eventCounts, event.type ?? "<missing>");
    const timestamp = eventTimestamp(event);
    if (timestamp) {
      firstTimestamp ??= timestamp;
      lastTimestamp = timestamp;
    }

    observeModelAndApi(event.message);
    observeModelAndApi(event.assistantMessageEvent?.message);
    observeModelAndApi(event.assistantMessageEvent?.partial);

    const assistantType = event.assistantMessageEvent?.type;
    increment(assistantEventCounts, assistantType);
    if (event.type === "tool_execution_start") toolStartCount++;
    if (event.type === "tool_execution_end") toolEndCount++;

    if (shouldKeep(event)) {
      output.write(`${JSON.stringify(sanitize(event))}\n`);
    }
  }

  await new Promise((resolve) => output.end(resolve));

  const selectedModel = Object.entries(models).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const selectedApi = Object.entries(apis).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  fs.writeFileSync(
    summaryPath,
    `${JSON.stringify(
      {
        selected_model: selectedModel,
        selected_api: selectedApi,
        event_counts: eventCounts,
        assistant_event_counts: assistantEventCounts,
        tool_start_count: toolStartCount,
        tool_end_count: toolEndCount,
        invalid_json_lines: invalidJsonLines,
        first_event_at: firstTimestamp,
        last_event_at: lastTimestamp,
      },
      null,
      2
    )}\n`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
