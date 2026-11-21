import path from 'node:path';

/**
 * 用户上传文件的私有存储根目录。
 *
 * 不能放在 `public/` 下：Next.js 在 `next start` 启动时会快照 public 文件，
 * 容器重启后即使存在授权路由，静态资源仍可能先返回原始字节。
 * Docker 部署把 uploads named volume 挂载到这里；URL 仍由授权路由 `/uploads/*` 提供。
 */
export const UPLOAD_ROOT = path.resolve(
  process.env.UPLOAD_ROOT ?? path.join(process.cwd(), 'data', 'uploads'),
);

/** 旧版本源码部署使用的目录，仅用于兼容迁移提示。 */
export const LEGACY_PUBLIC_UPLOAD_ROOT = path.join(process.cwd(), 'public', 'uploads');
