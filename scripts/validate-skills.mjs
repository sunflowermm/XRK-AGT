import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const skillRoots = [".cursor", ".claude", ".trae"]
  .map((dir) => path.join(root, dir, "skills"))
  .filter((dir) => fs.existsSync(dir));
const requiredSections = [
  "## 权威入口",
  "## 适用场景",
  "## 非适用场景",
  "## 执行步骤",
  "## 常见陷阱",
];
const bannedPatterns = [
  /brew\s+install/i,
  /apt(\-get)?\s+install/i,
  /winget\s+install/i,
  /choco\s+install/i,
];

function collectSkillFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillFile = path.join(dir, entry.name, "SKILL.md");
    if (fs.existsSync(skillFile)) results.push(skillFile);
  }
  return results;
}

function validateFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { ok: false, name: "", reason: "缺少 frontmatter" };
  const block = match[1];
  const nameLine = block.match(/^name:\s*(.+)$/m);
  const descLine = block.match(/^description:\s*(.+)$/m);
  if (!nameLine) return { ok: false, name: "", reason: "缺少 name 字段" };
  if (!descLine) return { ok: false, name: nameLine[1].trim(), reason: "缺少 description 字段" };
  return { ok: true, name: nameLine[1].trim(), reason: "" };
}

const files = skillRoots.flatMap((dir) => collectSkillFiles(dir));
const errors = [];
const warnings = [];

for (const file of files) {
  const content = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file).replace(/\\/g, "/");
  const dirName = path.basename(path.dirname(file));

  const fm = validateFrontmatter(content);
  if (!fm.ok) {
    errors.push(`${rel}: ${fm.reason}`);
    continue;
  }
  if (fm.name !== dirName) {
    errors.push(`${rel}: name(${fm.name}) 与目录名(${dirName}) 不一致`);
  }

  for (const section of requiredSections) {
    if (!content.includes(section)) {
      warnings.push(`${rel}: 缺少章节 ${section}`);
    }
  }

  for (const p of bannedPatterns) {
    if (p.test(content)) {
      errors.push(`${rel}: 命中禁用模式 ${p}`);
    }
  }
}

if (errors.length) {
  console.error("Skill 校验失败：");
  for (const err of errors) console.error(`- ${err}`);
  process.exit(1);
}

if (warnings.length) {
  console.warn("Skill 校验警告：");
  for (const warning of warnings) console.warn(`- ${warning}`);
}

console.log(`Skill 校验通过，共 ${files.length} 个技能文件（${skillRoots.length} 套目录）。`);
