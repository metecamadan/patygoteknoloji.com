const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createCalendarStore } = require("../lib/calendar");

test("calendar store creates reminders and notes by date", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-calendar-"));
  const store = createCalendarStore(root);
  const reminder = store.create({
    type: "reminder",
    date: "2026-07-29",
    time: "09:30",
    title: "XML güncelle",
    body: "Sabah feed kontrolü",
  });
  const note = store.create({
    type: "note",
    date: "2026-07-29",
    title: "Kampanya fikri",
    body: "Akakçe kampanyası",
  });
  assert.match(reminder.id, /^[a-f0-9]{16}$/);
  assert.equal(reminder.type, "reminder");
  assert.equal(note.type, "note");
  const listed = store.list("2026-07-01", "2026-07-31");
  assert.equal(listed.length, 2);
  assert.equal(store.list("2026-08-01", "2026-08-31").length, 0);
  const updated = store.update(reminder.id, { done: true, title: "XML güncellendi" });
  assert.equal(updated.done, true);
  assert.equal(updated.title, "XML güncellendi");
  assert.equal(store.remove(note.id), true);
  assert.equal(store.list("2026-07-01", "2026-07-31").length, 1);
});

test("calendar store rejects invalid dates and empty titles", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-calendar-bad-"));
  const store = createCalendarStore(root);
  assert.throws(() => store.create({ type: "note", date: "29-07-2026", title: "x" }), /tarih/i);
  assert.throws(() => store.create({ type: "note", date: "2026-07-29", title: "  " }), /Başlık/i);
  assert.throws(() => store.create({ type: "event", date: "2026-07-29", title: "x" }), /Tür/i);
});
