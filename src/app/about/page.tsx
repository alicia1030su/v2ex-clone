import Link from 'next/link';
import StaticPage from '@/components/StaticPage';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'V2EX › About' };

export default function AboutPage() {
  return (
    <StaticPage title="About" breadcrumb="About">
      <h1>About V2EX</h1>
      <div className="sep10" />

      <p>
        V2EX is a community of start-ups, designers, developers and creative people.
      </p>
      <p>V2EX 是创意工作者们的社区。这里汇聚了来自互联网行业、游戏行业和媒体行业的创意工作者。V2EX 希望能够成为创意工作者们的生活和事业的一部分。</p>
      <p>希望大家能够多多分享自己正在做的有趣事物、交流想法，在这里找到朋友甚至新的机会。并且，最重要的是，在这一切的过程中，保持对他人的友善。</p>

      <p>为了保持这里的良好氛围，V2EX 有自己的明确规则：</p>
      <ul>
        <li>这里绝对不讨论任何有关盗版软件、音乐、电影如何获得的问题</li>
        <li>这里绝对不会全文转载任何文章，而只会以链接方式分享</li>
        <li>这里绝对不会有任何教人如何钻空子的讨论</li>
        <li>这里感激和崇尚美的事物</li>
        <li>这里尊重原创</li>
        <li>这里反对中文互联网上的无信息量习惯如「顶」「沙发」「前排」「留名」「路过」</li>
        <li>这里禁止发布人身攻击、仇恨、暴力、侮辱性的言辞、暴露他人隐私的「人肉贴」</li>
        <li>当你在网上发帖时，请考虑到你所做的一切，会受到你所在地区法律的管辖</li>
        <li>请不要把 AI 生成的内容发送到这里</li>
        <li>如果你要教别人做事，请确认那件事情是你自己确实已经做过并且做得很好的</li>
      </ul>

      <hr />
      <p>
        V2EX 是一个<strong>独立复刻项目</strong>，用于技术研究与高保真界面还原演示。
        本站不是 V2EX 官方站点，与 V2EX 无任何关联，也未复制其品牌素材或用户数据。
      </p>
      <p>
        社区规则与功能设计参考了 <Link href="/faq">FAQ</Link> 与{' '}
        <Link href="/about">About</Link> 页面的公开说明。
      </p>
    </StaticPage>
  );
}
