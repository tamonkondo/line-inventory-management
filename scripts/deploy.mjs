/**
 * 既存デプロイを新バージョンへ更新する(URLは変わらない)。
 * GASエディタの「デプロイを管理 → 新バージョン」のUI操作の代替。
 * デプロイIDは .env の GAS_DEPLOYMENT_ID から読む。
 */
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const ENV_PATH = '.env';
const KEY = 'GAS_DEPLOYMENT_ID';

const readDeploymentId = () => {
  if (!existsSync(ENV_PATH)) return null;
  for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const match = line.match(/^\s*GAS_DEPLOYMENT_ID\s*=\s*(.+?)\s*$/);
    if (match && !match[1].startsWith('dummy')) return match[1];
  }
  return null;
};

const deploymentId = process.env[KEY] ?? readDeploymentId();
if (!deploymentId) {
  console.error(
    `${KEY} が見つかりません。\n` +
    'GASエディタ「デプロイ」→「デプロイを管理」に表示されるデプロイID(AKfycb...)を\n' +
    `.env に ${KEY}=AKfycb... の形で追記してください。`,
  );
  process.exit(1);
}

const description = new Date().toISOString().replace('T', ' ').slice(0, 16);
const result = spawnSync('npx', ['clasp', 'deploy', '-i', deploymentId, '-d', description], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
