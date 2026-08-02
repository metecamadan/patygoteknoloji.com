const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { atomicWriteJson } = require("./supplier");

const MAX_USERS = 100;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .slice(0, 160);
}

function normalizeName(value, max) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max || 80);
}

function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), useSalt, 64).toString("hex");
  return { salt: useSalt, hash };
}

function verifyPassword(password, user) {
  if (!user || !user.passwordHash || !user.passwordSalt) return false;
  const { hash } = hashPassword(password, user.passwordSalt);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(String(user.passwordHash), "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role || "admin",
    active: user.active !== false,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function createAdminUserStore(root) {
  const file = path.join(root, ".runtime", "admin-users.json");

  function read() {
    try {
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      if (value && value.users && typeof value.users === "object") return value;
    } catch (_) {}
    return { version: 1, users: {} };
  }

  function write(value) {
    const ids = Object.keys(value.users || {});
    if (ids.length > MAX_USERS) {
      throw new Error("Maksimum kullanıcı sayısına ulaşıldı.");
    }
    atomicWriteJson(file, value);
  }

  function list() {
    return Object.values(read().users || {})
      .map(publicUser)
      .sort((a, b) => String(a.email).localeCompare(String(b.email), "tr"));
  }

  function get(id) {
    return read().users[String(id || "")] || null;
  }

  function findByEmail(email) {
    const key = normalizeEmail(email);
    if (!key) return null;
    return Object.values(read().users || {}).find((user) => user.email === key) || null;
  }

  function count() {
    return Object.keys(read().users || {}).length;
  }

  function create(input, options) {
    const opts = options || {};
    const firstName = normalizeName(input && input.firstName, 60);
    const lastName = normalizeName(input && input.lastName, 60);
    const email = normalizeEmail(input && input.email);
    const password = String((input && input.password) || "");
    if (!firstName) throw new Error("Ad gerekli.");
    if (!lastName) throw new Error("Soyad gerekli.");
    if (!EMAIL_RE.test(email)) throw new Error("Geçerli bir e-posta gerekli.");
    if (password.length < 4) throw new Error("Şifre en az 4 karakter olmalı.");
    if (findByEmail(email)) throw new Error("Bu e-posta zaten kayıtlı.");

    const { salt, hash } = hashPassword(password);
    const now = new Date().toISOString();
    const user = {
      id: crypto.randomBytes(8).toString("hex"),
      firstName,
      lastName,
      email,
      passwordSalt: salt,
      passwordHash: hash,
      role: opts.role === "owner" ? "owner" : "admin",
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    const data = read();
    data.users[user.id] = user;
    write(data);
    return publicUser(user);
  }

  function update(id, patch) {
    const data = read();
    const current = data.users[String(id || "")];
    if (!current) return null;
    const next = Object.assign({}, current);
    if (patch && Object.prototype.hasOwnProperty.call(patch, "firstName")) {
      const firstName = normalizeName(patch.firstName, 60);
      if (!firstName) throw new Error("Ad gerekli.");
      next.firstName = firstName;
    }
    if (patch && Object.prototype.hasOwnProperty.call(patch, "lastName")) {
      const lastName = normalizeName(patch.lastName, 60);
      if (!lastName) throw new Error("Soyad gerekli.");
      next.lastName = lastName;
    }
    if (patch && Object.prototype.hasOwnProperty.call(patch, "email")) {
      const email = normalizeEmail(patch.email);
      if (!EMAIL_RE.test(email)) throw new Error("Geçerli bir e-posta gerekli.");
      const other = findByEmail(email);
      if (other && other.id !== current.id) throw new Error("Bu e-posta zaten kayıtlı.");
      next.email = email;
    }
    if (patch && Object.prototype.hasOwnProperty.call(patch, "password") && patch.password) {
      const password = String(patch.password);
      if (password.length < 4) throw new Error("Şifre en az 4 karakter olmalı.");
      const hashed = hashPassword(password);
      next.passwordSalt = hashed.salt;
      next.passwordHash = hashed.hash;
    }
    if (patch && Object.prototype.hasOwnProperty.call(patch, "active")) {
      next.active = Boolean(patch.active);
    }
    next.updatedAt = new Date().toISOString();
    data.users[next.id] = next;
    write(data);
    return publicUser(next);
  }

  function remove(id) {
    const data = read();
    const key = String(id || "");
    const current = data.users[key];
    if (!current) return false;
    const owners = Object.values(data.users).filter((u) => u.role === "owner" && u.active !== false);
    if (current.role === "owner" && owners.length <= 1) {
      throw new Error("Son sahip kullanıcı silinemez.");
    }
    delete data.users[key];
    write(data);
    return true;
  }

  function authenticate(email, password) {
    const user = findByEmail(email);
    if (!user || user.active === false) return null;
    if (!verifyPassword(password, user)) return null;
    return publicUser(user);
  }

  /** Seed first owner from legacy ADMIN_PASSWORD when store is empty. */
  function ensureBootstrapOwner(env) {
    if (count() > 0) return null;
    const password = String((env && env.ADMIN_PASSWORD) || "").trim();
    if (!password) return null;
    const email = normalizeEmail((env && env.ADMIN_EMAIL) || "admin@patygoteknoloji.com");
    return create(
      {
        firstName: "Patygo",
        lastName: "Admin",
        email,
        password,
      },
      { role: "owner" }
    );
  }

  return {
    list,
    get,
    findByEmail,
    count,
    create,
    update,
    remove,
    authenticate,
    ensureBootstrapOwner,
    publicUser,
  };
}

module.exports = {
  createAdminUserStore,
  normalizeEmail,
  hashPassword,
  verifyPassword,
  publicUser,
};
