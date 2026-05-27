
const fs = require('fs');
const path = require('path');

const destDir = path.join(__dirname, 'dist', 'generated', 'prisma');
const candidateSrcDirs = [
  path.join(__dirname, 'generated', 'prisma'),
  path.join(__dirname, 'node_modules', '.prisma', 'client'),
];

function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();

  if (isDirectory) {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach((childItemName) => {
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else {
      // Ensure parent directory exists
      const parentDir = path.dirname(dest);
      if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
      }
      fs.copyFileSync(src, dest);
  }
}

const srcDir = candidateSrcDirs.find((dir) => fs.existsSync(dir));
const relationshipMapSrc = path.join(
  __dirname,
  'src',
  'config',
  'family-relationship-map.json',
);
const relationshipMapDest = path.join(
  __dirname,
  'dist',
  'config',
  'family-relationship-map.json',
);
const contratoTemplateCandidates = [
  path.join(__dirname, 'public', 'docs', 'contrato.docx'),
  path.join(__dirname, 'docs', 'contrato.docx'),
  path.join(__dirname, '..', 'frontend', 'public', 'docs', 'contrato.docx'),
];
const contratoTemplateDest = path.join(
  __dirname,
  'dist',
  'public',
  'docs',
  'contrato.docx',
);
const fichaAdesaoTemplateCandidates = [
  path.join(__dirname, 'public', 'docs', 'ficha-adesao.docx'),
  path.join(__dirname, 'docs', 'ficha-adesao.docx'),
  path.join(__dirname, '..', 'frontend', 'public', 'docs', 'ficha-adesao.docx'),
];
const fichaAdesaoTemplateDest = path.join(
  __dirname,
  'dist',
  'public',
  'docs',
  'ficha-adesao.docx',
);

if (!srcDir) {
  console.error(
    `Source directory not found! Checked:\n- ${candidateSrcDirs.join('\n- ')}\nRun "prisma generate" first.`,
  );
  process.exit(1);
}

console.log(`Copying Prisma client from ${srcDir} to ${destDir}...`);
copyRecursiveSync(srcDir, destDir);
console.log('Copy complete.');

if (fs.existsSync(relationshipMapSrc)) {
  console.log(
    `Copying family relationship map from ${relationshipMapSrc} to ${relationshipMapDest}...`,
  );
  copyRecursiveSync(relationshipMapSrc, relationshipMapDest);
  console.log('Family relationship map copied.');
}

const contratoTemplateSrc = contratoTemplateCandidates.find((candidate) =>
  fs.existsSync(candidate),
);
if (contratoTemplateSrc) {
  console.log(
    `Copying contract template from ${contratoTemplateSrc} to ${contratoTemplateDest}...`,
  );
  copyRecursiveSync(contratoTemplateSrc, contratoTemplateDest);
  console.log('Contract template copied.');
}

const fichaAdesaoTemplateSrc = fichaAdesaoTemplateCandidates.find((candidate) =>
  fs.existsSync(candidate),
);
if (fichaAdesaoTemplateSrc) {
  console.log(
    `Copying membership form template from ${fichaAdesaoTemplateSrc} to ${fichaAdesaoTemplateDest}...`,
  );
  copyRecursiveSync(fichaAdesaoTemplateSrc, fichaAdesaoTemplateDest);
  console.log('Membership form template copied.');
}
