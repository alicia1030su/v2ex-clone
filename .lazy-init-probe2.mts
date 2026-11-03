
      import { db } from './src/db/index.ts';
      try {
        // 用不依赖业务表的查询 —— CI 的 unit job 不跑迁移
        await db.execute('select 1');
        console.log('UNEXPECTED_SUCCESS');
      } catch (e) {
        console.log('EXPECTED_ERROR:' + (e && e.message ? e.message : String(e)));
      }
    