import Link from 'next/link';
import Wrapper from '@/components/Wrapper';
import ForgotPasswordForm from '@/components/ForgotPasswordForm';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'V2EX › 找回密码' };

/**
 * 找回密码页（v0.0.3）
 *
 * 服务端只渲染页面骨架，表单本身是客户端组件
 * （见 src/components/ForgotPasswordForm.tsx），调用
 * `POST /api/auth/forgot-password` 申请重置链接。
 *
 * 邮件里的链接指向 `/reset-password?token=xxx`。
 */
export default function ForgotPage() {
  return (
    <Wrapper
      rightbar={
        <div className="box">
          <div className="cell">
            <strong>需要帮助？</strong>
            <div className="sep5" />
            <span className="fade">
              先看看 <Link href="/faq">FAQ</Link>，常见问题都有说明。
            </span>
          </div>
          <div className="cell">
            <strong>仍记得密码？</strong>
            <div className="sep5" />
            <span className="fade">
              可直接在 <Link href="/settings">个人设置</Link> 中修改。
            </span>
          </div>
        </div>
      }
    >
      <div className="box">
        <div className="header">
          <Link href="/">V2EX</Link> <span className="chevron">&nbsp;›&nbsp;</span> 找回密码
        </div>

        <div className="cell">
          填写你注册时使用的邮箱，我们会发送一条包含重置链接的邮件。
          链接默认在 60 分钟后失效。
        </div>

        <ForgotPasswordForm />

        <div className="cell f12 gray">
          未收到邮件？先检查垃圾邮件目录；也可以确认该邮箱是否确实用于注册。
          重置成功后将需要使用新密码重新登录。
        </div>
      </div>
    </Wrapper>
  );
}
