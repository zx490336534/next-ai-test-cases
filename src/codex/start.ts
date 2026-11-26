import { main } from './server';
import { WorkspaceError } from './store';

void main().catch((error) => {
  console.error(error instanceof WorkspaceError ? error.message : '测试用例工作区调用失败，请检查参数和本地数据库。');
  process.exitCode = 1;
});
