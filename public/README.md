# public/ — 静态资源目录

Next.js 会把本目录下的文件原样复制到 `/_next/static` 之外的根路径，
可通过 `/favicon.svg` 这样的绝对路径直接访问。

## 为什么本文件存在

Git **不跟踪空目录**。本项目早期版本的 `public/` 只有空目录，
导致：

- 干净克隆（`git clone`）后 `public/` 目录根本不存在；
- Dockerfile 的 `COPY --from=builder /app/public ./public` 直接失败，
  镜像构建中断。

保留本文件（以及 `favicon.svg`）可确保 `public/` 在任何克隆中都被创建。

## 内容约定

- `favicon.svg` —— 站点图标（纯 SVG 绘制，不含任何第三方商标素材）。
- `static/` —— 预留的静态资源目录。

> **注意**：不要把原站（V2EX）的图片、CSS、JS 等受保护素材放入本目录。
> 本项目所有图标均为自绘的等价 SVG 实现，见 `src/components/FeedIcons.tsx`
> 与 `src/components/Logo.tsx`。
