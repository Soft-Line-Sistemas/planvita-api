
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

if (!srcDir) {
  console.error(
    `Source directory not found! Checked:\n- ${candidateSrcDirs.join('\n- ')}\nRun "prisma generate" first.`,
  );
  process.exit(1);
}

console.log(`Copying Prisma client from ${srcDir} to ${destDir}...`);
copyRecursiveSync(srcDir, destDir);
console.log('Copy complete.');
