
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'generated', 'prisma');
const destDir = path.join(__dirname, 'dist', 'generated', 'prisma');

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

console.log(`Copying Prisma client from ${srcDir} to ${destDir}...`);
if (fs.existsSync(srcDir)) {
    copyRecursiveSync(srcDir, destDir);
    console.log('Copy complete.');
} else {
    console.error(`Source directory ${srcDir} not found! Run "prisma generate" first.`);
    process.exit(1);
}
