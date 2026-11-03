import Link from 'next/link';
import StaticPage from '@/components/StaticPage';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'V2EX › 找回密码' };

export default function ForgotPage() {
  return (
    <StaticPage
      title="找回密码"
      breadcrumb="找回密码"
      rightbar={
        <div className="box">
          <div className="cell">
            <strong>需要帮助？</strong>
            <div className="sep5" />
            <span className="fade">
              先看看 <Link href="/faq">FAQ</Link>，常见问题都有说明。
            </span>
          </div>
        </div>
      }
    >
      <h1>找回密码</h1>

      <p>
        本演示环境未接入邮件服务，因此不提供自助重置密码功能。
      </p>

      <h2>可用的替代方案</h2>
      <ul>
        <li>
          如果你记得当前密码，可直接在 <Link href="/settings">个人设置</Link> 中修改。
        </li>
        <li>
          如果你拥有管理员账号，可由管理员在管理后台重置该账号密码。
        </li>
        <li>
          忘记密码且无法联系管理员时，只能重新注册一个新账号。
        </li>
      </ul>

      <h2>为什么不做邮件重置</h2>
      <p>
        邮件重置需要配置 SMTP 服务并在服务端保存邮件发送凭据，
        这超出了本复刻工程的范围。生产部署时可直接接入标准邮件服务商实现该流程。
      </p>

      <hr />
      <p className="f12 fade">
        本页为独立复刻项目的说明文档，非 V2EX 官方内容。
      </p>
    </StaticPage>
  );
}
