'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

describe('entegra excel daily sync scripts', () => {
  it('ships sync + winrm fetch + task installer', () => {
    for (const rel of [
      'scripts/entegra_excel_daily_sync.py',
      'scripts/winrm_entegra_fetch.py',
      'scripts/install_entegra_excel_daily_task.py',
    ]) {
      const p = path.join(ROOT, rel);
      assert.ok(fs.existsSync(p), rel);
      const text = fs.readFileSync(p, 'utf8');
      assert.ok(!/pPSGcTdZ|password\s*=\s*['\"][^'\"]+['\"]/.test(text), 'no hardcoded password');
      assert.match(text, /winrm/i);
    }
  });

  it('daily sync uses local ~/.patygo paths and once-per-day stamp', () => {
    const text = fs.readFileSync(
      path.join(ROOT, 'scripts/entegra_excel_daily_sync.py'),
      'utf8',
    );
    assert.match(text, /windows-server\.json/);
    assert.match(text, /patygo-supplier-catalog/);
    assert.match(text, /last-success-day/);
    assert.match(text, /--force/);
    assert.match(text, /fetch_entegra_xlsx/);
  });

  it('task installer enables StartWhenAvailable and no RDP', () => {
    const text = fs.readFileSync(
      path.join(ROOT, 'scripts/install_entegra_excel_daily_task.py'),
      'utf8',
    );
    assert.match(text, /StartWhenAvailable/);
    assert.match(text, /InteractiveToken/);
    assert.match(text, /RunOnlyIfNetworkAvailable/);
    assert.doesNotMatch(text, /\bmstsc\b/i);
  });
});
