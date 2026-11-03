import StaticPage from '@/components/StaticPage';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'V2EX › Privacy' };

export default function PrivacyPage() {
  return (
    <StaticPage title="Privacy" breadcrumb="Privacy">
      <h1>Privacy</h1>

      <h2>我们收集哪些信息</h2>
      <ul>
        <li>账号信息：用户名、邮箱（可选）、密码哈希（不可逆的 scrypt 摘要）</li>
        <li>内容信息：你发布的主题与回复</li>
        <li>技术信息：会话标识、User-Agent、IP 地址（用于会话管理与速率限制）</li>
      </ul>

      <h2>我们如何使用这些信息</h2>
      <ul>
        <li>维持登录状态与账号安全</li>
        <li>对暴力登录与批量注册等行为进行速率限制</li>
        <li>在回复你发布的主题时向你发送站内通知</li>
      </ul>

      <h2>我们不做什么</h2>
      <ul>
        <li>不出售、不出租、不向第三方出售你的个人信息</li>
        <li>不使用第三方广告追踪器</li>
        <li>不收集你的通讯录、相册或位置信息</li>
      </ul>

      <h2>你的控制权</h2>
      <p>
        你可以在 <code>/settings</code> 随时修改头衔、简介、个人主页与所在地，
        也可以修改登录密码。删除账号请联系管理员。
      </p>

      <h2>数据存储</h2>
      <p>
        密码以 scrypt 加盐哈希存储，服务端不保存明文。验证码答案同样只存哈希，
        且为一次性使用。
      </p>

      <hr />
      <p className="f12 fade">
        本页为独立复刻项目的说明文档，非 V2EX 官方内容。
      </p>
    </StaticPage>
  );
}
