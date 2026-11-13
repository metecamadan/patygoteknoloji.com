# Patygo Agent Skills Marketplace

Orphan branch that publishes the **Patygo Cursor skills marketplace** so Cursor → **Customize → From GitHub Repository** can import it without a separate GitHub repo.

## Install in Cursor

1. Open **Customize** (Cursor sidebar / settings).
2. Choose **From GitHub Repository**.
3. Paste:

   `https://github.com/metecamadan/patygoteknoloji.com`

4. If the UI allows **branch selection**, choose:

   `cursor/skills-marketplace-fe99`

5. Install the **Patygo Agent Skills** plugin from this marketplace.

### Branch note

Cursor’s “From GitHub Repository” flow often expects a marketplace on the repository’s **default branch**. This orphan branch keeps the storefront `main` clean. If branch selection is unavailable in your Cursor build, prefer a dedicated empty repo (for example `patygo-agent-skills`) that contains only this marketplace content on `main`.

## Layout

```text
.cursor-plugin/marketplace.json          # marketplace manifest
plugins/patygo-agent-skills/
  .cursor-plugin/plugin.json             # plugin manifest
  skills/                                # skills shipped with the plugin
.agents/skills/                          # complete skills pack (agents CLI layout)
.cursor/skills/                          # complete skills pack (Cursor layout)
```

## Contents

Curated pack covering marketing, design, finance, APIs, sales, Shopify, security, product management, DevOps, i18n, RevOps, and legal/KVKK.

Reinstall / refresh from this branch:

```bash
node scripts/install-patygo-agent-skills.mjs
```

## Branch

- Branch: `cursor/skills-marketplace-fe99` (orphan — no storefront history)
- Do not merge this branch into `main`
