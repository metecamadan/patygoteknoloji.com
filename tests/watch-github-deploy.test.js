"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  evaluateDeployDecision,
  repoFromRemote,
  pickTestJob,
} = require("../scripts/watch-github-deploy");

const root = path.resolve(__dirname, "..");
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "ci-deploy.yml"), "utf8");

test("evaluateDeployDecision deploys only when remote Test job is green", () => {
  assert.equal(
    evaluateDeployDecision({ localSha: "aaa", remoteSha: "aaa" }).action,
    "noop"
  );
  assert.equal(
    evaluateDeployDecision({
      localSha: "aaa",
      remoteSha: "bbb",
      testStatus: "in_progress",
      testConclusion: "",
    }).action,
    "wait"
  );
  assert.equal(
    evaluateDeployDecision({
      localSha: "aaa",
      remoteSha: "bbb",
      testStatus: "completed",
      testConclusion: "failure",
    }).action,
    "skip"
  );
  assert.equal(
    evaluateDeployDecision({
      localSha: "aaa",
      remoteSha: "bbb",
      testStatus: "completed",
      testConclusion: "success",
    }).action,
    "deploy"
  );
});

test("repoFromRemote parses HTTPS and SSH GitHub remotes", () => {
  assert.equal(
    repoFromRemote("https://github.com/metecamadan/patygoteknoloji.com.git"),
    "metecamadan/patygoteknoloji.com"
  );
  assert.equal(
    repoFromRemote("git@github.com:metecamadan/patygoteknoloji.com.git"),
    "metecamadan/patygoteknoloji.com"
  );
});

test("pickTestJob prefers the Test job name", () => {
  const job = pickTestJob({
    jobs: [
      { name: "Deploy to production", conclusion: "failure" },
      { name: "Test", status: "completed", conclusion: "success" },
    ],
  });
  assert.equal(job.name, "Test");
  assert.equal(job.conclusion, "success");
});

test("CI deploy job no longer SSHes with appleboy", () => {
  assert.doesNotMatch(workflow, /appleboy\/ssh-action/);
  assert.match(workflow, /pull-deploy|VPS pull/i);
  assert.match(workflow, /needs: test/);
});
