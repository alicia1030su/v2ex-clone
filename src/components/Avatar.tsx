/**
 * 头像组件
 *
 * 原站头像来自 cdn.v2ex.com（受保护资源，不可复制）。
 * 本项目用确定性生成的 SVG 数据 URI 作为占位：同一用户始终得到同一颜色与首字母，
 * 尺寸与原站一致（24 / 48 / 64 / 73 px），因此布局与像素占位可比对。
 */
function hashOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

const PALETTE = [
  ['#e8f0fe', '#3b6fd4'],
  ['#fdecec', '#c04a4a'],
  ['#e9f7ee', '#3d8a56'],
  ['#fdf3e0', '#b5822a'],
  ['#f0e9fb', '#6f4bb5'],
  ['#e6f4f7', '#2f7d8c'],
];

export function avatarDataUri(seed: string, size: number): string {
  const h = hashOf(seed);
  const [bg, fg] = PALETTE[h % PALETTE.length];
  const ch = (seed.charAt(0) || '?').toUpperCase();
  const fontSize = Math.round(size * 0.44);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="3" fill="${bg}"/><text x="50%" y="50%" dy="0.36em" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="${fontSize}" font-weight="500" fill="${fg}">${ch}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

export function avatarUrl(
  user: { id: number; username: string; avatar: string | null },
  size: number,
): string {
  if (user.avatar) return user.avatar;
  return avatarDataUri(user.username || String(user.id), size);
}
