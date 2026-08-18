"use strict";

const fs = require("fs");
const path = require("path");
const { atomicWriteJson } = require("./supplier");

const MIN_ADMIN_PASSWORD_LENGTH = 12;

function createAdminSecurityStore(root) {
  const file = path.join(root, ".runtime", "admin-security.json");

  function read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function write(next) {
    atomicWriteJson(file, Object.assign({}, read(), next, { updatedAt: new Date().toISOString() }));
  }

  function activateForcePasswordChange(reason) {
    write({
      forcePasswordChange: true,
      reason: String(reason || "Panel şifresi güncellenmeli.").slice(0, 240),
    });
  }

  function clearForcePasswordChange() {
    write({
      forcePasswordChange: false,
      reason: "",
    });
  }

  function shouldForcePasswordChange(adminPassword) {
    const state = read();
    if (state.forcePasswordChange) return true;
    const pass = String(adminPassword || "");
    return pass.length > 0 && pass.length < MIN_ADMIN_PASSWORD_LENGTH;
  }

  function validateNewPassword(value) {
    const pass = String(value || "");
    if (pass.length < MIN_ADMIN_PASSWORD_LENGTH) {
      throw new Error("Yeni şifre en az " + MIN_ADMIN_PASSWORD_LENGTH + " karakter olmalı.");
    }
    return pass;
  }

  return {
    MIN_ADMIN_PASSWORD_LENGTH,
    activateForcePasswordChange,
    clearForcePasswordChange,
    shouldForcePasswordChange,
    validateNewPassword,
    read,
  };
}

function updateEnvAdminPassword(envFile, nextPassword) {
  const pass = String(nextPassword || "");
  if (!pass) throw new Error("Şifre boş olamaz.");
  if (!fs.existsSync(envFile)) {
    fs.writeFileSync(envFile, "ADMIN_PASSWORD=" + pass + "\n", "utf8");
    return;
  }
  const content = fs.readFileSync(envFile, "utf8");
  if (/^ADMIN_PASSWORD=/m.test(content)) {
    fs.writeFileSync(
      envFile,
      content.replace(/^ADMIN_PASSWORD=.*$/m, "ADMIN_PASSWORD=" + pass),
      "utf8"
    );
    return;
  }
  fs.appendFileSync(envFile, "\nADMIN_PASSWORD=" + pass + "\n", "utf8");
}

module.exports = {
  MIN_ADMIN_PASSWORD_LENGTH,
  createAdminSecurityStore,
  updateEnvAdminPassword,
};
