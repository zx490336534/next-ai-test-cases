import { main } from './server';

void main().catch(() => {
  console.error('启动测试用例工作区失败，请检查 Node.js 版本和本地数据库目录。');
  process.exitCode = 1;
});
