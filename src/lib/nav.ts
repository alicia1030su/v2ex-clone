/**
 * 顶部导航 tab 定义
 * 依据原站首页实际观察到的 tab 顺序与链接：
 *   程序员 /go/programmer, 创意 /go/create, 好玩 /go/play, Apple /go/apple,
 *   酷工作 /go/jobs, 交易 /go/deals, 城市 /go/city, 问与答 /go/qna,
 *   最热 /?tab=hot, 全部 /?tab=all, R2 /?tab=r2, VXNA /xna
 */
export type HomeTab = {
  key: string;
  label: string;
  href: string;
  /** 该 tab 展示哪些节点名；空数组表示全部 */
  nodes: string[];
};

export const HOME_TABS: HomeTab[] = [
  { key: 'programmer', label: '程序员', href: '/go/programmer', nodes: ['programmer'] },
  { key: 'create', label: '创意', href: '/go/create', nodes: ['create'] },
  { key: 'play', label: '好玩', href: '/go/play', nodes: ['play'] },
  { key: 'apple', label: 'Apple', href: '/go/apple', nodes: ['apple'] },
  { key: 'jobs', label: '酷工作', href: '/go/jobs', nodes: ['jobs'] },
  { key: 'deals', label: '交易', href: '/go/deals', nodes: ['deals'] },
  { key: 'city', label: '城市', href: '/go/city', nodes: ['city'] },
  { key: 'qna', label: '问与答', href: '/go/qna', nodes: ['qna'] },
  { key: 'hot', label: '最热', href: '/?tab=hot', nodes: [] },
  { key: 'all', label: '全部', href: '/?tab=all', nodes: [] },
  { key: 'r2', label: 'R2', href: '/?tab=r2', nodes: [] },
];

/** 首页二级 tab —— 原站 #SecondaryTabs */
export const SECONDARY_TABS = [
  { name: 'programmer', title: '程序员' },
  { name: 'python', title: 'Python' },
  { name: 'idev', title: 'iDev' },
  { name: 'claude', title: 'Claude' },
  { name: 'openai', title: 'OpenAI' },
  { name: 'localllm', title: 'Local LLM' },
  { name: 'cloud', title: '云计算' },
  { name: 'bb', title: '宽带症候群' },
];

/** 全部节点页的分类 —— 原站 /nodes 页面按分类分组 */
export const NODE_CATEGORIES = [
  { name: 'tech', title: '技术' },
  { name: 'create', title: '创意' },
  { name: 'life', title: '生活' },
  { name: 'play', title: '好玩' },
  { name: 'apple', title: 'Apple' },
  { name: 'jobs', title: '酷工作' },
  { name: 'deals', title: '交易' },
  { name: 'city', title: '城市' },
  { name: 'qna', title: '问与答' },
];
