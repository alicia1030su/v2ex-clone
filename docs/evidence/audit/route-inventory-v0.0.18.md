# 当前源码路由清单

页面：27；API 路由：74；HTTP 方法：93。

> 权限列为静态启发式提示，不是授权证明。

## 页面

| 路由 | 权限提示 | PAGE_INVENTORY | 源码 |
|---|---|---|---|
| `/` | public-optional-session | 是 | `src/app/page.tsx` |
| `/about` | public | 是 | `src/app/about/page.tsx` |
| `/admin` | authenticated | 是 | `src/app/admin/page.tsx` |
| `/bookmarks` | authenticated | 是 | `src/app/bookmarks/page.tsx` |
| `/faq` | public | 是 | `src/app/faq/page.tsx` |
| `/following` | authenticated | 是 | `src/app/following/page.tsx` |
| `/forgot` | public | 否 | `src/app/forgot/page.tsx` |
| `/go/:name` | public | 是 | `src/app/go/[name]/page.tsx` |
| `/go/new` | authenticated | 是 | `src/app/go/new/page.tsx` |
| `/go/search` | public | 是 | `src/app/go/search/page.tsx` |
| `/hot` | public | 是 | `src/app/hot/page.tsx` |
| `/leaderboard` | public-optional-session | 是 | `src/app/leaderboard/page.tsx` |
| `/member/:username` | public-optional-session | 是 | `src/app/member/[username]/page.tsx` |
| `/nodes` | public-optional-session | 是 | `src/app/nodes/page.tsx` |
| `/nodes/request` | authenticated | 否 | `src/app/nodes/request/page.tsx` |
| `/notifications` | authenticated | 是 | `src/app/notifications/page.tsx` |
| `/privacy` | public | 是 | `src/app/privacy/page.tsx` |
| `/recent` | public | 是 | `src/app/recent/page.tsx` |
| `/reports` | authenticated | 是 | `src/app/reports/page.tsx` |
| `/reset-password` | public | 否 | `src/app/reset-password/page.tsx` |
| `/settings` | authenticated | 是 | `src/app/settings/page.tsx` |
| `/signin` | public-optional-session | 是 | `src/app/signin/page.tsx` |
| `/signup` | public-optional-session | 是 | `src/app/signup/page.tsx` |
| `/t/:id` | public-optional-session | 是 | `src/app/t/[id]/page.tsx` |
| `/tag/:name` | public | 是 | `src/app/tag/[name]/page.tsx` |
| `/worldclock` | public | 是 | `src/app/worldclock/page.tsx` |
| `/xna` | public | 是 | `src/app/xna/page.tsx` |

## API

| 路由 | 方法 | 权限提示 | 权限点 | API_SPEC | 源码 |
|---|---|---|---|---|---|
| `/api/admin/categories` | GET, POST | admin | categories.view | 否 | `src/app/api/admin/categories/route.ts` |
| `/api/admin/categories/:id` | PATCH | public | - | 否 | `src/app/api/admin/categories/[id]/route.ts` |
| `/api/admin/config` | GET | admin | config.view | 否 | `src/app/api/admin/config/route.ts` |
| `/api/admin/credits` | POST | public | - | 否 | `src/app/api/admin/credits/route.ts` |
| `/api/admin/logs` | GET | admin | logs.view | 否 | `src/app/api/admin/logs/route.ts` |
| `/api/admin/node-requests` | GET | admin | nodes.approve | 否 | `src/app/api/admin/node-requests/route.ts` |
| `/api/admin/node-requests/:id/approve` | POST | public | - | 否 | `src/app/api/admin/node-requests/[id]/approve/route.ts` |
| `/api/admin/node-requests/:id/reject` | POST | public | - | 否 | `src/app/api/admin/node-requests/[id]/reject/route.ts` |
| `/api/admin/ops` | GET | admin | ops.view | 否 | `src/app/api/admin/ops/route.ts` |
| `/api/admin/pending` | GET | admin | reports.view | 否 | `src/app/api/admin/pending/route.ts` |
| `/api/admin/reports` | GET | admin | reports.view | 否 | `src/app/api/admin/reports/route.ts` |
| `/api/admin/reports/:id/handle` | POST | public | - | 否 | `src/app/api/admin/reports/[id]/handle/route.ts` |
| `/api/admin/stats` | GET | admin | config.view | 否 | `src/app/api/admin/stats/route.ts` |
| `/api/admin/users` | GET | admin | users.view | 否 | `src/app/api/admin/users/route.ts` |
| `/api/admin/users/:id/ban` | POST | public | - | 否 | `src/app/api/admin/users/[id]/ban/route.ts` |
| `/api/admin/users/:id/role` | PATCH | public | - | 否 | `src/app/api/admin/users/[id]/role/route.ts` |
| `/api/admin/users/:id/unban` | POST | public | - | 否 | `src/app/api/admin/users/[id]/unban/route.ts` |
| `/api/auth/forgot-password` | POST | public | - | 否 | `src/app/api/auth/forgot-password/route.ts` |
| `/api/auth/reset-password` | GET, POST | public | - | 否 | `src/app/api/auth/reset-password/route.ts` |
| `/api/auth/signin` | POST | public | - | 是 | `src/app/api/auth/signin/route.ts` |
| `/api/auth/signout` | POST | mixed | - | 是 | `src/app/api/auth/signout/route.ts` |
| `/api/auth/signup` | POST | public | - | 是 | `src/app/api/auth/signup/route.ts` |
| `/api/captcha` | GET | public | - | 是 | `src/app/api/captcha/route.ts` |
| `/api/checkin` | GET, POST | authenticated | - | 否 | `src/app/api/checkin/route.ts` |
| `/api/collections` | GET, POST | authenticated | - | 是 | `src/app/api/collections/route.ts` |
| `/api/credits` | GET | authenticated | - | 否 | `src/app/api/credits/route.ts` |
| `/api/debug/boom` | GET | public | - | 否 | `src/app/api/debug/boom/route.ts` |
| `/api/debug/floors` | GET | public | - | 是 | `src/app/api/debug/floors/route.ts` |
| `/api/debug/rate-limit-probe` | POST | public | - | 否 | `src/app/api/debug/rate-limit-probe/route.ts` |
| `/api/debug/reset-rate-limits` | POST | public | - | 是 | `src/app/api/debug/reset-rate-limits/route.ts` |
| `/api/debug/table-count` | GET | public | - | 否 | `src/app/api/debug/table-count/route.ts` |
| `/api/feed` | GET | public | - | 是 | `src/app/api/feed/route.ts` |
| `/api/feed/atom` | GET | public | - | 是 | `src/app/api/feed/atom/route.ts` |
| `/api/feed/json` | GET | public | - | 是 | `src/app/api/feed/json/route.ts` |
| `/api/health` | GET | public | - | 否 | `src/app/api/health/route.ts` |
| `/api/health/ready` | GET | public | - | 否 | `src/app/api/health/ready/route.ts` |
| `/api/leaderboard` | GET | public | - | 否 | `src/app/api/leaderboard/route.ts` |
| `/api/members/show.json` | GET | public | - | 是 | `src/app/api/members/show.json/route.ts` |
| `/api/node-requests` | GET, POST | authenticated | - | 否 | `src/app/api/node-requests/route.ts` |
| `/api/nodes` | GET, POST, PATCH | authenticated | - | 是 | `src/app/api/nodes/route.ts` |
| `/api/nodes/:name/feed` | GET | public | - | 是 | `src/app/api/nodes/[name]/feed/route.ts` |
| `/api/nodes/all.json` | GET | public | - | 是 | `src/app/api/nodes/all.json/route.ts` |
| `/api/nodes/list.json` | GET | public | - | 是 | `src/app/api/nodes/list.json/route.ts` |
| `/api/nodes/show.json` | GET | public | - | 是 | `src/app/api/nodes/show.json/route.ts` |
| `/api/notifications` | GET, POST, DELETE | authenticated | - | 否 | `src/app/api/notifications/route.ts` |
| `/api/replies` | POST | authenticated | - | 是 | `src/app/api/replies/route.ts` |
| `/api/replies/:id` | PUT, DELETE | authenticated | - | 否 | `src/app/api/replies/[id]/route.ts` |
| `/api/replies/:id/edit-history` | GET | authenticated | - | 否 | `src/app/api/replies/[id]/edit-history/route.ts` |
| `/api/replies/:id/restore` | POST | authenticated | - | 否 | `src/app/api/replies/[id]/restore/route.ts` |
| `/api/replies/show.json` | GET | public | - | 是 | `src/app/api/replies/show.json/route.ts` |
| `/api/reports` | GET, POST | authenticated | - | 否 | `src/app/api/reports/route.ts` |
| `/api/search` | GET | public | - | 是 | `src/app/api/search/route.ts` |
| `/api/search/suggest` | GET | public | - | 是 | `src/app/api/search/suggest/route.ts` |
| `/api/settings/password` | POST | authenticated | - | 是 | `src/app/api/settings/password/route.ts` |
| `/api/settings/profile` | POST | authenticated | - | 是 | `src/app/api/settings/profile/route.ts` |
| `/api/thanks` | POST, DELETE | authenticated | - | 否 | `src/app/api/thanks/route.ts` |
| `/api/topics` | POST | authenticated | - | 是 | `src/app/api/topics/route.ts` |
| `/api/topics/:id` | GET, PUT, DELETE | authenticated | - | 否 | `src/app/api/topics/[id]/route.ts` |
| `/api/topics/:id/edit-history` | GET | authenticated | - | 否 | `src/app/api/topics/[id]/edit-history/route.ts` |
| `/api/topics/:id/lock` | POST | authenticated | - | 否 | `src/app/api/topics/[id]/lock/route.ts` |
| `/api/topics/:id/pin` | POST | authenticated | - | 否 | `src/app/api/topics/[id]/pin/route.ts` |
| `/api/topics/:id/restore` | POST | authenticated | - | 否 | `src/app/api/topics/[id]/restore/route.ts` |
| `/api/topics/:id/unlock` | POST | authenticated | - | 否 | `src/app/api/topics/[id]/unlock/route.ts` |
| `/api/topics/:id/unpin` | POST | authenticated | - | 否 | `src/app/api/topics/[id]/unpin/route.ts` |
| `/api/topics/hot.json` | GET | public | - | 是 | `src/app/api/topics/hot.json/route.ts` |
| `/api/topics/latest.json` | GET | public | - | 是 | `src/app/api/topics/latest.json/route.ts` |
| `/api/topics/show.json` | GET | public | - | 是 | `src/app/api/topics/show.json/route.ts` |
| `/api/users/avatar` | POST, DELETE | authenticated | - | 否 | `src/app/api/users/avatar/route.ts` |
| `/api/users/follows` | GET, POST, DELETE | authenticated | - | 否 | `src/app/api/users/follows/route.ts` |
| `/api/users/follows/topics` | GET | authenticated | - | 否 | `src/app/api/users/follows/topics/route.ts` |
| `/api/users/me` | GET, PATCH | authenticated | - | 否 | `src/app/api/users/me/route.ts` |
| `/api/votes` | POST, DELETE | authenticated | - | 否 | `src/app/api/votes/route.ts` |
| `/feed/:file` | GET | public | - | 是 | `src/app/feed/[file]/route.ts` |
| `/uploads/*path` | GET | public | - | 否 | `src/app/uploads/[...path]/route.ts` |
