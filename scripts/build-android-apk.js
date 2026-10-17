const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const gradleWrapper = path.join(
  root,
  'android',
  process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'
);
const localProperties = path.join(root, 'android', 'local.properties');

function getLocalSdkPath() {
  if (!fs.existsSync(localProperties)) return null;

  const sdkLine = fs.readFileSync(localProperties, 'utf8')
    .split(/\r?\n/)
    .find(line => /^\s*sdk\.dir\s*=/.test(line));
  if (!sdkLine) return null;

  return sdkLine
    .replace(/^\s*sdk\.dir\s*=\s*/, '')
    .replace(/\\:/g, ':')
    .replace(/\\\\/g, '\\')
    .replace(/\\ /g, ' ')
    .trim();
}

function configureAndroidSdk() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    getLocalSdkPath(),
    process.platform === 'win32' && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk')
      : null,
    process.platform !== 'win32' && process.env.HOME
      ? path.join(process.env.HOME, 'Android', 'Sdk')
      : null
  ].filter(Boolean);

  const sdkPath = candidates.find(candidate => fs.existsSync(candidate));
  if (!sdkPath) {
    console.error([
      'Android SDK topilmadi. Android Studio o‘rnating: https://developer.android.com/studio',
      'Android Studio > More Actions > SDK Manager orqali Android SDK Platform 35 va Android SDK Build-Tools ni o‘rnating.',
      'Standart SDK yo‘li: %LOCALAPPDATA%\\Android\\Sdk',
      'So‘ng yangi PowerShell oynasida ANDROID_HOME ni SDK papkasiga sozlab, npm run android:apk ni qayta bajaring:',
      '  $env:ANDROID_HOME = "$env:LOCALAPPDATA\\Android\\Sdk"',
      '  npm run android:apk'
    ].join('\n'));
    process.exit(1);
  }

  process.env.ANDROID_HOME = sdkPath;
  process.env.ANDROID_SDK_ROOT = sdkPath;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

try {
  configureAndroidSdk();
  run('npx', ['cap', 'sync', 'android']);
  run(gradleWrapper, ['-p', 'android', 'assembleDebug']);

  const builtApk = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  const outputDir = path.join(root, 'dist');
  const outputApk = path.join(outputDir, 'OSAF-Gilam-Yuvish.apk');

  if (!fs.existsSync(builtApk)) {
    throw new Error(`Gradle completed but APK was not found at ${builtApk}`);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  fs.copyFileSync(builtApk, outputApk);
  console.log(`APK tayyor: ${outputApk}`);
} catch (error) {
  console.error(`APK yig‘ilmadi: ${error.message}`);
  process.exitCode = 1;
}
