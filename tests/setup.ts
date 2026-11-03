/**
 * 单元测试前置准备
 *
 * - 加载 .env.test（隔离测试数据库）
 * - 确保测试所需的表存在（迁移由 CI 步骤执行，此处仅做兜底检查）
 */
import { config } from 'dotenv';

if (process.env.ENV_FILE) {
  config({ path: process.env.ENV_FILE, quiet: true });
}
config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });
