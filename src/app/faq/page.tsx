import Link from 'next/link';
import StaticPage from '@/components/StaticPage';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'V2EX › FAQ' };

export default function FaqPage() {
  return (
    <StaticPage title="FAQ" breadcrumb="FAQ">
      <h1>V2EX FAQ</h1>

      <h2>V2EX 是什么意思？</h2>
      <p>
        V2EX 是 way to explore 和 way too extreme 的缩写。前者是我们每天都产生的探索世界的好奇心，
        而后者，是我们将一件事情做到极致的态度和决心。
      </p>

      <h2>V2EX 网站的主题是什么？</h2>
      <p>
        V2EX 是一个专业的技术社区。这里存在的主要意义是帮助会员们解决具体技术问题。同时，
        这里也是一个大家可以获得更多机会和反馈的地方 —— 你可以在这里{' '}
        <Link href="/go/jobs">发布招聘</Link>，或是 <Link href="/go/create">发布作品</Link>。
      </p>

      <h2>如何联系 V2EX？</h2>
      <p>
        如果你发现了网站的问题，或是你的账号遇到了难以解决的问题，可以通过
        <Link href="/settings">个人设置</Link> 页面查看账号信息。
      </p>

      <h2>如何发帖？</h2>
      <p>
        登录后点击顶部的 <Link href="/go/new">发布主题</Link>，选择节点并填写标题与正文。
        正文支持 Markdown 语法，包括段落、列表、代码块、引用与表格。
      </p>

      <h2>如何收藏？</h2>
      <p>
        收藏主题与收藏节点是两个独立的功能：
      </p>
      <ul>
        <li>
          <strong>收藏主题</strong>：在主题详情页点击「收藏」，主题会出现在{' '}
          <Link href="/bookmarks">我的收藏</Link> 页面。
        </li>
        <li>
          <strong>收藏节点</strong>：在节点页点击「加入收藏」，节点会出现在{' '}
          <Link href="/bookmarks">我的收藏</Link> 页面。
        </li>
      </ul>
      <p>
        注意：「关注」指的是关注站内的<strong>用户</strong>，与收藏节点不是一回事。
      </p>

      <h2>积分与铜币是怎么获得的？</h2>
      <p>
        发布主题可以获得积分。积分可以在 <Link href={`/member/`}>个人主页</Link> 查看。
      </p>

      <h2>为什么我的回复没有出现在页面上？</h2>
      <p>
        回复是分页显示的，每页 20 条。如果你在第一页没看到自己的回复，请翻到最后一页 ——
        新回复总是出现在最新的一页。
      </p>

      <h2>发帖有限流吗？</h2>
      <p>
        有。为了保证社区质量，登录、注册、发帖、回复、创建节点等操作都设有速率限制。
        触发限制时会收到明确的提示与等待时间。
      </p>

      <hr />
      <p className="f12 fade">
        本页为独立复刻项目的说明文档，非 V2EX 官方内容。
      </p>
    </StaticPage>
  );
}
