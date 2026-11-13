#!/usr/bin/env node
/**
 * Install the full Patygo Cursor agent skills pack into this repository.
 * One `npx skills add` call per package; continues on failures.
 * Then mirrors skills into `.cursor/skills`, `.agents/skills`, and `plugins/patygo-agent-skills/skills`.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/** @type {Array<{ pkg: string, skills: string[], skipIfBrokenFrontmatter?: boolean }>} */
const PACKAGES = [
  {
    pkg: 'coreyhaines31/marketingskills',
    skills: [
      'seo-audit',
      'ad-creative',
      'ads',
      'ai-seo',
      'analytics',
      'conversion-tracking',
      'copywriting',
      'content-strategy',
      'programmatic-seo',
      'marketing-ideas',
      'competitor-profiling',
      'cro',
      'cold-email',
      'sales-enablement',
      'prospecting',
      'emails',
      'attribution',
      'social',
      'influencer-marketing',
      'aso',
      'launch',
      'public-relations',
      'churn-prevention',
      'revops',
      'onboarding',
    ],
  },
  {
    pkg: 'google/skills',
    skills: ['google-ads-api-mcp-setup', 'google-ads-api-quickstart'],
  },
  {
    pkg: 'anthropics/skills',
    skills: ['frontend-design', 'brand-guidelines', 'xlsx', 'mcp-builder', 'pptx'],
  },
  {
    pkg: 'vercel-labs/agent-skills',
    skills: [
      'vercel-react-best-practices',
      'web-design-guidelines',
      'vercel-react-view-transitions',
    ],
  },
  {
    pkg: 'mattpocock/skills',
    skills: [
      'improve-codebase-architecture',
      'code-review',
      'tdd',
      'diagnosing-bugs',
      'implement',
      'grill-me',
      'to-spec',
    ],
  },
  {
    pkg: 'obra/superpowers',
    skills: [
      'systematic-debugging',
      'test-driven-development',
      'writing-plans',
      'verification-before-completion',
      'brainstorming',
    ],
  },
  {
    pkg: 'leonxlnx/taste-skill',
    skills: ['design-taste-frontend'],
  },
  {
    pkg: 'nextlevelbuilder/ui-ux-pro-max-skill',
    skills: ['ui-ux-pro-max', 'ui-styling', 'design-system'],
  },
  {
    pkg: 'shadcn-ui/ui',
    skills: ['shadcn'],
  },
  {
    pkg: 'pbakaus/impeccable',
    skills: ['impeccable'],
  },
  {
    pkg: 'designed-by-ai/skills',
    skills: ['design-mobile-apps'],
  },
  {
    pkg: 'addyosmani/web-quality-skills',
    skills: ['accessibility', 'core-web-vitals', 'performance'],
  },
  {
    pkg: 'ibelick/ui-skills',
    skills: ['fixing-accessibility', 'baseline-ui'],
  },
  {
    pkg: 'stripe/ai',
    skills: ['stripe-best-practices'],
  },
  {
    pkg: 'stripe/link-cli',
    skills: ['financial-insights'],
  },
  {
    pkg: 'microsoft/azure-skills',
    skills: [
      'azure-advisor-cost-optimization',
      'azure-kubernetes',
      'azure-compliance',
    ],
  },
  {
    pkg: 'wshobson/agents',
    skills: [
      'startup-financial-modeling',
      'openapi-spec-generation',
      'api-design-principles',
      'stripe-integration',
      'sql-optimization-patterns',
      'github-actions-templates',
      'gdpr-data-handling',
      'pci-compliance',
    ],
  },
  {
    pkg: 'anthropics/knowledge-work-plugins',
    skills: [
      'financial-statements',
      'sql-queries',
      'statistical-analysis',
      'legal-risk-assessment',
      'compliance-check',
    ],
  },
  {
    pkg: 'supabase/agent-skills',
    skills: ['supabase'],
  },
  {
    pkg: 'prisma/skills',
    skills: ['prisma-client-api', 'prisma-database-setup'],
  },
  {
    pkg: 'figma/mcp-server-guide',
    skills: ['figma-use', 'figma-generate-design'],
  },
  {
    pkg: 'shopify/shopify-ai-toolkit',
    skills: [
      'shopify-admin',
      'shopify-storefront-graphql',
      'shopify-liquid',
      'shopify-dev',
      'shopify-custom-data',
    ],
  },
  {
    pkg: 'agricidaniel/claude-seo',
    skills: ['seo-ecommerce', 'seo-local'],
  },
  {
    pkg: 'remotion-dev/skills',
    skills: ['remotion-best-practices'],
  },
  {
    pkg: 'heygen-com/hyperframes',
    skills: ['hyperframes', 'media-use'],
  },
  {
    pkg: 'amplitude/mcp-marketplace',
    skills: [
      'add-analytics-instrumentation',
      'taxonomy',
      'discover-analytics-patterns',
      'instrument-events',
    ],
  },
  {
    pkg: 'github/awesome-copilot',
    skills: ['sql-optimization', 'multi-stage-dockerfile', 'prd'],
  },
  {
    pkg: 'firebase/agent-skills',
    skills: ['firebase-security-rules-auditor'],
  },
  {
    pkg: 'addyosmani/agent-skills',
    skills: ['security-and-hardening', 'ci-cd-and-automation'],
  },
  {
    pkg: 'better-auth/skills',
    skills: ['better-auth-security-best-practices'],
  },
  {
    pkg: 'getsentry/skills',
    skills: ['security-review'],
  },
  {
    pkg: 'openai/skills',
    skills: ['security-best-practices'],
  },
  {
    pkg: 'phuryn/pm-skills',
    skills: ['create-prd', 'analyze-feature-requests', 'privacy-policy'],
  },
  {
    pkg: 'hashicorp/agent-skills',
    skills: ['terraform-style-guide', 'terraform-test'],
  },
  {
    pkg: 'docker/skills',
    skills: ['docker-build-strategies', 'docker-compose-patterns'],
  },
  {
    pkg: 'expo/skills',
    skills: ['eas-workflows'],
  },
  {
    pkg: 'flutter/agent-plugins',
    skills: ['flutter-setup-localization'],
  },
  {
    pkg: 'lobehub/lobehub',
    skills: ['i18n'],
  },
  {
    pkg: 'daymade/claude-code-skills',
    skills: ['i18n-expert'],
  },
  {
    pkg: 'kostja94/marketing-skills',
    skills: ['translation', 'local-seo'],
  },
  {
    pkg: 'unity-technologies/skills',
    skills: ['localize-unity-project'],
  },
  {
    pkg: 'mbfinotti/revops-skills',
    skills: ['revops-kickoff', 'customer-churn-signals'],
  },
  {
    pkg: 'googleworkspace/cli',
    skills: ['persona-customer-support'],
  },
  {
    pkg: 'mbfinotti/advertising-skills',
    skills: ['ad-attribution-gap'],
  },
  {
    pkg: 'firecrawl/skills',
    skills: ['firecrawl-build-onboarding'],
  },
  {
    pkg: 'mukul975/privacy-data-protection-skills',
    skills: ['turkey-kvkk'],
  },
  {
    pkg: 'nexscope-ai/ecommerce-skills',
    skills: ['cross-border-ecommerce'],
    skipIfBrokenFrontmatter: true,
  },
];

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      count += copyDirRecursive(from, to);
    } else if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(from);
      fs.rmSync(to, { recursive: true, force: true });
      fs.symlinkSync(target, to);
      count += 1;
    } else {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      count += 1;
    }
  }
  return count;
}

function listSkillDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function isBrokenFrontmatterError(output) {
  const text = String(output || '').toLowerCase();
  return (
    text.includes('frontmatter') ||
    text.includes('yaml') ||
    text.includes('invalid skill') ||
    text.includes('parse error') ||
    text.includes('skill.md')
  );
}

const failures = [];
const successes = [];

console.log(`Installing ${PACKAGES.length} skill packages into ${ROOT}...\n`);

for (const entry of PACKAGES) {
  const skillArgs = entry.skills.flatMap((s) => ['-s', s]);
  const args = [
    '--yes',
    'skills',
    'add',
    entry.pkg,
    ...skillArgs,
    '-a',
    'cursor',
    '-y',
    '--copy',
  ];
  const cmdPreview = `npx ${args.join(' ')}`;
  console.log(`\n=== ${entry.pkg} (${entry.skills.length} skills) ===`);
  console.log(`$ ${cmdPreview}`);

  const result = spawnSync('npx', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
  });

  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const combined = `${stdout}\n${stderr}`;
  process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  if (result.status !== 0) {
    if (entry.skipIfBrokenFrontmatter && isBrokenFrontmatterError(combined)) {
      const msg = `${entry.pkg}: skipped (broken frontmatter)`;
      console.warn(`WARN: ${msg}`);
      failures.push({
        pkg: entry.pkg,
        skills: entry.skills,
        exitCode: result.status,
        skipped: true,
        reason: 'broken frontmatter',
        excerpt: combined.slice(-800),
      });
    } else {
      console.error(`FAIL: ${entry.pkg} exited ${result.status}`);
      failures.push({
        pkg: entry.pkg,
        skills: entry.skills,
        exitCode: result.status,
        skipped: false,
        excerpt: combined.slice(-800),
      });
    }
  } else {
    successes.push({ pkg: entry.pkg, skills: entry.skills });
    console.log(`OK: ${entry.pkg}`);
  }
}

const agentsSkills = path.join(ROOT, '.agents', 'skills');
const cursorSkills = path.join(ROOT, '.cursor', 'skills');

console.log('\n=== Mirror .agents/skills → .cursor/skills ===');
if (fs.existsSync(agentsSkills)) {
  // Prefer .agents/skills as source of truth from skills CLI, then ensure .cursor/skills matches.
  if (fs.existsSync(cursorSkills)) {
    // Merge: copy any skill dirs from .agents that might differ
    for (const name of listSkillDirs(agentsSkills)) {
      const src = path.join(agentsSkills, name);
      const dest = path.join(cursorSkills, name);
      fs.rmSync(dest, { recursive: true, force: true });
      copyDirRecursive(src, dest);
    }
  } else {
    copyDirRecursive(agentsSkills, cursorSkills);
  }
  console.log(`Mirrored from ${agentsSkills}`);
} else if (fs.existsSync(cursorSkills)) {
  console.log(`.agents/skills missing; .cursor/skills already present (${listSkillDirs(cursorSkills).length} dirs)`);
} else {
  console.warn('Neither .agents/skills nor .cursor/skills found after install.');
}

// Also ensure .agents/skills has everything from .cursor/skills (skills CLI may write only to .cursor)
if (fs.existsSync(cursorSkills)) {
  fs.mkdirSync(agentsSkills, { recursive: true });
  for (const name of listSkillDirs(cursorSkills)) {
    const src = path.join(cursorSkills, name);
    const dest = path.join(agentsSkills, name);
    if (!fs.existsSync(dest)) {
      copyDirRecursive(src, dest);
    }
  }
}

const installedCursor = listSkillDirs(cursorSkills);
const installedAgents = listSkillDirs(agentsSkills);
const allNames = new Set([...installedCursor, ...installedAgents]);

const report = {
  packagesAttempted: PACKAGES.length,
  packagesSucceeded: successes.length,
  packagesFailed: failures.filter((f) => !f.skipped).length,
  packagesSkipped: failures.filter((f) => f.skipped).length,
  skillDirCount: allNames.size,
  cursorSkillCount: installedCursor.length,
  agentsSkillCount: installedAgents.length,
  skillNames: [...allNames].sort(),
  successes,
  failures,
};


const pluginSkills = path.join(ROOT, 'plugins', 'patygo-agent-skills', 'skills');
console.log('\n=== Mirror skills → plugins/patygo-agent-skills/skills + .agents/skills ===');
const skillSource = fs.existsSync(cursorSkills) && listSkillDirs(cursorSkills).length
  ? cursorSkills
  : agentsSkills;
if (fs.existsSync(skillSource)) {
  fs.rmSync(pluginSkills, { recursive: true, force: true });
  fs.mkdirSync(pluginSkills, { recursive: true });
  for (const name of listSkillDirs(skillSource)) {
    copyDirRecursive(path.join(skillSource, name), path.join(pluginSkills, name));
  }
  // Ensure .agents/skills matches .cursor/skills
  if (skillSource === cursorSkills) {
    fs.rmSync(agentsSkills, { recursive: true, force: true });
    fs.mkdirSync(agentsSkills, { recursive: true });
    for (const name of listSkillDirs(cursorSkills)) {
      copyDirRecursive(path.join(cursorSkills, name), path.join(agentsSkills, name));
    }
  } else if (fs.existsSync(agentsSkills) && skillSource === agentsSkills) {
    // already have agents; ensure cursor
    fs.mkdirSync(cursorSkills, { recursive: true });
    for (const name of listSkillDirs(agentsSkills)) {
      const dest = path.join(cursorSkills, name);
      fs.rmSync(dest, { recursive: true, force: true });
      copyDirRecursive(path.join(agentsSkills, name), dest);
    }
  }
  console.log(`Plugin skills mirrored from ${skillSource} → ${pluginSkills}`);
} else {
  console.warn('No skill source found to mirror into plugin path');
}

const reportPath = path.join(ROOT, 'scripts', 'install-patygo-agent-skills-report.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\nReport written to ${reportPath}`);
console.log(
  `\nSummary: ${successes.length}/${PACKAGES.length} packages OK, ` +
    `${failures.filter((f) => !f.skipped).length} failed, ` +
    `${failures.filter((f) => f.skipped).length} skipped, ` +
    `${allNames.size} skill directories.`
);

if (failures.length) {
  console.log('\nFailures / skips:');
  for (const f of failures) {
    console.log(
      `  - ${f.pkg}${f.skipped ? ' [skipped]' : ` [exit ${f.exitCode}]`}: ${f.skills.join(', ')}`
    );
  }
}

// Non-zero only if nothing installed at all
process.exit(allNames.size === 0 ? 1 : 0);
