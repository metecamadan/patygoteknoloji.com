#!/usr/bin/env node
/**
 * VPS pull-deploy: origin/main Test job yeşilse git reset --hard + pm2 restart.
 * GitHub → sunucu SSH gerekmez (authorized_keys boşken appleboy 1 sn'de düşer).
 */
"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_REPO = "metecamadan/patygoteknoloji.com";
const PM2_NAME = process.env.DEPLOY_PM2_NAME || "patygo";
const INTERVAL_MS = Math.max(15_000, Number(process.env.DEPLOY_WATCH_MS) || 45_000);

function evaluateDeployDecision(input) {
  const localSha = String((input && input.localSha) || "");
  const remoteSha = String((input && input.remoteSha) || "");
  if (!remoteSha || remoteSha === localSha) {
    return { action: "noop", reason: "already-current" };
  }
  const testStatus = String((input && input.testStatus) || "");
  const testConclusion = String((input && input.testConclusion) || "");
  if (testStatus && testStatus !== "completed") {
    return { action: "wait", reason: "test-running" };
  }
  if (testConclusion && testConclusion !== "success") {
    return { action: "skip", reason: "test-failed" };
  }
  if (testConclusion !== "success") {
    return { action: "wait", reason: "test-unknown" };
  }
  return { action: "deploy", reason: "test-green" };
}

function repoFromRemote(url) {
  const text = String(url || "").trim();
  const https = text.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (!https) return DEFAULT_REPO;
  return https[1] + "/" + https[2];
}

function git(args, cwd) {
  const result = spawnSync("git", args, {
    cwd: cwd || ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "git failed").trim().slice(0, 300));
  }
  return String(result.stdout || "").trim();
}

async function readJson(url, fetcher) {
  const fetchFn = fetcher || fetch;
  const response = await fetchFn(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "patygo-deploy-watch",
    },
  });
  if (!response.ok) {
    throw new Error("GitHub API " + response.status);
  }
  return response.json();
}

function pickTestJob(jobs) {
  const list = (jobs && jobs.jobs) || [];
  return (
    list.find((job) => String(job.name || "").toLowerCase() === "test") ||
    list.find((job) => /test/i.test(String(job.name || ""))) ||
    null
  );
}

async function loadTestJob(repo, sha, fetcher) {
  const runs = await readJson(
    "https://api.github.com/repos/" +
      repo +
      "/actions/runs?head_sha=" +
      encodeURIComponent(sha) +
      "&event=push&per_page=5",
    fetcher
  );
  const run = Array.isArray(runs.workflow_runs) ? runs.workflow_runs[0] : null;
  if (!run) return { testStatus: "", testConclusion: "" };
  const jobs = await readJson(
    "https://api.github.com/repos/" + repo + "/actions/runs/" + run.id + "/jobs",
    fetcher
  );
  const testJob = pickTestJob(jobs);
  if (!testJob) return { testStatus: "", testConclusion: "" };
  return {
    testStatus: String(testJob.status || ""),
    testConclusion: String(testJob.conclusion || ""),
  };
}

function deployNow() {
  git(["fetch", "origin", "main"]);
  git(["reset", "--hard", "origin/main"]);
  spawnSync("npm", ["ci", "--omit=dev"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  spawnSync("pm2", ["restart", PM2_NAME, "--update-env"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

async function tick(options) {
  const settings = options || {};
  const cwd = settings.cwd || ROOT;
  git(["fetch", "origin", "main"], cwd);
  const localSha = git(["rev-parse", "HEAD"], cwd);
  const remoteSha = git(["rev-parse", "origin/main"], cwd);
  if (remoteSha === localSha) {
    return evaluateDeployDecision({ localSha, remoteSha });
  }
  const repo = settings.repo || repoFromRemote(git(["remote", "get-url", "origin"], cwd));
  let testJob = { testStatus: "", testConclusion: "" };
  try {
    testJob = await loadTestJob(repo, remoteSha, settings.fetcher);
  } catch (err) {
    return { action: "wait", reason: "github-api:" + String(err.message || err).slice(0, 80) };
  }
  const decision = evaluateDeployDecision({
    localSha,
    remoteSha,
    testStatus: testJob.testStatus,
    testConclusion: testJob.testConclusion,
  });
  if (decision.action === "deploy" && settings.apply !== false) {
    deployNow();
  }
  return decision;
}

async function loop() {
  try {
    const decision = await tick();
    if (decision.action !== "noop") {
      console.log(new Date().toISOString(), decision.action, decision.reason);
    }
  } catch (err) {
    console.error(new Date().toISOString(), String(err && err.message ? err.message : err).slice(0, 300));
  }
}

if (require.main === module) {
  loop();
  setInterval(loop, INTERVAL_MS);
}

module.exports = {
  evaluateDeployDecision,
  repoFromRemote,
  pickTestJob,
  loadTestJob,
  tick,
};
